/**
 * Collects result points, checks `min`/`max` attributes (warning once per variable) and turns
 * the recorded series into `Trajectory` objects. `expandTrajectories` restores the variables
 * removed by the structural pre-processing (aliases, propagated constants, dummy derivatives)
 * so that the result contains every variable of the original flat model.
 */
import type { FlatModel } from '../flat.js';
import type { Trajectory, TrajectoryKind } from '../simulation.js';
import type { PreparedModel } from './structural/index.js';
import type { LogFn, System } from './system.js';
import { fmt } from './system.js';

export class Recorder {
  readonly time: number[] = [];
  /** One series per unknown (same layout as `v`). */
  readonly values: number[][];
  /** One series per state derivative. */
  readonly derivatives: number[][];
  private readonly warned = new Set<number>();
  private readonly sys: System;
  private readonly log: LogFn;

  constructor(sys: System, log: LogFn) {
    this.sys = sys;
    this.log = log;
    this.values = Array.from({ length: sys.nU }, () => []);
    this.derivatives = Array.from({ length: sys.nS }, () => []);
  }

  get lastTime(): number {
    return this.time.length ? this.time[this.time.length - 1] : NaN;
  }

  record(t: number, v: Float64Array, dv: Float64Array): void {
    this.time.push(t);
    const values = this.values;
    for (let i = 0; i < values.length; i++) values[i].push(v[i]);
    const der = this.derivatives;
    for (let i = 0; i < der.length; i++) der[i].push(dv[i]);
    this.checkBounds(t, v);
  }

  private checkBounds(t: number, v: Float64Array): void {
    const unknowns = this.sys.m.unknowns;
    for (let i = 0; i < unknowns.length; i++) {
      if (this.warned.has(i)) continue;
      const u = unknowns[i];
      if (u.min === undefined && u.max === undefined) continue;
      const x = v[i];
      if (u.min !== undefined && x < u.min - 1e-9 * Math.max(1, Math.abs(u.min))) {
        this.warned.add(i);
        this.log('warning', `Variable '${u.name}' = ${fmt(x)} is below its min attribute ${fmt(u.min)} at t=${fmt(t)}`);
      } else if (u.max !== undefined && x > u.max + 1e-9 * Math.max(1, Math.abs(u.max))) {
        this.warned.add(i);
        this.log('warning', `Variable '${u.name}' = ${fmt(x)} is above its max attribute ${fmt(u.max)} at t=${fmt(t)}`);
      }
    }
  }
}

/** Trajectories of the simulated (possibly reduced) model: unknowns, state derivatives, parameters and constants. */
export function buildTrajectories(sys: System, recorder: Recorder): Trajectory[] {
  const m = sys.m;
  const out: Trajectory[] = [];
  const paramByName = new Map(m.parameters.map((p) => [p.variable.name, p]));
  for (const variable of m.flat.variables) {
    const i = m.index.get(variable.name);
    if (i !== undefined) {
      const u = m.unknowns[i];
      const discrete = u.kind === 'discrete' || variable.variability === 'discrete' || u.type !== 'Real';
      out.push({
        name: u.name,
        values: recorder.values[i],
        kind: discrete ? 'discrete' : 'continuous',
        unit: variable.attributes.unit,
        displayUnit: variable.attributes.displayUnit,
        description: variable.description,
      });
      if (u.kind === 'state') {
        out.push({
          name: `der(${u.name})`,
          values: recorder.derivatives[i],
          kind: 'derivative',
          unit: variable.attributes.unit ? `${variable.attributes.unit}/s` : undefined,
          description: `der(${u.name})`,
        });
      }
      continue;
    }
    const p = paramByName.get(variable.name);
    if (p) {
      const value = typeof p.value === 'number' ? p.value : typeof p.value === 'boolean' ? (p.value ? 1 : 0) : NaN;
      if (Number.isNaN(value) && typeof p.value === 'string') continue;
      out.push({
        name: variable.name,
        values: [value],
        kind: variable.variability === 'constant' ? 'constant' : 'parameter',
        unit: variable.attributes.unit,
        displayUnit: variable.attributes.displayUnit,
        description: variable.description,
      });
    }
  }
  return out;
}

/**
 * Maps the trajectories of the reduced model back onto the original model: every original
 * variable gets a trajectory (aliases as `scale * rep + offset`, propagated variables as
 * constants, demoted states as continuous variables with their `der(x)` computed algebraically),
 * in the original declaration order.
 */
export function expandTrajectories(reduced: Trajectory[], original: FlatModel, prep: PreparedModel | undefined): Trajectory[] {
  if (!prep) return reduced;
  const byName = new Map<string, Trajectory>();
  for (const t of reduced) byName.set(t.name, t);
  const out: Trajectory[] = [];
  const used = new Set<string>();
  const take = (name: string): Trajectory | undefined => {
    const t = byName.get(name);
    if (t) used.add(name);
    return t;
  };
  const scaled = (t: Trajectory, scale: number, offset: number): number[] => (scale === 1 && offset === 0 ? t.values : t.values.map((x) => scale * x + offset));

  for (const v of original.variables) {
    const isParam = v.variability === 'parameter' || v.variability === 'constant';
    const meta = { unit: v.attributes.unit, displayUnit: v.attributes.displayUnit, description: v.description };
    if (isParam) {
      const t = take(v.name);
      if (t) out.push(t);
      continue;
    }
    const alias = prep.aliases.get(v.name);
    const discreteKind: TrajectoryKind = v.variability === 'discrete' || v.type !== 'Real' ? 'discrete' : 'continuous';
    if (alias) {
      const rep = take(alias.rep);
      if (!rep) continue;
      const constant = rep.kind === 'constant' || rep.kind === 'parameter';
      out.push({ name: v.name, values: scaled(rep, alias.scale, alias.offset), kind: constant ? 'constant' : discreteKind, ...meta });
      if (prep.originalStates.has(v.name)) {
        const repDer = constant ? undefined : take(`der(${alias.rep})`);
        const values = repDer ? scaled(repDer, alias.scale, 0) : constant ? [0] : undefined;
        if (values) {
          out.push({ name: `der(${v.name})`, values, kind: 'derivative', unit: v.attributes.unit ? `${v.attributes.unit}/s` : undefined, description: `der(${v.name})` });
        }
      }
      continue;
    }
    const t = take(v.name);
    if (!t) continue;
    if (t.kind === 'constant' || t.kind === 'parameter') {
      out.push({ ...t, kind: 'constant' });
      continue;
    }
    out.push(t);
    if (prep.originalStates.has(v.name)) {
      const d = take(`der(${v.name})`);
      if (d) out.push({ ...d, kind: 'derivative' });
    }
  }
  // Anything else the reduced model produced (higher derivatives, derivative states).
  for (const t of reduced) {
    if (used.has(t.name)) continue;
    used.add(t.name);
    out.push(prep.dummyDerivatives.has(t.name) || prep.derivativeStates.includes(t.name) || t.name.startsWith('der(') ? { ...t, kind: 'derivative' } : t);
  }
  return out;
}
