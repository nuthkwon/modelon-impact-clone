/**
 * Event semantics of the DAE solver core (Modelica §3.8.3 event-generating operators, §8.5/§8.6
 * when-equations): coinciding time/state events, relations inside when-bodies, when-clauses at
 * initialization, `change()` on discrete Reals, event generation of `integer()`/`floor()`/
 * `ceil()`/`div`/`mod`/`rem`, and the matching-based selection of the states freed by initial
 * equations.
 */
import { describe, expect, it } from 'vitest';
import { E } from '../ast.js';
import { getTrajectory, type SimulationOptions, type SimulationResult, type SolverName } from '../simulation.js';
import { compileModel } from './compile.js';
import { simulate } from './index.js';
import * as M from './test-models.js';

const ALL_SOLVERS: SolverName[] = ['CVode', 'Radau5', 'Implicit Euler', 'Explicit Euler', 'Runge-Kutta'];

function opts(partial: Partial<SimulationOptions> & { solver: SolverName }): SimulationOptions {
  return { startTime: 0, finalTime: 1, ncp: 500, rtol: 1e-6, ...partial };
}

/** Value of the last recorded point with time <= t. */
function valueAt(res: SimulationResult, name: string, t: number): number {
  const tr = getTrajectory(res, name);
  if (!tr) throw new Error(`no trajectory ${name}`);
  let idx = 0;
  for (let i = 0; i < res.time.length; i++) if (res.time[i] <= t + 1e-12) idx = i;
  return tr.values[idx];
}

const disc = (name: string, start = 0, type: 'Real' | 'Integer' | 'Boolean' = 'Real') => M.variable(name, { type, variability: 'discrete', start });

describe('coinciding time and state events', () => {
  // u = if time < 1 then 0 else 1; der(x) = u; when sample(0, 1) then n = pre(n) + 1.
  // The relation `time < 1` flips exactly at the sample instant t = 1.
  const model = () =>
    M.model(
      'T',
      [M.variable('x', { start: 0, fixed: true }), M.variable('u'), disc('n', 0, 'Integer')],
      [M.eq(M.der('x'), M.r('u')), M.eq(M.r('u'), M.ifExpr(M.lt(M.time, E.num(1)), E.num(0), E.num(1)))],
      { whenClauses: [M.when(E.call('sample', [E.num(0), E.num(1)]), [M.eq(M.r('n'), M.add(M.pre('n'), E.num(1)))])] },
    );

  it.each(ALL_SOLVERS)('%s fires the sample() at t = 1 although a state event is located there', (solver) => {
    const res = simulate(model(), opts({ solver, finalTime: 3.5, ncp: 70 }));
    expect(res.stats.completed).toBe(true);
    // Samples at t = 0, 1, 2, 3.
    expect(valueAt(res, 'n', 0.5)).toBe(1);
    expect(valueAt(res, 'n', 1.5)).toBe(2);
    expect(valueAt(res, 'n', 2.5)).toBe(3);
    expect(valueAt(res, 'n', 3.5)).toBe(4);
    // u switches at t = 1 and x integrates u afterwards.
    expect(valueAt(res, 'u', 0.9)).toBe(0);
    expect(valueAt(res, 'u', 1.1)).toBe(1);
    expect(valueAt(res, 'x', 3.5)).toBeCloseTo(2.5, solver === 'Explicit Euler' || solver === 'Implicit Euler' ? 1 : 4);
  });
});

