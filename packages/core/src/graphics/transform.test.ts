import { describe, expect, it } from 'vitest';
import type { CoordinateSystem, Placement, Point, Transformation } from '../graphics.js';
import { DEFAULT_COORDINATE_SYSTEM } from '../graphics.js';
import {
  applyMatrix,
  composeMatrices,
  extentCenter,
  extentContains,
  extentSize,
  flipTransformationHorizontal,
  flipTransformationVertical,
  identityMatrix,
  invert,
  matrixToSvg,
  multiply,
  normalizeAngle,
  normalizeExtent,
  placementBounds,
  placementMatrix,
  rotateTransformation,
  rotationMatrix,
  rotationOf,
  scaleMatrix,
  snapToGrid,
  transformExtent,
  transformationAt,
  transformationMatrix,
  translateTransformation,
  translationMatrix,
  type AffineMatrix,
} from './transform.js';

const icon: CoordinateSystem = DEFAULT_COORDINATE_SYSTEM; // {{-100,-100},{100,100}}, preserveAspectRatio
const iconFree: CoordinateSystem = { ...DEFAULT_COORDINATE_SYSTEM, preserveAspectRatio: false };

const place = (t: Partial<Transformation>, iconT?: Partial<Transformation>): Placement => ({
  visible: true,
  transformation: { origin: [0, 0], extent: [[-10, -10], [10, 10]], rotation: 0, ...t },
  ...(iconT ? { iconTransformation: { origin: [0, 0], extent: [[-10, -10], [10, 10]], rotation: 0, ...iconT } } : {}),
});

const near = (p: Point, expected: Point) => {
  expect(p[0]).toBeCloseTo(expected[0], 9);
  expect(p[1]).toBeCloseTo(expected[1], 9);
};

const nearMatrix = (m: AffineMatrix, e: AffineMatrix) => {
  for (const k of ['a', 'b', 'c', 'd', 'e', 'f'] as const) expect(m[k]).toBeCloseTo(e[k], 9);
};

