/**
 * Damped Newton iteration for dense nonlinear systems F(z) = 0 with a finite-difference
 * Jacobian. The LU factorisation lives in a `JacobianCache` that callers keep across
 * iterations and across integrator steps ("modified Newton"); it is refreshed when
 * convergence slows down, when a line search cannot find a decrease, or when the caller
 * invalidates it (e.g. the step size changed).
 */
import { luFactor, luSolve, newLU, type LUFactors } from './linalg.js';

export interface NewtonProblem {
  n: number;
  /** Evaluates F(z) into `out` (length n). */
  residual(z: Float64Array, out: Float64Array): void;
  /**
   * Fills convergence weights for the current iterate: the iteration has converged when
   * max_i |dz_i| / w_i <= 1.
   */
  weights(z: Float64Array, w: Float64Array): void;
  /** Typical magnitudes (nominal values) used to size finite-difference perturbations. */
  typical: Float64Array;
  /**
   * Optional absolute perturbation per unknown (0 = relative default). Boolean/Integer unknowns
   * use 1 so that a perturbation flips conditions the way a real change of the value would.
   */
  perturbation?: Float64Array;
}

export class JacobianCache {
  readonly n: number;
  readonly factors: LUFactors;
  /** Raw (unscaled) Jacobian, kept for diagnostics. */
  readonly jacobian: Float64Array;
  valid = false;
  /** Number of Newton iterations performed since the Jacobian was computed. */
  age = 0;
  /** Caller-defined tag (e.g. the BDF leading coefficient the Jacobian was built with). */
  tag = NaN;

  constructor(n: number) {
    this.n = n;
    this.factors = newLU(n);
    this.jacobian = new Float64Array(n * n);
  }

  invalidate(): void {
    this.valid = false;
  }
}

export interface NewtonOptions {
  /** Maximum number of Newton iterations (default 30). */
  maxIterations?: number;
  /** Maximum number of Jacobian evaluations within one solve (default 4). */
  maxJacobians?: number;
  /** Use a backtracking line search on the scaled residual norm (default true). */
  lineSearch?: boolean;
  /**
   * When the iteration hits `maxIterations` but the last scaled step is at most this value,
   * accept the iterate anyway (default: not accepted).
   */
  relaxedTolerance?: number;
  /** Recompute the Jacobian at every iteration (full Newton; used as an initialisation fallback). */
  alwaysRefresh?: boolean;
}

export type NewtonFailure = 'singular' | 'max-iterations' | 'diverged' | 'non-finite';

export interface NewtonResult {
  converged: boolean;
  iterations: number;
  jacobians: number;
  /** Scaled norm of the last Newton step (<= 1 means converged). */
  stepNorm: number;
  /** Final residual vector (aliases internal storage; copy if you keep it). */
  residual: Float64Array;
  reason?: NewtonFailure;
  /** Equation index with the largest |F_i| at the end. */
  worstEquation: number;
  /** For `singular`: input row that vanished (an equation independent of every unknown). */
  singularRow?: number;
  /** For `singular`: pivot column without a usable pivot (an unknown not determined by the equations). */
  singularCol?: number;
  /** For `non-finite`: equation index that produced NaN/Infinity. */
  nonFiniteIndex?: number;
  /** True when the result was accepted through `relaxedTolerance`. */
  relaxed?: boolean;
}

const SQRT_EPS = 1.4901161193847656e-8;

/**
 * Computes the finite-difference Jacobian of `p` at `z` (with residual `f0` already evaluated
 * there) and factorises it into `cache`. Returns the index of an equation that produced a
 * non-finite value, or -1 on success (check `cache.factors.singular` afterwards).
 */
export function computeJacobian(p: NewtonProblem, z: Float64Array, f0: Float64Array, cache: JacobianCache, scratch: Float64Array): number {
  const n = p.n;
  const J = cache.jacobian;
  const pert = p.perturbation;
  for (let j = 0; j < n; j++) {
    const zj = z[j];
    let d: number;
    if (pert && pert[j] > 0) {
      d = zj >= 0.5 ? -pert[j] : pert[j];
    } else {
      d = SQRT_EPS * Math.max(Math.abs(zj), p.typical[j]);
      if (zj < 0) d = -d;
    }
    z[j] = zj + d;
    p.residual(z, scratch);
    z[j] = zj;
    const inv = 1 / d;
    for (let i = 0; i < n; i++) {
      const v = (scratch[i] - f0[i]) * inv;
      if (!Number.isFinite(v)) {
        cache.valid = false;
        return i;
      }
      J[i * n + j] = v;
    }
  }
  luFactor(J, n, cache.factors);
  cache.valid = !cache.factors.singular;
  cache.age = 0;
  return -1;
}

function firstNonFinite(f: Float64Array, n: number): number {
  for (let i = 0; i < n; i++) if (!Number.isFinite(f[i])) return i;
  return -1;
}

function scaledResidualNorm(f: Float64Array, factors: LUFactors, n: number): number {
  let m = 0;
  for (let i = 0; i < n; i++) {
    const r = Math.abs(f[i]) * factors.rowScale[i];
    if (r > m) m = r;
  }
  return m;
}

function worstIndex(f: Float64Array, n: number): number {
  let m = -1;
  let idx = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(f[i]);
    if (!(a <= m)) {
      m = a;
      idx = i;
    }
  }
  return idx;
}

/**
 * Solves F(z) = 0 starting from `z` (updated in place). `cache` may hold a factorisation
 * from an earlier solve; it is reused while convergence is acceptable.
 */