describe('relations inside when-clause bodies', () => {
  it('do not become zero-crossing functions', () => {
    // when sample(0.25, 0.5) then c = pre(c) + (if x > 0.3 then 1 else 0); der(x) = 1
    const m = M.model(
      'T',
      [M.variable('x', { start: 0, fixed: true }), disc('c')],
      [M.eq(M.der('x'), E.num(1))],
      {
        whenClauses: [
          M.when(E.call('sample', [E.num(0.25), E.num(0.5)]), [M.eq(M.r('c'), M.add(M.pre('c'), M.ifExpr(M.gt(M.r('x'), E.num(0.3)), E.num(1), E.num(0))))]),
        ],
      },
    );
    const compiled = compileModel(m, opts({ solver: 'CVode' }));
    expect(compiled.relations.length).toBe(0);
    const res = simulate(m, opts({ solver: 'CVode', finalTime: 2, ncp: 20 }));
    // Time events at 0.25, 0.75, 1.25, 1.75 only; no state event at x = 0.3 (t = 0.3 is a
    // communication point, but an event would duplicate it).
    expect(res.stats.events).toBe(4);
    expect(res.time.filter((t) => Math.abs(t - 0.3) < 1e-6).length).toBe(1);
    expect(valueAt(res, 'c', 0.5)).toBe(0); // x = 0.25 < 0.3 at the first sample
    expect(valueAt(res, 'c', 1)).toBe(1);
    expect(valueAt(res, 'c', 2)).toBe(3);
  });

  it('may compare a continuous variable with its pre() value without chattering', () => {
    // y = sin(2 pi x), der(x) = 1; when sample(0.25, 0.5) then c = pre(c) + (if y > pre(y) then 1 else 0)
    const m = M.model(
      'T',
      [M.variable('x', { start: 0, fixed: true }), M.variable('y'), disc('c')],
      [M.eq(M.der('x'), E.num(1)), M.eq(M.r('y'), E.call('sin', [M.mul(E.num(2 * Math.PI), M.r('x'))]))],
      {
        whenClauses: [
          M.when(E.call('sample', [E.num(0.25), E.num(0.5)]), [M.eq(M.r('c'), M.add(M.pre('c'), M.ifExpr(M.gt(M.r('y'), M.pre('y')), E.num(1), E.num(0))))]),
        ],
      },
    );
    const res = simulate(m, opts({ solver: 'CVode', finalTime: 2, ncp: 20 }));
    expect(res.stats.completed).toBe(true);
    expect(res.stats.events).toBe(4);
    // At the event instant y = pre(y) for a continuous variable, so the if-branch is never taken.
    expect(valueAt(res, 'c', 2)).toBe(0);
  });

  it('relations in initial equations are not monitored during the simulation', () => {
    const m = M.model(
      'T',
      [M.variable('x', { start: 0, fixed: false }), M.variable('y')],
      [M.eq(M.der('x'), E.num(1)), M.eq(M.r('y'), M.mul(E.num(2), M.r('x')))],
      { initialEquations: [M.eq(M.r('x'), M.ifExpr(M.gt(M.time, E.num(0.5)), E.num(1), E.num(-1)), 'T', 'initial')] },
    );
    const res = simulate(m, opts({ solver: 'CVode', finalTime: 2, ncp: 20 }));
    expect(valueAt(res, 'x', 0)).toBe(-1);
    expect(res.stats.events).toBe(0);
    expect(res.time.length).toBe(21);
  });
});

