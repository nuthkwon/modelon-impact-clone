/**
 * Runtime view of a compiled model: evaluation context, tolerances, the two Newton problems
 * the integrators need (implicit step in the states+algebraics, and algebraics+derivatives
 * for given states) and shared statistics/logging.
 */
import { ModelicaError } from '../ast.js';
import type { SimulationOptions, SimulationStats } from '../simulation.js';
import { createContext, type CompiledModel, type EvalContext } from './compile.js';
import { JacobianCache, newtonSolve, type NewtonOptions, type NewtonProblem, type NewtonResult } from './newton.js';

export type LogFn = (level: 'debug' | 'info' | 'warning' | 'error', message: string) => void;

/** Newton converges to a fraction of the integration tolerance. */
const NEWTON_FACTOR = 0.05;

export class System {
  readonly m: CompiledModel;
  readonly ctx: EvalContext;
  readonly nS: number;
  readonly nA: number;
  readonly nD: number;
  readonly nU: number;
  readonly nEq: number;
  readonly rtol: number;
  /** Absolute tolerance per unknown (scaled by nominal). */
  readonly atol: Float64Array;
  /** Nominal magnitude per unknown. */
  readonly nominal: Float64Array;
  readonly stats: SimulationStats;
  readonly log: LogFn;
  readonly options: SimulationOptions;

  /** Canonical current state of the simulation. */
  t = 0;
  readonly v: Float64Array;
  readonly dv: Float64Array;

  readonly implicitCache: JacobianCache;
  implicitAlpha = NaN;
  readonly algebraicCache: JacobianCache;

  private readonly resScratch: Float64Array;
  private newtonWarnings = 0;

  constructor(m: CompiledModel, options: SimulationOptions, stats: SimulationStats, log: LogFn) {
    this.m = m;
    this.options = options;
    this.stats = stats;
    this.log = log;
    this.ctx = createContext(m);
    this.nS = m.nS;
    this.nA = m.nA;
    this.nD = m.nD;
    this.nU = m.nU;
    this.nEq = m.residuals.length;
    this.rtol = options.rtol > 0 ? options.rtol : 1e-6;
    const atolBase = options.atol !== undefined && options.atol > 0 ? options.atol : 1e-6;
    this.atol = new Float64Array(m.nU);
    this.nominal = new Float64Array(m.nU);
    for (const u of m.unknowns) {
      this.nominal[u.index] = u.nominal;
      this.atol[u.index] = atolBase * Math.max(1, u.nominal);
    }
    this.v = this.ctx.v;
    this.dv = this.ctx.dv;
    this.implicitCache = new JacobianCache(m.nS + m.nA);
    this.algebraicCache = new JacobianCache(m.nA + m.nS);
    this.resScratch = new Float64Array(this.nEq);
  }

  /** Points the evaluation context at the given arrays. */
  bind(t: number, v: Float64Array, dv: Float64Array): void {
    this.ctx.t = t;
    this.ctx.v = v;
    this.ctx.dv = dv;
  }

  /** Restores the context to the canonical state arrays. */
  bindCanonical(): void {
    this.ctx.t = this.t;
    this.ctx.v = this.v;
    this.ctx.dv = this.dv;
  }

  /** Evaluates all equation residuals for the currently bound context. */
  residuals(out: Float64Array): void {
    const ctx = this.ctx;
    const res = this.m.residuals;
    for (let i = 0; i < res.length; i++) out[i] = res[i].fn(ctx);
  }

  /** Throws a ModelicaError naming the equation if any residual is non-finite at the bound context. */
  checkFinite(where: string): void {
    this.residuals(this.resScratch);
    for (let i = 0; i < this.nEq; i++) {
      if (!Number.isFinite(this.resScratch[i])) this.throwNonFinite(i, where);
    }
    for (let i = 0; i < this.nU; i++) {
      if (!Number.isFinite(this.ctx.v[i])) {
        throw new ModelicaError(`Variable '${this.m.unknowns[i].name}' became ${describeNonFinite(this.ctx.v[i])} ${where}`);
      }
    }
  }

  throwNonFinite(eqIndex: number, where: string, initial = false): never {
    const eq = initial && eqIndex >= this.nEq ? this.m.initialResiduals[eqIndex - this.nEq] : this.m.residuals[eqIndex];
    const value = eq ? eq.fn(this.ctx) : NaN;
    throw new ModelicaError(
      `Equation '${eq?.text ?? '?'}' (${eq?.origin ?? '?'}) evaluated to ${describeNonFinite(value)} ${where}`,
    );
  }

  /** Returns the name of the equation with index `i` (equations first, then initial equations). */
  equationName(i: number): string {
    const eq = i < this.nEq ? this.m.residuals[i] : this.m.initialResiduals[i - this.nEq];
    return eq ? `${eq.text} [${eq.origin}]` : `#${i}`;
  }

  // -------------------------------------------------------------------------------------------
  // Newton problems
  // -------------------------------------------------------------------------------------------

