/**
 * Event handling: zero-crossing detection on the relations collected by `compile.ts`,
 * bisection on the dense output of the last step to locate the crossing, event iteration
 * (when-clauses, `reinit`, discrete assignments, `edge`/`change`), time events from
 * `sample(start, interval)`, and dense output (Hermite interpolation of the states with the
 * algebraic variables re-solved by Newton).
 */
import { ModelicaError } from '../ast.js';
import { relationHolds } from './compile.js';
import type { StepRecord } from './integrators.js';
import type { Recorder } from './output.js';
import { fmt, type LogFn, type System } from './system.js';

/** Relative tolerance used to identify time events and to stop the bisection. */
export const EVENT_TIME_TOL = 1e-9;
const MAX_BISECTIONS = 50;
const MAX_EVENT_ITERATIONS = 50;

export class EventHandler {
  /** Boolean value of every when-condition at the last event (or after initialisation). */
  readonly condPrev: Uint8Array;
  private readonly condNow: Uint8Array;
  private readonly relFresh: Uint8Array;
  private readonly relBisect: Uint8Array;
  private readonly vTmp: Float64Array;
  private readonly dvTmp: Float64Array;
  private readonly guessV: Float64Array;
  private readonly guessDv: Float64Array;
  private readonly sys: System;
  private readonly recorder: Recorder;
  private readonly log: LogFn;
  /** Chattering guard. */
  private lastEventTime = NaN;
  private eventsAtSameTime = 0;

  constructor(sys: System, recorder: Recorder, log: LogFn) {
    this.sys = sys;
    this.recorder = recorder;
    this.log = log;
    const nW = sys.m.whens.length;
    const nR = sys.m.relations.length;
    this.condPrev = new Uint8Array(nW);
    this.condNow = new Uint8Array(nW);
    this.relFresh = new Uint8Array(nR);
    this.relBisect = new Uint8Array(nR);
    this.vTmp = new Float64Array(sys.nU);
    this.dvTmp = new Float64Array(sys.nS);
    this.guessV = new Float64Array(sys.nU);
    this.guessDv = new Float64Array(sys.nS);
  }

  get hasEvents(): boolean {
    return this.sys.m.relations.length > 0 || this.sys.m.samplers.length > 0;
  }

  // -----------------------------------------------------------------------------------------
  // Evaluation helpers
  // -----------------------------------------------------------------------------------------

  /** Evaluates every relation from its operands (ignoring the frozen values) at (t, v, dv). */
  evalRelations(t: number, v: Float64Array, dv: Float64Array, out: Uint8Array): void {
    const sys = this.sys;
    const ctx = sys.ctx;
    sys.bind(t, v, dv);
    const frozen = ctx.frozen;
    ctx.frozen = false;
    const rels = sys.m.relations;
    for (let i = 0; i < rels.length; i++) {
      const r = rels[i];
      out[i] = relationHolds(r.op, r.left(ctx), r.right(ctx)) ? 1 : 0;
    }
    ctx.frozen = frozen;
  }

  /** Evaluates every when-condition with the currently frozen relation values. */
  evalConditions(t: number, v: Float64Array, dv: Float64Array, out: Uint8Array): void {
    const sys = this.sys;
    const ctx = sys.ctx;
    sys.bind(t, v, dv);
    ctx.frozen = true;
    const whens = sys.m.whens;
    for (let i = 0; i < whens.length; i++) out[i] = whens[i].cond(ctx) >= 0.5 ? 1 : 0;
  }

  private static differ(a: Uint8Array, b: Uint8Array): boolean {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
    return false;
  }

  /** Called once after initialisation: remembers the current condition values so that no spurious edge fires at t0. */
  initializeConditions(): void {
    const sys = this.sys;
    sys.ctx.sampleActive.fill(0);
    this.evalConditions(sys.t, sys.v, sys.dv, this.condPrev);
    sys.bindCanonical();
  }

  // -----------------------------------------------------------------------------------------
  // Dense output
  // -----------------------------------------------------------------------------------------

