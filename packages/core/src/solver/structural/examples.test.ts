/**
 * End-to-end: flattens and simulates every shipped example model (libraries/Examples and the
 * Modelica.*.Examples.* models) with the structural pre-processing and checks completion,
 * finite trajectories and a few physical properties against analytic references.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FlatModel } from '../../flat.js';
import { ClassRegistry } from '../../registry.js';
import { flatten } from '../../flatten/index.js';
import { getTrajectory, type SimulationOptions, type SimulationResult } from '../../simulation.js';
import { simulate } from '../index.js';

const LIB_ROOT = fileURLToPath(new URL('../../../../../libraries/', import.meta.url));
const MODELICA_DIR = join(LIB_ROOT, 'Modelica');
const EXAMPLES_DIR = join(LIB_ROOT, 'Examples');

const EXAMPLES = [
  'Examples.RCCircuit',
  'Examples.RLCCircuit',
  'Examples.MassSpringDamper',
  'Examples.RotationalDrive',
  'Examples.PIDControlledMotor',
  'Examples.HeatedRoom',
  'Examples.BouncingBall',
  'Examples.VanDerPol',
  'Examples.LotkaVolterra',
  'Examples.SimplePendulum',
  'Modelica.Blocks.Examples.PID_Controller',
  'Modelica.Electrical.Analog.Examples.ChuaCircuit',
  'Modelica.Electrical.Analog.Examples.CharacteristicIdealDiodes',
  'Modelica.Electrical.Analog.Examples.CauerLowPassAnalog',
  'Modelica.Mechanics.Rotational.Examples.First',
  'Modelica.Mechanics.Translational.Examples.Oscillator',
  'Modelica.Thermal.HeatTransfer.Examples.TwoMasses',
];

const MAX_STOP_TIME = 10;
const MAX_POINTS = 2000;
const TIME_LIMIT_MS = 3000;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (entry.endsWith('.mo')) out.push(p);
  }
  return out;
}

function loadLibrary(registry: ClassRegistry, id: string, dir: string): void {
  const files = walk(dir).sort((a, b) => {
    const ka = a.replace(/package\.mo$/, '!package.mo');
    const kb = b.replace(/package\.mo$/, '!package.mo');
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  registry.addLibrary({ id, name: id, readOnly: id === 'Modelica' });
  for (const f of files) {
    const diags = registry.addFile(id, relative(dir, f), readFileSync(f, 'utf8'));
    expect(diags.filter((d) => d.severity === 'error'), `${id}/${relative(dir, f)}`).toEqual([]);
  }
}

function experimentOptions(flat: FlatModel): SimulationOptions {
  const stop = Math.min(flat.experiment?.StopTime ?? 1, MAX_STOP_TIME);
  const interval = flat.experiment?.Interval;
  const ncp = interval && interval > 0 ? Math.min(MAX_POINTS, Math.max(10, Math.round(stop / interval))) : 500;
  return { startTime: flat.experiment?.StartTime ?? 0, finalTime: stop, ncp, rtol: 1e-5, solver: 'CVode' };
}

function param(flat: FlatModel, name: string): number {
  const v = flat.variables.find((x) => x.name === name);
  if (!v || typeof v.value !== 'number') throw new Error(`parameter ${name} not found in ${flat.className}`);
  return v.value;
}

function values(res: SimulationResult, name: string): number[] {
  const t = getTrajectory(res, name);
  if (!t) throw new Error(`no trajectory ${name} in ${res.className}`);
  return t.values;
}

const hasLibraries = existsSync(MODELICA_DIR) && existsSync(EXAMPLES_DIR);

describe.skipIf(!hasLibraries)('shipped examples simulate end-to-end', () => {
  const registry = new ClassRegistry();
  if (hasLibraries) {
    loadLibrary(registry, 'Modelica', MODELICA_DIR);
    loadLibrary(registry, 'Examples', EXAMPLES_DIR);
  }
  const results = new Map<string, { flat: FlatModel; res: SimulationResult; ms: number }>();
  const run = (name: string): { flat: FlatModel; res: SimulationResult; ms: number } => {
    const cached = results.get(name);
    if (cached) return cached;
    const flat = flatten(registry, name);
    const t0 = performance.now();
    const res = simulate(flat, experimentOptions(flat));
    const ms = performance.now() - t0;
    const entry = { flat, res, ms };
    results.set(name, entry);
    return entry;
  };

  it.each(EXAMPLES)('%s completes with finite trajectories for every variable', (name) => {
    const { flat, res, ms } = run(name);
    expect(res.stats.completed).toBe(true);
    const o = res.options;
    expect(res.time[0]).toBe(o.startTime);
    expect(res.time[res.time.length - 1]).toBeCloseTo(o.finalTime, 9);
    expect(res.time.length).toBeGreaterThanOrEqual(o.ncp + 1);
    for (const v of flat.variables) {
      if (v.type === 'String') continue;
      const tr = getTrajectory(res, v.name);
      expect(tr, `${name}: missing trajectory ${v.name}`).toBeDefined();
      expect(tr!.values.length, `${name}: ${v.name}`).toBe(tr!.kind === 'parameter' || tr!.kind === 'constant' ? 1 : res.time.length);
      const bad = tr!.values.findIndex((x) => !Number.isFinite(x));
      expect(bad, `${name}: ${v.name} is not finite at index ${bad}`).toBe(-1);
    }
    for (const tr of res.trajectories) {
      if (tr.kind === 'derivative') expect(tr.values.every(Number.isFinite), `${name}: ${tr.name}`).toBe(true);
    }
    expect(res.log.some((l) => l.level === 'error')).toBe(false);
    expect(ms, `${name} took ${ms.toFixed(0)} ms`).toBeLessThan(TIME_LIMIT_MS);
  });

  it('RCCircuit: capacitor.v follows the first-order step response', () => {
    const { flat, res } = run('Examples.RCCircuit');
    const V = param(flat, 'stepVoltage.V');
    const t0 = param(flat, 'stepVoltage.startTime');
    const tau = param(flat, 'resistor.R') * param(flat, 'capacitor.C');
    const v = values(res, 'capacitor.v');
    const i = values(res, 'resistor.i');
    let err = 0;
    for (let k = 0; k < res.time.length; k++) {
      const t = res.time[k];
      const exact = t <= t0 ? 0 : V * (1 - Math.exp(-(t - t0) / tau));
      err = Math.max(err, Math.abs(v[k] - exact));
      // Kirchhoff through the aliases: resistor current charges the capacitor.
      if (t > t0 + 1e-6) expect(i[k]).toBeCloseTo((V - v[k]) / param(flat, 'resistor.R'), 6);
    }
    expect(err).toBeLessThan(2e-3);
    expect(res.stats.propagated).toBeGreaterThanOrEqual(2); // T_heatPort, R_actual
    expect(getTrajectory(res, 'resistor.R_actual')!.kind).toBe('constant');
    expect(getTrajectory(res, 'resistor.R_actual')!.values[0]).toBeCloseTo(param(flat, 'resistor.R'), 9);
  });

  it('MassSpringDamper: mass.s oscillates and decays to the static equilibrium', () => {
    const { flat, res } = run('Examples.MassSpringDamper');
    const F = param(flat, 'step.height');
    const c = param(flat, 'spring.c');
    const sEq = param(flat, 'fixed.s0') - param(flat, 'mass.L') / 2 - param(flat, 'spring.s_rel0') + F / c;
    const s = values(res, 'mass.s');
    const t0 = param(flat, 'step.startTime');
    expect(s[0]).toBe(0);
    expect(Math.max(...s)).toBeGreaterThan(sEq * 1.3); // overshoot (zeta = 0.1)
    expect(Math.abs(s[s.length - 1] - sEq)).toBeLessThan(0.005);
    // Peak of the first overshoot at t0 + pi/wd with wd = w0 sqrt(1 - zeta^2).
    const m = param(flat, 'mass.m');
    const d = param(flat, 'damper.d');
    const w0 = Math.sqrt(c / m);
    const zeta = d / (2 * Math.sqrt(c * m));
    const tPeak = t0 + Math.PI / (w0 * Math.sqrt(1 - zeta * zeta));
    const kPeak = res.time.findIndex((t) => t >= tPeak);
    expect(s[kPeak]).toBeCloseTo(sEq * (1 + Math.exp((-zeta * Math.PI) / Math.sqrt(1 - zeta * zeta))), 2);
    // The relative coordinate of the damper is reconstructed consistently.
    const sRel = values(res, 'damper.s_rel');
    for (let k = 0; k < res.time.length; k += 50) expect(sRel[k]).toBeCloseTo(param(flat, 'fixed.s0') - (s[k] + param(flat, 'mass.L') / 2), 9);
  });

  it('RotationalDrive: bounded speeds, finite energy and an exactly satisfied constraint', () => {
    const { flat, res } = run('Examples.RotationalDrive');
    const w1 = values(res, 'inertia1.w');
    const w2 = values(res, 'inertia2.w');
    const phiRel = values(res, 'springDamper.phi_rel');
    const phi1 = values(res, 'inertia1.phi');
    const phi2 = values(res, 'inertia2.phi');
    const J1 = param(flat, 'inertia1.J');
    const J2 = param(flat, 'inertia2.J');
    const c = param(flat, 'springDamper.c');
    for (let k = 0; k < res.time.length; k++) {
      expect(Math.abs(w1[k])).toBeLessThan(50);
      const energy = 0.5 * J1 * w1[k] ** 2 + 0.5 * J2 * w2[k] ** 2 + 0.5 * c * phiRel[k] ** 2;
      expect(Number.isFinite(energy)).toBe(true);
      expect(energy).toBeLessThan(1e4);
      expect(phiRel[k] - (phi2[k] - phi1[k])).toBeCloseTo(0, 9);
    }
    expect(res.stats.dummyStates!.length).toBe(2);
    expect(Math.max(...w1.map(Math.abs))).toBeGreaterThan(0.5); // it actually moves
    expect(getTrajectory(res, 'der(inertia2.phi)')!.kind).toBe('derivative');
  });

  it('PIDControlledMotor: the speed reaches the setpoint within 5%', () => {
    const { flat, res } = run('Examples.PIDControlledMotor');
    const setpoint = param(flat, 'reference.height');
    const w = values(res, 'inertia.w');
    expect(Math.abs(w[w.length - 1] - setpoint) / setpoint).toBeLessThan(0.05);
    // Alias chain emf.phi = inertia.phi = speedSensor.flange.phi and the sensor reads the speed.
    const ws = values(res, 'speedSensor.w');
    for (let k = 0; k < res.time.length; k += 100) expect(ws[k]).toBeCloseTo(w[k], 9);
    expect(res.stats.dummyStates).toEqual([]);
  });

  it('BouncingBall: several bounces are detected', () => {
    const { res } = run('Examples.BouncingBall');
    expect(res.stats.events).toBeGreaterThanOrEqual(3);
    // e = 0.7 is a Zeno sequence (accumulation point at ~2.56 s): up to there the ball never
    // penetrates the floor; what happens after the accumulation point is a property of the
    // event handling, not of this stage (identical without structural simplification).
    const h = values(res, 'h');
    const tZeno = 2.4;
    for (let k = 0; k < res.time.length; k++) if (res.time[k] < tZeno) expect(h[k]).toBeGreaterThan(-1e-3);
    expect(res.stats.events).toBeGreaterThanOrEqual(20);
  });

  it('PID_Controller: initial equations hold with the demoted inertia and the constraint is satisfied', () => {
    const { res } = run('Modelica.Blocks.Examples.PID_Controller');
    expect(res.stats.dummyStates).toEqual(['inertia2.phi', 'inertia2.w']);
    const phiRel = values(res, 'spring.phi_rel');
    const phi1 = values(res, 'inertia1.phi');
    const phi2 = values(res, 'inertia2.phi');
    for (let k = 0; k < res.time.length; k += 20) expect(phiRel[k] - (phi2[k] - phi1[k])).toBeCloseTo(0, 9);
    // initial equation der(inertia1.w) = 0 and spring.w_rel(fixed=true, start=0)
    expect(values(res, 'der(inertia1.w)')[0]).toBeCloseTo(0, 6);
    expect(values(res, 'spring.w_rel')[0]).toBeCloseTo(0, 9);
  });

  it('CauerLowPassAnalog: the capacitor loop is handled by dummy derivatives', () => {
    const { res } = run('Modelica.Electrical.Analog.Examples.CauerLowPassAnalog');
    expect(res.stats.dummyStates).toEqual(['C2.v', 'C4.v']);
    expect(res.stats.propagated).toBeGreaterThanOrEqual(2);
  });

  it('prints per-model statistics', () => {
    const rows = EXAMPLES.map((name) => {
      const { flat, res, ms } = run(name);
      const nStates = flat.stats.states;
      return `${name.padEnd(62)} ${String(res.stats.steps).padStart(6)} steps ${String(res.stats.events).padStart(3)} ev  states ${String(nStates).padStart(2)} -> ${String(nStates - (res.stats.dummyStates?.length ?? 0)).padStart(2)}  aliases ${String(res.stats.aliasEliminated).padStart(3)}  propagated ${String(res.stats.propagated).padStart(3)}  dummies [${res.stats.dummyStates?.join(', ') ?? ''}]  ${ms.toFixed(0).padStart(5)} ms`;
    });
    console.log(`Example simulations:\n  ${rows.join('\n  ')}`);
    expect(rows.length).toBe(EXAMPLES.length);
  });
});
