import { describe, expect, it } from 'vitest';
import { E, ModelicaError } from '../../ast.js';
import type { FlatModel } from '../../flat.js';
import { getTrajectory, type SimulationOptions, type SimulationResult } from '../../simulation.js';
import { createParameterEnvironment } from '../compile.js';
import { simulate } from '../index.js';
import * as M from '../test-models.js';
import { reduceIndex } from './indexReduction.js';
import { createWorkingModel } from './model.js';

const opts: SimulationOptions = { startTime: 0, finalTime: 2, ncp: 200, rtol: 1e-6, solver: 'CVode' };

function maxDiff(a: SimulationResult, b: SimulationResult, name: string): number {
  const ta = getTrajectory(a, name)!.values;
  const tb = getTrajectory(b, name)!.values;
  expect(a.time.length).toBe(b.time.length);
  let m = 0;
  for (let i = 0; i < ta.length; i++) m = Math.max(m, Math.abs(ta[i] - tb[i]));
  return m;
}

function unknownCount(flat: FlatModel): number {
  return flat.variables.filter((v) => v.variability === 'continuous' || v.variability === 'discrete').length;
}

describe('index reduction: two states aliased through der()', () => {
  // der(x) = v, der(y) = w, x = y, der(v) = -x  ->  x = y = cos(t)
  const model = () =>
    M.model(
      'T',
      [M.variable('x', { start: 1, fixed: true }), M.variable('y', { start: 1 }), M.variable('v', { start: 0, fixed: true }), M.variable('w')],
      [M.eq(M.der('x'), M.r('v')), M.eq(M.der('y'), M.r('w')), M.eq(M.r('x'), M.r('y')), M.eq(M.der('v'), E.neg(M.r('x')))],
    );

  it('reduceIndex alone (no alias pass) demotes the state without a fixed start and keeps the system balanced', () => {
    const flat = model();
    const wm = createWorkingModel(flat, createParameterEnvironment(flat, {}).env);
    const r = reduceIndex(wm, { startTime: 0 });
    expect(r.dummyStates).toEqual(['y']);
    expect(r.differentiated).toBe(1);
    expect([...r.dummyDerivatives.keys()]).toEqual(['der(y)']);
    expect(r.messages).toEqual(['Selected dummy derivative for y']);
    expect(wm.flat.equations.length).toBe(unknownCount(wm.flat));
    expect(wm.states.has('y')).toBe(false);
    expect(wm.states.has('x')).toBe(true);
    // The reduced model simulates without further structural processing.
    const res = simulate(wm.flat, { ...opts, disableStructuralSimplification: true });
    const y = getTrajectory(res, 'y')!.values;
    for (let i = 0; i < res.time.length; i++) expect(y[i]).toBeCloseTo(Math.cos(res.time[i]), 3);
  });

  it('the full pipeline eliminates the alias instead and reproduces x = y = cos(t) with der(y) in the output', () => {
    const res = simulate(model(), opts);
    // x = y, and then der(x) = v together with der(x) = w make w an alias of v.
    expect(res.stats.aliasEliminated).toBe(2);
    expect(res.stats.dummyStates).toEqual([]);
    const x = getTrajectory(res, 'x')!.values;
    const y = getTrajectory(res, 'y')!.values;
    const dy = getTrajectory(res, 'der(y)')!;
    expect(dy.kind).toBe('derivative');
    for (let i = 0; i < res.time.length; i++) {
      expect(x[i]).toBeCloseTo(Math.cos(res.time[i]), 3);
      expect(y[i]).toBe(x[i]);
      expect(dy.values[i]).toBeCloseTo(-Math.sin(res.time[i]), 3);
    }
  });
});

