import { describe, expect, it } from 'vitest';
import { luFactor, luSolve, matVec, solveLinear, wrmsNorm } from './linalg.js';

function randomMatrix(n: number, seed: number): Float64Array {
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff - 0.5;
  };
  const a = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) a[i] = rnd() * 10;
  // make it comfortably non-singular
  for (let i = 0; i < n; i++) a[i * n + i] += 20;
  return a;
}

describe('dense LU', () => {
  it('solves a small system exactly', () => {
    // 2x + y = 5, x - y = 1  -> x = 2, y = 1
    const a = new Float64Array([2, 1, 1, -1]);
    const x = solveLinear(a, new Float64Array([5, 1]), 2);
    expect(x[0]).toBeCloseTo(2, 12);
    expect(x[1]).toBeCloseTo(1, 12);
  });

  it('solves random systems to machine precision (A x == b)', () => {
    for (const n of [1, 3, 7, 20]) {
      const a = randomMatrix(n, n * 17 + 3);
      const xTrue = new Float64Array(n).map((_, i) => i + 1);
      const b = matVec(a, xTrue, n);
      const x = solveLinear(a, b, n);
      for (let i = 0; i < n; i++) expect(x[i]).toBeCloseTo(xTrue[i], 9);
    }
  });

  it('handles badly scaled rows thanks to row equilibration', () => {
    // Row 0 is 1e-8 times row scale of row 1: the pivot search would otherwise be misled.
    const a = new Float64Array([1e-8, 2e-8, 3, 4]);
    const b = new Float64Array([1e-8 * 1 + 2e-8 * 2, 3 * 1 + 4 * 2]);
    const x = solveLinear(a, b, 2);
    expect(x[0]).toBeCloseTo(1, 8);
    expect(x[1]).toBeCloseTo(2, 8);
  });

  it('pivots when the diagonal is zero', () => {
    const a = new Float64Array([0, 1, 1, 0]);
    const x = solveLinear(a, new Float64Array([3, 4]), 2);
    expect(x[0]).toBeCloseTo(4, 12);
    expect(x[1]).toBeCloseTo(3, 12);
  });

  it('reports singular matrices with the offending row/column', () => {
    const zeroRow = luFactor(new Float64Array([1, 2, 0, 0]), 2);
    expect(zeroRow.singular).toBe(true);
    expect(zeroRow.singularRow).toBe(1);
    const dependent = luFactor(new Float64Array([1, 2, 2, 4]), 2);
    expect(dependent.singular).toBe(true);
    expect(dependent.singularCol).toBe(1);
    expect(() => solveLinear(new Float64Array([1, 2, 2, 4]), new Float64Array([1, 1]), 2)).toThrow(/singular/);
  });

  it('reuses a factorisation for several right-hand sides', () => {
    const n = 4;
    const a = randomMatrix(n, 99);
    const f = luFactor(a, n);
    for (let k = 0; k < 3; k++) {
      const xTrue = new Float64Array(n).map((_, i) => (i + 1) * (k + 1));
      const b = matVec(a, xTrue, n);
      const x = new Float64Array(n);
      luSolve(f, b, x);
      for (let i = 0; i < n; i++) expect(x[i]).toBeCloseTo(xTrue[i], 9);
    }
  });

  it('computes weighted RMS norms', () => {
    expect(wrmsNorm(new Float64Array([3, 4]), new Float64Array([1, 1]))).toBeCloseTo(Math.sqrt(12.5), 12);
    expect(wrmsNorm(new Float64Array([]), new Float64Array([]))).toBe(0);
  });
});
