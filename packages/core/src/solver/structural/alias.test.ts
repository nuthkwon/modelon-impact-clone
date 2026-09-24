import { describe, expect, it } from 'vitest';
import { E, ModelicaError } from '../../ast.js';
import type { FlatModel } from '../../flat.js';
import { getTrajectory } from '../../simulation.js';
import { createParameterEnvironment } from '../compile.js';
import { simulate } from '../index.js';
import * as M from '../test-models.js';
import { detectAliases, eliminateAliases, type AliasMap, type DetectedAlias } from './alias.js';
import { evalNumeric } from './expr.js';
import { createWorkingModel, type WorkingModel } from './model.js';

function working(flat: FlatModel): WorkingModel {
  return createWorkingModel(flat, createParameterEnvironment(flat, {}).env);
}

const opts = { startTime: 0, finalTime: 1, ncp: 10, rtol: 1e-6, solver: 'CVode' as const };

/** Checks that the detected relation `a = scale*b + offset` satisfies the equation it came from. */
function satisfies(al: DetectedAlias, flat: FlatModel, wm: WorkingModel): void {
  const eq = flat.equations[al.equation];
  for (const bVal of [0.3, -1.7, 4.2]) {
    const values = new Map<string, number>([[al.b, bVal], [al.a, al.scale * bVal + al.offset]]);
    const ctx = { time: 0, env: wm.env, value: (name: string) => values.get(name) };
    const residual = evalNumeric(eq.left, ctx) - evalNumeric(eq.right, ctx);
    expect(Math.abs(residual), `${al.a} = ${al.scale}*${al.b} + ${al.offset} for '${M.eq === undefined ? '' : ''}${JSON.stringify(eq.origin)}'`).toBeLessThan(1e-12);
  }
}

