/**
 * Pure geometry helpers for placing components on a diagram (Modelica Specification 3.5,
 * §18.6.6 "Component instance").
 *
 * Coordinate convention
 * ---------------------
 * Every function in this module works in **Modelica coordinates: y grows upwards** and
 * positive rotations are counter-clockwise. Icon coordinates are those of the component's
 * class (`coordinateSystem.extent`, usually {{-100,-100},{100,100}}); parent coordinates are
 * those of the enclosing class's diagram layer. The renderer applies a single y-flip
 * (`scale(1,-1)` or an equivalent viewBox transform) at the root when drawing; nothing here
 * knows about screen pixels.
 *
 * Matrices are affine 2×3 matrices in the SVG/Canvas layout `{a, b, c, d, e, f}`:
 *
 *     x' = a·x + c·y + e
 *     y' = b·x + d·y + f
 *
 * `multiply(m1, m2)` composes so that `applyMatrix(multiply(m1, m2), p)` equals
 * `applyMatrix(m1, applyMatrix(m2, p))` — m2 is applied first, like `DOMMatrix.multiply`.
 */
import type { CoordinateSystem, Extent, Placement, Point, Transformation } from '../graphics.js';

export interface AffineMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const EPS = 1e-12;

// ---------------------------------------------------------------------------
// Matrix primitives
// ---------------------------------------------------------------------------