describe('placementMatrix', () => {
  it('rotation 90 about the origin maps a port at (100,0) to (0,100) (extent = icon extent)', () => {
    const m = placementMatrix(place({ extent: [[-100, -100], [100, 100]], rotation: 90 }), icon);
    near(applyMatrix(m, [100, 0]), [0, 100]);
    near(applyMatrix(m, [0, 100]), [-100, 0]);
    near(applyMatrix(m, [0, 0]), [0, 0]);
  });

  it('extent {{-10,-10},{10,10}} scales the 200×200 icon by 0.1', () => {
    const m = placementMatrix(place({}), icon);
    nearMatrix(m, { a: 0.1, b: 0, c: 0, d: 0.1, e: 0, f: 0 });
    near(applyMatrix(m, [100, 0]), [10, 0]);
    near(applyMatrix(m, [-100, -100]), [-10, -10]);
  });

  it('scales, then rotates about the origin, then translates to the origin', () => {
    const m = placementMatrix(place({ origin: [30, -20], rotation: 90 }), icon);
    near(applyMatrix(m, [100, 0]), [30, -10]); // (100,0) → (10,0) → rot90 (0,10) → +origin
    near(applyMatrix(m, [0, 0]), [30, -20]);
    near(applyMatrix(m, [0, 100]), [20, -20]);
  });

  it('accepts rotations of 180, 270 and -90 (= 270)', () => {
    near(applyMatrix(placementMatrix(place({ rotation: 180 }), icon), [100, 0]), [-10, 0]);
    near(applyMatrix(placementMatrix(place({ rotation: 270 }), icon), [100, 0]), [0, -10]);
    near(applyMatrix(placementMatrix(place({ rotation: -90 }), icon), [100, 0]), [0, -10]);
    near(applyMatrix(placementMatrix(place({ rotation: 45, extent: [[-100, -100], [100, 100]] }), icon), [100, 0]), [100 / Math.SQRT2, 100 / Math.SQRT2]);
  });

  it('reversed extent coordinates mirror the icon', () => {
    const hm = placementMatrix(place({ extent: [[10, -10], [-10, 10]] }), icon);
    near(applyMatrix(hm, [100, 0]), [-10, 0]);
    near(applyMatrix(hm, [0, 100]), [0, 10]);
    near(applyMatrix(hm, [50, 50]), [-5, 5]);
    const vm = placementMatrix(place({ extent: [[-10, 10], [10, -10]] }), icon);
    near(applyMatrix(vm, [100, 0]), [10, 0]);
    near(applyMatrix(vm, [0, 100]), [0, -10]);
    // flip + rotation: mirror first, then rotate
    const both = placementMatrix(place({ extent: [[10, -10], [-10, 10]], rotation: 90 }), icon);
    near(applyMatrix(both, [100, 0]), [0, -10]);
  });

  it('preserveAspectRatio uses the smaller uniform scale centered in a non-square extent', () => {
    const wide = place({ extent: [[-20, -10], [20, 10]] });
    const m = placementMatrix(wide, icon);
    nearMatrix(m, { a: 0.1, b: 0, c: 0, d: 0.1, e: 0, f: 0 });
    near(applyMatrix(m, [100, 0]), [10, 0]);
    near(applyMatrix(m, [0, 100]), [0, 10]);
    // without aspect preservation the scale is non-uniform
    const free = placementMatrix(wide, iconFree);
    nearMatrix(free, { a: 0.2, b: 0, c: 0, d: 0.1, e: 0, f: 0 });
    near(applyMatrix(free, [100, 0]), [20, 0]);
    near(applyMatrix(free, [0, 100]), [0, 10]);
  });

  it('centers the icon in an off-center extent (extent is relative to the origin)', () => {
    const m = placementMatrix(place({ extent: [[0, 0], [40, 20]], origin: [100, 100] }), icon);
    near(applyMatrix(m, [0, 0]), [120, 110]);
    near(applyMatrix(m, [100, 0]), [130, 110]);
    near(applyMatrix(m, [0, 100]), [120, 120]);
    const free = placementMatrix(place({ extent: [[0, 0], [40, 20]], origin: [100, 100] }), iconFree);
    near(applyMatrix(free, [-100, -100]), [100, 100]);
    near(applyMatrix(free, [100, 100]), [140, 120]);
  });

  it('preserveAspectRatio keeps flips and works with a non-square icon coordinate system', () => {
    const wideIcon: CoordinateSystem = { extent: [[-200, -100], [200, 100]], preserveAspectRatio: true, initialScale: 0.1, grid: [2, 2] };
    const m = placementMatrix(place({ extent: [[20, -20], [-20, 20]] }), wideIcon);
    // sx = -40/400 = -0.1, sy = 40/200 = 0.2 → uniform 0.1 with the x flip kept
    nearMatrix(m, { a: -0.1, b: 0, c: 0, d: 0.1, e: 0, f: 0 });
    near(applyMatrix(m, [200, 100]), [-20, 10]);
  });

  it('maps the icon center to the extent center when the icon coordinate system is off-center', () => {
    const shifted: CoordinateSystem = { extent: [[0, 0], [100, 100]], preserveAspectRatio: true, initialScale: 0.1, grid: [2, 2] };
    const m = placementMatrix(place({}), shifted);
    near(applyMatrix(m, [50, 50]), [0, 0]);
    near(applyMatrix(m, [0, 0]), [-10, -10]);
    near(applyMatrix(m, [100, 100]), [10, 10]);
  });

  it('uses iconTransformation only when asked and present', () => {
    const p = place({ origin: [50, 0] }, { origin: [-100, 0], extent: [[-10, -10], [10, 10]], rotation: 180 });
    near(applyMatrix(placementMatrix(p, icon), [0, 0]), [50, 0]);
    near(applyMatrix(placementMatrix(p, icon, true), [0, 0]), [-100, 0]);
    near(applyMatrix(placementMatrix(p, icon, true), [100, 0]), [-110, 0]);
    // no iconTransformation → falls back to transformation
    near(applyMatrix(placementMatrix(place({ origin: [50, 0] }), icon, true), [0, 0]), [50, 0]);
    expect(rotationOf(p)).toBe(0);
    expect(rotationOf(p, true)).toBe(180);
    expect(rotationOf(place({ rotation: -90 }))).toBe(270);
    expect(rotationOf(place({ rotation: 450 }))).toBe(90);
  });

  it('degenerate icon extents do not produce NaN', () => {
    const zero: CoordinateSystem = { extent: [[0, 0], [0, 0]], preserveAspectRatio: true, initialScale: 0.1, grid: [2, 2] };
    const m = transformationMatrix({ origin: [1, 2], extent: [[-10, -10], [10, 10]], rotation: 0 }, zero);
    for (const v of Object.values(m)) expect(Number.isFinite(v)).toBe(true);
    near(applyMatrix(m, [0, 0]), [1, 2]);
  });

  it('placementBounds is the bounding box of the transformed icon extent', () => {
    expect(placementBounds(place({ origin: [30, -20] }), icon)).toEqual([[20, -30], [40, -10]]);
    const rotated = placementBounds(place({ extent: [[-20, -10], [20, 10]], rotation: 90 }), iconFree);
    near(rotated[0], [-10, -20]);
    near(rotated[1], [10, 20]);
  });
});

