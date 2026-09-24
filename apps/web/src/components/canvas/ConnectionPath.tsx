/**
 * A `connect()` equation drawn as its `Line` annotation: polyline (or smoothed Bezier) in the
 * annotation colour, hairline thickness via non-scaling strokes, optional arrowheads, plus a
 * wide transparent hit path (10px) for selection. Selected connections get an accent glow.
 * Editable connections carry `data-connection=<equationIndex>`; inherited ones (equationIndex -1,
 * from a base class) carry `data-connection-inherited=<index in diagram.connections>` instead so
 * they can be selected and identified individually but never dragged, edited or deleted.
 */
import { memo, useId } from 'react';
import type { ConnectionView, Point } from '@impact/core';
import { colorToCss } from '@impact/core';
import { polyPath, smoothPath, strokePx } from '../graphics/GraphicsLayerSvg';

export interface ConnectionPathProps {
  connection: ConnectionView;
  /** Index in `diagram.connections` (identity of inherited connections, whose equationIndex is -1). */
  index: number;
  selected: boolean;
  /** Points shown while the line is being edited (diagram coordinates). */
  livePoints?: Point[];
}

function dash(pattern: ConnectionView['line']['pattern'], px: number): string | undefined {
  const u = Math.max(1, px);
  switch (pattern) {
    case 'Dash': return `${6 * u} ${4 * u}`;
    case 'Dot': return `${1.5 * u} ${3 * u}`;
    case 'DashDot': return `${6 * u} ${3 * u} ${1.5 * u} ${3 * u}`;
    case 'DashDotDot': return `${6 * u} ${3 * u} ${1.5 * u} ${3 * u} ${1.5 * u} ${3 * u}`;
    default: return undefined;
  }
}

export const ConnectionPath = memo(function ConnectionPath({ connection, index, selected, livePoints }: ConnectionPathProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const { line } = connection;
  const pts = livePoints ?? line.points;
  if (pts.length < 2) return null;
  const d = line.smooth === 'Bezier' ? smoothPath(pts) : polyPath(pts);
  const color = colorToCss(line.color);
  const px = strokePx(line.thickness);
  const [a0, a1] = line.arrow;
  const size = 3;
  const marker = (id: string, kind: 'Open' | 'Filled' | 'Half', end: boolean) => (
    <marker id={id} markerWidth={size} markerHeight={size} refX={size} refY={size / 2} orient={end ? 'auto' : 'auto-start-reverse'} markerUnits="userSpaceOnUse">
      <path d={kind === 'Half' ? `M0,0 L${size},${size / 2} L0,${size / 2} Z` : `M0,0 L${size},${size / 2} L0,${size} Z`} fill={kind === 'Open' ? 'none' : color} stroke={color} strokeWidth={0.4} />
    </marker>
  );
  return (
    <g
      className={`connection${selected ? ' selected' : ''}${livePoints ? ' editing' : ''}${connection.inherited ? ' inherited' : ''}`}
      data-connection={connection.inherited ? undefined : connection.equationIndex}
      data-connection-inherited={connection.inherited ? index : undefined}
    >
      {(a0 !== 'None' || a1 !== 'None') && (
        <defs>
          {a0 !== 'None' && marker(`${uid}-s`, a0, false)}
          {a1 !== 'None' && marker(`${uid}-e`, a1, true)}
        </defs>
      )}
      {selected && <path className="connection-glow" d={d} fill="none" strokeWidth={px + 6} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
      {line.pattern !== 'None' && (
        <path
          className="connection-line"
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={px}
          strokeDasharray={dash(line.pattern, px)}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          markerStart={a0 !== 'None' ? `url(#${uid}-s)` : undefined}
          markerEnd={a1 !== 'None' ? `url(#${uid}-e)` : undefined}
        />
      )}
      <path className="connection-hit" d={d} fill="none" stroke="transparent" strokeWidth={10} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </g>
  );
});
