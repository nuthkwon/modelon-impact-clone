/**
 * Pure geometry helpers for the diagram canvas: viewport (screen ↔ diagram) transforms,
 * orthogonal connection routing, connector compatibility, connection-line editing math and
 * hit testing. Everything here is framework-free so it can be unit-tested.
 *
 * Diagram coordinates are Modelica class coordinates (y up); screen coordinates are CSS pixels
 * relative to the canvas element (y down). The root SVG transform is `matrix(s 0 0 -s tx ty)`.
 */
import type { Causality, Color, ComponentView, DiagramView, Extent, Point, PortView } from '@impact/core';
import { applyMatrix, extentCenter, invert, multiply, normalizeExtent, placementBounds, placementMatrix, transformExtent, type AffineMatrix } from '@impact/core';
import type { Viewport } from '../../store/types';

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;
export const FIT_PADDING = 40;
export const GRID_STEP = 20;
export const SNAP_GRID: Point = [2, 2];

// ---------------------------------------------------------------------------
// Viewport
// ---------------------------------------------------------------------------

/** Root matrix mapping diagram (y up) to screen (y down): `matrix(s 0 0 -s tx ty)`. */
export function viewportMatrix(vp: Viewport): AffineMatrix {
  return { a: vp.scale, b: 0, c: 0, d: -vp.scale, e: vp.tx, f: vp.ty };
}

export function diagramToScreen(vp: Viewport, p: Point): Point {
  return [vp.scale * p[0] + vp.tx, -vp.scale * p[1] + vp.ty];
}

export function screenToDiagram(vp: Viewport, p: Point): Point {
  return applyMatrix(invert(viewportMatrix(vp)), p);
}