describe('when-clauses at initialization', () => {
  it('a when-clause whose condition is true at startTime does not fire (no false->true edge)', () => {
    const m = M.model(
      'T',
      [M.variable('x', { start: 1, fixed: true }), disc('n')],
      [M.eq(M.der('x'), E.num(1))],
      { whenClauses: [M.when(M.gt(M.r('x'), E.num(0.5)), [M.eq(M.r('n'), M.add(M.pre('n'), E.num(1)))])] },
    );
    const res = simulate(m, opts({ solver: 'CVode', finalTime: 1, ncp: 10 }));
    const n = getTrajectory(res, 'n')!.values;
    for (const v of n) expect(v).toBe(0);
    expect(res.stats.events).toBe(0);
  });

  it('`when time >= 0` keeps the start value at t0', () => {
    const m = M.model('T', [M.variable('x', { start: 0, fixed: true }), disc('m', 1)], [M.eq(M.der('x'), E.num(1))], {
      whenClauses: [M.when(E.bin('>=', M.time, E.num(0)), [M.eq(M.r('m'), E.num(7))])],
    });
    const res = simulate(m, opts({ solver: 'CVode', finalTime: 1, ncp: 10 }));
    for (const v of getTrajectory(res, 'm')!.values) expect(v).toBe(1);
  });

  it('`when initial()` fires and a condition that becomes true later fires once', () => {
    const m = M.model(
      'T',
      [M.variable('x', { start: 0, fixed: true }), disc('a'), disc('b')],
      [M.eq(M.der('x'), E.num(1))],
      {
        whenClauses: [
          M.when(E.call('initial'), [M.eq(M.r('a'), E.num(5))]),
          M.when(E.bin('or', E.call('initial'), M.gt(M.r('x'), E.num(0.5))), [M.eq(M.r('b'), M.add(M.pre('b'), E.num(1)))]),
        ],
      },
    );
    const res = simulate(m, opts({ solver: 'CVode', finalTime: 1, ncp: 10 }));
    expect(valueAt(res, 'a', 0)).toBe(5);
    expect(valueAt(res, 'a', 1)).toBe(5);
    expect(valueAt(res, 'b', 0)).toBe(1); // initial()
    expect(valueAt(res, 'b', 0.4)).toBe(1);
    expect(valueAt(res, 'b', 0.6)).toBe(2); // x > 0.5 becomes true
    expect(valueAt(res, 'b', 1)).toBe(2);
  });
});

