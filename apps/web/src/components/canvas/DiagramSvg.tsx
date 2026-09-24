/**
 * The SVG scene of the model canvas. Root group `matrix(s 0 0 -s tx ty)` maps Modelica
 * y-up diagram coordinates to the screen; inside it: optional line grid, the class's own
 * Diagram-layer graphics, connections, components (with ports) and the connection preview.
 * Screen-space overlays (result frames, labels, selection, rubber band) live in a sibling group.
 */
import { useCallback, useId, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { Causality, ClassRegistry, DiagramView } from '@impact/core';
import { colorToCss, matrixToSvg } from '@impact/core';
import { useStore } from '../../store';
import { GraphicsItems, polyPath } from '../graphics/GraphicsLayerSvg';
import { CanvasTooltip, type TooltipState } from './CanvasTooltip';
import { ComponentNode } from './ComponentNode';
import { ConnectionPath } from './ConnectionPath';
import { ConnectTargetHighlight, LabelsLayer, ResultFrames, RubberBand, SelectionLayer } from './SelectionLayer';
import { collectPortAnchors, domainColor, GRID_STEP, orthogonalRoute, snapDelta, visibleExtent, type ConnectorInfo } from './geometry';
import { useInteractions, type InteractionApi, type InteractionState } from './useInteractions';
import type { ViewportApi } from './useViewport';

const EMPTY_SELECTION: string[] = [];

/** Causality / physical classification of connector classes (for the model's own connectors), cached per registry version. */
function makeConnectorInfo(registry: ClassRegistry): (className: string) => ConnectorInfo {
  const cache = new Map<string, ConnectorInfo>();
  const visit = (className: string, seen: Set<string>): ConnectorInfo => {
    let causality: Causality = 'none';
    let physical = false;
    for (const cls of registry.inheritanceChain(className)) {
      const sc = cls.def.shortClass;
      if (sc) {
        if (sc.input) causality = 'input';
        if (sc.output) causality = 'output';
        if (sc.flow) physical = true;
        if (!seen.has(sc.typeName)) {
          seen.add(sc.typeName);
          const base = registry.lookup(sc.typeName, cls.fullName);
          if (base && !base.builtin && base.fullName !== className) {
            const bi = visit(base.fullName, seen);
            if (causality === 'none') causality = bi.causality;
            physical = physical || bi.physical;
          }
        }
      }
      for (const c of cls.def.components) if (c.prefixes.flow) physical = true;
    }
    return { causality, physical };
  };
  return (className) => {
    let v = cache.get(className);
    if (!v) {
      v = visit(className, new Set([className]));
      cache.set(className, v);
    }
    return v;
  };
}

export interface DiagramSvgProps {
  diagram: DiagramView | undefined;
  viewport: ViewportApi;
  readOnly: boolean;
  showGrid: boolean;
  /** Exposes the interaction API (cancel/delete/copy/paste) to the container for keyboard shortcuts. */
  interactionsRef: MutableRefObject<InteractionApi | null>;
}

export function DiagramSvg({ diagram, viewport, readOnly, showGrid, interactionsRef }: DiagramSvgProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gridId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const selection = useStore((s) => s.selection) ?? EMPTY_SELECTION;
  const selectedConnection = useStore((s) => s.selectedConnection);
  const snapping = useStore((s) => s.settings.snapping);
  const mode = useStore((s) => s.mode);
  const registryVersion = useStore((s) => s.registryVersion);
  const [tooltip, setTooltip] = useState<TooltipState | undefined>(undefined);
  const onTooltip = useCallback((tip: TooltipState | undefined) => setTooltip(tip), []);

  const connectorInfo = useMemo(() => makeConnectorInfo(useStore.getState().registry), [registryVersion]);
  const anchors = useMemo(() => (diagram ? collectPortAnchors(diagram, connectorInfo) : []), [diagram, connectorInfo]);

  const api = useInteractions({ svgRef, diagram, viewport, readOnly, anchors, onTooltip });
  interactionsRef.current = api;
  const { state } = api;

  // Snap the live move preview when snapping is on so the preview matches the committed move.
  const displayState: InteractionState = useMemo(() => (state.kind === 'move' && snapping ? { ...state, delta: snapDelta(state.delta, true) } : state), [state, snapping]);

  const selectedSet = useMemo(() => new Set(selection), [selection]);
  const connectFrom = state.kind === 'connect' ? state.from : undefined;
  const connection = useMemo(() => (selectedConnection !== undefined ? diagram?.connections.find((c) => c.equationIndex === selectedConnection) : undefined), [diagram, selectedConnection]);

  const liveTransform = (name: string): string | undefined => {
    if (displayState.kind === 'move' && displayState.names.includes(name)) return `translate(${displayState.delta[0]} ${displayState.delta[1]})`;
    if (displayState.kind === 'rotate' && displayState.name === name && displayState.delta !== 0) return `rotate(${displayState.delta} ${displayState.center[0]} ${displayState.center[1]})`;
    return undefined;
  };

  const { vp, size } = viewport;
  const grid = showGrid && size.width > 0 ? visibleExtent(vp, size.width, size.height) : undefined;
  const cursorState = state.kind === 'idle' ? (api.spaceHeld ? 'space' : 'idle') : state.kind;

  return (
    <>
      <svg
        ref={svgRef}
        className="diagram-svg"
        data-state={cursorState}
        width="100%"
        height="100%"
        onDragStart={(e) => e.preventDefault()}
        {...api.handlers}
      >
        <defs>
          {/* One vertical + one horizontal 1px line per 20-unit cell; the half-cell offset puts them on multiples of 20. */}
          <pattern id={gridId} x={-GRID_STEP / 2} y={-GRID_STEP / 2} width={GRID_STEP} height={GRID_STEP} patternUnits="userSpaceOnUse">
            <path className="grid-line" d={`M${GRID_STEP / 2} 0V${GRID_STEP}M0 ${GRID_STEP / 2}H${GRID_STEP}`} vectorEffect="non-scaling-stroke" />
          </pattern>
        </defs>
        <g className="diagram-root" transform={matrixToSvg(viewport.matrix)}>
          {grid && <rect className="grid-fill" x={grid[0][0]} y={grid[0][1]} width={grid[1][0] - grid[0][0]} height={grid[1][1] - grid[0][1]} fill={`url(#${gridId})`} pointerEvents="none" />}
          {grid && <circle className="grid-origin" cx={0} cy={0} r={1.5 / vp.scale} pointerEvents="none" />}
          {diagram && (
            <>
              <g className="diagram-graphics" pointerEvents="none">
                <GraphicsItems items={diagram.diagram.graphics} />
              </g>
              <g className="connections">
                {diagram.connections.map((c) => (
                  <ConnectionPath
                    key={c.equationIndex}
                    connection={c}
                    selected={c.equationIndex === selectedConnection}
                    livePoints={state.kind === 'editConnection' && state.equationIndex === c.equationIndex ? state.points : undefined}
                  />
                ))}
              </g>
              <g className="components">
                {diagram.components.map((c) => (
                  <ComponentNode
                    key={c.name}
                    component={c}
                    selected={selectedSet.has(c.name)}
                    liveTransform={liveTransform(c.name)}
                    connectFrom={connectFrom}
                    connectorInfo={c.isConnector ? connectorInfo(c.className) : undefined}
                  />
                ))}
              </g>
              {state.kind === 'connect' && (
                <path
                  className="connect-preview"
                  d={polyPath(orthogonalRoute(state.from.center, state.target?.center ?? state.current))}
                  fill="none"
                  stroke={colorToCss(domainColor(state.from.className))}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
              )}
            </>
          )}
        </g>
        {diagram && (
          <g className="screen-layer">
            {mode === 'results' && <ResultFrames components={diagram.components} vp={vp} />}
            <LabelsLayer components={diagram.components} vp={vp} state={displayState} />
            <SelectionLayer components={diagram.components} selection={selection} selectedConnection={connection} vp={vp} state={displayState} readOnly={readOnly} />
            <RubberBand state={displayState} vp={vp} />
            {state.kind === 'connect' && <ConnectTargetHighlight target={state.target} vp={vp} />}
          </g>
        )}
      </svg>
      <CanvasTooltip tip={state.kind === 'idle' ? tooltip : undefined} />
    </>
  );
}