describe('index reduction: mechanical constraint phi_rel = phi_b - phi_a (index 3)', () => {
  const J_a = 1;
  const J_b = 2;
  const c = 100;
  const d = 5;
  const d_b = 1;
  const A = 10;
  const f = 1;
  const drive = () => M.mul(M.n(A), E.call('sin', [M.mul(M.n(2 * Math.PI * f), M.time)]));

  /**
   * Two inertias coupled by a spring-damper with relative states, as the flattener produces it
   * (MSL sign convention: tau = c*phi_rel acts with + on a and with - on b).
   */
  function constrained(): FlatModel {
    return M.model(
      'T',
      [
        M.param('J_a', J_a),
        M.param('J_b', J_b),
        M.param('c', c),
        M.param('d', d),
        M.param('d_b', d_b),
        M.variable('phi_a', { start: 0, fixed: true }),
        M.variable('w_a', { start: 0, fixed: true }),
        M.variable('a_a'),
        M.variable('phi_b', { start: 0 }),
        M.variable('w_b', { start: 0 }),
        M.variable('a_b'),
        M.variable('phi_rel', { start: 0, fixed: true, nominal: 1e-4 }),
        M.variable('w_rel', { start: 0, fixed: true }),
        M.variable('a_rel'),
        M.variable('tau'),
        M.variable('tau_drive'),
      ],
      [
        M.eq(M.r('w_a'), M.der('phi_a')),
        M.eq(M.r('a_a'), M.der('w_a')),
        M.eq(M.mul(M.r('J_a'), M.r('a_a')), M.add(M.r('tau_drive'), M.r('tau'))),
        M.eq(M.r('w_b'), M.der('phi_b')),
        M.eq(M.r('a_b'), M.der('w_b')),
        M.eq(M.mul(M.r('J_b'), M.r('a_b')), M.sub(E.neg(M.r('tau')), M.mul(M.r('d_b'), M.r('w_b')))),
        M.eq(M.r('phi_rel'), M.sub(M.r('phi_b'), M.r('phi_a'))),
        M.eq(M.r('w_rel'), M.der('phi_rel')),
        M.eq(M.r('a_rel'), M.der('w_rel')),
        M.eq(M.r('tau'), M.add(M.mul(M.r('c'), M.r('phi_rel')), M.mul(M.r('d'), M.r('w_rel')))),
        M.eq(M.r('tau_drive'), drive()),
      ],
    );
  }

  /** The same system as an explicit ODE in phi_a, w_a, phi_b, w_b. */
  function reference(): FlatModel {
    const phiRel = M.sub(M.r('phi_b'), M.r('phi_a'));
    const wRel = M.sub(M.r('w_b'), M.r('w_a'));
    const tau = M.add(M.mul(M.n(c), phiRel), M.mul(M.n(d), wRel));
    return M.model(
      'Ref',
      [M.variable('phi_a', { start: 0, fixed: true }), M.variable('w_a', { start: 0, fixed: true }), M.variable('phi_b', { start: 0, fixed: true }), M.variable('w_b', { start: 0, fixed: true })],
      [
        M.eq(M.der('phi_a'), M.r('w_a')),
        M.eq(M.mul(M.n(J_a), M.der('w_a')), M.add(drive(), tau)),
        M.eq(M.der('phi_b'), M.r('w_b')),
        M.eq(M.mul(M.n(J_b), M.der('w_b')), M.sub(E.neg(tau), M.mul(M.n(d_b), M.r('w_b')))),
      ],
    );
  }

  it('simulates only after index reduction and matches the explicitly reduced ODE', () => {
    const flat = constrained();
    expect(() => simulate(flat, { ...opts, disableStructuralSimplification: true })).toThrow(ModelicaError);
    const res = simulate(flat, opts);
    const ref = simulate(reference(), opts);
    expect(res.stats.completed).toBe(true);
    // The inertia without fixed start values (phi_b, w_b) is demoted; phi_rel/w_rel keep their fixed starts.
    expect(res.stats.dummyStates).toEqual(['phi_b', 'w_b']);
    expect(res.log.some((l) => /2 dummy derivatives selected \(phi_b, w_b\)/.test(l.message))).toBe(true);
    expect(res.log.filter((l) => /^Selected dummy derivative for /.test(l.message)).map((l) => l.message)).toEqual([
      'Selected dummy derivative for phi_b',
      'Selected dummy derivative for w_b',
    ]);
    expect(maxDiff(res, ref, 'phi_b')).toBeLessThan(2e-4);
    expect(maxDiff(res, ref, 'w_b')).toBeLessThan(2e-3);
    expect(maxDiff(res, ref, 'phi_a')).toBeLessThan(2e-4);
    // The constraint holds exactly at every output point and der(phi_b) is available.
    const phiA = getTrajectory(res, 'phi_a')!.values;
    const phiB = getTrajectory(res, 'phi_b')!.values;
    const phiRel = getTrajectory(res, 'phi_rel')!.values;
    const wB = getTrajectory(res, 'w_b')!.values;
    const dPhiB = getTrajectory(res, 'der(phi_b)')!;
    expect(dPhiB.kind).toBe('derivative');
    for (let i = 0; i < res.time.length; i++) {
      expect(phiRel[i] - (phiB[i] - phiA[i])).toBeCloseTo(0, 9);
      expect(dPhiB.values[i]).toBeCloseTo(wB[i], 9);
    }
    // Every original variable has a trajectory.
    for (const v of flat.variables) expect(getTrajectory(res, v.name), v.name).toBeDefined();
  });

  it('demotes the compliant element instead when the inertias carry the fixed start values', () => {
    const flat = constrained();
    const byName = new Map(flat.variables.map((v) => [v.name, v]));
    byName.get('phi_b')!.attributes = { start: 0, fixed: true };
    byName.get('w_b')!.attributes = { start: 0, fixed: true };
    byName.get('phi_rel')!.attributes = { start: 0 };
    byName.get('w_rel')!.attributes = { start: 0 };
    const res = simulate(flat, opts);
    expect(res.stats.dummyStates).toEqual(['phi_rel', 'w_rel']);
    expect(maxDiff(res, simulate(reference(), opts), 'phi_b')).toBeLessThan(2e-4);
  });

  it('turns fixed=true start values of demoted states into initial equations', () => {
    // All positions fixed except phi_rel's: demoting the inertia b would need its fixed value as an initial equation.
    const flat = constrained();
    const byName = new Map(flat.variables.map((v) => [v.name, v]));
    byName.get('phi_b')!.attributes = { start: 0.5, fixed: true };
    byName.get('w_b')!.attributes = { start: 0, fixed: true };
    byName.get('phi_rel')!.attributes = { start: 0 };
    byName.get('w_rel')!.attributes = { start: 0 };
    byName.get('phi_a')!.attributes = { start: 0 };
    byName.get('w_a')!.attributes = { start: 0 };
    const res = simulate(flat, opts);
    // Now the inertia a (no fixed start) is demoted ... or the compliant family; either way phi_b(0) = 0.5 holds.
    expect(getTrajectory(res, 'phi_b')!.values[0]).toBeCloseTo(0.5, 9);
    expect(getTrajectory(res, 'phi_rel')!.values[0]).toBeCloseTo(0.5 - getTrajectory(res, 'phi_a')!.values[0], 9);
  });

  it('keeps the fixed initial value 0 of a demoted state whose fixed=true has no explicit start', () => {
    // phi_b(fixed=true) without start means phi_b(0) = 0 (Modelica default start). With phi_a(0) = 1 fixed and
    // the compliant element preferred as state, an inertia is demoted; the constraint then gives phi_rel(0) = -1.
    const flat = constrained();
    const byName = new Map(flat.variables.map((v) => [v.name, v]));
    byName.get('phi_a')!.attributes = { start: 1, fixed: true };
    byName.get('w_a')!.attributes = { start: 0, fixed: true };
    byName.get('phi_b')!.attributes = { fixed: true };
    byName.get('w_b')!.attributes = { start: 0 };
    byName.get('phi_rel')!.attributes = { start: 0, stateSelect: 'prefer' };
    byName.get('w_rel')!.attributes = { start: 0, stateSelect: 'prefer' };
    const res = simulate(flat, opts);
    expect(res.stats.dummyStates!.length).toBe(2);
    expect(getTrajectory(res, 'phi_a')!.values[0]).toBeCloseTo(1, 9);
    expect(getTrajectory(res, 'phi_b')!.values[0]).toBeCloseTo(0, 9);
    expect(getTrajectory(res, 'phi_rel')!.values[0]).toBeCloseTo(-1, 9);
  });
});