describe('change() and event-generating functions', () => {
  it('change(d) detects a change of a discrete Real smaller than 0.5', () => {
    const m = M.model('T', [M.variable('x', { start: 0, fixed: true }), disc('d'), disc('c')], [M.eq(M.der('x'), E.num(1))], {
      whenClauses: [
        M.when(E.call('sample', [E.num(0.25), E.num(0.25)]), [M.eq(M.r('d'), M.add(M.pre('d'), E.num(0.1)))]),
        M.when(E.call('change', [M.r('d')]), [M.eq(M.r('c'), M.add(M.pre('c'), E.num(1)))]),
      ],
    });
    const res = simulate(m, opts({ solver: 'CVode', finalTime: 1.1, ncp: 11 }));
    expect(valueAt(res, 'd', 1.1)).toBeCloseTo(0.4, 12);
    expect(valueAt(res, 'c', 0.3)).toBe(1);
    expect(valueAt(res, 'c', 1.1)).toBe(4);
  });

  it.each(ALL_SOLVERS)('%s generates events for integer() and when change(k) fires', (solver) => {
    // der(x) = 1; k = integer(x); when change(k) then c = pre(c) + 1
    const m = M.model(
      'T',
      [M.variable('x', { start: 0, fixed: true }), M.variable('k', { type: 'Integer' }), disc('c')],
      [M.eq(M.der('x'), E.num(1)), M.eq(M.r('k'), E.call('integer', [M.r('x')]))],
      { whenClauses: [M.when(E.call('change', [M.r('k')]), [M.eq(M.r('c'), M.add(M.pre('c'), E.num(1)))])] },
    );
    const res = simulate(m, opts({ solver, finalTime: 3.5, ncp: 35 }));
    expect(res.stats.completed).toBe(true);
    expect(res.stats.events).toBe(3);
    expect(valueAt(res, 'c', 3.5)).toBe(3);
    expect(valueAt(res, 'k', 0.5)).toBe(0);
    expect(valueAt(res, 'k', 1.5)).toBe(1);
    expect(valueAt(res, 'k', 3.5)).toBe(3);
    const tol = solver === 'Explicit Euler' || solver === 'Implicit Euler' ? 1e-2 : 1e-6;
    for (const te of [1, 2, 3]) {
      const near = res.time.filter((t) => Math.abs(t - te) < tol);
      expect(near.length, `event at t=${te}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('floor/ceil/div/mod/rem generate events at the jumps of their results', () => {
    // der(x) = 1; f = floor(x); g = ceil(x); q = div(x, 1.5); m = mod(x, 1.5); r = rem(x, 1.5)
    const m = M.model(
      'T',
      [
        M.variable('x', { start: 0.1, fixed: true }),
        M.variable('f', { type: 'Integer' }),
        M.variable('g', { type: 'Integer' }),
        M.variable('q', { type: 'Integer' }),
        M.variable('mm'),
        M.variable('rr'),
        disc('nf', 0, 'Integer'),
        disc('nq', 0, 'Integer'),
      ],
      [
        M.eq(M.der('x'), E.num(1)),
        M.eq(M.r('f'), E.call('floor', [M.r('x')])),
        M.eq(M.r('g'), E.call('ceil', [M.r('x')])),
        M.eq(M.r('q'), E.call('div', [M.r('x'), E.num(1.5)])),
        M.eq(M.r('mm'), E.call('mod', [M.r('x'), E.num(1.5)])),
        M.eq(M.r('rr'), E.call('rem', [M.r('x'), E.num(1.5)])),
      ],
      {
        whenClauses: [
          M.when(E.call('change', [M.r('f')]), [M.eq(M.r('nf'), M.add(M.pre('nf'), E.num(1)))]),
          M.when(E.call('change', [M.r('q')]), [M.eq(M.r('nq'), M.add(M.pre('nq'), E.num(1)))]),
        ],
      },
    );
    const res = simulate(m, opts({ solver: 'CVode', finalTime: 3.5, ncp: 35 }));
    expect(res.stats.completed).toBe(true);
    // floor jumps at x = 1, 2, 3 (t = 0.9, 1.9, 2.9); div(x, 1.5) jumps at x = 1.5, 3 (t = 1.4, 2.9).
    expect(valueAt(res, 'nf', 3.5)).toBe(3);
    expect(valueAt(res, 'nq', 3.5)).toBe(2);
    const x = getTrajectory(res, 'x')!.values;
    const f = getTrajectory(res, 'f')!.values;
    const g = getTrajectory(res, 'g')!.values;
    const q = getTrajectory(res, 'q')!.values;
    const mm = getTrajectory(res, 'mm')!.values;
    const rr = getTrajectory(res, 'rr')!.values;
    for (let i = 0; i < res.time.length; i++) {
      // Away from the jump instants the values are the exact functions of x.
      const frac = x[i] - Math.floor(x[i]);
      if (frac < 1e-6 || frac > 1 - 1e-6) continue;
      expect(f[i], `floor at t=${res.time[i]}`).toBe(Math.floor(x[i]));
      expect(g[i], `ceil at t=${res.time[i]}`).toBe(Math.ceil(x[i]));
      const s = x[i] / 1.5;
      if (Math.abs(s - Math.round(s)) < 1e-6) continue;
      expect(q[i], `div at t=${res.time[i]}`).toBe(Math.trunc(s));
      expect(mm[i], `mod at t=${res.time[i]}`).toBeCloseTo(x[i] - Math.floor(s) * 1.5, 9);
      expect(rr[i], `rem at t=${res.time[i]}`).toBeCloseTo(x[i] - Math.trunc(s) * 1.5, 9);
    }
    // Event instants are present (pre/post points) at the jumps of floor.
    for (const te of [0.9, 1.9, 2.9]) expect(res.time.filter((t) => Math.abs(t - te) < 1e-6).length).toBeGreaterThanOrEqual(2);
  });

  it('noEvent(floor(x)) and floor() inside a when-body do not create zero-crossing functions', () => {
    const m = M.model(
      'T',
      [M.variable('x', { start: 0, fixed: true }), M.variable('f'), disc('c')],
      [M.eq(M.der('x'), E.num(1)), M.eq(M.r('f'), E.call('noEvent', [E.call('floor', [M.r('x')])]))],
      { whenClauses: [M.when(E.call('sample', [E.num(0.25), E.num(1)]), [M.eq(M.r('c'), E.call('floor', [M.mul(E.num(4), M.r('x'))]))])] },
    );
    const compiled = compileModel(m, opts({ solver: 'CVode' }));
    expect(compiled.relations.length).toBe(0);
    const res = simulate(m, opts({ solver: 'CVode', finalTime: 2, ncp: 20 }));
    expect(res.stats.events).toBe(2); // samples at 0.25 and 1.25
    expect(valueAt(res, 'c', 0.7)).toBe(1); // floor(4 * 0.25)
    expect(valueAt(res, 'c', 2)).toBe(5); // floor(4 * 1.25)
  });
});

describe('free states for initial equations', () => {
  it('frees the state that the initial equation determines, not the first declared one', () => {
    // der(x) = -x; der(y) = -y; initial equation y = 3  ->  x = start = 0, y = 3
    const m = M.model('T', [M.variable('x', { start: 0 }), M.variable('y', { start: 0 })], [M.eq(M.der('x'), E.neg(M.r('x'))), M.eq(M.der('y'), E.neg(M.r('y')))], {
      initialEquations: [M.eq(M.r('y'), E.num(3), 'T', 'initial')],
    });
    const res = simulate(m, opts({ solver: 'CVode', finalTime: 1, ncp: 10 }));
    expect(valueAt(res, 'x', 0)).toBe(0);
    expect(valueAt(res, 'y', 0)).toBeCloseTo(3, 9);
    expect(valueAt(res, 'y', 1)).toBeCloseTo(3 * Math.exp(-1), 3);
  });

  it('frees a state that an initial equation reaches only through the derivative equations', () => {
    // der(x) = -x + u; der(y) = -y; initial equation der(y) = 0 with y declared last -> y = 0... make it non-trivial:
    // der(y) = -y + 2 -> steady state y = 2; x keeps its start value.
    const m = M.model(
      'T',
      [M.variable('x', { start: 1 }), M.variable('y', { start: 0 })],
      [M.eq(M.der('x'), E.neg(M.r('x'))), M.eq(M.der('y'), M.add(E.neg(M.r('y')), E.num(2)))],
      { initialEquations: [M.eq(M.der('y'), E.num(0), 'T', 'initial')] },
    );
    const res = simulate(m, opts({ solver: 'CVode', finalTime: 1, ncp: 10 }));
    expect(valueAt(res, 'x', 0)).toBe(1);
    expect(valueAt(res, 'y', 0)).toBeCloseTo(2, 9);
  });

  it('prefers fixed=false states and warns about a fixed=false state no initial equation determines', () => {
    const m = M.model(
      'T',
      [M.variable('x', { start: 1, fixed: false }), M.variable('y', { start: 0 }), M.variable('z', { start: 0.5, fixed: false })],
      [M.eq(M.der('x'), E.neg(M.r('x'))), M.eq(M.der('y'), E.neg(M.r('y'))), M.eq(M.der('z'), E.neg(M.r('z')))],
      { initialEquations: [M.eq(M.add(M.r('x'), M.r('y')), E.num(4), 'T', 'initial')] },
    );
    const res = simulate(m, opts({ solver: 'CVode', finalTime: 1, ncp: 10 }));
    expect(valueAt(res, 'x', 0)).toBeCloseTo(4, 9);
    expect(valueAt(res, 'y', 0)).toBe(0);
    expect(valueAt(res, 'z', 0)).toBe(0.5);
    expect(res.log.some((l) => l.level === 'warning' && /'z' has fixed=false/.test(l.message))).toBe(true);
  });

  it('still reports an overdetermined initialization problem', () => {
    const m = M.model('T', [M.variable('x', { start: 0, fixed: true })], [M.eq(M.der('x'), E.num(1))], {
      initialEquations: [M.eq(M.r('x'), E.num(2), 'T', 'initial')],
    });
    expect(() => simulate(m, opts({ solver: 'CVode' }))).toThrow(/overdetermined/);
  });
});
