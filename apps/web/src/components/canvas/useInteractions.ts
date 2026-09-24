/**
 * Pointer state machine of the diagram: selection, rubber band, moving, rotating, connecting,
 * connection-line editing and panning. Pointer events are handled on the root <svg> (with
 * pointer capture); the element under the pointer is identified via `data-*` attributes:
 * `data-component`, `data-port`, `data-connection`, `data-handle`.
 *
 * Every committed change is a single `EditOperation` applied through the store on pointer up:
 *  - drag components → `moveComponents`
 *  - rotation handle  → `rotateComponent`
 *  - port to port     → `addConnection`
 *  - segment/corner   → `setConnectionPoints`
 *
 * The model's own connectors (`isConnector`) double as ports: dragging an *unselected* one draws
 * a connection, a plain click selects it and a selected one is moved like any other component.
 * Inherited connections (`equationIndex` -1) can be selected for inspection (by their index in
 * `diagram.connections`) but never dragged, edited or deleted.
 */
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent, RefObject } from 'react';
import type { DiagramView, Point } from '@impact/core';
import { useStore } from '../../store';
import type { Viewport } from '../../store/types';
import { useContextMenu } from '../common/ContextMenu';
import { useShellActions } from '../shell/shellActions';
import type { MenuItem } from '../common/ContextMenu';
import { Icon } from '../icons';
import { clipboardSize, copyComponents, pasteComponents } from './clipboard';
import {
  angleBetween,
  classifyPort,
  componentCenter,
  componentsInRect,
  dedupePoints,
  domainColor,
  dragCorner,
  dragSegment,
  findPortAt,
  insertCorner,
  nearestCorner,
  nearestSegment,
  orthogonalRoute,
  screenToDiagram,
  shortClassName,
  snapAngle,
  snapDelta,
  type PortAnchor,
} from './geometry';
import type { ViewportApi } from './useViewport';
import type { TooltipState } from './CanvasTooltip';
import { canvasOwnsKey, isPointerOver } from './keyScope';

const DRAG_THRESHOLD_PX = 3;
const PORT_TOLERANCE_PX = 6;
const CORNER_TOLERANCE_PX = 8;

export type ConnectionEditMode = { type: 'segment'; index: number } | { type: 'corner'; index: number };

export type InteractionState =
  | { kind: 'idle' }
  | { kind: 'pan'; startClient: Point; startVp: Viewport }
  | {
      kind: 'press';
      name: string;
      startScreen: Point;
      start: Point;
      additive: boolean;
      wasSelected: boolean;
      /** Set for a press on an unselected own connector: dragging starts a connection from it instead of moving it. */
      connectFrom?: PortAnchor;
    }
  | { kind: 'move'; names: string[]; start: Point; delta: Point }
  | { kind: 'rubber'; start: Point; current: Point; additive: boolean }
  | { kind: 'rotate'; name: string; center: Point; startPoint: Point; delta: number }
  | { kind: 'connect'; from: PortAnchor; current: Point; target?: PortAnchor }
  | { kind: 'pressConnection'; equationIndex: number; startScreen: Point; start: Point }
  | { kind: 'editConnection'; equationIndex: number; original: Point[]; points: Point[]; mode: ConnectionEditMode; start: Point };

const IDLE: InteractionState = { kind: 'idle' };

export interface InteractionOptions {
  svgRef: RefObject<SVGSVGElement | null>;
  diagram: DiagramView | undefined;
  viewport: ViewportApi;
  readOnly: boolean;
  anchors: PortAnchor[];
  onTooltip(tip: TooltipState | undefined): void;
}

export interface InteractionHandlers {
  onPointerDown(e: ReactPointerEvent<SVGSVGElement>): void;
  onPointerMove(e: ReactPointerEvent<SVGSVGElement>): void;
  onPointerUp(e: ReactPointerEvent<SVGSVGElement>): void;
  onPointerCancel(e: ReactPointerEvent<SVGSVGElement>): void;
  onDoubleClick(e: ReactMouseEvent<SVGSVGElement>): void;
  onContextMenu(e: ReactMouseEvent<SVGSVGElement>): void;
  onPointerOver(e: ReactPointerEvent<SVGSVGElement>): void;
  onPointerOut(e: ReactPointerEvent<SVGSVGElement>): void;
}

export interface InteractionApi {
  state: InteractionState;
  handlers: InteractionHandlers;
  spaceHeld: boolean;
  /** Index (in `diagram.connections`) of the inherited connection last clicked; meaningful while `store.selectedConnection === -1`. */
  inheritedSelection: number | undefined;
  cancel(): void;
  deleteSelection(): void;
  copySelection(): void;
  paste(): Promise<void>;
}