describe('alias detection', () => {
  it('recognises every alias form (a = b, a = -b, a + b = 0, a - b = 0, -a = b, 0 = a - b, offsets, scales)', () => {
    const names = 'abcdefghijklmnopqr'.split('');
    const flat = M.model(
      'T',
      [...names.map((n) => M.variable(n)), M.param('k', 2), M.param('c0', 5)],
      [
        M.eq(M.r('a'), M.r('b'), 'a=b'),
        M.eq(M.r('c'), E.neg(M.r('d')), 'c=-d'),
        M.eq(M.add(M.r('e'), M.r('f')), M.n(0), 'e+f=0', 'connect-flow'),
        M.eq(M.sub(M.r('g'), M.r('h')), M.n(0), 'g-h=0'),
        M.eq(E.neg(M.r('i')), M.r('j'), '-i=j'),
        M.eq(M.n(0), M.sub(M.r('k'), M.r('l')), '0=k-l'),
        M.eq(M.r('m'), M.add(M.r('n'), M.r('c0')), 'm=n+c0'),
        M.eq(M.r('o'), M.mul(M.r('k'), M.r('p')), 'o=k*p'),
        M.eq(M.mul(M.n(3), M.r('q')), M.sub(M.mul(M.n(2), M.r('r')), M.n(1)), '3q=2r-1'),
      ],
    );
    // 'k' is both a parameter name and a variable name in this synthetic model: rename the variable to avoid confusion.
    flat.variables = flat.variables.filter((v) => !(v.name === 'k' && v.variability === 'continuous'));
    flat.variables.push(M.variable('kk'));
    flat.equations[5] = M.eq(M.n(0), M.sub(M.r('kk'), M.r('l')), '0=kk-l');
    const wm = working(flat);
    const found = detectAliases(wm);
    expect(found.length).toBe(9);
    for (const al of found) satisfies(al, flat, wm);
    const byEq = new Map(found.map((f) => [flat.equations[f.equation].origin, f]));
    expect(byEq.get('a=b')).toMatchObject({ scale: 1, offset: 0 });
    expect(byEq.get('c=-d')).toMatchObject({ scale: -1, offset: 0 });
    expect(byEq.get('e+f=0')).toMatchObject({ scale: -1, offset: 0 });
    expect(byEq.get('g-h=0')).toMatchObject({ scale: 1, offset: 0 });
    expect(byEq.get('-i=j')).toMatchObject({ scale: -1, offset: 0 });
    expect(byEq.get('0=kk-l')).toMatchObject({ scale: 1, offset: 0 });
    expect(byEq.get('m=n+c0')).toMatchObject({ a: 'm', b: 'n', scale: 1, offset: 5 });
    expect(byEq.get('o=k*p')).toMatchObject({ a: 'o', b: 'p', scale: 2, offset: 0 });
  });

  it('does not treat equations with three unknowns, der(), if-expressions or time as aliases', () => {
    const flat = M.model(
      'T',
      [M.variable('a'), M.variable('b'), M.variable('c'), M.variable('x', { start: 0 })],
      [
        M.eq(M.r('a'), M.add(M.r('b'), M.r('c'))),
        M.eq(M.r('b'), M.der('x')),
        M.eq(M.r('c'), M.ifExpr(M.gt(M.time, M.n(1)), M.r('a'), M.n(0))),
        M.eq(M.der('x'), M.mul(M.n(2), M.time)),
      ],
    );
    expect(detectAliases(working(flat))).toEqual([]);
  });

  it('finds derivative aliases: two variables defined by the same der(x)', () => {
    const flat = M.model(
      'T',
      [M.variable('phi', { start: 0, fixed: true }), M.variable('w1'), M.variable('w2')],
      [M.eq(M.r('w1'), M.der('phi')), M.eq(M.r('w2'), E.neg(M.der('phi'))), M.eq(M.der('phi'), M.n(1))],
    );
    const found = detectAliases(working(flat));
    expect(found).toEqual([{ equation: 1, a: 'w2', b: 'w1', scale: -1, offset: 0 }]);
  });

  it('accepts Boolean aliases only between variables of the same type', () => {
    const flat = M.model(
      'T',
      [M.variable('b1', { type: 'Boolean', variability: 'discrete' }), M.variable('b2', { type: 'Boolean', variability: 'discrete' }), M.variable('x')],
      [M.eq(M.r('b1'), M.r('b2')), M.eq(M.r('b2'), M.gt(M.time, M.n(0.5))), M.eq(M.r('x'), M.ifExpr(M.r('b1'), M.n(1), M.n(0)))],
    );
    const found = detectAliases(working(flat));
    expect(found).toEqual([{ equation: 0, a: 'b1', b: 'b2', scale: 1, offset: 0 }]);
  });
});