describe('index reduction: pendulum in Cartesian coordinates (index 3)', () => {
  const L = 1;
  const g = 9.81;
  const theta0 = Math.atan2(0.6, 0.8);

  function pendulum(): FlatModel {
    return M.model(
      'Pendulum',
      [
        M.param('L', L),
        M.param('g', g),
        M.variable('x', { start: 0.6, fixed: true }),
        M.variable('y', { start: -0.8 }),
        M.variable('vx', { start: 0, fixed: true }),
        M.variable('vy', { start: 0 }),
        M.variable('lambda'),
      ],
      [
        M.eq(M.der('x'), M.r('vx')),
        M.eq(M.der('y'), M.r('vy')),
        M.eq(M.der('vx'), E.neg(M.mul(M.r('lambda'), M.r('x')))),
        M.eq(M.der('vy'), M.sub(E.neg(M.mul(M.r('lambda'), M.r('y'))), M.r('g'))),
        M.eq(M.add(E.bin('^', M.r('x'), M.n(2)), E.bin('^', M.r('y'), M.n(2))), E.bin('^', M.r('L'), M.n(2))),
      ],
    );
  }

  /** theta'' = -(g/L) sin(theta), x = L sin(theta), y = -L cos(theta). */
  function reference(): FlatModel {
    return M.model(
      'Ref',
      [M.variable('theta', { start: theta0, fixed: true }), M.variable('omega', { start: 0, fixed: true }), M.variable('x'), M.variable('y')],
      [
        M.eq(M.der('theta'), M.r('omega')),
        M.eq(M.der('omega'), M.mul(M.n(-g / L), E.call('sin', [M.r('theta')]))),
        M.eq(M.r('x'), M.mul(M.n(L), E.call('sin', [M.r('theta')]))),
        M.eq(M.r('y'), M.mul(M.n(-L), E.call('cos', [M.r('theta')]))),
      ],
    );
  }

  it('is reduced to index 1 with y and vy as dummy states and follows the reference solution', () => {
    // Documented outcome: SUCCESS. The constraint is differentiated twice; the second-order
    // Jacobian [2x 2y] is evaluated at the start point and, because x and vx carry the fixed
    // start values, y and vy are selected as dummy derivatives (states x, vx remain). With a
    // static selection the reduced model is valid while |y| stays away from 0, which holds for
    // this 37 degree swing.
    const res = simulate(pendulum(), { ...opts, finalTime: 2, ncp: 400 });
    expect(res.stats.completed).toBe(true);
    expect(res.stats.dummyStates).toEqual(['y', 'vy']);
    const ref = simulate(reference(), { ...opts, finalTime: 2, ncp: 400 });
    expect(maxDiff(res, ref, 'x')).toBeLessThan(2e-3);
    expect(maxDiff(res, ref, 'y')).toBeLessThan(2e-3);
    const x = getTrajectory(res, 'x')!.values;
    const y = getTrajectory(res, 'y')!.values;
    for (let i = 0; i < res.time.length; i++) expect(x[i] * x[i] + y[i] * y[i]).toBeCloseTo(L * L, 7);
    // Higher derivatives introduced by the reduction are reported as derivatives.
    expect(getTrajectory(res, 'der(y)')!.kind).toBe('derivative');
    expect(getTrajectory(res, 'der(vy)')!.kind).toBe('derivative');
  });
});