describe('matrix algebra', () => {
  it('multiply applies the right operand first', () => {
    const m = multiply(translationMatrix(10, 0), rotationMatrix(90));
    near(applyMatrix(m, [1, 0]), [10, 1]);
    const other = multiply(rotationMatrix(90), translationMatrix(10, 0));
    near(applyMatrix(other, [1, 0]), [0, 11]);
    near(applyMatrix(composeMatrices(translationMatrix(1, 1), scaleMatrix(2), rotationMatrix(90)), [1, 0]), [1, 3]);
    nearMatrix(composeMatrices(), identityMatrix());
  });

  it('invert undoes a placement matrix', () => {
    const m = placementMatrix(place({ origin: [30, -20], extent: [[-20, -10], [20, 10]], rotation: 30 }), iconFree);
    nearMatrix(multiply(invert(m), m), identityMatrix());
    nearMatrix(multiply(m, invert(m)), identityMatrix());
    const p: Point = [12.5, -7.25];
    near(applyMatrix(invert(m), applyMatrix(m, p)), p);
    // singular → identity, never NaN
    nearMatrix(invert(scaleMatrix(0, 0)), identityMatrix());
  });

  it('rotation is exact at multiples of 90° and formats for SVG', () => {
    expect(rotationMatrix(90)).toEqual({ a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 });
    expect(rotationMatrix(180)).toEqual({ a: -1, b: 0, c: 0, d: -1, e: 0, f: 0 });
    expect(rotationMatrix(-90)).toEqual({ a: 0, b: -1, c: 1, d: 0, e: 0, f: 0 });
    expect(matrixToSvg(placementMatrix(place({ origin: [30, -20], rotation: 90 }), icon))).toBe('matrix(0 0.1 -0.1 0 30 -20)');
    expect(matrixToSvg({ a: 1 / 3, b: 0, c: 0, d: 1, e: -0, f: 2 })).toBe('matrix(0.333333 0 0 1 0 2)');
  });
});

