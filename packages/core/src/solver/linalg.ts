/**
 * Small dense linear algebra kernels on row-major `Float64Array` matrices:
 * LU factorisation with row equilibration and partial pivoting, triangular solves and a few
 * vector helpers. Sized for the DAE systems this platform simulates (tens to a few hundred
 * unknowns), so everything is straightforward O(n^3) without blocking.
 */

export interface LUFactors {
  n: number;
  /** Combined L (strict lower, unit diagonal implied) and U (upper) of the scaled, permuted matrix. */
  lu: Float64Array;
  /** Row permutation: row i of the factorisation is row piv[i] of the (scaled) input. */
  piv: Int32Array;
  /** Row scaling applied before factorisation (1 / max |row|). */
  rowScale: Float64Array;
  singular: boolean;
  /** For singular matrices: the input row that vanished (all zeros) if that was the cause. */
  singularRow?: number;
  /** For singular matrices: the pivot column with no usable pivot. */
  singularCol?: number;
}

export function newLU(n: number): LUFactors {
  return { n, lu: new Float64Array(n * n), piv: new Int32Array(n), rowScale: new Float64Array(n), singular: false };
}

/** Relative pivot threshold below which a (row-equilibrated) matrix is treated as singular. */
export const SINGULAR_PIVOT = 1e-13;

/**
 * Factorises `a` (n x n, row-major, not modified) into `out`. Rows are scaled to unit max-norm
 * first so that pivoting is meaningful for badly scaled DAE Jacobians (currents vs. voltages).
 */
export function luFactor(a: Float64Array, n: number, out: LUFactors = newLU(n)): LUFactors {
  const lu = out.lu;
  const piv = out.piv;
  const scale = out.rowScale;
  out.singular = false;
  out.singularRow = undefined;
  out.singularCol = undefined;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = 0; j < n; j++) {
      const x = Math.abs(a[i * n + j]);
      if (x > m) m = x;
    }
    if (m === 0) {
      out.singular = true;
      if (out.singularRow === undefined) out.singularRow = i;
      scale[i] = 1;
    } else {
      scale[i] = 1 / m;
    }
    const s = scale[i];
    for (let j = 0; j < n; j++) lu[i * n + j] = a[i * n + j] * s;
    piv[i] = i;
  }
  if (out.singular) return out;

  for (let k = 0; k < n; k++) {
    // Partial pivoting: find the largest entry in column k below the diagonal.
    let p = k;
    let pmax = Math.abs(lu[k * n + k]);
    for (let i = k + 1; i < n; i++) {
      const x = Math.abs(lu[i * n + k]);
      if (x > pmax) {
        pmax = x;
        p = i;
      }
    }
    if (!(pmax > SINGULAR_PIVOT)) {
      out.singular = true;
      out.singularCol = k;
      return out;
    }
    if (p !== k) {
      for (let j = 0; j < n; j++) {
        const tmp = lu[k * n + j];
        lu[k * n + j] = lu[p * n + j];
        lu[p * n + j] = tmp;
      }
      const tp = piv[k];
      piv[k] = piv[p];
      piv[p] = tp;
    }
    const pivot = lu[k * n + k];
    for (let i = k + 1; i < n; i++) {
      const f = lu[i * n + k] / pivot;
      lu[i * n + k] = f;
      if (f !== 0) {
        for (let j = k + 1; j < n; j++) lu[i * n + j] -= f * lu[k * n + j];
      }
    }
  }
  return out;
}

/** Solves A x = b using the factorisation of A. `x` may alias `b`. */
export function luSolve(f: LUFactors, b: Float64Array, x: Float64Array): void {
  const n = f.n;
  const lu = f.lu;
  // Apply scaling + permutation: y = P D b
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const src = f.piv[i];
    y[i] = b[src] * f.rowScale[src];
  }
  // Forward substitution (unit lower).
  for (let i = 1; i < n; i++) {
    let s = y[i];
    for (let j = 0; j < i; j++) s -= lu[i * n + j] * y[j];
    y[i] = s;
  }
  // Back substitution.
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let j = i + 1; j < n; j++) s -= lu[i * n + j] * y[j];
    y[i] = s / lu[i * n + i];
  }
  for (let i = 0; i < n; i++) x[i] = y[i];
}

/** Convenience: solve A x = b for a fresh matrix. Throws if singular. */
export function solveLinear(a: Float64Array, b: Float64Array, n: number): Float64Array {
  const f = luFactor(a, n);
  if (f.singular) throw new Error('solveLinear: matrix is singular');
  const x = new Float64Array(n);
  luSolve(f, b, x);
  return x;
}

/** y = A x */
export function matVec(a: Float64Array, x: Float64Array, n: number, y: Float64Array = new Float64Array(n)): Float64Array {
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += a[i * n + j] * x[j];
    y[i] = s;
  }
  return y;
}

export function maxAbs(x: Float64Array): number {
  let m = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > m) m = a;
  }
  return m;
}

/** Weighted root-mean-square norm: sqrt(mean((x_i / w_i)^2)). Returns 0 for empty vectors. */
export function wrmsNorm(x: Float64Array, w: Float64Array, n: number = x.length): number {
  if (n === 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const r = x[i] / w[i];
    s += r * r;
  }
  return Math.sqrt(s / n);
}

/** Weighted max norm: max |x_i| / w_i. */
export function wmaxNorm(x: Float64Array, w: Float64Array, n: number = x.length): number {
  let m = 0;
  for (let i = 0; i < n; i++) {
    const r = Math.abs(x[i]) / w[i];
    if (r > m) m = r;
  }
  return m;
}

export function isFiniteArray(x: Float64Array, n: number = x.length): number {
  for (let i = 0; i < n; i++) if (!Number.isFinite(x[i])) return i;
  return -1;
}
