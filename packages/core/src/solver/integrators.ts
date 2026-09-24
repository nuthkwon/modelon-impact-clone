/**
 * Time integrators. All of them advance the canonical state of a `System` by one accepted
 * step and expose the step as a `StepRecord` for dense output and event location.
 *
 * | `SolverName`     | Implementation                                                          |
 * | ---------------- | ----------------------------------------------------------------------- |
 * | `CVode`          | variable-step BDF of order 1-2 (implicit Euler start, then BDF2),        |
 * |                  | predictor-corrector error estimate, PI step controller                   |
 * | `Radau5`         | variable-step implicit trapezoidal rule with the same controller. The    |
 * |                  | name is only the UI label: a genuine Radau IIA(5) scheme is not          |
 * |                  | implemented; the trapezoidal rule is the 2nd-order A-stable alternative. |
 * | `Implicit Euler` | fixed-step BDF1                                                          |
 * | `Explicit Euler` | fixed-step forward Euler; algebraics/derivatives solved by Newton        |
 * | `Runge-Kutta`    | fixed-step classic RK4; algebraics/derivatives solved by Newton per stage|
 *
 * Every implicit step replaces `dv` by `alpha * v_{n+1} + c` (from the multistep formula) and
 * solves G(v_{n+1}) = F(t, v, alpha v + c) = 0 with the modified Newton in `System`.
 */
import { ModelicaError } from '../ast.js';
import type { SimulationOptions, SolverName } from '../simulation.js';
import { wrmsNorm } from './linalg.js';
import type { NewtonResult } from './newton.js';
import { fmt, type System } from './system.js';

export interface StepRecord {
  t0: number;
  t1: number;
  v0: Float64Array;
  dv0: Float64Array;
  v1: Float64Array;
  dv1: Float64Array;
}

export interface Integrator {
  readonly name: SolverName;
  /** Forgets history and restarts (order 1, small step) from the system's current state. */
  restart(): void;
  /** Advances by one accepted step, not beyond `tMax`. Updates the system state and returns the step. */
  step(tMax: number): StepRecord;
  readonly last: StepRecord;
}

export function createIntegrator(name: SolverName, sys: System, options: SimulationOptions): Integrator {
  switch (name) {
    case 'CVode':
      return new VariableStepImplicit(sys, options, 'bdf', name);
    case 'Radau5':
      return new VariableStepImplicit(sys, options, 'trapezoidal', name);
    case 'Implicit Euler':
      return new FixedStepImplicitEuler(sys, options);
    case 'Explicit Euler':
      return new FixedStepExplicit(sys, options, 'euler');
    case 'Runge-Kutta':
      return new FixedStepExplicit(sys, options, 'rk4');
    default:
      throw new ModelicaError(`Unknown solver '${String(name)}'`);
  }
}

/** Fixed step size used by the fixed-step integrators. */
export function fixedStepSize(options: SimulationOptions): number {
  if (options.stepSize !== undefined && options.stepSize > 0) return options.stepSize;
  const span = options.finalTime - options.startTime;
  return span / Math.max(options.ncp, 1);
}

/** Maximum step for the variable-step integrators. */
export function maxStepSize(options: SimulationOptions): number {
  if (options.maxStep !== undefined && options.maxStep > 0) return options.maxStep;
  return (options.finalTime - options.startTime) / 10;
}

function minStepSize(t: number, options: SimulationOptions): number {
  const scale = Math.max(Math.abs(t), Math.abs(options.finalTime), Math.abs(options.startTime), 1);
  return 32 * Number.EPSILON * scale;
}

abstract class BaseIntegrator implements Integrator {
  readonly last: StepRecord;
  protected readonly sys: System;
  protected readonly options: SimulationOptions;
  abstract readonly name: SolverName;

  constructor(sys: System, options: SimulationOptions) {
    this.sys = sys;
    this.options = options;
    this.last = {
      t0: 0,
      t1: 0,
      v0: new Float64Array(sys.nU),
      dv0: new Float64Array(sys.nS),
      v1: new Float64Array(sys.nU),
      dv1: new Float64Array(sys.nS),
    };
  }

  abstract restart(): void;
  abstract step(tMax: number): StepRecord;