  /**
   * Interpolates the step at `tau`: cubic Hermite for the states (using the derivatives at
   * both ends), held values for the when-discretes, and the algebraic variables/derivatives
   * re-solved by Newton (falling back to linear interpolation if that fails).
   */
  denseOutput(rec: StepRecord, tau: number, v: Float64Array, dv: Float64Array): void {
    const sys = this.sys;
    const nS = sys.nS;
    const nA = sys.nA;
    const h = rec.t1 - rec.t0;
    const s = h > 0 ? Math.min(1, Math.max(0, (tau - rec.t0) / h)) : 1;
    const s2 = s * s;
    const s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1;
    const h10 = s3 - 2 * s2 + s;
    const h01 = -2 * s3 + 3 * s2;
    const h11 = s3 - s2;
    for (let i = 0; i < nS; i++) {
      v[i] = h00 * rec.v0[i] + h10 * h * rec.dv0[i] + h01 * rec.v1[i] + h11 * h * rec.dv1[i];
      dv[i] = (1 - s) * rec.dv0[i] + s * rec.dv1[i];
    }
    for (let i = nS; i < nS + nA; i++) v[i] = (1 - s) * rec.v0[i] + s * rec.v1[i];
    for (let i = nS + nA; i < sys.nU; i++) v[i] = rec.v1[i];
    if (nA + nS > 0) {
      // Keep the interpolated guess for the fallback.
      this.guessV.set(v);
      this.guessDv.set(dv);
      const res = sys.solveAlgebraic(tau, v, dv);
      if (!res.converged) {
        v.set(this.guessV);
        dv.set(this.guessDv);
      }
    }
    sys.bindCanonical();
  }

  // -----------------------------------------------------------------------------------------
  // State events
  // -----------------------------------------------------------------------------------------

  /**
   * Checks the accepted step for relation changes. Returns NaN if none; otherwise the event
   * time located by bisection (within 1e-9*(1+|t|)), with `vOut`/`dvOut` holding the pre-event
   * state at that time (consistent with the old relation values).
   */
  locateStateEvent(rec: StepRecord, vOut: Float64Array, dvOut: Float64Array): number {
    const sys = this.sys;
    if (sys.m.relations.length === 0) return NaN;
    const relVals = sys.ctx.relVals;
    this.evalRelations(rec.t1, rec.v1, rec.dv1, this.relFresh);
    if (!EventHandler.differ(this.relFresh, relVals)) {
      sys.bindCanonical();
      return NaN;
    }
    let lo = rec.t0;
    let hi = rec.t1;
    vOut.set(rec.v1);
    dvOut.set(rec.dv1);
    const tol = EVENT_TIME_TOL * (1 + Math.abs(rec.t1));
    for (let iter = 0; iter < MAX_BISECTIONS && hi - lo > tol; iter++) {
      const mid = 0.5 * (lo + hi);
      this.denseOutput(rec, mid, this.vTmp, this.dvTmp);
      this.evalRelations(mid, this.vTmp, this.dvTmp, this.relBisect);
      if (EventHandler.differ(this.relBisect, relVals)) {
        hi = mid;
        vOut.set(this.vTmp);
        dvOut.set(this.dvTmp);
      } else {
        lo = mid;
      }
    }
    sys.bindCanonical();
    return hi;
  }

  // -----------------------------------------------------------------------------------------
  // Time events
  // -----------------------------------------------------------------------------------------

  /** Next time > t at which a `sample` operator fires, or Infinity. */
  nextTimeEvent(t: number): number {
    let next = Infinity;
    const tol = EVENT_TIME_TOL * (1 + Math.abs(t));
    for (const s of this.sys.m.samplers) {
      let tn: number;
      if (t < s.start - tol) tn = s.start;
      else {
        let k = Math.floor((t - s.start) / s.interval + 1e-12) + 1;
        tn = s.start + k * s.interval;
        while (tn <= t + tol) {
          k++;
          tn = s.start + k * s.interval;
        }
      }
      if (tn < next) next = tn;
    }
    return next;
  }

  private sampleFires(index: number, t: number): boolean {
    const s = this.sys.m.samplers[index];
    const tol = EVENT_TIME_TOL * (1 + Math.abs(t));
    if (t < s.start - tol) return false;
    const k = Math.round((t - s.start) / s.interval);
    return Math.abs(s.start + k * s.interval - t) <= tol;
  }

  timeEventDue(t: number): boolean {
    for (let i = 0; i < this.sys.m.samplers.length; i++) if (this.sampleFires(i, t)) return true;
    return false;
  }

  // -----------------------------------------------------------------------------------------
  // Event iteration
  // -----------------------------------------------------------------------------------------