describe('index reduction: failures are reported clearly', () => {
  it('reports structurally singular models (an equation that is the derivative of another)', () => {
    const flat = M.model('T', [M.variable('x', { start: 1 }), M.variable('y')], [M.eq(M.r('x'), M.r('y')), M.eq(M.der('x'), M.der('y'))]);
    expect(() => simulate(flat, opts)).toThrow(ModelicaError);
    expect(() => simulate(flat, opts)).toThrow(/structurally singular|redundant/);
  });

  it('reports equations that cannot be differentiated', () => {
    // Constraint between two states involving a function without derivative rule.
    const flat = M.model(
      'T',
      [M.variable('x', { start: 1, fixed: true }), M.variable('y', { start: 1 }), M.variable('v', { start: 0, fixed: true }), M.variable('w')],
      [M.eq(M.der('x'), M.r('v')), M.eq(M.der('y'), M.r('w')), M.eq(M.r('x'), E.call('myFunc', [M.r('y')])), M.eq(M.der('v'), E.neg(M.r('x')))],
    );
    expect(() => simulate(flat, opts)).toThrow(/Index reduction is not possible[\s\S]*myFunc/);
  });

  it('refuses to demote a state that is re-initialised in a when-clause', () => {
    const flat = M.model(
      'T',
      [M.variable('x', { start: 1, fixed: true }), M.variable('y', { start: 1 }), M.variable('v', { start: 0, fixed: true }), M.variable('w')],
      [M.eq(M.der('x'), M.r('v')), M.eq(M.der('y'), M.r('w')), M.eq(M.mul(M.r('x'), M.r('x')), M.mul(M.r('y'), M.r('y'))), M.eq(M.der('v'), E.neg(M.r('x')))],
      { whenClauses: [M.when(M.gt(M.time, M.n(0.5)), [M.reinit('y', M.n(2)), M.reinit('x', M.n(2))])] },
    );
    // Both x and y are reinit targets and constrained to each other: whichever is demoted, the error names it.
    expect(() => simulate(flat, opts)).toThrow(/reinit\((x|y), \.\.\.\) is not possible/);
  });
});