describe('alias elimination', () => {
  it('collapses sign chains into one class and keeps the state as representative', () => {
    // a = -b, b = -c, c = x (x is the state) -> a = x, b = -x, c = x
    const flat = M.model(
      'T',
      [M.variable('x', { start: 1, fixed: true }), M.variable('a'), M.variable('b'), M.variable('c')],
      [M.eq(M.r('a'), E.neg(M.r('b'))), M.eq(M.r('b'), E.neg(M.r('c'))), M.eq(M.r('c'), M.r('x')), M.eq(M.der('x'), E.neg(M.r('a')))],
    );
    const wm = working(flat);
    const aliases: AliasMap = new Map();
    expect(eliminateAliases(wm, aliases)).toBe(3);
    expect(aliases.get('a')).toEqual({ rep: 'x', scale: 1, offset: 0 });
    expect(aliases.get('b')).toEqual({ rep: 'x', scale: -1, offset: 0 });
    expect(aliases.get('c')).toEqual({ rep: 'x', scale: 1, offset: 0 });
    expect(wm.flat.variables.map((v) => v.name)).toEqual(['x']);
    expect(wm.flat.equations.length).toBe(1);
    // der(x) = -a became der(x) = -x
    const res = simulate(wm.flat, { ...opts, disableStructuralSimplification: true });
    expect(getTrajectory(res, 'x')!.values.at(-1)).toBeCloseTo(Math.exp(-1), 3);
  });

  it('prefers a fixed start value, then an explicit start, then the shorter name', () => {
    const flat = M.model(
      'T',
      [M.variable('long_name_state', { start: 2, fixed: true }), M.variable('y', { start: 1 }), M.variable('zz')],
      [M.eq(M.r('long_name_state'), M.r('y')), M.eq(M.r('y'), M.r('zz')), M.eq(M.der('long_name_state'), M.n(0))],
    );
    const wm = working(flat);
    const aliases: AliasMap = new Map();
    eliminateAliases(wm, aliases);
    expect([...aliases.keys()].sort()).toEqual(['y', 'zz']);
    expect(aliases.get('y')!.rep).toBe('long_name_state');

    const flat2 = M.model('T', [M.variable('p', { start: 1 }), M.variable('q'), M.variable('r')], [M.eq(M.r('p'), M.r('q')), M.eq(M.r('q'), M.r('r')), M.eq(M.r('r'), M.time)]);
    const wm2 = working(flat2);
    const aliases2: AliasMap = new Map();
    eliminateAliases(wm2, aliases2);
    expect(aliases2.get('q')!.rep).toBe('p');
    expect(aliases2.get('r')!.rep).toBe('p');
  });

  it('merges start values into the representative and reports conflicting fixed start values of two states', () => {
    const ok = M.model(
      'T',
      [M.variable('x', { start: 1, fixed: true }), M.variable('y', { start: 3 })],
      [M.eq(M.r('y'), M.add(M.r('x'), M.n(2))), M.eq(M.der('x'), M.n(0)), M.eq(M.der('y'), M.n(0))],
    );
    const wm = working(ok);
    eliminateAliases(wm, new Map());
    expect(wm.flat.variables.map((v) => v.name)).toEqual(['x']);
    expect(wm.flat.variables[0].attributes).toMatchObject({ start: 1, fixed: true });

    const transfer = M.model(
      'T',
      [M.variable('x', { start: 0 }), M.variable('y', { start: 3, fixed: true })],
      [M.eq(M.r('y'), M.add(M.r('x'), M.n(2))), M.eq(M.der('x'), M.n(0)), M.eq(M.der('y'), M.n(0))],
    );
    const wm2 = working(transfer);
    eliminateAliases(wm2, new Map());
    // y has the fixed start -> it is the representative; x is expressed through it.
    expect(wm2.flat.variables.map((v) => v.name)).toEqual(['y']);

    const conflict = M.model(
      'T',
      [M.variable('x', { start: 1, fixed: true }), M.variable('y', { start: 2, fixed: true })],
      [M.eq(M.r('x'), M.r('y')), M.eq(M.der('x'), M.n(0)), M.eq(M.der('y'), M.n(0))],
    );
    expect(() => eliminateAliases(working(conflict), new Map())).toThrow(ModelicaError);
    expect(() => eliminateAliases(working(conflict), new Map())).toThrow(/Conflicting start values/);
  });

  it('merges min/max/nominal conservatively', () => {
    const flat = M.model(
      'T',
      [M.variable('x', { start: 0, fixed: true, min: -10, max: 10 }), M.variable('y', { min: -1, max: 4, nominal: 100 })],
      [M.eq(M.r('y'), E.neg(M.r('x'))), M.eq(M.der('x'), M.n(0))],
    );
    const wm = working(flat);
    eliminateAliases(wm, new Map());
    const x = wm.flat.variables[0];
    // y in [-1, 4] and y = -x  ->  x in [-4, 1]
    expect(x.attributes.min).toBe(-4);
    expect(x.attributes.max).toBe(1);
    expect(x.attributes.nominal).toBe(100);
  });

  it('treats fixed=true without an explicit start as the fixed start value 0 and keeps an explicit fixed=false', () => {
    // Algebraic x(fixed=true) is an alias of the state y(start=1): the class is fixed at 0.
    const fixedNoStart = M.model('T', [M.variable('y', { start: 1 }), M.variable('x', { fixed: true })], [M.eq(M.der('y'), E.neg(M.r('y'))), M.eq(M.r('x'), M.r('y'))]);
    const wm = working(fixedNoStart);
    eliminateAliases(wm, new Map());
    expect(wm.flat.variables.map((v) => v.name)).toEqual(['y']);
    expect(wm.flat.variables[0].attributes).toMatchObject({ start: 0, fixed: true });

    // Two states: the fixed one (implicit start 0) is preferred as representative over an explicit start.
    const twoStates = M.model(
      'T',
      [M.variable('y', { start: 1 }), M.variable('x', { fixed: true })],
      [M.eq(M.r('x'), M.r('y')), M.eq(M.der('x'), M.n(0)), M.eq(M.der('y'), M.n(0))],
    );
    const wm2 = working(twoStates);
    eliminateAliases(wm2, new Map());
    expect(wm2.flat.variables.map((v) => v.name)).toEqual(['x']);
    expect(wm2.flat.variables[0].attributes.fixed).toBe(true);

    // The implicit fixed start 0 conflicts with an explicit fixed start of the alias.
    const conflict = M.model(
      'T',
      [M.variable('x', { fixed: true }), M.variable('y', { start: 2, fixed: true })],
      [M.eq(M.r('x'), M.r('y')), M.eq(M.der('x'), M.n(0)), M.eq(M.der('y'), M.n(0))],
    );
    expect(() => eliminateAliases(working(conflict), new Map())).toThrow(/Conflicting start values: 'x' \(start=0, fixed=true\)/);

    // An explicit fixed=false of the eliminated variable reaches a representative without fixed.
    const notFixed = M.model('T', [M.variable('b', { start: 1 }), M.variable('a', { fixed: false })], [M.eq(M.der('b'), E.neg(M.r('b'))), M.eq(M.r('a'), M.r('b'))]);
    const wm3 = working(notFixed);
    eliminateAliases(wm3, new Map());
    expect(wm3.flat.variables[0].attributes).toMatchObject({ start: 1, fixed: false });
  });

  it('throws for redundant equations that reduce to 0 = 0', () => {
    const flat = M.model('T', [M.variable('x'), M.variable('y')], [M.eq(M.add(M.r('x'), M.r('y')), M.n(1)), M.eq(M.mul(M.n(2), M.add(M.r('x'), M.r('y'))), M.n(2))]);
    expect(() => simulate(flat, opts)).toThrow(/structurally singular[\s\S]*redundant/);
  });

  it('reports a contradictory alias pair as an inconsistent model, not as a redundant equation', () => {
    const flat = M.model(
      'T',
      [M.variable('a'), M.variable('b'), M.variable('c')],
      [M.eq(M.r('a'), M.r('b'), 'a=b'), M.eq(M.r('a'), M.add(M.r('b'), M.n(1)), 'a=b+1'), M.eq(M.r('c'), M.time)],
    );
    expect(() => simulate(flat, opts)).toThrow(ModelicaError);
    expect(() => simulate(flat, opts)).toThrow(/The model is inconsistent: equation 'a = b \+ 1' \[a=b\+1\] reduces to 0 = -1/);
    // A chain of offsets that is consistent up to round-off is redundant (0 = 0), not inconsistent.
    const chain = M.model(
      'T',
      [M.variable('a'), M.variable('b'), M.variable('c')],
      [M.eq(M.r('a'), M.add(M.r('b'), M.n(0.1))), M.eq(M.r('b'), M.add(M.r('c'), M.n(0.2))), M.eq(M.r('a'), M.add(M.r('c'), M.n(0.3)))],
    );
    expect(() => simulate(chain, opts)).toThrow(/structurally singular[\s\S]*redundant/);
  });
});

