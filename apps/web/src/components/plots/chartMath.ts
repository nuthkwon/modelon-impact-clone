/**
 * Pure numeric helpers for the SVG line chart: 1-2-5 "nice" ticks, log ticks, linear/log
 * scales, min/max decimation and nearest-x interpolation. No DOM, no React — unit-tested.
 */

export interface Tick {
  value: number;
  label: string;
  /** Minor ticks (2·10^n, 5·10^n on log axes) draw a gridline but a lighter label. */
  minor?: boolean;
}

export type Domain = [number, number];

/** Largest 1/2/5·10^n step that yields at most `maxTicks` intervals over `span`. */
export function niceStep(span: number, maxTicks = 6): number {
  if (!(span > 0) || !Number.isFinite(span) || !(maxTicks > 0)) return 1;
  const rough = span / maxTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const r = rough / mag;
  const m = r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10;
  return m * mag;
}

/** Decimal places implied by `step` (0 for steps ≥ 1), capped at what toFixed accepts. */
function decimalsOf(step: number): number {
  return Math.min(100, Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));
}

/** Significant digits that show a value of magnitude `abs` at the resolution of `step` (1..17). */
function significantDigits(abs: number, step: number): number {
  const d = Math.floor(Math.log10(abs) + 1e-9) - Math.floor(Math.log10(step) + 1e-9) + 1;
  return Math.min(17, Math.max(1, d));
}

/** Strips trailing zeros of a plain number or an exponent mantissa: `2.5000e+6` → `2.5e6`, `0.30` → `0.3`, `-0` → `0`. */
function trimZeros(s: string): string {
  const [mantissa, exp] = s.split('e');
  let m = mantissa.includes('.') ? mantissa.replace(/\.?0+$/, '') : mantissa;
  if (m === '-0') m = '0';
  return exp === undefined ? m : `${m}e${exp.replace('+', '')}`;
}

/**
 * Rounds `v` to the decimal precision implied by `step` (kills 0.30000000000000004) without
 * dropping digits the step resolves: ticks 1e-17 apart stay 1e-17, 2e-17, … instead of 0.
 */
export function roundToStep(v: number, step: number): number {
  const out = Number(v.toFixed(decimalsOf(step)));
  return out === 0 ? 0 : out;
}

/**
 * Tick label: fixed decimals derived from `step`, exponent form for very large/small values. The
 * precision follows the step in both forms, so ticks 200 apart around 2.5e6 read 2.5e6, 2.5002e6,
 * … and ticks 1e-15 apart around -9.80665 keep the digits that tell them apart.
 */
export function formatTick(v: number, step?: number): string {
  if (!Number.isFinite(v)) return '';
  if (v === 0) return '0';
  const abs = Math.abs(v);
  const st = step !== undefined && step > 0 && Number.isFinite(step) ? step : undefined;
  if (st !== undefined && abs < st * 1e-6) return '0';
  if (abs >= 1e6 || abs < 1e-4) {
    return trimZeros(st !== undefined ? v.toExponential(significantDigits(abs, st) - 1) : Number(v.toPrecision(3)).toExponential());
  }
  if (st === undefined) return trimZeros(Number(v.toPrecision(4)).toString());
  // Below the double's resolution toFixed prints binary noise ("-9.806649999999999"); the shortest
  // round-trip form of the same value ("-9.80665") is just as exact, so take it when it is shorter.
  const fixed = v.toFixed(decimalsOf(st));
  const shortest = String(v);
  return trimZeros(shortest.length < fixed.length && !shortest.includes('e') ? shortest : fixed);
}

/** Linear ticks at 1-2-5 steps covering [min, max] (inclusive when a tick lands on a bound). */
export function linearTicks(min: number, max: number, maxTicks = 6): Tick[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min > max) [min, max] = [max, min];
  if (min === max) {
    const pad = min === 0 ? 1 : Math.abs(min) * 0.1;
    min -= pad;
    max += pad;
  }
  const step = niceStep(max - min, maxTicks);
  // Count steps from the multiple of `step` nearest `min` rather than from 0, so a small range far
  // from the origin keeps its precision (i·step stays tiny next to the anchor).
  const anchor = roundToStep(Math.round(min / step) * step, step);
  const start = anchor + Math.ceil((min - anchor) / step - 1e-9) * step;
  const tol = step * 1e-9;
  const ticks: Tick[] = [];
  for (let i = 0; i < 200; i++) {
    const value = roundToStep(start + i * step, step);
    if (value > max + tol) break;
    // Skip float noise below the range and duplicates (steps below the double's resolution).
    if (value < min - tol || (ticks.length > 0 && value <= ticks[ticks.length - 1].value)) continue;
    ticks.push({ value, label: formatTick(value, step) });
  }
  return ticks;
}