  protected snapshotStart(): void {
    this.last.t0 = this.sys.t;
    this.last.v0.set(this.sys.v);
    this.last.dv0.set(this.sys.dv);
  }

  protected snapshotEnd(): void {
    this.last.t1 = this.sys.t;
    this.last.v1.set(this.sys.v);
    this.last.dv1.set(this.sys.dv);
  }

  protected restoreStart(): void {
    this.sys.t = this.last.t0;
    this.sys.v.set(this.last.v0);
    this.sys.dv.set(this.last.dv0);
    this.sys.bindCanonical();
  }

  /** Clips a proposed step so that it ends at `tMax` when close, without leaving a tiny remainder. */
  protected clip(h: number, t: number, tMax: number): number {
    const remaining = tMax - t;
    if (remaining <= h * (1 + 1e-9)) return remaining;
    if (remaining < 2 * h) return remaining / 2;
    return h;
  }
}

// ---------------------------------------------------------------------------------------------
// Variable-step implicit multistep methods (BDF1/BDF2 and trapezoidal rule)
// ---------------------------------------------------------------------------------------------

type ImplicitMethod = 'bdf' | 'trapezoidal';

class VariableStepImplicit extends BaseIntegrator {
  readonly name: SolverName;
  private readonly method: ImplicitMethod;
  private readonly hmax: number;
  private h = 0;
  private order: 1 | 2 = 1;
  /** Number of accepted steps since the last restart (history length). */
  private stepsSinceRestart = 0;
  private tPrev = 0;
  private readonly vPrev: Float64Array;
  private readonly dvPrev: Float64Array;
  private errPrev = 1;
  private consecutiveRejections = 0;
  private readonly vPred: Float64Array;
  private readonly c: Float64Array;
  private readonly err: Float64Array;
  private readonly w: Float64Array;

  constructor(sys: System, options: SimulationOptions, method: ImplicitMethod, name: SolverName) {
    super(sys, options);
    this.name = name;
    this.method = method;
    let hmax = maxStepSize(options);
    if (sys.nS === 0) {
      // Pure algebraic model: there is nothing to control the step with; evaluate at least at
      // every communication point so that events are not skipped.
      hmax = Math.min(hmax, (options.finalTime - options.startTime) / Math.max(options.ncp, 1));
    }
    this.hmax = hmax;
    this.vPrev = new Float64Array(sys.nU);
    this.dvPrev = new Float64Array(sys.nS);
    this.vPred = new Float64Array(sys.nU);
    this.c = new Float64Array(sys.nS);
    this.err = new Float64Array(sys.nS);
    this.w = new Float64Array(sys.nS);
  }

  restart(): void {
    this.order = 1;
    this.stepsSinceRestart = 0;
    this.consecutiveRejections = 0;
    this.errPrev = 1;
    this.h = this.initialStep();
    this.sys.implicitCache.invalidate();
  }

  private initialStep(): number {
    const sys = this.sys;
    const span = this.options.finalTime - this.options.startTime;
    let h = Math.min(this.hmax, 1e-3 * span);
    if (sys.nS > 0) {
      // Limit the first-order change to a fraction of the tolerance band.
      for (let i = 0; i < sys.nS; i++) this.w[i] = sys.atol[i] + sys.rtol * Math.abs(sys.v[i]);
      const dvNorm = wrmsNorm(sys.dv, this.w, sys.nS);
      if (dvNorm > 0) h = Math.min(h, 10 / dvNorm);
    }
    return Math.max(h, minStepSize(sys.t, this.options) * 10);
  }

  private predict(h: number): void {
    const sys = this.sys;
    const v0 = this.last.v0;
    const dv0 = this.last.dv0;
    const vP = this.vPred;
    const nS = sys.nS;
    const nSA = nS + sys.nA;
    vP.set(v0);
    if (this.stepsSinceRestart === 0 || this.order === 1) {
      for (let i = 0; i < nS; i++) vP[i] = v0[i] + h * dv0[i];
      return;
    }
    const h1 = this.last.t0 - this.tPrev;
    const r = h / h1;
    // States: quadratic through (tPrev, vPrev), (t0, v0) with slope dv0 at t0.
    for (let i = 0; i < nS; i++) {
      const a = (this.vPrev[i] - v0[i] + dv0[i] * h1) / (h1 * h1);
      vP[i] = v0[i] + dv0[i] * h + a * h * h;
    }
    // Algebraics: linear extrapolation.
    for (let i = nS; i < nSA; i++) vP[i] = v0[i] + (v0[i] - this.vPrev[i]) * r;
  }

