/**
 * Collects result points and checks `min`/`max` attributes (warning once per variable).
 */
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
