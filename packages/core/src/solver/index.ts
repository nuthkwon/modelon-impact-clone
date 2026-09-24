/**
 * DAE simulation engine: `simulate(flat, options, hooks)`.
 *
 * Pipeline: `structural/` (alias elimination, propagation of known variables, index
 * reduction) -> `compile.ts` (residual closures) -> `init.ts` (initial system, solved block-wise)
 * -> integrator from `integrators.ts` stepping until `finalTime`, with `events.ts` locating and
 * handling state and time events after every accepted step, and `output.ts` collecting the
 * trajectories at the communication points (plus pre-/post-event points) and expanding them to
 * the variables of the original model.
 *
 * Throws `ModelicaError` for structural problems (unbalanced model, unsupported constructs),
 * initialisation failures and numerical failures during integration (NaN/Infinity, step size
 * below the minimum, singular Jacobians).
 */
import { ModelicaError } from '../ast.js';
import type { FlatModel } from '../flat.js';
import { DEFAULT_SIMULATION_OPTIONS, normalizeSolverName, type LogMessage, type SimulationOptions, type SimulationResult, type SimulationStats } from '../simulation.js';
import { compileModel } from './compile.js';
import { EventHandler, EVENT_TIME_TOL } from './events.js';
import { initialize } from './init.js';
import { createIntegrator } from './integrators.js';
import { buildTrajectories, expandTrajectories, Recorder } from './output.js';
import { prepareModel, type PreparedModel } from './structural/index.js';
import { fmt, System, type LogFn } from './system.js';

export interface SimulationHooks {
  /** Called periodically with progress 0..1; return false to cancel. */
  onProgress?(progress: number, time: number): boolean | void;
  /** Log sink. */
  onLog?(level: 'debug' | 'info' | 'warning' | 'error', message: string): void;
}

