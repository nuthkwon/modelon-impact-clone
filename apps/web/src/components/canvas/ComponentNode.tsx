/**
 * One placed component: its resolved icon inside `placementMatrix(placement, icon.cs)`, an
 * invisible hit rectangle over the icon extent and its ports. Memoised on the component
 * object identity (the diagram is rebuilt only when the registry changes) plus the few
 * interaction props, so zooming/panning or moving other components does not re-render it.
 */
import { memo, useMemo } from 'react';
import type { ComponentView } from '@impact/core';
import { matrixToSvg, multiply, normalizeExtent, placementMatrix } from '@impact/core';
import { GraphicsItems } from '../graphics/GraphicsLayerSvg';
import { classifyPort, domainOf, portRefOf, type ConnectorInfo, type PortAnchor, type PortCompatibility } from './geometry';
import { PortMarker } from './PortMarker';

export interface ComponentNodeProps {
  component: ComponentView;
  selected: boolean;
  /** Extra SVG transform (diagram coordinates) applied while dragging/rotating. */
  liveTransform?: string;
  /** Anchor the user is currently connecting from; ports are classified against it. */
  connectFrom?: PortAnchor;
  /** Causality/physical info for own connectors (components with `isConnector`). */
  connectorInfo?: ConnectorInfo;
}

export const ComponentNode = memo(function ComponentNode({ component, selected, liveTransform, connectFrom, connectorInfo }: ComponentNodeProps) {
  const m = useMemo(() => placementMatrix(component.placement, component.icon.coordinateSystem), [component]);
  // Screen orientation of the icon (root y-flip ∘ placement); zoom is uniform and irrelevant for text orientation.
  const world = useMemo(() => multiply({ a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 }, m), [m]);
  const subs = useMemo(
    () => ({
      name: component.name,
      className: component.shortClassName,
      params: Object.fromEntries(component.parameters.map((p) => [p.name, p.valueText ?? p.defaultText ?? ''])),
    }),
    [component],
  );
  const [[x1, y1], [x2, y2]] = normalizeExtent(component.icon.coordinateSystem.extent);
  const w = x2 - x1;
  const h = y2 - y1;
  if (component.placement.visible === false) return null;

  let ownCompatibility: PortCompatibility | undefined;
  if (connectFrom && component.isConnector) {
    ownCompatibility = classifyPort(connectFrom, {
      ref: component.name,
      className: component.className,
      causality: connectorInfo?.causality ?? 'none',
      physical: connectorInfo?.physical ?? false,
      domain: domainOf(component.className),
    });
  }

  const cls = ['component', selected ? 'selected' : '', component.disabled ? 'disabled' : '', component.isConnector ? 'own-connector' : '', ownCompatibility ?? ''].filter(Boolean).join(' ');
  const pad = Math.max(w, h) * 0.15;

  return (
    <g className={cls} data-component={component.name} data-port={component.isConnector ? component.name : undefined} transform={liveTransform} opacity={component.disabled ? 0.4 : undefined}>
      <g transform={matrixToSvg(m)}>
        {ownCompatibility && <rect className="port-halo" x={x1 - pad} y={y1 - pad} width={w + 2 * pad} height={h + 2 * pad} rx={pad} ry={pad} vectorEffect="non-scaling-stroke" />}
        <GraphicsItems items={component.icon.graphics} subs={subs} world={world} />
        <rect className="component-hit" x={x1} y={y1} width={w} height={h} fill="transparent" stroke="none" />
        {component.ports.map((p) => (
          <PortMarker key={p.name} port={p} componentName={component.name} compatibility={connectFrom ? classifyPort(connectFrom, portRefOf(p, component.name)) : undefined} />
        ))}
      </g>
    </g>
  );
});