export function clampScale(s: number): number {
  if (!Number.isFinite(s) || s <= 0) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/** Viewport that fits `extent` into a `width`×`height` area with `padding` px on every side. */
export function fitViewport(extent: Extent, width: number, height: number, padding = FIT_PADDING): Viewport {
  const n = normalizeExtent(extent);
  const ew = Math.max(1e-6, n[1][0] - n[0][0]);
  const eh = Math.max(1e-6, n[1][1] - n[0][1]);
  const [cx, cy] = extentCenter(n);
  const availW = Math.max(1, width - 2 * padding);
  const availH = Math.max(1, height - 2 * padding);
  const scale = clampScale(Math.min(availW / ew, availH / eh));
  return { scale, tx: width / 2 - scale * cx, ty: height / 2 + scale * cy };
}

/** Zooms by `factor` keeping the diagram point under `screenPoint` fixed. */
export function zoomAt(vp: Viewport, screenPoint: Point, factor: number): Viewport {
  const scale = clampScale(vp.scale * factor);
  if (scale === vp.scale) return vp;
  const d = screenToDiagram(vp, screenPoint);
  return { scale, tx: screenPoint[0] - scale * d[0], ty: screenPoint[1] + scale * d[1] };
}

export function panBy(vp: Viewport, dx: number, dy: number): Viewport {
  return { scale: vp.scale, tx: vp.tx + dx, ty: vp.ty + dy };
}

/** Visible diagram-space rectangle for a viewport of `width`×`height` px. */
export function visibleExtent(vp: Viewport, width: number, height: number): Extent {
  const a = screenToDiagram(vp, [0, 0]);
  const b = screenToDiagram(vp, [width, height]);
  return normalizeExtent([a, b]);
}

// ---------------------------------------------------------------------------
// Rounding / snapping
// ---------------------------------------------------------------------------

export function round2(v: number): number {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? 0 : r;
}

export function roundPoint(p: Point): Point {
  return [round2(p[0]), round2(p[1])];
}

/** Snaps a move delta to the 2-unit grid when snapping is on; always rounds to 0.01. */
export function snapDelta(delta: Point, snapping: boolean, grid: Point = SNAP_GRID): Point {
  if (snapping) {
    const sx = grid[0] > 0 ? Math.round(delta[0] / grid[0]) * grid[0] : delta[0];
    const sy = grid[1] > 0 ? Math.round(delta[1] / grid[1]) * grid[1] : delta[1];
    return roundPoint([sx, sy]);
  }
  return roundPoint(delta);
}

/** Snaps an angle to the nearest multiple of `step` degrees. */
export function snapAngle(deg: number, step: number): number {
  if (step <= 0) return deg;
  const r = Math.round(deg / step) * step;
  return r === 0 ? 0 : r;
}

/** Signed angle (degrees, counter-clockwise positive in y-up coordinates) from `from` to `to` around `center`, in (-180, 180]. */
export function angleBetween(center: Point, from: Point, to: Point): number {
  const a0 = Math.atan2(from[1] - center[1], from[0] - center[0]);
  const a1 = Math.atan2(to[1] - center[1], to[0] - center[0]);
  let d = ((a1 - a0) * 180) / Math.PI;
  while (d <= -180) d += 360;
  while (d > 180) d -= 360;
  return d;
}

// ---------------------------------------------------------------------------
// Connection routing
// ---------------------------------------------------------------------------

/**
 * Default orthogonal route between two points: a straight line when they share a
 * coordinate, otherwise an elbow through the midpoint of the dominant axis (3 segments).
 * Points are rounded to 0.01.
 */
export function orthogonalRoute(a: Point, b: Point): Point[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (Math.abs(dx) < 1e-9 || Math.abs(dy) < 1e-9) return [roundPoint(a), roundPoint(b)];
  if (Math.abs(dx) >= Math.abs(dy)) {
    const mx = round2((a[0] + b[0]) / 2);
    return [roundPoint(a), [mx, round2(a[1])], [mx, round2(b[1])], roundPoint(b)];
  }
  const my = round2((a[1] + b[1]) / 2);
  return [roundPoint(a), [round2(a[0]), my], [round2(b[0]), my], roundPoint(b)];
}

/** Domain colour for a connector class per UI_SPEC §5.1. */
export function domainColor(className: string): Color {
  const d = domainOf(className);
  switch (d) {
    case 'electrical': return [0, 0, 255];
    case 'rotational': return [95, 95, 95];
    case 'translational': return [0, 127, 0];
    case 'thermal': return [191, 0, 0];
    case 'real': return [0, 0, 127];
    case 'boolean': return [255, 0, 255];
    default: return [0, 0, 0];
  }
}

export type Domain = 'electrical' | 'rotational' | 'translational' | 'thermal' | 'real' | 'boolean' | 'integer' | 'fluid' | 'magnetic' | 'other';

/** Domain of a connector class derived from its fully-qualified name. */
export function domainOf(className: string): Domain {
  const n = className;
  if (/^Modelica\.Electrical\./.test(n)) return 'electrical';
  if (/^Modelica\.Mechanics\.Rotational\./.test(n)) return 'rotational';
  if (/^Modelica\.Mechanics\.Translational\./.test(n)) return 'translational';
  if (/^Modelica\.Thermal\./.test(n)) return 'thermal';
  if (/^Modelica\.Magnetic\./.test(n)) return 'magnetic';
  if (/^Modelica\.Fluid\./.test(n) || /^Modelica\.Media\./.test(n)) return 'fluid';
  if (/^Modelica\.Blocks\.Interfaces\.Real/.test(n)) return 'real';
  if (/^Modelica\.Blocks\.Interfaces\.Boolean/.test(n)) return 'boolean';
  if (/^Modelica\.Blocks\.Interfaces\.Integer/.test(n)) return 'integer';
  const short = n.split('.').pop() ?? n;
  if (/^Real(Input|Output)$/.test(short)) return 'real';
  if (/^Boolean(Input|Output)$/.test(short)) return 'boolean';
  if (/^Integer(Input|Output)$/.test(short)) return 'integer';
  return 'other';
}

// ---------------------------------------------------------------------------
// Ports & compatibility
// ---------------------------------------------------------------------------

export interface ConnectorInfo {
  causality: Causality;
  physical: boolean;
}

/** A connectable endpoint on the canvas with its geometry in diagram coordinates. */
export interface PortAnchor {
  /** Connector reference as used in `connect()`: `resistor.p` or `u` (own connector). */
  ref: string;
  /** Owning component name; for own connectors the connector component itself. */
  component: string;
  /** Port name inside the component; undefined for the model's own connectors. */
  port?: string;
  className: string;
  causality: Causality;
  physical: boolean;
  domain: Domain;
  /** Centre of the connector icon in diagram coordinates. */
  center: Point;
  /** Bounding box of the connector icon in diagram coordinates (normalized). */
  bounds: Extent;
}

export function shortClassName(className: string): string {
  return className.split('.').pop() ?? className;
}

/** Strips the causal suffix so `RealInput` and `RealOutput` share the base `Real`. */
export function causalBase(className: string): string {
  return shortClassName(className).replace(/(Input|Output)$/, '');
}

export type PortCompatibility = 'compatible' | 'incompatible';

export interface PortLike {
  ref: string;
  className: string;
  causality: Causality;
  physical: boolean;
  domain: Domain;
}

/**
 * Whether a connection may be drawn from `start` to `other`: same connector class, or two
 * physical connectors of the same known domain, or an input↔output pair of the same base type.
 */
export function classifyPort(start: PortLike, other: PortLike): PortCompatibility {
  if (start.ref === other.ref) return 'incompatible';
  if (other.className === start.className) return 'compatible';
  if (start.physical && other.physical && start.domain === other.domain && start.domain !== 'other') return 'compatible';
  const startCausal = start.causality === 'input' || start.causality === 'output';
  const otherCausal = other.causality === 'input' || other.causality === 'output';
  if (startCausal && otherCausal && start.causality !== other.causality && causalBase(start.className) === causalBase(other.className)) return 'compatible';
  return 'incompatible';
}

export function portRefOf(view: PortView, component: string): PortLike & { ref: string } {
  return {
    ref: `${component}.${view.name}`,
    className: view.className,
    causality: view.causality,
    physical: view.physical,
    domain: domainOf(view.className),
  };
}

/** Collects every connectable endpoint of the diagram (component ports and the model's own connectors). */
export function collectPortAnchors(diagram: DiagramView, connectorInfo: (className: string) => ConnectorInfo): PortAnchor[] {
  const out: PortAnchor[] = [];
  for (const c of diagram.components) {
    // Disabled (conditional) and undrawn components (no Placement / visible=false) have no ports on the canvas.
    if (c.disabled || !isPlaced(c)) continue;
    const cm = placementMatrix(c.placement, c.icon.coordinateSystem);
    if (c.isConnector) {
      const info = connectorInfo(c.className);
      const bounds = placementBounds(c.placement, c.icon.coordinateSystem);
      out.push({
        ref: c.name,
        component: c.name,
        className: c.className,
        causality: info.causality,
        physical: info.physical,
        domain: domainOf(c.className),
        center: extentCenter(bounds),
        bounds,
      });
    }
    for (const p of c.ports) {
      const pm = multiply(cm, placementMatrix(p.placement, p.icon.coordinateSystem, true));
      const bounds = transformExtent(pm, p.icon.coordinateSystem.extent);
      out.push({
        ref: `${c.name}.${p.name}`,
        component: c.name,
        port: p.name,
        className: p.className,
        causality: p.causality,
        physical: p.physical,
        domain: domainOf(p.className),
        center: applyMatrix(pm, extentCenter(p.icon.coordinateSystem.extent)),
        bounds,
      });
    }
  }
  return out;
}

/** Nearest anchor whose bounds (grown by `tolerance` diagram units) contain `p`. */
export function findPortAt(anchors: PortAnchor[], p: Point, tolerance: number): PortAnchor | undefined {
  let best: PortAnchor | undefined;
  let bestDist = Infinity;
  for (const a of anchors) {
    const [[x1, y1], [x2, y2]] = a.bounds;
    if (p[0] < x1 - tolerance || p[0] > x2 + tolerance || p[1] < y1 - tolerance || p[1] > y2 + tolerance) continue;
    const d = Math.hypot(p[0] - a.center[0], p[1] - a.center[1]);
    if (d < bestDist) {
      bestDist = d;
      best = a;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Connection-line editing
// ---------------------------------------------------------------------------

export interface SegmentHit {
  index: number;
  distance: number;
  /** Closest point on the segment. */
  projection: Point;
}

function projectOnSegment(a: Point, b: Point, p: Point): { t: number; point: Point } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return { t: 0, point: [a[0], a[1]] };
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { t, point: [a[0] + t * dx, a[1] + t * dy] };
}

/** Segment of the polyline closest to `p`. */
export function nearestSegment(points: Point[], p: Point): SegmentHit | undefined {
  let best: SegmentHit | undefined;
  for (let i = 0; i < points.length - 1; i++) {
    const { point } = projectOnSegment(points[i], points[i + 1], p);
    const d = Math.hypot(point[0] - p[0], point[1] - p[1]);
    if (!best || d < best.distance) best = { index: i, distance: d, projection: point };
  }
  return best;
}

/** Index of the interior corner within `tolerance` of `p`, or -1. Endpoints are attached to ports and not returned. */
export function nearestCorner(points: Point[], p: Point, tolerance: number): number {
  let best = -1;
  let bestDist = tolerance;
  for (let i = 1; i < points.length - 1; i++) {
    const d = Math.hypot(points[i][0] - p[0], points[i][1] - p[1]);
    if (d <= bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * Moves segment `index` by `delta`, perpendicular to itself for axis-aligned segments
 * (horizontal → y only, vertical → x only; diagonal → both). Both endpoints of the segment
 * move. Endpoints of the whole line stay attached to their ports: when the first or last
 * segment is dragged a duplicate of the port point is inserted so the line stays connected.
 */
export function dragSegment(points: Point[], index: number, delta: Point): Point[] {
  if (points.length < 2 || index < 0 || index >= points.length - 1) return points.map((p) => [p[0], p[1]]);
  let pts: Point[] = points.map((p) => [p[0], p[1]]);
  let i = index;
  if (i === 0) {
    pts = [[pts[0][0], pts[0][1]], ...pts];
    i = 1;
  }
  if (i === pts.length - 2) {
    const last = pts[pts.length - 1];
    pts = [...pts, [last[0], last[1]]];
  }
  const a = pts[i];
  const b = pts[i + 1];
  const horizontal = Math.abs(a[1] - b[1]) < 1e-9;
  const vertical = Math.abs(a[0] - b[0]) < 1e-9;
  const degenerate = horizontal && vertical;
  const dx = degenerate || !horizontal ? delta[0] : 0;
  const dy = degenerate || !vertical ? delta[1] : 0;
  pts[i] = [round2(a[0] + dx), round2(a[1] + dy)];
  pts[i + 1] = [round2(b[0] + dx), round2(b[1] + dy)];
  return pts;
}

/** Moves the interior corner `index` by `delta`. */
export function dragCorner(points: Point[], index: number, delta: Point): Point[] {
  const pts: Point[] = points.map((p) => [p[0], p[1]]);
  if (index <= 0 || index >= pts.length - 1) return pts;
  pts[index] = [round2(pts[index][0] + delta[0]), round2(pts[index][1] + delta[1])];
  return pts;
}

/** Inserts a new corner on segment `index` at `at` (the projection of the click point). */
export function insertCorner(points: Point[], index: number, at: Point): Point[] {
  const pts: Point[] = points.map((p) => [p[0], p[1]]);
  if (index < 0 || index >= pts.length - 1) return pts;
  pts.splice(index + 1, 0, roundPoint(at));
  return pts;
}

/** Removes consecutive duplicate points (created by `dragSegment` when the user does not move). */
export function dedupePoints(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-9 && Math.abs(last[1] - p[1]) < 1e-9) continue;
    out.push([p[0], p[1]]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hit testing / selection
// ---------------------------------------------------------------------------

export function extentsIntersect(a: Extent, b: Extent): boolean {
  const na = normalizeExtent(a);
  const nb = normalizeExtent(b);
  return na[0][0] <= nb[1][0] && na[1][0] >= nb[0][0] && na[0][1] <= nb[1][1] && na[1][1] >= nb[0][1];
}

/** True when the component is drawn on the canvas: it has a `Placement` and is not `visible=false` (see `hiddenPlacement`). */
export function isPlaced(c: ComponentView): boolean {
  return c.placement.visible !== false;
}

/** Drawn components whose placement bounds intersect `rect` (diagram coordinates); hidden components are never hit. */
export function componentsInRect(components: ComponentView[], rect: Extent): string[] {
  return components.filter((c) => isPlaced(c) && extentsIntersect(placementBounds(c.placement, c.icon.coordinateSystem), rect)).map((c) => c.name);
}

/** Bounds of a component in diagram coordinates. */
export function componentBounds(c: ComponentView): Extent {
  return placementBounds(c.placement, c.icon.coordinateSystem);
}

/**
 * Visual centre of a placed component in diagram coordinates: `origin + R(rotation) · centre(extent)`,
 * the same pivot core's `rotateComponent`/`flipComponent` use (`centerTransformation`). Note that
 * `transformation.origin` is *not* the position: unrotated components are stored in canonical form
 * with origin {0,0} and an absolute extent.
 */
export function componentCenter(c: ComponentView): Point {
  return extentCenter(componentBounds(c));
}

/** True when the icon contains a `%name` text item (so no extra name label is needed). */
export function iconHasNameText(c: ComponentView): boolean {
  return c.icon.graphics.some((g) => g.kind === 'Text' && g.visible && /%name\b/.test(g.textString));
}

/** Rotates `p` about `center` by `deg` degrees (counter-clockwise in y-up coordinates). */
export function rotatePoint(p: Point, center: Point, deg: number): Point {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const x = p[0] - center[0];
  const y = p[1] - center[1];
  return [center[0] + x * cos - y * sin, center[1] + x * sin + y * cos];
}

export function extentCorners(e: Extent): Point[] {
  const n = normalizeExtent(e);
  return [
    [n[0][0], n[0][1]],
    [n[1][0], n[0][1]],
    [n[1][0], n[1][1]],
    [n[0][0], n[1][1]],
  ];
}