export { compileModel } from './compile.js';
export type { CompiledModel } from './compile.js';
export { prepareModel } from './structural/index.js';
export type { PreparedModel, AliasEntry, AliasMap } from './structural/index.js';

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Simulates a flat model. Throws `ModelicaError` on structural/initialisation failures. */
export function simulate(flat: FlatModel, options: SimulationOptions, hooks?: SimulationHooks): SimulationResult {
  const started = now();
  const opts: SimulationOptions = { ...DEFAULT_SIMULATION_OPTIONS, ...options };
  if (!Number.isFinite(opts.startTime) || !Number.isFinite(opts.finalTime)) {
    throw new ModelicaError(`Invalid simulation interval [${opts.startTime}, ${opts.finalTime}]`);
  }
  if (opts.finalTime < opts.startTime) {
    throw new ModelicaError(`finalTime (${opts.finalTime}) must not be smaller than startTime (${opts.startTime})`);
  }
  if (!(opts.ncp >= 0) || !Number.isFinite(opts.ncp)) opts.ncp = DEFAULT_SIMULATION_OPTIONS.ncp;
  opts.ncp = Math.floor(opts.ncp);
  if (!normalizeSolverName(opts.solver)) {
    throw new ModelicaError(`Unknown solver '${String(opts.solver)}' (expected CVode, Radau5, Implicit Euler, Explicit Euler or Runge-Kutta)`);
  }

  const log: LogMessage[] = [];
  const logFn: LogFn = (level, message) => {
    log.push({ level, message, source: 'simulation', time: new Date().toISOString() });
    hooks?.onLog?.(level, message);
  };
  const stats: SimulationStats = {
    steps: 0,
    rejectedSteps: 0,
    newtonIterations: 0,
    jacobianEvaluations: 0,
    events: 0,
    cpuTimeMs: 0,
    completed: false,
  };

  const finish = (): void => {
    stats.cpuTimeMs = now() - started;
  };

  try {
    let prep: PreparedModel | undefined;
    if (!opts.disableStructuralSimplification) {
      prep = prepareModel(flat, logFn, opts);
      stats.aliasEliminated = prep.stats.aliasEliminated;
      stats.propagated = prep.stats.propagated;
      stats.dummyStates = prep.dummyStates;
    }
    const m = compileModel(prep ? prep.model : flat, opts);
    for (const w of m.warnings) logFn('warning', w);
    const sys = new System(m, opts, stats, logFn);
    const recorder = new Recorder(sys, logFn);
    const events = new EventHandler(sys, recorder, logFn);
    logFn(
      'info',
      `Simulating ${flat.className} with ${opts.solver}: ${m.nS} state${m.nS === 1 ? '' : 's'}, ${m.nA} algebraic and ${m.nD} discrete variable${m.nA + m.nD === 1 ? '' : 's'}, ${m.relations.length} zero-crossing function${m.relations.length === 1 ? '' : 's'}, ${m.samplers.length} time-event source${m.samplers.length === 1 ? '' : 's'}`,
    );

    const t0 = opts.startTime;
    const tEnd = opts.finalTime;
    const span = tEnd - t0;
    const ncp = opts.ncp;
    const tol = EVENT_TIME_TOL * Math.max(1, Math.abs(t0), Math.abs(tEnd));

    initialize(sys, events);
    recorder.record(sys.t, sys.v, sys.dv);
    const integrator = createIntegrator(opts.solver, sys, opts);
    if (events.timeEventDue(t0)) events.handleEvent(t0, true);
    integrator.restart();

    // Communication points.
    const outTime = (k: number): number => (k >= ncp ? tEnd : t0 + (k * span) / ncp);
    let nextK = 1;
    const vTmp = new Float64Array(sys.nU);
    const dvTmp = new Float64Array(sys.nS);
    const vE = new Float64Array(sys.nU);
    const dvE = new Float64Array(sys.nS);

    const emitUpTo = (rec: { t0: number; t1: number; v0: Float64Array; dv0: Float64Array; v1: Float64Array; dv1: Float64Array }, limit: number, inclusive: boolean): void => {
      if (ncp === 0) return;
      while (nextK <= ncp) {
        const tk = outTime(nextK);
        if (inclusive ? tk > limit + tol : tk >= limit - tol) break;
        if (Math.abs(tk - rec.t1) <= tol) recorder.record(rec.t1, rec.v1, rec.dv1);
        else if (tk > rec.t0 + tol) {
          events.denseOutput(rec, tk, vTmp, dvTmp);
          recorder.record(tk, vTmp, dvTmp);
        }
        nextK++;
      }
    };
    const skipOutputAt = (t: number): void => {
      while (nextK <= ncp && outTime(nextK) <= t + tol) nextK++;
    };
    skipOutputAt(t0);

    let cancelled = false;
    let lastProgress = 0;
    const report = (force: boolean): void => {
      const progress = span > 0 ? Math.min(1, (sys.t - t0) / span) : 1;
      if (force || progress >= lastProgress + 0.02) {
        lastProgress = progress;
        if (hooks?.onProgress?.(progress, sys.t) === false) cancelled = true;
      }
    };
    report(true);

    while (!cancelled && sys.t < tEnd - tol) {
      const tEv = events.nextTimeEvent(sys.t);
      const tMax = Math.min(tEnd, tEv);
      const rec = integrator.step(tMax);
      const te = events.locateStateEvent(rec, vE, dvE);
      if (!Number.isNaN(te)) {
        // A time event at the same instant (a step clipped at a sample time whose relations
        // flip there) is processed in the same event iteration; `nextTimeEvent` then moves on.
        const timeEvent = events.timeEventDue(te);
        emitUpTo(rec, te, false);
        sys.t = te;
        sys.v.set(vE);
        sys.dv.set(dvE);
        sys.bindCanonical();
        events.handleEvent(te, timeEvent);
        skipOutputAt(te);
        integrator.restart();
      } else {
        const timeEvent = events.timeEventDue(rec.t1);
        if (ncp === 0) {
          if (!timeEvent) recorder.record(rec.t1, rec.v1, rec.dv1);
        } else {
          emitUpTo(rec, rec.t1, !timeEvent);
        }
        if (timeEvent) {
          events.handleEvent(rec.t1, true);
          skipOutputAt(rec.t1);
          integrator.restart();
        }
      }
      report(false);
    }

    if (cancelled) {
      logFn('warning', 'Simulation cancelled');
      stats.completed = false;
    } else {
      if (recorder.lastTime < tEnd - tol) recorder.record(sys.t, sys.v, sys.dv);
      stats.completed = true;
      report(true);
    }
    finish();
    logFn(
      'info',
      `Simulation ${stats.completed ? 'finished' : 'stopped'} at t=${fmt(sys.t)}: ${stats.steps} steps (${stats.rejectedSteps} rejected), ${stats.newtonIterations} Newton iterations, ${stats.jacobianEvaluations} Jacobian evaluations, ${stats.events} events, ${stats.cpuTimeMs.toFixed(1)} ms`,
    );

    return {
      className: flat.className,
      options: opts,
      time: recorder.time,
      trajectories: expandTrajectories(buildTrajectories(sys, recorder), flat, prep),
      stats,
      log,
    };
  } catch (e) {
    finish();
    if (e instanceof ModelicaError) logFn('error', e.message);
    throw e;
  }
}
