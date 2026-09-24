/**
 * Screen-space overlays drawn on top of the (zoomed, y-flipped) diagram layer so that handle
 * sizes and label fonts stay in CSS pixels: component name labels, selection outlines with
 * corner handles and the rotation handle, selected-connection corner handles, the rubber band
 * and the connection-target highlight.
 */
import type { ComponentView, ConnectionView, Extent, Point } from '@impact/core';
import type { Viewport } from '../../store/types';
import { componentBounds, diagramToScreen, extentCorners, iconHasNameText, rotatePoint, type PortAnchor } from './geometry';
import type { InteractionState } from './useInteractions';

const HANDLE = 6;
const ROTATE_OFFSET = 14;
const ROTATE_RADIUS = 6;

function liveDeltaFor(state: InteractionState, name: string): Point | undefined {
  return state.kind === 'move' && state.names.includes(name) ? state.delta : undefined;
}

function screenCorners(c: ComponentView, vp: Viewport, state: InteractionState): Point[] {
  const bounds: Extent = componentBounds(c);
  let corners = extentCorners(bounds);
  const delta = liveDeltaFor(state, c.name);
  if (delta) corners = corners.map(([x, y]): Point => [x + delta[0], y + delta[1]]);
  if (state.kind === 'rotate' && state.name === c.name && state.delta !== 0) corners = corners.map((p) => rotatePoint(p, state.center, state.delta));
  return corners.map((p) => diagramToScreen(vp, p));
}

export function LabelsLayer({ components, vp, state }: { components: ComponentView[]; vp: Viewport; state: InteractionState }) {
  return (
    <g className="canvas-labels" pointerEvents="none">
      {components.map((c) => {
        if (iconHasNameText(c) || c.placement.visible === false) return null;
        const b = componentBounds(c);
        let x = (b[0][0] + b[1][0]) / 2;
        let y = Math.min(b[0][1], b[1][1]);
        const delta = liveDeltaFor(state, c.name);
        if (delta) {
          x += delta[0];
          y += delta[1];
        }
        const [sx, sy] = diagramToScreen(vp, [x, y]);
        return (
          <text key={c.name} className="component-label" x={sx} y={sy + 14} textAnchor="middle" fontSize={12} opacity={c.disabled ? 0.4 : undefined}>
            {c.name}
          </text>
        );
      })}
    </g>
  );
}

export interface SelectionLayerProps {
  components: ComponentView[];
  selection: string[];
  selectedConnection?: ConnectionView;
  vp: Viewport;
  state: InteractionState;
  readOnly: boolean;
}

export function SelectionLayer({ components, selection, selectedConnection, vp, state, readOnly }: SelectionLayerProps) {
  const selected = selection.map((n) => components.find((c) => c.name === n)).filter((c): c is ComponentView => !!c);
  const connPoints = state.kind === 'editConnection' && selectedConnection && state.equationIndex === selectedConnection.equationIndex ? state.points : selectedConnection?.line.points;
  return (
    <g className="canvas-selection">
      {selected.map((c) => {
        const pts = screenCorners(c, vp, state);
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        const right = Math.max(...xs);
        const top = Math.min(...ys);
        const poly = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
        return (
          <g key={c.name} className="selection-outline">
            <polygon points={poly} className="selection-rect" />
            {pts.map((p, i) => (
              <rect key={i} className="selection-handle" x={p[0] - HANDLE / 2} y={p[1] - HANDLE / 2} width={HANDLE} height={HANDLE} />
            ))}
            {!readOnly && !c.isConnector && (
              <g className="rotation-handle" data-handle="rotate" data-component={c.name}>
                <line x1={right} y1={top} x2={right} y2={top - ROTATE_OFFSET} className="rotation-line" />
                <circle cx={right} cy={top - ROTATE_OFFSET} r={ROTATE_RADIUS} className="rotation-knob" />
              </g>
            )}
          </g>
        );
      })}
      {selectedConnection && connPoints && connPoints.length > 2 && (
        <g className="connection-handles">
          {connPoints.map((p, i) => {
            if (i === 0 || i === connPoints.length - 1) return null;
            const [sx, sy] = diagramToScreen(vp, p);
            return (
              <rect
                key={i}
                className="selection-handle connection-handle"
                data-connection={readOnly ? undefined : selectedConnection.equationIndex}
                x={sx - HANDLE / 2}
                y={sy - HANDLE / 2}
                width={HANDLE}
                height={HANDLE}
              />
            );
          })}
        </g>
      )}
    </g>
  );
}

export function RubberBand({ state, vp }: { state: InteractionState; vp: Viewport }) {
  if (state.kind !== 'rubber') return null;
  const a = diagramToScreen(vp, state.start);
  const b = diagramToScreen(vp, state.current);
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  const w = Math.abs(a[0] - b[0]);
  const h = Math.abs(a[1] - b[1]);
  if (w < 1 && h < 1) return null;
  return <rect className="rubber-band" x={x} y={y} width={w} height={h} />;
}

export function ConnectTargetHighlight({ target, vp }: { target?: PortAnchor; vp: Viewport }) {
  if (!target) return null;
  const [sx, sy] = diagramToScreen(vp, target.center);
  return <circle className="connect-target" cx={sx} cy={sy} r={9} />;
}