  step(tMax: number): StepRecord {
    const sys = this.sys;
    const nS = sys.nS;
    const nSA = nS + sys.nA;
    this.snapshotStart();
    const t0 = this.last.t0;
    const hmin = minStepSize(t0, this.options);
    let newtonFailures = 0;

    for (;;) {
      let h = this.clip(Math.min(this.h, this.hmax), t0, tMax);
      if (h < hmin) {
        if (tMax - t0 <= hmin) h = tMax - t0;
        else {
          throw new ModelicaError(
            `${this.name}: step size ${fmt(h)} fell below the minimum at t=${fmt(t0)} (the integrator cannot satisfy the tolerance; check for discontinuities or increase rtol)`,
          );
        }
      }
      const t1 = t0 + h;
      this.predict(h);

      // Multistep coefficients: dv = alpha * v1 + c.
      let alpha: number;
      let errConst: number;
      let k: number;
      const v0 = this.last.v0;
      const dv0 = this.last.dv0;
      const c = this.c;
      if (this.method === 'bdf') {
        if (this.order === 1 || this.stepsSinceRestart === 0) {
          alpha = 1 / h;
          for (let i = 0; i < nS; i++) c[i] = -v0[i] / h;
          errConst = 0.5;
          k = 1;
        } else {
          const h1 = t0 - this.tPrev;
          const wr = h / h1;
          alpha = (1 + 2 * wr) / ((1 + wr) * h);
          const b1 = -(1 + wr) / h;
          const b2 = (wr * wr) / ((1 + wr) * h);
          for (let i = 0; i < nS; i++) c[i] = b1 * v0[i] + b2 * this.vPrev[i];
          errConst = 0.4;
          k = 2;
        }
      } else {
        alpha = 2 / h;
        for (let i = 0; i < nS; i++) c[i] = (-2 * v0[i]) / h - dv0[i];
        if (this.stepsSinceRestart === 0) {
          errConst = 0.5;
          k = 1;
        } else {
          errConst = 0.2;
          k = 2;
        }
      }

      // Corrector.
      for (let i = 0; i < nSA; i++) sys.v[i] = this.vPred[i];
      const res = sys.solveImplicit(t1, sys.v, sys.dv, alpha, c);
      if (!res.converged) {
        newtonFailures++;
        this.restoreStart();
        if (res.reason === 'singular') {
          throw new ModelicaError(
            `${this.name}: ${this.describeSingular(res, t1)}`,
          );
        }
        if (res.reason === 'non-finite') {
          sys.bind(t1, this.vPred, sys.dv);
          sys.throwNonFinite(res.nonFiniteIndex ?? 0, `while solving the step to t=${fmt(t1)}`);
        }
        sys.warnNewton(`Newton did not converge at t=${fmt(t1)} (${res.reason}); step reduced`);
        this.h = h * 0.25;
        this.order = 1;
        this.stepsSinceRestart = 0;
        sys.implicitCache.invalidate();
        if (newtonFailures > 25) {
          throw new ModelicaError(`${this.name}: Newton iteration repeatedly failed near t=${fmt(t0)} (${sys.equationName(res.worstEquation)})`);
        }
        continue;
      }

      // Local error estimate on the states.
      let errNorm = 0;
      if (nS > 0) {
        for (let i = 0; i < nS; i++) {
          this.err[i] = errConst * (sys.v[i] - this.vPred[i]);
          this.w[i] = sys.atol[i] + sys.rtol * Math.max(Math.abs(v0[i]), Math.abs(sys.v[i]));
        }
        errNorm = wrmsNorm(this.err, this.w, nS);
        if (!Number.isFinite(errNorm)) {
          sys.bindCanonical();
          sys.checkFinite(`after the step to t=${fmt(t1)}`);
          errNorm = 1e10;
        }
      }
      if (errNorm > 1 && h > hmin) {
        this.restoreStart();
        sys.stats.rejectedSteps++;
        this.consecutiveRejections++;
        let fac = Math.max(0.1, 0.9 * Math.pow(errNorm, -1 / (k + 1)));
        if (this.consecutiveRejections >= 2) {
          this.order = 1;
          this.stepsSinceRestart = 0;
          fac = Math.min(fac, 0.5);
        }
        this.h = h * fac;
        if (this.options.dynamicDiagnostics) sys.log('debug', `Step rejected at t=${fmt(t1)}: error ${fmt(errNorm)} (h=${fmt(h)})`);
        continue;
      }

      // Accept.
      sys.t = t1;
      sys.bindCanonical();
      sys.stats.steps++;
      this.tPrev = t0;
      this.vPrev.set(v0);
      this.dvPrev.set(dv0);
      this.stepsSinceRestart++;
      if (this.method === 'bdf' && this.order === 1 && this.stepsSinceRestart >= 2) this.order = 2;

      // PI step size controller (Gustafsson/Soderlind style).
      const e = Math.max(errNorm, 1e-10);
      const ep = Math.max(this.errPrev, 1e-10);
      let fac: number;
      if (this.stepsSinceRestart <= 1) fac = 0.9 * Math.pow(e, -1 / (k + 1));
      else fac = 0.9 * Math.pow(e, -0.7 / (k + 1)) * Math.pow(ep, 0.4 / (k + 1));
      fac = Math.min(5, Math.max(0.2, fac));
      if (this.consecutiveRejections > 0) fac = Math.min(fac, 1);
      this.consecutiveRejections = 0;
      this.errPrev = e;
      this.h = Math.min(this.hmax, h * fac);
      this.snapshotEnd();
      return this.last;
    }
  }

