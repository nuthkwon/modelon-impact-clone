import { describe, expect, it } from 'vitest';
import {
  decimate,
  extent,
  formatTick,
  interpolateAt,
  isMonotonic,
  linearTicks,
  logTicks,
  makeScale,
  nearestIndex,
  nearestIndexUnsorted,
  niceStep,
  padDomain,
  panDomain,
  roundToStep,
  wheelZoom,
  zoomDomain,
} from './chartMath';

describe('niceStep', () => {
  it('picks 1-2-5 steps', () => {
    expect(niceStep(1, 6)).toBeCloseTo(0.2);
    expect(niceStep(10, 6)).toBe(2);
    expect(niceStep(100, 6)).toBe(20);
    expect(niceStep(7, 6)).toBe(2);
    expect(niceStep(0.5, 6)).toBeCloseTo(0.1);
    expect(niceStep(3, 6)).toBeCloseTo(0.5);
    expect(niceStep(60, 6)).toBe(10);
  });
  it('is defensive for degenerate input', () => {
    expect(niceStep(0, 6)).toBe(1);
    expect(niceStep(-1, 6)).toBe(1);
    expect(niceStep(NaN, 6)).toBe(1);
  });
});

describe('linearTicks', () => {
  it('covers [0, 1] with 0.2 steps and clean labels', () => {
    const t = linearTicks(0, 1);
    expect(t.map((x) => x.value)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(t.map((x) => x.label)).toEqual(['0', '0.2', '0.4', '0.6', '0.8', '1']);
  });
  it('handles negative ranges and reversed bounds', () => {
    expect(linearTicks(-1, 1).map((x) => x.value)).toEqual([-1, -0.5, 0, 0.5, 1]);
    expect(linearTicks(1, -1).map((x) => x.value)).toEqual([-1, -0.5, 0, 0.5, 1]);
  });
  it('does not accumulate floating point garbage', () => {
    const t = linearTicks(0, 0.3, 4);
    for (const tick of t) expect(tick.label.length).toBeLessThan(6);
    expect(t.map((x) => x.value)).toEqual([0, 0.1, 0.2, 0.3]);
  });
  it('pads a degenerate domain', () => {
    const t = linearTicks(5, 5);
    expect(t.length).toBeGreaterThanOrEqual(3);
    expect(t.some((x) => x.value === 5)).toBe(true);
    const z = linearTicks(0, 0);
    expect(z.some((x) => x.value === 0)).toBe(true);
  });
  it('uses exponent labels for very large values', () => {
    const t = linearTicks(0, 5e6, 5);
    expect(t[1].label).toBe('1e6');
  });
  it('returns nothing for non-finite input', () => {
    expect(linearTicks(NaN, 1)).toEqual([]);
    expect(linearTicks(0, Infinity)).toEqual([]);
  });
});

describe('logTicks', () => {
  it('emits one major per decade', () => {
    const t = logTicks(0.001, 1000).filter((x) => !x.minor);
    expect(t.map((x) => x.value)).toEqual([0.001, 0.01, 0.1, 1, 10, 100, 1000]);
    expect(t.map((x) => x.label)).toEqual(['0.001', '0.01', '0.1', '1', '10', '100', '1000']);
  });
  it('thins decades on very wide ranges', () => {
    const t = logTicks(1, 1e12, 6);
    expect(t.every((x) => !x.minor)).toBe(true);
    expect(t.map((x) => x.value)).toEqual([1, 100, 1e4, 1e6, 1e8, 1e10, 1e12]);
    expect(t[3].label).toBe('1e6');
  });
  it('adds 2 and 5 minors on narrow ranges and clips to bounds', () => {
    const t = logTicks(0.5, 50);
    expect(t.map((x) => x.value)).toEqual([0.5, 1, 2, 5, 10, 20, 50]);
    expect(t.filter((x) => x.minor).map((x) => x.value)).toEqual([0.5, 2, 5, 20, 50]);
  });
  it('falls back to linear ticks inside a single decade', () => {
    const t = logTicks(2, 8);
    expect(t.map((x) => x.value)).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });
  it('rejects non-positive bounds', () => {
    expect(logTicks(0, 10)).toEqual([]);
    expect(logTicks(-1, 10)).toEqual([]);
  });
});

describe('formatTick / roundToStep', () => {
  it('formats with step precision and trims zeros', () => {
    expect(formatTick(0.2, 0.2)).toBe('0.2');
    expect(formatTick(1, 0.2)).toBe('1');
    expect(formatTick(-0.0000001, 1)).toBe('0');
    expect(formatTick(2500000)).toBe('2.5e6');
    expect(formatTick(0.00001234)).toBe('1.23e-5');
    expect(formatTick(0)).toBe('0');
    expect(formatTick(3.14159)).toBe('3.142');
  });
  it('rounds to the step precision', () => {
    expect(roundToStep(0.1 + 0.2, 0.1)).toBe(0.3);
    expect(roundToStep(1234.5, 100)).toBe(1235);
  });
});

describe('scales', () => {
  it('maps and inverts linearly', () => {
    const s = makeScale([0, 10], [0, 100]);
    expect(s(5)).toBe(50);
    expect(s.invert(50)).toBe(5);
    const r = makeScale([0, 10], [100, 0]);
    expect(r(0)).toBe(100);
    expect(r(10)).toBe(0);
    expect(r.invert(25)).toBe(7.5);
  });
  it('is stable for a degenerate domain', () => {
    const s = makeScale([3, 3], [0, 100]);
    expect(s(3)).toBe(0);
    expect(s.invert(40)).toBe(3);
  });
  it('zooms and pans domains', () => {
    expect(zoomDomain([0, 10], 5, 0.5)).toEqual([2.5, 7.5]);
    expect(zoomDomain([0, 10], 0, 2)).toEqual([0, 20]);
    expect(panDomain([0, 10], 3)).toEqual([3, 13]);
  });
  it('computes and pads extents', () => {
    expect(extent([[1, 5, NaN], [-2, 3]])).toEqual([-2, 5]);
    expect(extent([[], [NaN]])).toBeUndefined();
    expect(padDomain([0, 10], 0.1)).toEqual([-1, 11]);
    expect(padDomain([4, 4])).toEqual([3.6, 4.4]);
    expect(padDomain([0, 0])).toEqual([-1, 1]);
  });
});

describe('decimate', () => {
  const n = 10001;
  const x = Array.from({ length: n }, (_, i) => i / (n - 1));
  const y = x.map((v) => Math.sin(v * 40 * Math.PI) * (1 + v));
  it('returns the input untouched when sparse', () => {
    const r = decimate([0, 1, 2], [1, 2, 3], 100);
    expect(r.x).toEqual([0, 1, 2]);
    expect(r.y).toEqual([1, 2, 3]);
  });
  it('keeps at most two points per bucket plus the edges and preserves extremes', () => {
    const r = decimate(x, y, 100);
    expect(r.x.length).toBeLessThanOrEqual(202);
    expect(r.x.length).toBe(r.y.length);
    expect(Math.min(...r.y)).toBe(Math.min(...y));
    expect(Math.max(...r.y)).toBe(Math.max(...y));
    expect(isMonotonic(r.x)).toBe(true);
  });
  it('keeps one neighbour outside a zoomed range on each side', () => {
    const r = decimate(x, y, 50, 0.4, 0.6);
    expect(r.x[0]).toBeLessThan(0.4);
    expect(r.x[r.x.length - 1]).toBeGreaterThan(0.6);
    expect(r.x.slice(1, -1).every((v) => v >= 0.4 && v <= 0.6)).toBe(true);
    expect(r.x.length).toBeLessThanOrEqual(102);
  });
  it('truncates to the shorter of x and y', () => {
    const r = decimate([0, 1, 2, 3], [1, 2], 100);
    expect(r.x).toEqual([0, 1]);
  });
});

describe('nearest / interpolate', () => {
  it('finds the nearest sample by binary search', () => {
    expect(nearestIndex([0, 1, 2, 3], 1.4)).toBe(1);
    expect(nearestIndex([0, 1, 2, 3], 1.6)).toBe(2);
    expect(nearestIndex([0, 1, 2, 3], -5)).toBe(0);
    expect(nearestIndex([0, 1, 2, 3], 10)).toBe(3);
    expect(nearestIndex([], 1)).toBe(-1);
  });
  it('finds the nearest sample in unsorted data', () => {
    expect(nearestIndexUnsorted([3, 0, 2, 1], 0.9)).toBe(3);
    expect(nearestIndexUnsorted([], 0)).toBe(-1);
  });
  it('interpolates linearly inside the range only', () => {
    expect(interpolateAt([0, 1, 2], [0, 10, 20], 0.5)).toBe(5);
    expect(interpolateAt([0, 1, 2], [0, 10, 20], 2)).toBe(20);
    expect(interpolateAt([0, 1, 2], [0, 10, 20], 0)).toBe(0);
    expect(interpolateAt([0, 1, 2], [0, 10, 20], 2.5)).toBeUndefined();
    expect(interpolateAt([0, 1, 2], [0, 10, 20], -1)).toBeUndefined();
    expect(interpolateAt([], [], 1)).toBeUndefined();
    expect(interpolateAt([1], [7], 100)).toBe(7);
  });
  it('handles duplicate x (event points)', () => {
    expect(interpolateAt([0, 1, 1, 2], [0, 1, 5, 6], 1)).toBe(5);
    expect(interpolateAt([0, 1, 1, 2], [0, 1, 5, 6], 1.5)).toBe(5.5);
  });
  it('detects monotonic arrays', () => {
    expect(isMonotonic([0, 0, 1, 2])).toBe(true);
    expect(isMonotonic([0, 2, 1])).toBe(false);
    expect(isMonotonic([])).toBe(true);
  });
});

describe('precision for tiny ranges around a large offset', () => {
  it('keeps tick values and labels distinct and increasing inside the range', () => {
    const lo = -9.806650000000005;
    const hi = -9.80665;
    const t = linearTicks(lo, hi, 6);
    expect(t.length).toBeGreaterThanOrEqual(3);
    const values = t.map((x) => x.value);
    const labels = t.map((x) => x.label);
    expect(new Set(values).size).toBe(values.length);
    expect(new Set(labels).size).toBe(labels.length);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]);
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(lo - 1e-14);
      expect(v).toBeLessThanOrEqual(hi + 1e-14);
    }
    for (const l of labels) expect(l).not.toBe('-9.80665');
  });
  it('shows enough exponent digits for a narrow range of large values', () => {
    const t = linearTicks(2500000, 2501000, 6);
    expect(t.map((x) => x.label)).toEqual(['2.5e6', '2.5002e6', '2.5004e6', '2.5006e6', '2.5008e6', '2.501e6']);
  });
  it('does not round sub-1e-15 ticks to zero', () => {
    const t = linearTicks(1e-17, 5e-17, 6);
    expect(t.map((x) => x.value)).toEqual([1e-17, 2e-17, 3e-17, 4e-17, 5e-17]);
    expect(t.map((x) => x.label)).toEqual(['1e-17', '2e-17', '3e-17', '4e-17', '5e-17']);
  });
  it('derives the label precision from the step', () => {
    expect(formatTick(2500200, 200)).toBe('2.5002e6');
    expect(formatTick(2500000, 200)).toBe('2.5e6');
    expect(formatTick(283.152, 0.002)).toBe('283.152');
    expect(formatTick(3e-17, 1e-17)).toBe('3e-17');
    expect(formatTick(1e6, 1e6)).toBe('1e6');
    expect(roundToStep(3e-17, 1e-17)).toBe(3e-17);
    expect(roundToStep(-9.806650000000004, 1e-15)).toBe(-9.806650000000004);
  });
  it('pads a span within floating-point noise like a constant, and a real span proportionally', () => {
    const d = padDomain([-9.806650000000005, -9.80665], 0.05);
    expect(d[0]).toBeLessThan(-10);
    expect(d[1]).toBeGreaterThan(-9.5);
    const [lo, hi] = padDomain([283.15, 283.16], 0.05);
    expect(lo).toBeCloseTo(283.1495, 9);
    expect(hi).toBeCloseTo(283.1605, 9);
    expect(padDomain([0, 1e-13])).toEqual([-5e-15, 1e-13 + 5e-15]);
  });
});