function attr(target: EventTarget | null, selector: string, name: string): string | undefined {
  const el = target instanceof Element ? target.closest(selector) : null;
  const v = el?.getAttribute(name);
  return v ?? undefined;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function useInteractions({ svgRef, diagram, viewport, readOnly, anchors, onTooltip }: InteractionOptions): InteractionApi {
  const [state, setState] = useState<InteractionState>(IDLE);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [spaceHeld, setSpaceHeld] = useState(false);
  const spaceRef = useRef(false);
  const [inheritedSelection, setInheritedSelection] = useState<number | undefined>(undefined);
  const ctx = useContextMenu();
  const shell = useShellActions();

  const anchorsByRef = useMemo(() => new Map(anchors.map((a) => [a.ref, a])), [anchors]);
  const componentsByName = useMemo(() => new Map((diagram?.components ?? []).map((c) => [c.name, c])), [diagram]);

  const toDiagram = useCallback(
    (clientX: number, clientY: number): { screen: Point; point: Point } => {
      const screen = viewport.clientToScreen(clientX, clientY);
      return { screen, point: screenToDiagram(viewport.vp, screen) };
    },
    [viewport],
  );

  const update = useCallback((next: InteractionState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const release = useCallback(
    (e?: ReactPointerEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (svg && e && svg.hasPointerCapture(e.pointerId)) {
        try {
          svg.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
      update(IDLE);
    },
    [svgRef, update],
  );

  // Space key → temporary pan mode.
  useEffect(() => {
    const isEditable = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isEditable(e.target)) return;
      if (!spaceRef.current) {
        spaceRef.current = true;
        setSpaceHeld(true);
      }
      // Swallow the key (page scroll) only when it is aimed at the diagram — focus on it, or nothing
      // focused while the pointer is over it. A focused button elsewhere must still be activated by Space.
      if (stateRef.current.kind === 'idle' && !e.defaultPrevented) {
        const svg = svgRef.current;
        if (canvasOwnsKey(svg, e.target, isPointerOver(svg), document.body)) e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceRef.current = false;
        setSpaceHeld(false);
      }
    };
    const blur = () => {
      spaceRef.current = false;
      setSpaceHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [svgRef]);

  // ------------------------------------------------------------------ actions

  const deleteSelection = useCallback(() => {
    const s = useStore.getState();
    if (readOnly) return;
    if (s.selectedConnection !== undefined) {
      if (s.selectedConnection < 0) return; // inherited connection: read-only
      void s.applyEdit({ op: 'deleteConnection', equationIndex: s.selectedConnection });
      s.select([]);
    } else if (s.selection.length) {
      void s.applyEdit({ op: 'deleteComponents', names: s.selection });
      s.select([]);
    }
  }, [readOnly]);

  const copySelection = useCallback(() => {
    const s = useStore.getState();
    copyComponents(s.diagram, s.selection);
  }, []);

  const paste = useCallback(async () => {
    if (readOnly) return;
    const s = useStore.getState();
    const created = await pasteComponents((op) => s.applyEdit(op));
    if (created.length) useStore.getState().select(created);
  }, [readOnly]);

  const cancel = useCallback(() => {
    if (stateRef.current.kind !== 'idle') update(IDLE);
    else {
      const s = useStore.getState();
      if (s.selection.length || s.selectedConnection !== undefined) s.select([]);
    }
  }, [update]);

  // ------------------------------------------------------------------ pointer handlers

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg || !diagram) return;
      onTooltip(undefined);
      const capture = () => {
        try {
          svg.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      };
      const { screen, point } = toDiagram(e.clientX, e.clientY);
      const store = useStore.getState();

      if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
        e.preventDefault();
        capture();
        update({ kind: 'pan', startClient: [e.clientX, e.clientY], startVp: viewport.vp });
        return;
      }
      if (e.button !== 0) return;

      const handle = attr(e.target, '[data-handle]', 'data-handle');
      if (handle === 'rotate') {
        const name = attr(e.target, '[data-handle]', 'data-component');
        const comp = name ? componentsByName.get(name) : undefined;
        if (comp && !readOnly) {
          capture();
          // Pivot on the visual centre: core's `rotateComponent` re-centres the transformation, so the
          // preview must turn about the same point (the origin is {0,0} for unrotated components).
          update({ kind: 'rotate', name: comp.name, center: componentCenter(comp), startPoint: point, delta: 0 });
        }
        return;
      }

      const portRef = attr(e.target, '[data-port]', 'data-port');
      if (portRef && !readOnly) {
        const anchor = anchorsByRef.get(portRef);
        // Ports of components start a connection right away; the model's own connectors carry
        // `data-port` too but are components (selectable/movable) — handled below.
        if (anchor && anchor.port !== undefined) {
          capture();
          update({ kind: 'connect', from: anchor, current: anchor.center });
          return;
        }
      }

      const compName = attr(e.target, '[data-component]', 'data-component');
      const comp = compName ? componentsByName.get(compName) : undefined;
      if (comp) {
        const additive = e.shiftKey;
        const wasSelected = store.selection.includes(comp.name);
        const connectFrom = comp.isConnector && !readOnly && !wasSelected && !additive ? anchorsByRef.get(comp.name) : undefined;
        if (!connectFrom) {
          if (!wasSelected) store.select(additive ? [...store.selection, comp.name] : [comp.name]);
          else if (store.selectedConnection !== undefined) store.select(store.selection);
        }
        capture();
        update({ kind: 'press', name: comp.name, startScreen: screen, start: point, additive, wasSelected, connectFrom });
        return;
      }

      const connAttr = attr(e.target, '[data-connection]', 'data-connection');
      if (connAttr !== undefined) {
        const idx = Number(connAttr);
        if (Number.isInteger(idx) && idx >= 0) {
          store.select([], idx);
          capture();
          update({ kind: 'pressConnection', equationIndex: idx, startScreen: screen, start: point });
          return;
        }
      }

      const inheritedAttr = attr(e.target, '[data-connection-inherited]', 'data-connection-inherited');
      if (inheritedAttr !== undefined) {
        const i = Number(inheritedAttr);
        if (Number.isInteger(i) && i >= 0) {
          // Selectable for inspection only: no drag/edit state is entered.
          setInheritedSelection(i);
          store.select([], -1);
          return;
        }
      }

      capture();
      update({ kind: 'rubber', start: point, current: point, additive: e.shiftKey });
    },
    [svgRef, diagram, toDiagram, update, viewport.vp, componentsByName, anchorsByRef, readOnly, onTooltip],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const st = stateRef.current;
      if (st.kind === 'idle' || !diagram) return;
      const { screen, point } = toDiagram(e.clientX, e.clientY);
      const scale = viewport.vp.scale;
      switch (st.kind) {
        case 'pan':
          viewport.set({ scale: st.startVp.scale, tx: st.startVp.tx + (e.clientX - st.startClient[0]), ty: st.startVp.ty + (e.clientY - st.startClient[1]) });
          return;
        case 'press': {
          if (dist(screen, st.startScreen) < DRAG_THRESHOLD_PX || readOnly) return;
          if (st.connectFrom) {
            const hit = findPortAt(anchors, point, PORT_TOLERANCE_PX / scale);
            const target = hit && hit.ref !== st.connectFrom.ref && classifyPort(st.connectFrom, hit) === 'compatible' ? hit : undefined;
            update({ kind: 'connect', from: st.connectFrom, current: point, target });
            return;
          }
          const selection = useStore.getState().selection;
          const names = selection.includes(st.name) ? selection.filter((n) => componentsByName.has(n)) : [st.name];
          update({ kind: 'move', names, start: st.start, delta: [point[0] - st.start[0], point[1] - st.start[1]] });
          return;
        }
        case 'move':
          update({ ...st, delta: [point[0] - st.start[0], point[1] - st.start[1]] });
          return;
        case 'rubber':
          update({ ...st, current: point });
          return;
        case 'rotate': {
          const raw = angleBetween(st.center, st.startPoint, point);
          update({ ...st, delta: snapAngle(raw, e.shiftKey ? 15 : 90) });
          return;
        }
        case 'connect': {
          const hit = findPortAt(anchors, point, PORT_TOLERANCE_PX / scale);
          const target = hit && hit.ref !== st.from.ref && classifyPort(st.from, hit) === 'compatible' ? hit : undefined;
          update({ ...st, current: point, target });
          return;
        }
        case 'pressConnection': {
          if (dist(screen, st.startScreen) < DRAG_THRESHOLD_PX || readOnly) return;
          const conn = diagram.connections.find((c) => c.equationIndex === st.equationIndex);
          if (!conn || conn.line.points.length < 2) return;
          const original = conn.line.points.map((p): Point => [p[0], p[1]]);
          const corner = nearestCorner(original, st.start, CORNER_TOLERANCE_PX / scale);
          const mode: ConnectionEditMode = corner >= 0 ? { type: 'corner', index: corner } : { type: 'segment', index: nearestSegment(original, st.start)?.index ?? 0 };
          const delta: Point = [point[0] - st.start[0], point[1] - st.start[1]];
          const points = mode.type === 'corner' ? dragCorner(original, mode.index, delta) : dragSegment(original, mode.index, delta);
          update({ kind: 'editConnection', equationIndex: st.equationIndex, original, points, mode, start: st.start });
          return;
        }
        case 'editConnection': {
          const delta: Point = [point[0] - st.start[0], point[1] - st.start[1]];
          const points = st.mode.type === 'corner' ? dragCorner(st.original, st.mode.index, delta) : dragSegment(st.original, st.mode.index, delta);
          update({ ...st, points });
          return;
        }
      }
    },
    [diagram, toDiagram, viewport, readOnly, componentsByName, anchors, update],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const st = stateRef.current;
      const store = useStore.getState();
      switch (st.kind) {
        case 'press':
          if (st.connectFrom) store.select([st.name]); // plain click on an unselected own connector selects it
          else if (st.additive && st.wasSelected) store.select(store.selection.filter((n) => n !== st.name));
          break;
        case 'move': {
          const delta = snapDelta(st.delta, store.settings.snapping);
          if (delta[0] !== 0 || delta[1] !== 0) void store.applyEdit({ op: 'moveComponents', names: st.names, delta });
          break;
        }
        case 'rubber': {
          const { point } = toDiagram(e.clientX, e.clientY);
          const moved = dist(st.start, point) * viewport.vp.scale >= DRAG_THRESHOLD_PX;
          if (!moved) {
            if (!st.additive) store.select([]);
          } else if (diagram) {
            const hit = componentsInRect(diagram.components, [st.start, point]);
            store.select(st.additive ? Array.from(new Set([...store.selection, ...hit])) : hit);
          }
          break;
        }
        case 'rotate':
          if (st.delta !== 0) void store.applyEdit({ op: 'rotateComponent', name: st.name, deltaDegrees: st.delta });
          break;
        case 'connect':
          if (st.target) {
            void store.applyEdit({
              op: 'addConnection',
              from: st.from.ref,
              to: st.target.ref,
              points: orthogonalRoute(st.from.center, st.target.center),
              color: domainColor(st.from.className),
            });
          }
          break;
        case 'editConnection': {
          const points = dedupePoints(st.points);
          const changed = points.length !== st.original.length || points.some((p, i) => p[0] !== st.original[i][0] || p[1] !== st.original[i][1]);
          if (changed && points.length >= 2) void store.applyEdit({ op: 'setConnectionPoints', equationIndex: st.equationIndex, points });
          break;
        }
        default:
          break;
      }
      release(e);
    },
    [toDiagram, viewport.vp.scale, diagram, release],
  );

  const onPointerCancel = useCallback((e: ReactPointerEvent<SVGSVGElement>) => release(e), [release]);

  const onDoubleClick = useCallback(
    (e: ReactMouseEvent<SVGSVGElement>) => {
      const store = useStore.getState();
      const compName = attr(e.target, '[data-component]', 'data-component');
      if (compName && componentsByName.has(compName)) {
        store.select([compName]);
        store.setDetailsTab('PROPERTIES');
        store.setDetailsOpen(true);
        return;
      }
      const connAttr = attr(e.target, '[data-connection]', 'data-connection');
      if (connAttr !== undefined && diagram && !readOnly) {
        const idx = Number(connAttr);
        if (!Number.isInteger(idx) || idx < 0) return;
        const conn = diagram.connections.find((c) => c.equationIndex === idx);
        if (!conn) return;
        const { point } = toDiagram(e.clientX, e.clientY);
        const hit = nearestSegment(conn.line.points, point);
        if (!hit) return;
        void store.applyEdit({ op: 'setConnectionPoints', equationIndex: idx, points: insertCorner(conn.line.points, hit.index, hit.projection) });
      }
    },
    [componentsByName, diagram, readOnly, toDiagram],
  );

  const onContextMenu = useCallback(
    (e: ReactMouseEvent<SVGSVGElement>) => {
      e.preventDefault();
      if (stateRef.current.kind !== 'idle') return;
      const store = useStore.getState();
      const compName = attr(e.target, '[data-component]', 'data-component');
      const comp = compName ? componentsByName.get(compName) : undefined;
      if (comp) {
        if (!store.selection.includes(comp.name)) store.select([comp.name]);
        const name = comp.name;
        const items: MenuItem[] = [
          { label: 'Rotate 90° clockwise', icon: createElement(Icon.Rotate), disabled: readOnly, onSelect: () => void store.applyEdit({ op: 'rotateComponent', name, deltaDegrees: -90 }) },
          { label: 'Rotate 90° counter-clockwise', icon: createElement(Icon.RotateLeft), disabled: readOnly, onSelect: () => void store.applyEdit({ op: 'rotateComponent', name, deltaDegrees: 90 }) },
          { label: 'Flip horizontal', icon: createElement(Icon.Flip), disabled: readOnly, onSelect: () => void store.applyEdit({ op: 'flipComponent', name, axis: 'horizontal' }) },
          { label: 'Flip vertical', icon: createElement(Icon.Flip, { style: { transform: 'rotate(90deg)' } }), disabled: readOnly, onSelect: () => void store.applyEdit({ op: 'flipComponent', name, axis: 'vertical' }) },
          { separator: true },
          { label: 'Rename…', icon: createElement(Icon.Edit), disabled: readOnly, onSelect: () => shell.openRename({ kind: 'component', name }) },
          { label: 'Show documentation', icon: createElement(Icon.Description), onSelect: () => shell.showDocumentation(comp.className) },
          { label: 'Open class', icon: createElement(Icon.OpenInNew), onSelect: () => store.openClass(comp.className) },
          { separator: true },
          { label: 'Copy', icon: createElement(Icon.ContentCopy), shortcut: 'Ctrl+C', onSelect: () => copyComponents(store.diagram, store.selection.includes(name) ? store.selection : [name]) },
          { label: 'Delete', icon: createElement(Icon.Delete), shortcut: 'Del', danger: true, disabled: readOnly, onSelect: () => deleteSelection() },
        ];
        ctx.open(e, items);
        return;
      }
      const connAttr = attr(e.target, '[data-connection]', 'data-connection');
      if (connAttr !== undefined) {
        const idx = Number(connAttr);
        if (Number.isInteger(idx) && idx >= 0) {
          store.select([], idx);
          ctx.open(e, [{ label: 'Delete connection', icon: createElement(Icon.Delete), danger: true, disabled: readOnly, onSelect: () => void store.applyEdit({ op: 'deleteConnection', equationIndex: idx }) }]);
          return;
        }
      }
      const inheritedAttr = attr(e.target, '[data-connection-inherited]', 'data-connection-inherited');
      if (inheritedAttr !== undefined) {
        const i = Number(inheritedAttr);
        if (Number.isInteger(i) && i >= 0) {
          setInheritedSelection(i);
          store.select([], -1);
          ctx.open(e, [
            { label: 'Inherited connection', header: true },
            { label: 'Delete connection', icon: createElement(Icon.Delete), danger: true, disabled: true },
          ]);
          return;
        }
      }
      const showGrid = store.settings.showGrid;
      ctx.open(e, [
        { label: 'Paste', shortcut: 'Ctrl+V', disabled: readOnly || clipboardSize() === 0, onSelect: () => void paste() },
        { label: 'Fit to view', icon: createElement(Icon.FitScreen), shortcut: 'F', onSelect: () => viewport.fit() },
        { label: 'Show grid', icon: createElement(Icon.Grid), checked: showGrid, onSelect: () => store.updateSettings({ showGrid: !showGrid }) },
      ]);
    },
    [componentsByName, readOnly, ctx, shell, deleteSelection, paste, viewport],
  );

  const onPointerOver = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (stateRef.current.kind !== 'idle') return;
      if (attr(e.target, '[data-connection-inherited]', 'data-connection-inherited') !== undefined) {
        onTooltip({ x: e.clientX, y: e.clientY, text: 'Inherited connection' });
        return;
      }
      const ref = attr(e.target, '[data-port]', 'data-port');
      if (!ref) return;
      const anchor = anchorsByRef.get(ref);
      if (anchor) onTooltip({ x: e.clientX, y: e.clientY, text: `${ref} (${shortClassName(anchor.className)})` });
    },
    [anchorsByRef, onTooltip],
  );

  const onPointerOut = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (attr(e.target, '[data-port]', 'data-port') || attr(e.target, '[data-connection-inherited]', 'data-connection-inherited') !== undefined) onTooltip(undefined);
    },
    [onTooltip],
  );

  const handlers = useMemo<InteractionHandlers>(
    () => ({ onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onDoubleClick, onContextMenu, onPointerOver, onPointerOut }),
    [onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onDoubleClick, onContextMenu, onPointerOver, onPointerOut],
  );

  return { state, handlers, spaceHeld, inheritedSelection, cancel, deleteSelection, copySelection, paste };
}