  private describeSingular(res: NewtonResult, t: number): string {
    const sys = this.sys;
    const parts: string[] = [];
    if (res.singularRow !== undefined) parts.push(`equation '${sys.equationName(res.singularRow)}' does not depend on any unknown`);
    if (res.singularCol !== undefined) parts.push(`variable '${sys.m.unknowns[res.singularCol].name}' is not determined by the equations`);
    return `singular Jacobian at t=${fmt(t)}${parts.length ? ': ' + parts.join('; ') : ''}`;
  }
}

// ---------------------------------------------------------------------------------------------
// Fixed-step implicit Euler
// ---------------------------------------------------------------------------------------------

class FixedStepImplicitEuler extends BaseIntegrator {
  readonly name: SolverName = 'Implicit Euler';
  private readonly hFixed: number;
  private readonly c: Float64Array;

  constructor(sys: System, options: SimulationOptions) {
    super(sys, options);
    this.hFixed = fixedStepSize(options);
    this.c = new Float64Array(sys.nS);
  }

  restart(): void {
    this.sys.implicitCache.invalidate();
  }

  step(tMax: number): StepRecord {
    const sys = this.sys;
    const nS = sys.nS;
    this.snapshotStart();
    const t0 = this.last.t0;
    const hmin = minStepSize(t0, this.options);
    let h = this.clip(this.hFixed, t0, tMax);
    for (let attempt = 0; ; attempt++) {
      const t1 = t0 + h;
      const v0 = this.last.v0;
      const dv0 = this.last.dv0;
      for (let i = 0; i < nS; i++) {
        sys.v[i] = v0[i] + h * dv0[i];
        this.c[i] = -v0[i] / h;
      }
      const res = sys.solveImplicit(t1, sys.v, sys.dv, 1 / h, this.c);
      if (res.converged) {
        sys.t = t1;
        sys.bindCanonical();
        sys.stats.steps++;
        this.snapshotEnd();
        return this.last;
      }
      this.restoreStart();
      if (res.reason === 'singular') {
        throw new ModelicaError(`Implicit Euler: singular Jacobian at t=${fmt(t1)} (${sys.equationName(res.worstEquation)})`);
      }
      sys.stats.rejectedSteps++;
      sys.warnNewton(`Newton did not converge at t=${fmt(t1)}; step reduced`);
      h *= 0.5;
      sys.implicitCache.invalidate();
      if (h < hmin || attempt > 12) {
        throw new ModelicaError(`Implicit Euler: Newton iteration failed at t=${fmt(t1)} even with a reduced step (${sys.equationName(res.worstEquation)})`);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Fixed-step explicit methods (forward Euler, RK4) for semi-explicit index-1 DAEs
// ---------------------------------------------------------------------------------------------

class FixedStepExplicit extends BaseIntegrator {
  readonly name: SolverName;
  private readonly scheme: 'euler' | 'rk4';
  private readonly hFixed: number;
  private readonly k1: Float64Array;
  private readonly k2: Float64Array;
  private readonly k3: Float64Array;
  private readonly k4: Float64Array;

  constructor(sys: System, options: SimulationOptions, scheme: 'euler' | 'rk4') {
    super(sys, options);
    this.scheme = scheme;
    this.name = scheme === 'euler' ? 'Explicit Euler' : 'Runge-Kutta';
    this.hFixed = fixedStepSize(options);
    this.k1 = new Float64Array(sys.nS);
    this.k2 = new Float64Array(sys.nS);
    this.k3 = new Float64Array(sys.nS);
    this.k4 = new Float64Array(sys.nS);
  }

  restart(): void {
    // Nothing to forget: single-step methods.
  }

  /** Sets the states to x, solves algebraics + derivatives at t, copies dv into `k`. */
  private evalDerivative(t: number, x: Float64Array | null, k: Float64Array): void {
    const sys = this.sys;
    if (x) for (let i = 0; i < sys.nS; i++) sys.v[i] = x[i];
    const res = sys.solveAlgebraic(t, sys.v, sys.dv);
    if (!res.converged) {
      if (res.reason === 'singular') {
        throw new ModelicaError(
          `${this.name}: ${sys.describeAlgebraicFailure(res, t)}. The model cannot be solved explicitly for the derivatives (it may be a higher-index DAE or contain a non-trivial algebraic loop); use an implicit solver such as CVode or Radau5.`,
        );
      }
      if (res.reason === 'non-finite') {
        sys.throwNonFinite(res.nonFiniteIndex ?? 0, `at t=${fmt(t)}`);
      }
      throw new ModelicaError(`${this.name}: ${sys.describeAlgebraicFailure(res, t)}. Try a smaller step size or an implicit solver.`);
    }
    k.set(sys.dv);
  }

  step(tMax: number): StepRecord {
    const sys = this.sys;
    const nS = sys.nS;
    this.snapshotStart();
    const t0 = this.last.t0;
    const h = this.clip(this.hFixed, t0, tMax);
    const t1 = t0 + h;
    const v0 = this.last.v0;
    const x = new Float64Array(nS);
    if (this.scheme === 'euler' || nS === 0) {
      this.k1.set(this.last.dv0);
      for (let i = 0; i < nS; i++) x[i] = v0[i] + h * this.k1[i];
    } else {
      this.k1.set(this.last.dv0);
      for (let i = 0; i < nS; i++) x[i] = v0[i] + 0.5 * h * this.k1[i];
      this.evalDerivative(t0 + 0.5 * h, x, this.k2);
      for (let i = 0; i < nS; i++) x[i] = v0[i] + 0.5 * h * this.k2[i];
      this.evalDerivative(t0 + 0.5 * h, x, this.k3);
      for (let i = 0; i < nS; i++) x[i] = v0[i] + h * this.k3[i];
      this.evalDerivative(t1, x, this.k4);
      for (let i = 0; i < nS; i++) x[i] = v0[i] + (h / 6) * (this.k1[i] + 2 * this.k2[i] + 2 * this.k3[i] + this.k4[i]);
    }
    // Final consistent point (algebraics + derivatives at t1).
    for (let i = 0; i < nS; i++) sys.v[i] = x[i];
    for (let i = nS; i < nS + sys.nA; i++) sys.v[i] = v0[i];
    this.evalDerivative(t1, null, this.k1);
    sys.t = t1;
    sys.bindCanonical();
    sys.checkFinite(`after the step to t=${fmt(t1)}`);
    sys.stats.steps++;
    this.snapshotEnd();
    return this.last;
  }
}