/**
 * Log-axis ticks: one major per decade (thinned to ≤ maxTicks+1 decades), plus 2·10^n and 5·10^n
 * minors when the range spans few decades. Falls back to linear ticks inside a single decade.
 */
export function logTicks(min: number, max: number, maxTicks = 6): Tick[] {
  if (!(min > 0) || !(max > 0) || !Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min > max) [min, max] = [max, min];
  if (min === max) {
    min /= 2;
    max *= 2;
  }
  const lo = Math.floor(Math.log10(min) + 1e-9);
  const hi = Math.ceil(Math.log10(max) - 1e-9);
  const decades = hi - lo;
  const step = Math.max(1, Math.ceil(decades / maxTicks));
  const inRange = (v: number) => v >= min * (1 - 1e-9) && v <= max * (1 + 1e-9);
  const ticks: Tick[] = [];
  for (let e = lo; e <= hi; e += step) {
    const v = Math.pow(10, e);
    if (inRange(v)) ticks.push({ value: v, label: formatTick(v, v) });
    if (step === 1 && decades <= 4) {
      for (const m of [2, 5]) {
        const mv = m * v;
        if (inRange(mv)) ticks.push({ value: mv, label: formatTick(mv, v), minor: true });
      }
    }
  }
  ticks.sort((a, b) => a.value - b.value);
  if (ticks.length < 3) return linearTicks(min, max, maxTicks).filter((t) => t.value > 0);
  return ticks;
}

export interface Scale {
  (v: number): number;
  invert(px: number): number;
  domain: Domain;
  range: Domain;
}

/** Linear mapping domain → range (both may be reversed). Log axes transform values first. */
export function makeScale(domain: Domain, range: Domain): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  const fn = ((v: number) => r0 + (v - d0) * k) as Scale;
  fn.invert = (px: number) => (k === 0 ? d0 : d0 + (px - r0) / k);
  fn.domain = domain;
  fn.range = range;
  return fn;
}

export const log10 = (v: number): number => (v > 0 ? Math.log10(v) : NaN);
export const pow10 = (v: number): number => Math.pow(10, v);