describe('alias elimination through simulate()', () => {
  it('reconstructs the trajectories of eliminated variables (sign, offset and scale)', () => {
    const flat = M.model(
      'T',
      [M.param('k', 3), M.variable('x', { start: 1, fixed: true }), M.variable('y'), M.variable('z'), M.variable('u')],
      [M.eq(M.r('y'), M.add(M.r('x'), M.n(2))), M.eq(M.r('z'), E.neg(M.r('y'))), M.eq(M.r('u'), M.mul(M.r('k'), M.r('z'))), M.eq(M.der('x'), E.neg(M.r('x')))],
    );
    const res = simulate(flat, opts);
    expect(res.stats.aliasEliminated).toBe(3);
    expect(res.stats.propagated).toBe(0);
    expect(res.log.some((l) => /Structural analysis: 3 alias variables eliminated/.test(l.message))).toBe(true);
    const x = getTrajectory(res, 'x')!.values;
    const y = getTrajectory(res, 'y')!;
    const z = getTrajectory(res, 'z')!;
    const u = getTrajectory(res, 'u')!;
    expect(y.kind).toBe('continuous');
    for (let i = 0; i < x.length; i++) {
      expect(y.values[i]).toBeCloseTo(x[i] + 2, 12);
      expect(z.values[i]).toBeCloseTo(-(x[i] + 2), 12);
      expect(u.values[i]).toBeCloseTo(-3 * (x[i] + 2), 12);
    }
    // Declaration order is preserved and every variable (plus der(x)) is present.
    expect(res.trajectories.map((t) => t.name)).toEqual(['k', 'x', 'der(x)', 'y', 'z', 'u']);
    expect(getTrajectory(res, 'der(x)')!.kind).toBe('derivative');
  });

  it('substitutes aliases inside pre(), reinit() and when-conditions', () => {
    // Bouncing ball where the when-clause refers to alias variables h2 = h and v2 = v.
    const flat = M.model(
      'T',
      [M.param('e', 0.8), M.param('g', 9.81), M.variable('h', { start: 1, fixed: true }), M.variable('v', { start: 0, fixed: true }), M.variable('h2'), M.variable('v2')],
      [M.eq(M.der('h'), M.r('v')), M.eq(M.der('v'), E.neg(M.r('g'))), M.eq(M.r('h2'), M.r('h')), M.eq(M.r('v2'), M.r('v'))],
      { whenClauses: [M.when(M.lt(M.r('h2'), M.n(0)), [M.reinit('v2', M.mul(E.neg(M.r('e')), M.pre('v2')))])] },
    );
    const res = simulate(flat, { ...opts, finalTime: 3, ncp: 300 });
    expect(res.stats.aliasEliminated).toBe(2);
    expect(res.stats.events).toBeGreaterThanOrEqual(5);
    const h = getTrajectory(res, 'h')!.values;
    const h2 = getTrajectory(res, 'h2')!.values;
    const v = getTrajectory(res, 'v')!.values;
    const v2 = getTrajectory(res, 'v2')!.values;
    for (let i = 0; i < h.length; i++) {
      expect(h[i]).toBeGreaterThan(-1e-3);
      expect(h2[i]).toBe(h[i]);
      expect(v2[i]).toBe(v[i]);
    }
    // The reinit target v2 is the representative of its class; the original state v keeps its derivative.
    expect(res.trajectories.map((t) => t.name)).toContain('der(v)');
    expect(getTrajectory(res, 'der(v)')!.kind).toBe('derivative');
  });

  it('a state with fixed=true but no explicit start keeps its fixed initial value 0 through an alias', () => {
    // der(x) = v, der(y) = w, x = y, der(v) = -x with x(fixed=true) [start 0] and y(start=1): x = y = cos(t)*0 = 0 ... the class starts at 0.
    const flat = M.model(
      'T',
      [M.variable('x', { fixed: true }), M.variable('y', { start: 1 }), M.variable('v', { start: 0, fixed: true }), M.variable('w')],
      [M.eq(M.der('x'), M.r('v')), M.eq(M.der('y'), M.r('w')), M.eq(M.r('x'), M.r('y')), M.eq(M.der('v'), E.neg(M.r('x')))],
    );
    const res = simulate(flat, opts);
    expect(res.stats.aliasEliminated).toBe(2);
    expect(getTrajectory(res, 'x')!.values[0]).toBe(0);
    expect(getTrajectory(res, 'y')!.values[0]).toBe(0);
    for (const value of getTrajectory(res, 'x')!.values) expect(Math.abs(value)).toBeLessThan(1e-9);
  });

  it('an explicit fixed=false of an eliminated variable decides which state the initial equations free', () => {
    // z(start=3) and b(start=1) are states; a(fixed=false) = b. `initial equation z + a = 3` can free either state:
    // the fixed=false of a (now of b) must win over z, which appears first in the equation.
    const flat = M.model(
      'T',
      [M.variable('z', { start: 3 }), M.variable('a', { fixed: false }), M.variable('b', { start: 1 })],
      [M.eq(M.der('z'), E.neg(M.r('z'))), M.eq(M.der('b'), E.neg(M.r('b'))), M.eq(M.r('a'), M.r('b'))],
      { initialEquations: [M.eq(M.add(M.r('z'), M.r('a')), M.n(3), 'init', 'initial')] },
    );
    const res = simulate(flat, opts);
    expect(getTrajectory(res, 'z')!.values[0]).toBeCloseTo(3, 9);
    expect(getTrajectory(res, 'b')!.values[0]).toBeCloseTo(0, 9);
    expect(getTrajectory(res, 'a')!.values[0]).toBeCloseTo(0, 9);
  });

  it('aliases of two states through a gear ratio (scaled alias) need no index reduction', () => {
    // phi_a = ratio*phi_b, w_a = der(phi_a), w_b = der(phi_b), J_a*der(w_a) + ratio*J_b*der(w_b) = tau
    const flat = M.model(
      'T',
      [
        M.param('ratio', 10),
        M.param('J_a', 0.1),
        M.param('J_b', 2),
        M.variable('phi_a'),
        M.variable('phi_b', { start: 0, fixed: true }),
        M.variable('w_a'),
        M.variable('w_b', { start: 0, fixed: true }),
        M.variable('tau'),
      ],
      [
        M.eq(M.r('phi_a'), M.mul(M.r('ratio'), M.r('phi_b'))),
        M.eq(M.r('w_a'), M.der('phi_a')),
        M.eq(M.r('w_b'), M.der('phi_b')),
        M.eq(M.add(M.mul(M.r('J_a'), M.der('w_a')), M.mul(M.mul(M.r('ratio'), M.r('J_b')), M.der('w_b'))), M.r('tau')),
        M.eq(M.r('tau'), M.n(1)),
      ],
    );
    const res = simulate(flat, opts);
    expect(res.stats.dummyStates).toEqual([]);
    expect(res.stats.aliasEliminated).toBe(2);
    // Effective inertia seen from b: J_b + J_a*ratio^2 ... torque balance: (ratio*J_a + ratio*J_b) der(w_b) = 1
    const alpha = 1 / (10 * 0.1 + 10 * 2);
    const wb = getTrajectory(res, 'w_b')!.values;
    const wa = getTrajectory(res, 'w_a')!.values;
    const t = res.time;
    for (let i = 0; i < t.length; i++) {
      expect(wb[i]).toBeCloseTo(alpha * t[i], 8);
      expect(wa[i]).toBeCloseTo(10 * alpha * t[i], 7);
    }
  });
});
