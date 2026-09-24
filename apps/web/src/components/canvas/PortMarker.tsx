/**
 * A connector of a component, drawn from the connector class icon at the port's placement
 * (inside the component's icon coordinate system). Carries `data-port="comp.port"` for hit
 * testing and shows a green/grey halo while a connection is being drawn.
 */
import { memo } from 'react';
import type { PortView } from '@impact/core';
import { matrixToSvg, normalizeExtent, placementMatrix } from '@impact/core';
import { GraphicsItems } from '../graphics/GraphicsLayerSvg';
import type { PortCompatibility } from './geometry';

export interface PortMarkerProps {
  port: PortView;
  componentName: string;
  compatibility?: PortCompatibility;
}

export const PortMarker = memo(function PortMarker({ port, componentName, compatibility }: PortMarkerProps) {
  const m = placementMatrix(port.placement, port.icon.coordinateSystem, true);
  const [[x1, y1], [x2, y2]] = normalizeExtent(port.icon.coordinateSystem.extent);
  const w = x2 - x1;
  const h = y2 - y1;
  const pad = Math.max(w, h) * 0.15;
  return (
    <g className={`port${compatibility ? ` ${compatibility}` : ''}`} data-port={`${componentName}.${port.name}`} transform={matrixToSvg(m)}>
      {compatibility && <rect className="port-halo" x={x1 - pad} y={y1 - pad} width={w + 2 * pad} height={h + 2 * pad} rx={pad} ry={pad} vectorEffect="non-scaling-stroke" />}
      <GraphicsItems items={port.icon.graphics} subs={{ name: port.name, className: port.className.split('.').pop() }} />
      <rect className="port-hit" x={x1} y={y1} width={w} height={h} fill="transparent" stroke="none" />
    </g>
  );
});