/** [min, max] over all finite values of the given arrays; undefined when empty. */
export function extent(arrays: number[][]): Domain | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  for (const arr of arrays) {
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (!Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return lo <= hi ? [lo, hi] : undefined;
}

/**
 * True when [lo, hi] spans nothing beyond floating-point noise (≤ 1e-12 of its magnitude): the
 * data is a constant such as der(v) = -9.80665 ± a few ULPs, and no axis can resolve it.
 */
export function isNoiseSpan(lo: number, hi: number): boolean {
  return hi - lo <= Math.max(Math.abs(lo), Math.abs(hi)) * 1e-12;
}

/** Pads a domain by `fraction` on each side; a constant (or noise-level) domain gets ±10 % (or ±1 around 0). */
export function padDomain([lo, hi]: Domain, fraction = 0.05): Domain {
  if (isNoiseSpan(lo, hi)) {
    const mid = (lo + hi) / 2;
    const pad = mid === 0 ? 1 : Math.abs(mid) * 0.1;
    return [mid - pad, mid + pad];
  }
  const pad = (hi - lo) * fraction;
  return [lo - pad, hi + pad];
}

/** True when x is non-decreasing (time-like); enables binary search and decimation. */
export function isMonotonic(x: number[]): boolean {
  for (let i = 1; i < x.length; i++) if (x[i] < x[i - 1]) return false;
  return true;
}

/**
 * Min/max decimation: one bucket per pixel column over [xMin, xMax]; each bucket keeps its
 * minimum and maximum (in x order) so peaks survive. The nearest points outside the range are
 * kept so lines run to the edge. Requires monotonic x; returns the input when already sparse.
 */
export function decimate(x: number[], y: number[], buckets: number, xMin?: number, xMax?: number): { x: number[]; y: number[] } {
  const n = Math.min(x.length, y.length);
  if (n <= buckets * 2 || buckets < 1) return { x: x.length === n ? x : x.slice(0, n), y: y.length === n ? y : y.slice(0, n) };
  const lo = xMin ?? x[0];
  const hi = xMax ?? x[n - 1];
  if (!(hi > lo)) return { x: x.slice(0, n), y: y.slice(0, n) };
  const width = (hi - lo) / buckets;
  const ox: number[] = [];
  const oy: number[] = [];
  // nearest point left of the range
  let start = 0;
  while (start < n && x[start] < lo) start++;
  if (start > 0) {
    ox.push(x[start - 1]);
    oy.push(y[start - 1]);
  }
  let bucket = -1;
  let minI = -1;
  let maxI = -1;
  const flush = () => {
    if (minI < 0) return;
    if (minI === maxI) {
      ox.push(x[minI]);
      oy.push(y[minI]);
    } else if (minI < maxI) {
      ox.push(x[minI], x[maxI]);
      oy.push(y[minI], y[maxI]);
    } else {
      ox.push(x[maxI], x[minI]);
      oy.push(y[maxI], y[minI]);
    }
    minI = maxI = -1;
  };
  let i = start;
  for (; i < n && x[i] <= hi; i++) {
    const b = Math.min(buckets - 1, Math.floor((x[i] - lo) / width));
    if (b !== bucket) {
      flush();
      bucket = b;
    }
    const v = y[i];
    if (minI < 0) {
      minI = maxI = i;
    } else {
      if (v < y[minI] || (Number.isNaN(y[minI]) && !Number.isNaN(v))) minI = i;
      if (v > y[maxI] || (Number.isNaN(y[maxI]) && !Number.isNaN(v))) maxI = i;
    }
  }
  flush();
  // nearest point right of the range
  if (i < n) {
    ox.push(x[i]);
    oy.push(y[i]);
  }
  return { x: ox, y: oy };
}

/** Index of the sample closest to `v` in a sorted array (binary search); -1 for empty input. */
export function nearestIndex(xs: number[], v: number): number {
  const n = xs.length;
  if (!n) return -1;
  if (v <= xs[0]) return 0;
  if (v >= xs[n - 1]) return n - 1;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= v) lo = mid;
    else hi = mid;
  }
  return v - xs[lo] <= xs[hi] - v ? lo : hi;
}

/** Index of the sample closest to `v` in an unsorted array (linear scan); -1 for empty input. */
export function nearestIndexUnsorted(xs: number[], v: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const d = Math.abs(xs[i] - v);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Linear interpolation of y at x = v over a sorted x array. Returns undefined outside the
 * data range or for empty input; a single sample is a constant.
 */
export function interpolateAt(xs: number[], ys: number[], v: number): number | undefined {
  const n = Math.min(xs.length, ys.length);
  if (!n) return undefined;
  if (n === 1) return ys[0];
  if (v < xs[0] || v > xs[n - 1]) return undefined;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= v) lo = mid;
    else hi = mid;
  }
  if (xs[hi] === xs[lo]) return ys[lo];
  const f = (v - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + f * (ys[hi] - ys[lo]);
}

/** Zooms a domain by `factor` around `center` (factor < 1 zooms in). */
export function zoomDomain([lo, hi]: Domain, center: number, factor: number): Domain {
  return [center - (center - lo) * factor, center + (hi - center) * factor];
}

/** Shifts a domain by `delta` in domain units. */
export function panDomain([lo, hi]: Domain, delta: number): Domain {
  return [lo + delta, hi + delta];
}

export interface PlotArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Zoom factor of a wheel notch: 0.8 % per px of deltaY (clamped to ±60 px); exp keeps in and out symmetric. */
export function wheelZoomFactor(deltaY: number): number {
  return Math.exp(Math.sign(deltaY) * Math.min(Math.abs(deltaY), 60) * 0.008);
}

/**
 * Domains after a wheel event at pixel (px, py), both zoomed around the value under the pointer;
 * undefined when the pointer is outside the plotting area (tick labels, axis titles, margins).
 */
export function wheelZoom(xs: Scale, ys: Scale, area: PlotArea, px: number, py: number, deltaY: number): { x: Domain; y: Domain } | undefined {
  if (px < area.left || px > area.left + area.width || py < area.top || py > area.top + area.height) return undefined;
  const factor = wheelZoomFactor(deltaY);
  return { x: zoomDomain(xs.domain, xs.invert(px), factor), y: zoomDomain(ys.domain, ys.invert(py), factor) };
}