  /**
   * Handles an event at `t`. On entry the system state (sys.t, sys.v, sys.dv) is the pre-event
   * point, consistent with the old (frozen) relation values. Records the pre- and post-event
   * points, applies fired when-clauses in order, re-solves the algebraic variables and updates
   * the relation values, `pre` and the remembered condition values.
   */
  handleEvent(t: number, timeEvent: boolean): void {
    const sys = this.sys;
    const ctx = sys.ctx;
    const m = sys.m;
    sys.t = t;
    sys.bindCanonical();

    // Chattering guard.
    if (Math.abs(t - this.lastEventTime) <= EVENT_TIME_TOL * (1 + Math.abs(t))) {
      if (++this.eventsAtSameTime > 500) {
        throw new ModelicaError(`Chattering detected: more than 500 events at t=${fmt(t)}; the model does not have a consistent solution after the event`);
      }
    } else {
      this.eventsAtSameTime = 0;
    }
    this.lastEventTime = t;

    // Pre-event point and pre() values.
    this.recorder.record(t, sys.v, sys.dv);
    ctx.pre.set(sys.v);

    if (timeEvent) {
      for (let i = 0; i < m.samplers.length; i++) ctx.sampleActive[i] = this.sampleFires(i, t) ? 1 : 0;
    }

    // New relation values and consistent algebraics for them.
    this.evalRelations(t, sys.v, sys.dv, this.relFresh);
    const relationChanged = EventHandler.differ(this.relFresh, ctx.relVals);
    ctx.relVals.set(this.relFresh);
    if (relationChanged) this.resolve(t);

    const fired: string[] = [];
    let iter = 0;
    for (; iter < MAX_EVENT_ITERATIONS; iter++) {
      this.evalConditions(t, sys.v, sys.dv, this.condNow);
      let any = false;
      for (let w = 0; w < m.whens.length; w++) {
        if (this.condNow[w] && !this.condPrev[w]) {
          any = true;
          this.applyActions(w);
          fired.push(m.whens[w].text);
        }
      }
      this.condPrev.set(this.condNow);
      if (any) this.resolve(t);
      this.evalRelations(t, sys.v, sys.dv, this.relFresh);
      if (EventHandler.differ(this.relFresh, ctx.relVals)) {
        ctx.relVals.set(this.relFresh);
        this.resolve(t);
        continue;
      }
      if (!any) break;
    }
    if (iter >= MAX_EVENT_ITERATIONS) {
      throw new ModelicaError(`Event iteration did not converge at t=${fmt(t)} (when-clauses keep triggering each other: ${fired.slice(-5).join(', ')})`);
    }

    ctx.sampleActive.fill(0);
    ctx.pre.set(sys.v);
    this.evalConditions(t, sys.v, sys.dv, this.condPrev);
    sys.bindCanonical();
    sys.checkFinite(`after the event at t=${fmt(t)}`);
    this.recorder.record(t, sys.v, sys.dv);
    sys.stats.events++;
    if (sys.options.dynamicDiagnostics) {
      this.log('debug', `${timeEvent ? 'Time' : 'State'} event at t=${fmt(t)}${fired.length ? `: ${fired.join('; ')}` : ''}`);
    }
  }

  private applyActions(w: number): void {
    const sys = this.sys;
    const ctx = sys.ctx;
    sys.bindCanonical();
    ctx.frozen = true;
    for (const act of sys.m.whens[w].actions) {
      const value = act.value(ctx);
      if (!Number.isFinite(value)) {
        throw new ModelicaError(`'${act.text}' evaluated to ${Number.isNaN(value) ? 'NaN' : 'Infinity'} at t=${fmt(sys.t)} (${sys.m.whens[w].origin})`);
      }
      const u = sys.m.unknowns[act.target];
      sys.v[act.target] = u.type === 'Boolean' ? (value >= 0.5 ? 1 : 0) : value;
    }
  }

  /** Re-solves algebraic variables and derivatives for the current states/discretes. */
  private resolve(t: number): void {
    const sys = this.sys;
    if (sys.nA + sys.nS === 0) return;
    sys.algebraicCache.invalidate();
    const res = sys.solveAlgebraic(t, sys.v, sys.dv, { maxJacobians: 5, maxIterations: 50 });
    sys.bindCanonical();
    if (!res.converged) {
      if (res.reason === 'non-finite') sys.throwNonFinite(res.nonFiniteIndex ?? 0, `at the event at t=${fmt(t)}`);
      this.log('warning', `Could not re-initialize the algebraic variables at the event at t=${fmt(t)}: ${sys.describeAlgebraicFailure(res, t)}`);
    }
  }
}