describe('wheelZoom', () => {
  const xs = makeScale([0, 10], [50, 450]);
  const ys = makeScale([0, 1], [210, 10]);
  const area = { left: 50, top: 10, width: 400, height: 200 };
  it('zooms both domains around the cursor, keeping the value under the pointer in place', () => {
    const z = wheelZoom(xs, ys, area, 250, 110, -60);
    expect(z).toBeDefined();
    expect(z!.x[1] - z!.x[0]).toBeLessThan(10);
    expect(z!.y[1] - z!.y[0]).toBeLessThan(1);
    expect((5 - z!.x[0]) / (z!.x[1] - z!.x[0])).toBeCloseTo(0.5);
    expect((0.5 - z!.y[0]) / (z!.y[1] - z!.y[0])).toBeCloseTo(0.5);
    const edge = wheelZoom(xs, ys, area, 130, 110, -60)!;
    expect((2 - edge.x[0]) / (edge.x[1] - edge.x[0])).toBeCloseTo(0.2);
    const out = wheelZoom(xs, ys, area, 250, 110, 60)!;
    expect(out.x[1] - out.x[0]).toBeGreaterThan(10);
  });
  it('ignores wheel events outside the plotting area (tick labels, axis title, margins)', () => {
    expect(wheelZoom(xs, ys, area, 20, 100, -60)).toBeUndefined();
    expect(wheelZoom(xs, ys, area, 250, 230, -60)).toBeUndefined();
    expect(wheelZoom(xs, ys, area, 460, 100, -60)).toBeUndefined();
    expect(wheelZoom(xs, ys, area, 250, 5, -60)).toBeUndefined();
  });
  it('clamps very large deltas to a single notch', () => {
    expect(wheelZoom(xs, ys, area, 250, 110, -6000)!.x).toEqual(wheelZoom(xs, ys, area, 250, 110, -60)!.x);
  });
});