export function newtonSolve(p: NewtonProblem, z: Float64Array, cache: JacobianCache, options: NewtonOptions = {}): NewtonResult {
  const n = p.n;
  const maxIter = options.maxIterations ?? 30;
  const maxJac = options.maxJacobians ?? 4;
  const lineSearch = options.lineSearch ?? true;
  const f = new Float64Array(n);
  const result: NewtonResult = { converged: true, iterations: 0, jacobians: 0, stepNorm: 0, residual: f, worstEquation: 0 };
  if (n === 0) return result;

  const fNew = new Float64Array(n);
  const dz = new Float64Array(n);
  const dzBar = new Float64Array(n);
  const zTrial = new Float64Array(n);
  const w = new Float64Array(n);
  const scratch = new Float64Array(n);

  p.residual(z, f);
  let nf = firstNonFinite(f, n);
  if (nf >= 0) return { ...result, converged: false, reason: 'non-finite', nonFiniteIndex: nf, worstEquation: nf };

  let iterations = 0;
  let jacobians = 0;
  let deltaPrev = Infinity;
  let delta = Infinity;

  while (iterations < maxIter) {
    if (!cache.valid) {
      if (jacobians >= maxJac) break;
      const bad = computeJacobian(p, z, f, cache, scratch);
      jacobians++;
      if (bad >= 0) {
        return { ...result, converged: false, iterations, jacobians, reason: 'non-finite', nonFiniteIndex: bad, worstEquation: bad };
      }
      if (cache.factors.singular) {
        return {
          ...result,
          converged: false,
          iterations,
          jacobians,
          reason: 'singular',
          singularRow: cache.factors.singularRow,
          singularCol: cache.factors.singularCol,
          worstEquation: worstIndex(f, n),
        };
      }
    }
    const fresh = cache.age === 0;

    luSolve(cache.factors, f, dz);
    for (let i = 0; i < n; i++) dz[i] = -dz[i];
    p.weights(z, w);
    let fullStep = 0;
    for (let i = 0; i < n; i++) {
      const r = Math.abs(dz[i]) / w[i];
      if (r > fullStep) fullStep = r;
    }

    // Backtracking line search. A trial step is accepted when the (row-equilibrated) residual
    // norm decreases, or when Deuflhard's natural monotonicity test holds: the simplified
    // Newton correction at the trial point, J^-1 F(z + lambda dz), is shorter than
    // (1 - lambda/2) |dz| in the convergence weights. The second test is affine invariant and
    // does not depend on how the equations happen to be scaled (e.g. bilinear rows such as
    // `P = v*i` whose residual grows quadratically along an otherwise exact Newton step).
    const fNorm0 = scaledResidualNorm(f, cache.factors, n);
    let lambda = 1;
    let accepted = false;
    let trialFinite = false;
    for (let ls = 0; ls < 7; ls++) {
      for (let i = 0; i < n; i++) zTrial[i] = z[i] + lambda * dz[i];
      p.residual(zTrial, fNew);
      nf = firstNonFinite(fNew, n);
      trialFinite = nf < 0;
      if (trialFinite) {
        if (!lineSearch || lambda * fullStep <= 1) {
          accepted = true;
          break;
        }
        const fNorm1 = scaledResidualNorm(fNew, cache.factors, n);
        if (fNorm1 <= fNorm0 * (1 - 1e-4 * lambda) || fNorm1 <= 1e-300) {
          accepted = true;
          break;
        }
        luSolve(cache.factors, fNew, dzBar);
        let barStep = 0;
        for (let i = 0; i < n; i++) {
          const r = Math.abs(dzBar[i]) / w[i];
          if (r > barStep) barStep = r;
        }
        if (barStep <= (1 - 0.5 * lambda) * fullStep) {
          accepted = true;
          break;
        }
      }
      lambda *= 0.5;
    }
    if (!accepted) {
      if (!fresh) {
        // The Jacobian is stale: refresh it and try again from the same point.
        cache.invalidate();
        continue;
      }
      if (!trialFinite) {
        return { ...result, converged: false, iterations, jacobians, reason: 'non-finite', nonFiniteIndex: nf, worstEquation: nf };
      }
      // Fresh Jacobian and no decrease even for a tiny step: take the damped step anyway; the
      // divergence check below will stop the iteration if this keeps happening.
      accepted = true;
    }

    iterations++;
    cache.age++;
    delta = lambda * fullStep;
    z.set(zTrial);
    f.set(fNew);
    if (options.alwaysRefresh) cache.invalidate();

    if (delta <= 1) {
      // Estimate the remaining error from the observed contraction rate.
      const rate = deltaPrev < Infinity && deltaPrev > 0 ? delta / deltaPrev : 0;
      const est = rate < 1 ? (delta * rate) / (1 - rate) : delta;
      if (rate < 0.9 && est <= 1) {
        return { converged: true, iterations, jacobians, stepNorm: delta, residual: f, worstEquation: worstIndex(f, n) };
      }
      if (delta <= 0.01) {
        return { converged: true, iterations, jacobians, stepNorm: delta, residual: f, worstEquation: worstIndex(f, n) };
      }
    }
    if (deltaPrev < Infinity) {
      if (delta > 0.5 * deltaPrev && !fresh) cache.invalidate();
      else if (delta > 10 * deltaPrev && fresh && lambda < 1) {
        return { converged: false, iterations, jacobians, stepNorm: delta, residual: f, reason: 'diverged', worstEquation: worstIndex(f, n) };
      }
    }
    deltaPrev = delta;
  }

  if (options.relaxedTolerance !== undefined && delta <= options.relaxedTolerance) {
    return { converged: true, relaxed: true, iterations, jacobians, stepNorm: delta, residual: f, worstEquation: worstIndex(f, n) };
  }
  return { converged: false, iterations, jacobians, stepNorm: delta, residual: f, reason: 'max-iterations', worstEquation: worstIndex(f, n) };
}