describe('editing helpers', () => {
  const t: Transformation = { origin: [30, -20], extent: [[-20, -10], [20, 10]], rotation: 0 };

  it('flipTransformationHorizontal swaps x and mirrors about the vertical axis through the origin', () => {
    const f = flipTransformationHorizontal(t);
    expect(f).toEqual({ origin: [30, -20], extent: [[20, -10], [-20, 10]], rotation: 0 });
    expect(t.extent).toEqual([[-20, -10], [20, 10]]); // input untouched
    const m = transformationMatrix(t, iconFree);
    const fm = transformationMatrix(f, iconFree);
    for (const p of [[100, 0], [0, 100], [37, -81], [-100, 100]] as Point[]) {
      const [x, y] = applyMatrix(m, p);
      near(applyMatrix(fm, p), [2 * t.origin[0] - x, y]);
    }
  });

  it('flips of rotated components mirror in the parent frame (rotation is negated)', () => {
    for (const rot of [90, 45, 270, 180]) {
      const r: Transformation = { ...t, rotation: rot };
      const m = transformationMatrix(r, iconFree);
      const h = flipTransformationHorizontal(r);
      const v = flipTransformationVertical(r);
      expect(h.rotation).toBe(normalizeAngle(-rot));
      expect(v.rotation).toBe(normalizeAngle(-rot));
      const hm = transformationMatrix(h, iconFree);
      const vm = transformationMatrix(v, iconFree);
      for (const p of [[100, 0], [0, 100], [37, -81]] as Point[]) {
        const [x, y] = applyMatrix(m, p);
        near(applyMatrix(hm, p), [2 * r.origin[0] - x, y]);
        near(applyMatrix(vm, p), [x, 2 * r.origin[1] - y]);
      }
    }
    // flipping twice restores the original mapping
    const twice = flipTransformationHorizontal(flipTransformationHorizontal({ ...t, rotation: 90 }));
    nearMatrix(transformationMatrix(twice, iconFree), transformationMatrix({ ...t, rotation: 90 }, iconFree));
  });

  it('flipTransformationVertical swaps y', () => {
    expect(flipTransformationVertical(t)).toEqual({ origin: [30, -20], extent: [[-20, 10], [20, -10]], rotation: 0 });
  });

  it('rotateTransformation and translateTransformation', () => {
    expect(rotateTransformation(t, 90).rotation).toBe(90);
    expect(rotateTransformation({ ...t, rotation: 270 }, 90).rotation).toBe(0);
    expect(rotateTransformation(t, -90).rotation).toBe(270);
    expect(rotateTransformation(t, 90).extent).toEqual(t.extent);
    expect(translateTransformation(t, 5, -5)).toEqual({ origin: [35, -25], extent: [[-20, -10], [20, 10]], rotation: 0 });
    expect(t.origin).toEqual([30, -20]);
  });

  it('transformationAt builds a drop transformation honouring the icon aspect ratio', () => {
    expect(transformationAt([10, 20])).toEqual({ origin: [10, 20], extent: [[-10, -10], [10, 10]], rotation: 0 });
    expect(transformationAt([0, 0], 40, undefined, -90)).toEqual({ origin: [0, 0], extent: [[-20, -20], [20, 20]], rotation: 270 });
    const wide: CoordinateSystem = { extent: [[-200, -100], [200, 100]], preserveAspectRatio: true, initialScale: 0.1, grid: [2, 2] };
    expect(transformationAt([0, 0], 20, wide)).toEqual({ origin: [0, 0], extent: [[-10, -5], [10, 5]], rotation: 0 });
    const tall: CoordinateSystem = { ...wide, extent: [[-50, -100], [50, 100]] };
    expect(transformationAt([0, 0], 20, tall)).toEqual({ origin: [0, 0], extent: [[-5, -10], [5, 10]], rotation: 0 });
  });
});

describe('extent helpers', () => {
  it('center, size, normalize, contains, transform', () => {
    expect(extentCenter([[-70, 30], [70, -30]])).toEqual([0, 0]);
    expect(extentCenter([[0, 0], [40, 20]])).toEqual([20, 10]);
    expect(extentSize([[-70, 30], [70, -30]])).toEqual([140, 60]);
    expect(normalizeExtent([[70, 30], [-70, -30]])).toEqual([[-70, -30], [70, 30]]);
    expect(extentContains([[70, 30], [-70, -30]], [0, 0])).toBe(true);
    expect(extentContains([[-70, -30], [70, 30]], [71, 0])).toBe(false);
    expect(transformExtent(rotationMatrix(90), [[0, 0], [40, 20]])).toEqual([[-20, 0], [0, 40]]);
    expect(transformExtent(translationMatrix(1, 1), [[0, 0], [1, 1]])).toEqual([[1, 1], [2, 2]]);
  });

  it('snapToGrid rounds to the grid and tolerates a zero grid', () => {
    expect(snapToGrid([3, 5.1], [2, 2])).toEqual([4, 6]);
    expect(snapToGrid([-0.9, 0.9], [2, 2])).toEqual([0, 0]);
    expect(Object.is(snapToGrid([-0.9, 0], [2, 2])[0], -0)).toBe(false);
    expect(snapToGrid([3.3, 7.7], [0, 5])).toEqual([3.3, 10]);
    expect(snapToGrid([12.4, -12.6], [5, 5])).toEqual([10, -15]);
  });

  it('normalizeAngle', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(725)).toBe(5);
    expect(normalizeAngle(NaN)).toBe(0);
  });
});
