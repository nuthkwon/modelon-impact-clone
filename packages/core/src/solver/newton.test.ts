import { describe, expect, it } from 'vitest';
import { JacobianCache, newtonSolve, type NewtonProblem } from './newton.js';

function problem(n: number, residual: (z: Float64Array, out: Float64Array) => void, tol = 1e-10): NewtonProblem {
  return {
    n,
    residual,
    weights(z, w) {
      for (let i = 0; i < n; i++) w[i] = tol * (1 + Math.abs(z[i]));
    },
    typical: new Float64Array(n).fill(1),
  };
}

describe('Newton solver', () => {
  it('solves a linear system in one or two iterations', () => {
    const p = problem(2, (z, out) => {
      out[0] = 2 * z[0] + z[1] - 5;
      out[1] = z[0] - z[1] - 1;
    });
    const z = new Float64Array([0, 0]);
    const res = newtonSolve(p, z, new JacobianCache(2));
    expect(res.converged).toBe(true);
    expect(res.iterations).toBeLessThanOrEqual(2);
    expect(res.jacobians).toBe(1);
    expect(z[0]).toBeCloseTo(2, 9);
    expect(z[1]).toBeCloseTo(1, 9);
  });

  it('solves a nonlinear system (x^2 + y^2 = 2, x - y = 0)', () => {
    const p = problem(2, (z, out) => {
      out[0] = z[0] * z[0] + z[1] * z[1] - 2;
      out[1] = z[0] - z[1];
    });
    const z = new Float64Array([3, 0.5]);
    const res = newtonSolve(p, z, new JacobianCache(2));
    expect(res.converged).toBe(true);
    expect(z[0]).toBeCloseTo(1, 9);
    expect(z[1]).toBeCloseTo(1, 9);
    expect(res.stepNorm).toBeLessThanOrEqual(1);
  });

  it('reuses the Jacobian across solves and refreshes it when convergence is slow', () => {
    const p = problem(1, (z, out) => {
      out[0] = Math.exp(z[0]) - 5; // root ln 5
    });
    const cache = new JacobianCache(1);
    const z1 = new Float64Array([1]);
    const r1 = newtonSolve(p, z1, cache);
    expect(r1.converged).toBe(true);
    expect(z1[0]).toBeCloseTo(Math.log(5), 9);
    // Second solve from a different point: the stale Jacobian is reused first and
    // refreshed only if convergence is too slow.
    const z2 = new Float64Array([1.7]);
    const r2 = newtonSolve(p, z2, cache);
    expect(r2.converged).toBe(true);
    expect(z2[0]).toBeCloseTo(Math.log(5), 9);
    expect(r1.jacobians + r2.jacobians).toBeLessThanOrEqual(3);
  });

  it('uses damping to converge from a poor starting point', () => {
    // atan(x) = 0.5: undamped Newton from x = 10 diverges.
    const p = problem(1, (z, out) => {
      out[0] = Math.atan(z[0]) - 0.5;
    });
    const z = new Float64Array([10]);
    const res = newtonSolve(p, z, new JacobianCache(1), { maxIterations: 100, maxJacobians: 100 });
    expect(res.converged).toBe(true);
    expect(z[0]).toBeCloseTo(Math.tan(0.5), 8);
  });

  it('reports singular Jacobians with the offending equation/unknown', () => {
    const p = problem(2, (z, out) => {
      out[0] = z[0] - 1;
      out[1] = 2 * z[0] - 2; // does not depend on z[1]
    });
    const res = newtonSolve(p, new Float64Array([0, 0]), new JacobianCache(2));
    expect(res.converged).toBe(false);
    expect(res.reason).toBe('singular');
    expect(res.singularCol).toBe(1);

    const zeroRow = problem(2, (z, out) => {
      out[0] = z[0] + z[1];
      out[1] = 0;
    });
    const r2 = newtonSolve(zeroRow, new Float64Array([0, 0]), new JacobianCache(2));
    expect(r2.reason).toBe('singular');
    expect(r2.singularRow).toBe(1);
  });

  it('reports non-finite residuals', () => {
    const p = problem(1, (z, out) => {
      out[0] = Math.sqrt(z[0] - 5); // NaN at the start value
    });
    const res = newtonSolve(p, new Float64Array([0]), new JacobianCache(1));
    expect(res.converged).toBe(false);
    expect(res.reason).toBe('non-finite');
    expect(res.nonFiniteIndex).toBe(0);
  });

  it('gives up after the iteration limit when there is no root', () => {
    const p = problem(1, (z, out) => {
      out[0] = z[0] * z[0] + 1;
    });
    const res = newtonSolve(p, new Float64Array([1]), new JacobianCache(1), { maxIterations: 20, maxJacobians: 20 });
    expect(res.converged).toBe(false);
    expect(['max-iterations', 'diverged']).toContain(res.reason);
  });

  it('uses unit perturbations for discrete-valued unknowns', () => {
    // b in {0,1}; y = (b >= 0.5 ? 1 : 0); b = 1. A relative perturbation of b would create a
    // huge Jacobian entry; the unit perturbation gives dy/db = 1.
    const p: NewtonProblem = {
      n: 2,
      residual(z, out) {
        out[0] = z[0] - 1;
        out[1] = z[1] - (z[0] >= 0.5 ? 1 : 0);
      },
      weights(_z, w) {
        w.fill(1e-9);
      },
      typical: new Float64Array([1, 1]),
      perturbation: new Float64Array([1, 0]),
    };
    const z = new Float64Array([0, 0]);
    const res = newtonSolve(p, z, new JacobianCache(2));
    expect(res.converged).toBe(true);
    expect(z[0]).toBeCloseTo(1, 12);
    expect(z[1]).toBeCloseTo(1, 12);
  });

  it('handles empty problems', () => {
    const res = newtonSolve(problem(0, () => undefined), new Float64Array(0), new JacobianCache(0));
    expect(res.converged).toBe(true);
    expect(res.iterations).toBe(0);
  });
});
