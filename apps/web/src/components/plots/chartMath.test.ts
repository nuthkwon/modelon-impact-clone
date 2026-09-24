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