export function identityMatrix(): AffineMatrix {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

export function translationMatrix(dx: number, dy: number): AffineMatrix {
  return { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy };
}

export function scaleMatrix(sx: number, sy: number = sx): AffineMatrix {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

/** Rotation by `deg` degrees, counter-clockwise in y-up coordinates, about the origin. */
export function rotationMatrix(deg: number): AffineMatrix {
  const r = (deg * Math.PI) / 180;
  const cos = cleanTrig(Math.cos(r));
  const sin = cleanTrig(Math.sin(r));
  return { a: cos, b: sin, c: cleanTrig(-sin), d: cos, e: 0, f: 0 };
}

/** Rounds trig results for multiples of 90° so that `cos(90°)` is exactly 0 (and never -0). */
function cleanTrig(v: number): number {
  const r = Math.round(v);
  if (Math.abs(v - r) < 1e-12) return r === 0 ? 0 : r;
  return v;
}

/** `m1 ∘ m2`: apply `m2` first, then `m1`. */
export function multiply(m1: AffineMatrix, m2: AffineMatrix): AffineMatrix {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

/** Composes several matrices left to right: `composeMatrices(m1, m2, m3)` applies m3 first. */
export function composeMatrices(...ms: AffineMatrix[]): AffineMatrix {
  return ms.reduce((acc, m) => multiply(acc, m), identityMatrix());
}

export function applyMatrix(m: AffineMatrix, p: Point): Point {
  return [m.a * p[0] + m.c * p[1] + m.e, m.b * p[0] + m.d * p[1] + m.f];
}

/** Applies the linear part only (no translation) — for direction vectors. */
export function applyMatrixToVector(m: AffineMatrix, v: Point): Point {
  return [m.a * v[0] + m.c * v[1], m.b * v[0] + m.d * v[1]];
}

/** Inverse matrix. A singular matrix (zero-size extent) yields the identity rather than NaN. */
export function invert(m: AffineMatrix): AffineMatrix {
  const det = m.a * m.d - m.b * m.c;
  if (!Number.isFinite(det) || Math.abs(det) < EPS) return identityMatrix();
  const a = m.d / det;
  const b = -m.b / det;
  const c = -m.c / det;
  const d = m.a / det;
  return { a, b, c, d, e: -(a * m.e + c * m.f), f: -(b * m.e + d * m.f) };
}

/** `matrix(a b c d e f)` for an SVG `transform` attribute (values are in Modelica coordinates). */
export function matrixToSvg(m: AffineMatrix): string {
  return `matrix(${fmt(m.a)} ${fmt(m.b)} ${fmt(m.c)} ${fmt(m.d)} ${fmt(m.e)} ${fmt(m.f)})`;
}

function fmt(v: number): string {
  const r = Math.round(v * 1e6) / 1e6;
  return String(r === 0 ? 0 : r);
}

// ---------------------------------------------------------------------------
// Extents
// ---------------------------------------------------------------------------

export function extentCenter(e: Extent): Point {
  return [(e[0][0] + e[1][0]) / 2, (e[0][1] + e[1][1]) / 2];
}

/** Absolute width and height of an extent. */
export function extentSize(e: Extent): Point {
  return [Math.abs(e[1][0] - e[0][0]), Math.abs(e[1][1] - e[0][1])];
}

/** Returns the extent with the smaller coordinates first (loses flip information). */
export function normalizeExtent(e: Extent): Extent {
  return [
    [Math.min(e[0][0], e[1][0]), Math.min(e[0][1], e[1][1])],
    [Math.max(e[0][0], e[1][0]), Math.max(e[0][1], e[1][1])],
  ];
}

/** Axis-aligned bounding box (normalized extent) of a set of points. */
export function boundsOfPoints(points: Point[]): Extent {
  if (points.length === 0) return [[0, 0], [0, 0]];
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const [x, y] of points) {
    if (x < x1) x1 = x;
    if (y < y1) y1 = y;
    if (x > x2) x2 = x;
    if (y > y2) y2 = y;
  }
  return [[x1, y1], [x2, y2]];
}

/** Transforms the four corners of an extent and returns their bounding box. */
export function transformExtent(m: AffineMatrix, e: Extent): Extent {
  const corners: Point[] = [
    applyMatrix(m, [e[0][0], e[0][1]]),
    applyMatrix(m, [e[1][0], e[0][1]]),
    applyMatrix(m, [e[1][0], e[1][1]]),
    applyMatrix(m, [e[0][0], e[1][1]]),
  ];
  return boundsOfPoints(corners);
}

/** True if `p` lies inside `e` (either orientation). */
export function extentContains(e: Extent, p: Point): boolean {
  const n = normalizeExtent(e);
  return p[0] >= n[0][0] && p[0] <= n[1][0] && p[1] >= n[0][1] && p[1] <= n[1][1];
}

/** Rounds a point to the nearest grid intersection. Non-positive grid steps leave the coordinate as is. */
export function snapToGrid(p: Point, grid: Point): Point {
  const snap = (v: number, g: number): number => (g > 0 && Number.isFinite(g) ? Math.round(v / g) * g : v);
  return [fixZero(snap(p[0], grid[0])), fixZero(snap(p[1], grid[1]))];
}

function fixZero(v: number): number {
  return v === 0 ? 0 : v; // turns -0 into 0
}

// ---------------------------------------------------------------------------
// Placement → matrix
// ---------------------------------------------------------------------------

/**
 * Rotation of a placement (its `transformation.rotation`), normalized to [0, 360).
 */
export function rotationOf(placement: Placement, useIconTransformation = false): number {
  const t = (useIconTransformation && placement.iconTransformation) || placement.transformation;
  return normalizeAngle(t.rotation);
}

/** Normalizes an angle in degrees to [0, 360). */
export function normalizeAngle(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const r = ((deg % 360) + 360) % 360;
  return r === 0 ? 0 : r; // -0 → 0
}

/**
 * The affine transform from a component's icon coordinates (its class's
 * `coordinateSystem`, y up) to the coordinates of the parent's diagram layer (y up), per
 * Modelica spec §18.6.6.2:
 *
 * 1. The icon extent is mapped onto `transformation.extent` (which is relative to
 *    `transformation.origin`). The scale may be non-uniform; reversed extent coordinates
 *    flip the icon. With `preserveAspectRatio`, a uniform scale (the smaller of the two
 *    factors) is used and the icon is centered in the extent, keeping any flips.
 * 2. The result is rotated by `transformation.rotation` degrees about the origin.
 * 3. The origin is translated to `transformation.origin`.
 *
 * `useIconTransformation` selects `iconTransformation` (connectors shown on the icon layer
 * of the enclosing class) when present, otherwise `transformation`.
 */
export function placementMatrix(
  placement: Placement,
  iconCoordinateSystem: CoordinateSystem,
  useIconTransformation = false,
): AffineMatrix {
  const t = (useIconTransformation && placement.iconTransformation) || placement.transformation;
  return transformationMatrix(t, iconCoordinateSystem);
}

/** Same as `placementMatrix` for a bare `Transformation`. */
export function transformationMatrix(t: Transformation, iconCoordinateSystem: CoordinateSystem): AffineMatrix {
  const iconExtent = iconCoordinateSystem.extent;
  const [iw, ih] = extentSize(iconExtent);
  const [icx, icy] = extentCenter(iconExtent);

  const [[px1, py1], [px2, py2]] = t.extent;
  const pw = px2 - px1; // signed: negative = horizontal flip
  const ph = py2 - py1;
  const pcx = (px1 + px2) / 2;
  const pcy = (py1 + py2) / 2;

  let sx = iw > EPS ? pw / iw : 1;
  let sy = ih > EPS ? ph / ih : 1;

  if (iconCoordinateSystem.preserveAspectRatio) {
    const s = Math.min(Math.abs(sx), Math.abs(sy));
    sx = (sx < 0 ? -1 : 1) * s;
    sy = (sy < 0 ? -1 : 1) * s;
  }

  // Step 1: scale about the icon center, then move the icon center onto the extent center.
  const scaleToExtent: AffineMatrix = { a: sx, b: 0, c: 0, d: sy, e: pcx - sx * icx, f: pcy - sy * icy };
  // Steps 2 & 3.
  return composeMatrices(translationMatrix(t.origin[0], t.origin[1]), rotationMatrix(t.rotation), scaleToExtent);
}

/**
 * Axis-aligned bounding box of a placed component in parent coordinates (the transformed
 * icon extent). Useful for selection rectangles and hit testing.
 */
export function placementBounds(
  placement: Placement,
  iconCoordinateSystem: CoordinateSystem,
  useIconTransformation = false,
): Extent {
  const m = placementMatrix(placement, iconCoordinateSystem, useIconTransformation);
  return transformExtent(m, iconCoordinateSystem.extent);
}

// ---------------------------------------------------------------------------
// Editing transformations
// ---------------------------------------------------------------------------

function cloneTransformation(t: Transformation): Transformation {
  return {
    origin: [t.origin[0], t.origin[1]],
    extent: [[t.extent[0][0], t.extent[0][1]], [t.extent[1][0], t.extent[1][1]]],
    rotation: t.rotation,
  };
}

/**
 * Mirrors the component about the vertical axis through its origin, as seen in the parent
 * diagram. Mathematically `F_x · R(θ) = R(−θ) · F_x`, so the rotation is negated and the
 * extent's x coordinates are swapped. For an unrotated component this is simply an x swap.
 */
export function flipTransformationHorizontal(t: Transformation): Transformation {
  const r = cloneTransformation(t);
  r.extent = [[t.extent[1][0], t.extent[0][1]], [t.extent[0][0], t.extent[1][1]]];
  r.rotation = normalizeAngle(-t.rotation);
  return r;
}

/**
 * Mirrors the component about the horizontal axis through its origin, as seen in the parent
 * diagram (`F_y · R(θ) = R(−θ) · F_y`): rotation negated, extent y coordinates swapped.
 */
export function flipTransformationVertical(t: Transformation): Transformation {
  const r = cloneTransformation(t);
  r.extent = [[t.extent[0][0], t.extent[1][1]], [t.extent[1][0], t.extent[0][1]]];
  r.rotation = normalizeAngle(-t.rotation);
  return r;
}

/** Rotates the component by `deg` degrees (counter-clockwise) about its origin. */
export function rotateTransformation(t: Transformation, deg: number): Transformation {
  const r = cloneTransformation(t);
  r.rotation = normalizeAngle(t.rotation + deg);
  return r;
}

/** Moves the component's origin by (dx, dy) in parent coordinates. */
export function translateTransformation(t: Transformation, dx: number, dy: number): Transformation {
  const r = cloneTransformation(t);
  r.origin = [t.origin[0] + dx, t.origin[1] + dy];
  return r;
}

/**
 * Builds a transformation for a component dropped at `position` with a square extent of
 * `size` (default 20, i.e. {{-10,-10},{10,10}}), optionally scaled to the icon's aspect
 * ratio so that non-square icons keep their shape.
 */
export function transformationAt(
  position: Point,
  size = 20,
  iconCoordinateSystem?: CoordinateSystem,
  rotationDeg = 0,
): Transformation {
  let hw = size / 2;
  let hh = size / 2;
  if (iconCoordinateSystem) {
    const [iw, ih] = extentSize(iconCoordinateSystem.extent);
    if (iw > EPS && ih > EPS) {
      const ratio = iw / ih;
      if (ratio > 1) hh = hw / ratio;
      else if (ratio < 1) hw = hh * ratio;
    }
  }
  return { origin: [position[0], position[1]], extent: [[-hw, -hh], [hw, hh]], rotation: normalizeAngle(rotationDeg) };
}