  /**
   * Implicit step: unknowns z = v[0..nS+nA), with dv_i = alpha * z_i + c_i for the states.
   * `v` (states + algebraics as initial guess; discretes untouched) and `dv` are updated in place.
   */
  solveImplicit(t: number, v: Float64Array, dv: Float64Array, alpha: number, c: Float64Array): NewtonResult {
    const nS = this.nS;
    const n = nS + this.nA;
    this.bind(t, v, dv);
    const ctx = this.ctx;
    const sys = this;
    const problem: NewtonProblem = {
      n,
      residual(z, out) {
        for (let i = 0; i < n; i++) v[i] = z[i];
        for (let i = 0; i < nS; i++) dv[i] = alpha * z[i] + c[i];
        sys.residuals(out);
      },
      weights(z, w) {
        for (let i = 0; i < n; i++) w[i] = NEWTON_FACTOR * (sys.atol[i] + sys.rtol * Math.abs(z[i]));
      },
      typical: this.nominal.subarray(0, n),
    };
    const cache = this.implicitCache;
    if (cache.valid && Number.isFinite(this.implicitAlpha) && Math.abs(alpha / this.implicitAlpha - 1) > 0.3) cache.invalidate();
    const z = new Float64Array(n);
    for (let i = 0; i < n; i++) z[i] = v[i];
    const before = cache.valid;
    const res = newtonSolve(problem, z, cache, { maxIterations: 12, maxJacobians: 2 });
    if (res.jacobians > 0 || !before) this.implicitAlpha = alpha;
    this.stats.newtonIterations += res.iterations;
    this.stats.jacobianEvaluations += res.jacobians;
    // Leave v/dv at the final iterate (converged or not; callers restore on failure).
    for (let i = 0; i < n; i++) v[i] = z[i];
    for (let i = 0; i < nS; i++) dv[i] = alpha * z[i] + c[i];
    ctx.t = t;
    return res;
  }

  /**
   * Solves the algebraic variables and the derivatives for fixed states (and discretes):
   * unknowns z = [v[nS..nS+nA), dv]. `v` and `dv` are updated in place.
   */
  solveAlgebraic(t: number, v: Float64Array, dv: Float64Array, options: NewtonOptions = {}): NewtonResult {
    const nS = this.nS;
    const nA = this.nA;
    const n = nA + nS;
    this.bind(t, v, dv);
    const sys = this;
    const problem: NewtonProblem = {
      n,
      residual(z, out) {
        for (let i = 0; i < nA; i++) v[nS + i] = z[i];
        for (let i = 0; i < nS; i++) dv[i] = z[nA + i];
        sys.residuals(out);
      },
      weights(z, w) {
        for (let i = 0; i < nA; i++) w[i] = NEWTON_FACTOR * (sys.atol[nS + i] + sys.rtol * Math.abs(z[i]));
        for (let i = 0; i < nS; i++) w[nA + i] = NEWTON_FACTOR * (sys.atol[i] + sys.rtol * Math.abs(z[nA + i]));
      },
      typical: this.algebraicTypical(),
    };
    const z = new Float64Array(n);
    for (let i = 0; i < nA; i++) z[i] = v[nS + i];
    for (let i = 0; i < nS; i++) z[nA + i] = dv[i];
    const res = newtonSolve(problem, z, this.algebraicCache, { maxIterations: 20, maxJacobians: 3, ...options });
    this.stats.newtonIterations += res.iterations;
    this.stats.jacobianEvaluations += res.jacobians;
    for (let i = 0; i < nA; i++) v[nS + i] = z[i];
    for (let i = 0; i < nS; i++) dv[i] = z[nA + i];
    return res;
  }

  private algTypical?: Float64Array;
  private algebraicTypical(): Float64Array {
    if (!this.algTypical) {
      const nS = this.nS;
      const nA = this.nA;
      const t = new Float64Array(nA + nS);
      for (let i = 0; i < nA; i++) t[i] = this.nominal[nS + i];
      for (let i = 0; i < nS; i++) t[nA + i] = this.nominal[i];
      this.algTypical = t;
    }
    return this.algTypical;
  }

  /** Human-readable explanation of a Newton failure for the algebraic subsystem. */
  describeAlgebraicFailure(res: NewtonResult, t: number): string {
    const nS = this.nS;
    const nA = this.nA;
    if (res.reason === 'singular') {
      const parts: string[] = [];
      if (res.singularRow !== undefined) parts.push(`equation '${this.equationName(res.singularRow)}' does not depend on any algebraic variable or derivative`);
      if (res.singularCol !== undefined) {
        const j = res.singularCol;
        const name = j < nA ? this.m.unknowns[nS + j].name : `der(${this.m.unknowns[j - nA].name})`;
        parts.push(`'${name}' is not determined by the equations`);
      }
      return `the Jacobian of the algebraic subsystem is singular at t=${fmt(t)}${parts.length ? ': ' + parts.join('; ') : ''}`;
    }
    if (res.reason === 'non-finite') {
      const eq = res.nonFiniteIndex !== undefined ? this.equationName(res.nonFiniteIndex) : '?';
      return `equation '${eq}' evaluated to NaN or Infinity at t=${fmt(t)}`;
    }
    return `Newton iteration did not converge at t=${fmt(t)} (largest residual in '${this.equationName(res.worstEquation)}')`;
  }

  /** Rate-limited warning about Newton failures during integration. */
  warnNewton(message: string): void {
    this.newtonWarnings++;
    if (this.newtonWarnings <= 10) this.log('warning', message);
    else if (this.newtonWarnings === 11) this.log('warning', 'Further Newton convergence warnings are suppressed');
    else if (this.options.dynamicDiagnostics) this.log('debug', message);
  }
}

export function fmt(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  if (x === 0) return '0';
  const a = Math.abs(x);
  if (a >= 1e-3 && a < 1e6) return String(Number(x.toPrecision(8)));
  return x.toExponential(6);
}

function describeNonFinite(x: number): string {
  return Number.isNaN(x) ? 'NaN' : x > 0 ? '+Infinity' : x < 0 ? '-Infinity' : 'non-finite';
}
