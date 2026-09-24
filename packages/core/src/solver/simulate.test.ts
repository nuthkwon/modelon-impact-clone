import { describe, expect, it } from 'vitest';
import { E, ModelicaError } from '../ast.js';
import { getTrajectory, type SimulationOptions, type SimulationResult, type SolverName } from '../simulation.js';
import { compileModel } from './compile.js';
import { simulate } from './index.js';
import * as M from './test-models.js';

const ALL_SOLVERS: SolverName[] = ['CVode', 'Radau5', 'Implicit Euler', 'Explicit Euler', 'Runge-Kutta'];
const VARIABLE_STEP: SolverName[] = ['CVode', 'Radau5'];

function opts(partial: Partial<SimulationOptions> & { solver: SolverName }): SimulationOptions {
  return { startTime: 0, finalTime: 1, ncp: 500, rtol: 1e-6, ...partial };
}

function maxError(res: SimulationResult, name: string, exact: (t: number) => number, from = 0): number {
  const tr = getTrajectory(res, name);
  if (!tr) throw new Error(`no trajectory ${name}`);
  let m = 0;
  for (let i = 0; i < res.time.length; i++) {
    if (res.time[i] < from) continue;
    m = Math.max(m, Math.abs(tr.values[i] - exact(res.time[i])));
  }
  return m;
}

function valueAt(res: SimulationResult, name: string, t: number): number {
  const tr = getTrajectory(res, name)!;
  // last point with time <= t
  let idx = 0;
  for (let i = 0; i < res.time.length; i++) if (res.time[i] <= t + 1e-12) idx = i;
  return tr.values[idx];
}

describe('RC circuit (DAE with connect equations)', () => {
  const R = 100;
  const C = 1e-3;
  const V = 1;
  const exact = (t: number) => V * (1 - Math.exp(-t / (R * C)));

  it.each(ALL_SOLVERS)('%s matches 1 - exp(-t/RC)', (solver) => {
    const res = simulate(M.rcCircuit(R, C, V), opts({ solver, finalTime: 0.5, ncp: 500, rtol: 1e-6 }));
    expect(res.stats.completed).toBe(true);
    expect(res.time.length).toBe(501);
    expect(res.time[0]).toBe(0);
    expect(res.time[res.time.length - 1]).toBeCloseTo(0.5, 12);
    const err = maxError(res, 'capacitor.v', exact);
    const tol = solver === 'Explicit Euler' || solver === 'Implicit Euler' ? 3e-3 : 1e-4;
    expect(err).toBeLessThan(tol);
    // Kirchhoff: source current equals minus the capacitor current, resistor.v + capacitor.v = V
    const iSrc = getTrajectory(res, 'source.i')!.values;
    const iCap = getTrajectory(res, 'capacitor.i')!.values;
    const vRes = getTrajectory(res, 'resistor.v')!.values;
    const vCap = getTrajectory(res, 'capacitor.v')!.values;
    for (let i = 0; i < res.time.length; i += 50) {
      expect(iSrc[i] + iCap[i]).toBeCloseTo(0, 9);
      expect(vRes[i] + vCap[i]).toBeCloseTo(V, 9);
    }
  });

  it('produces trajectories for every variable with metadata, derivatives and parameters', () => {
    const res = simulate(M.rcCircuit(R, C, V), opts({ solver: 'CVode', finalTime: 0.1, ncp: 10 }));
    const cap = getTrajectory(res, 'capacitor.v')!;
    expect(cap.kind).toBe('continuous');
    expect(cap.unit).toBe('V');
    expect(cap.description).toMatch(/Voltage drop/);
    const der = getTrajectory(res, 'der(capacitor.v)')!;
    expect(der.kind).toBe('derivative');
    expect(der.values.length).toBe(res.time.length);
    expect(der.values[0]).toBeCloseTo(V / (R * C), 6);
    const p = getTrajectory(res, 'resistor.R')!;
    expect(p.kind).toBe('parameter');
    expect(p.values).toEqual([R]);
    expect(p.unit).toBe('Ohm');
    const flat = M.rcCircuit(R, C, V);
    for (const v of flat.variables) expect(getTrajectory(res, v.name), v.name).toBeDefined();
    expect(res.className).toBe('Examples.RC');
    expect(res.stats.steps).toBeGreaterThan(0);
    expect(res.stats.jacobianEvaluations).toBeGreaterThan(0);
    expect(res.stats.newtonIterations).toBeGreaterThan(0);
    expect(res.stats.cpuTimeMs).toBeGreaterThanOrEqual(0);
    expect(res.log.some((l) => l.source === 'simulation' && l.level === 'info')).toBe(true);
  });

  it('applies parameter modifiers by name', () => {
    const res = simulate(M.rcCircuit(R, C, V), opts({ solver: 'CVode', finalTime: 0.5, modifiers: { 'resistor.R': 50, 'source.V': '2' } }));
    const err = maxError(res, 'capacitor.v', (t) => 2 * (1 - Math.exp(-t / (50 * C))));
    expect(err).toBeLessThan(2e-4);
    expect(getTrajectory(res, 'resistor.R')!.values).toEqual([50]);
    expect(getTrajectory(res, 'source.V')!.values).toEqual([2]);
  });

  it('warns about modifiers that do not name a parameter', () => {
    const res = simulate(M.rcCircuit(R, C, V), opts({ solver: 'CVode', finalTime: 0.1, ncp: 5, modifiers: { nonsense: 1 } }));
    expect(res.log.some((l) => l.level === 'warning' && /nonsense/.test(l.message))).toBe(true);
  });

  it('reuses the Jacobian across steps for a linear model', () => {
    const res = simulate(M.rcCircuit(R, C, V), opts({ solver: 'CVode', finalTime: 0.5, ncp: 100 }));
    expect(res.stats.jacobianEvaluations).toBeLessThan(res.stats.steps / 3);
    expect(res.stats.newtonIterations).toBeLessThan(res.stats.steps * 12);
  });
});

describe('mass-spring-damper', () => {
  const m = 1;
  const k = 10;
  const d = 0.5;
  const x0 = 1;
  const exact = M.massSpringDamperAnalytic(m, k, d, x0);

  it.each(ALL_SOLVERS)('%s follows the damped oscillation', (solver) => {
    const res = simulate(M.massSpringDamper(m, k, d, x0), opts({ solver, finalTime: 10, ncp: 1000, rtol: 1e-6 }));
    const err = maxError(res, 'x', exact);
    const tol = solver === 'Explicit Euler' || solver === 'Implicit Euler' ? 0.1 : 1e-3;
    expect(err).toBeLessThan(tol);
    // Energy-consistent force: f = -k x - d v at every point.
    const x = getTrajectory(res, 'x')!.values;
    const v = getTrajectory(res, 'v')!.values;
    const f = getTrajectory(res, 'f')!.values;
    for (let i = 0; i < res.time.length; i += 97) expect(f[i]).toBeCloseTo(-k * x[i] - d * v[i], 8);
  });

  it('RK4 with a fine fixed step is very accurate', () => {
    const res = simulate(M.massSpringDamper(m, k, d, x0), opts({ solver: 'Runge-Kutta', finalTime: 10, ncp: 1000, stepSize: 0.01 }));
    expect(maxError(res, 'x', exact)).toBeLessThan(1e-6);
    expect(res.stats.steps).toBe(1000);
  });
});

describe('Van der Pol (stiff, mu = 1000)', () => {
  it.each(VARIABLE_STEP)('%s completes with a moderate number of steps', (solver) => {
    const res = simulate(M.vanDerPol(1000), opts({ solver, finalTime: 3000, ncp: 500, rtol: 1e-4 }));
    expect(res.stats.completed).toBe(true);
    expect(res.stats.steps).toBeLessThan(20000);
    expect(res.time.length).toBe(501);
    const x = getTrajectory(res, 'x')!.values;
    // The relaxation oscillation stays within the classic limit cycle bounds.
    for (const xi of x) expect(Math.abs(xi)).toBeLessThan(2.05);
    // Stiff phases: the solution sits near |x| ~ 2 -> 1 for most of the time.
    expect(Math.abs(x[x.length - 1])).toBeGreaterThan(1);
    expect(res.stats.rejectedSteps).toBeLessThan(res.stats.steps);
  });

  it('CVode at rtol 1e-6 agrees with Radau5 (trapezoidal) at the final time', () => {
    const a = simulate(M.vanDerPol(1000), opts({ solver: 'CVode', finalTime: 3000, ncp: 10, rtol: 1e-6 }));
    const b = simulate(M.vanDerPol(1000), opts({ solver: 'Radau5', finalTime: 3000, ncp: 10, rtol: 1e-6 }));
    const xa = getTrajectory(a, 'x')!.values;
    const xb = getTrajectory(b, 'x')!.values;
    expect(Math.abs(xa[xa.length - 1] - xb[xb.length - 1])).toBeLessThan(2e-3);
  });
});

describe('bouncing ball (when / reinit / pre)', () => {
  it.each(ALL_SOLVERS)('%s bounces at least 5 times in 3 s and never penetrates the floor', (solver) => {
    const res = simulate(M.bouncingBall(0.8, 1), opts({ solver, finalTime: 3, ncp: 300, rtol: 1e-6 }));
    expect(res.stats.completed).toBe(true);
    expect(res.stats.events).toBeGreaterThanOrEqual(5);
    const h = getTrajectory(res, 'h')!.values;
    const v = getTrajectory(res, 'v')!.values;
    for (const hi of h) expect(hi).toBeGreaterThan(-1e-3);
    // Event points are duplicated in time: the pre-event and post-event velocities differ by -e.
    let bounces = 0;
    for (let i = 1; i < res.time.length; i++) {
      if (res.time[i] === res.time[i - 1] && Math.abs(v[i] - v[i - 1]) > 1e-6) {
        bounces++;
        expect(v[i]).toBeCloseTo(-0.8 * v[i - 1], 6);
        expect(v[i - 1]).toBeLessThan(0);
      }
    }
    expect(bounces).toBeGreaterThanOrEqual(5);
    // First impact at sqrt(2 h0 / g); the first-order Euler schemes carry an O(h) trajectory error.
    const tImpact = Math.sqrt(2 / 9.81);
    const eventTimes = res.time.filter((t, i) => i > 0 && res.time[i - 1] === t);
    const impactTol = solver === 'Explicit Euler' || solver === 'Implicit Euler' ? 1e-2 : 1e-4;
    expect(Math.min(...eventTimes.map((t) => Math.abs(t - tImpact)))).toBeLessThan(impactTol);
  });

  it('a Zeno sequence (e = 0.7) terminates and the simulation completes', () => {
    const res = simulate(M.bouncingBall(0.7, 1), opts({ solver: 'CVode', finalTime: 3, ncp: 100 }));
    expect(res.stats.completed).toBe(true);
    expect(res.stats.events).toBeGreaterThan(10);
  });
});

describe('algebraic models (no states)', () => {
  it.each(ALL_SOLVERS)('%s evaluates y = sin(time), z = 2y + 1 exactly at the output points', (solver) => {
    const res = simulate(M.algebraicModel(), opts({ solver, finalTime: 6, ncp: 100 }));
    expect(res.time.length).toBe(101);
    expect(maxError(res, 'y', Math.sin)).toBeLessThan(1e-9);
    expect(maxError(res, 'z', (t) => 2 * Math.sin(t) + 1)).toBeLessThan(1e-9);
  });

  it('solves the parallel-resistor algebraic loop', () => {
    const res = simulate(M.parallelResistors(10, 100, 200), opts({ solver: 'CVode', finalTime: 1, ncp: 10 }));
    expect(res.time.length).toBe(11);
    const check = (name: string, value: number) => {
      for (const x of getTrajectory(res, name)!.values) expect(x).toBeCloseTo(value, 9);
    };
    check('r1.i', 0.1);
    check('r2.i', 0.05);
    check('source.i', -0.15);
    check('r1.v', 10);
    check('ground.p.i', 0);
  });

  it('solves a nonlinear algebraic loop by Newton at every point', () => {
    const res = simulate(M.nonlinearAlgebraic(), opts({ solver: 'CVode', finalTime: 2, ncp: 20 }));
    const x = getTrajectory(res, 'x')!.values;
    const y = getTrajectory(res, 'y')!.values;
    for (let i = 0; i < res.time.length; i++) {
      const t = res.time[i];
      expect(x[i] * x[i] + y[i] - 3 - t).toBeCloseTo(0, 6);
      expect(x[i] - y[i] - t + 1).toBeCloseTo(0, 6);
    }
  });
});

describe('structural checks', () => {
  it('throws a ModelicaError with the counts for an unbalanced model', () => {
    const run = () => simulate(M.unbalanced(), opts({ solver: 'CVode' }));
    expect(run).toThrow(ModelicaError);
    expect(run).toThrow(/not balanced: 1 equation, 2 variables/);
    try {
      run();
    } catch (e) {
      const err = e as ModelicaError;
      expect(err.message).toMatch(/Variables \(2\):[\s\S]*x \(state\)[\s\S]*y/);
      expect(err.message).toMatch(/Equations \(1\):[\s\S]*der\(x\) = y/);
      expect(err.diagnostics[0].code).toBe('unbalanced');
    }
  });

  it('counts when-assigned discrete variables as equations', () => {
    const compiled = compileModel(M.sampleCounter(), opts({ solver: 'CVode' }));
    expect(compiled.nS).toBe(1);
    expect(compiled.nA).toBe(1);
    expect(compiled.nD).toBe(1);
    expect(compiled.unknowns.map((u) => u.name)).toEqual(['x', 'y', 'count']);
    expect(compiled.samplers.length).toBe(1);
  });

  it('rejects unsupported constructs with clear messages', () => {
    const arr = M.model('T', [M.variable('x')], [M.eq(M.r('x'), E.array([E.num(1)]))]);
    expect(() => simulate(arr, opts({ solver: 'CVode' }))).toThrow(/Array expressions are not supported/);
    const unknownVar = M.model('T', [M.variable('x')], [M.eq(M.r('x'), M.r('nope'))]);
    expect(() => simulate(unknownVar, opts({ solver: 'CVode' }))).toThrow(/Unknown variable 'nope'/);
    const badWhen = M.model('T', [M.variable('x', { start: 0 })], [M.eq(M.der('x'), E.num(1))], {
      whenClauses: [M.when(M.gt(M.time, E.num(0.5)), [M.eq(M.r('x'), E.num(0))])],
    });
    expect(() => simulate(badWhen, opts({ solver: 'CVode' }))).toThrow(/use reinit/);
  });

  it('names the equation when a residual becomes NaN', () => {
    const bad = M.model('T', [M.variable('x', { start: 1, fixed: true }), M.variable('y')], [
      M.eq(M.der('x'), E.num(-1)),
      M.eq(M.r('y'), E.call('sqrt', [M.r('x')]), 'T.y'),
    ]);
    // x becomes negative after t = 1 -> sqrt(x) = NaN
    expect(() => simulate(bad, opts({ solver: 'CVode', finalTime: 3 }))).toThrow(/y = sqrt\(x\)[\s\S]*NaN/);
  });

  it('explicit solvers report when the derivatives cannot be solved explicitly', () => {
    // der(x) appears only through an algebraic constraint with a singular structure:
    // x + y = 1 and der(x) + der(x) - 2 der(x) = 0 (derivative cancels) -> singular Jacobian
    const m = M.model('T', [M.variable('x', { start: 0 }), M.variable('y')], [
      M.eq(M.add(M.r('x'), M.r('y')), E.num(1)),
      M.eq(M.sub(M.add(M.der('x'), M.der('x')), M.mul(E.num(2), M.der('x'))), E.num(0)),
    ]);
    expect(() => simulate(m, opts({ solver: 'Runge-Kutta', ncp: 10 }))).toThrow(/implicit solver|singular/);
  });
});

describe('events', () => {
  it.each(ALL_SOLVERS)('%s locates the if-expression switch at t = 0.5 sharply', (solver) => {
    const res = simulate(M.ifSwitch(), opts({ solver, finalTime: 1, ncp: 100 }));
    const near = res.time.filter((t) => Math.abs(t - 0.5) < 1e-6);
    expect(near.length).toBeGreaterThanOrEqual(2);
    expect(res.stats.events).toBeGreaterThanOrEqual(1);
    const y = getTrajectory(res, 'y')!.values;
    const z = getTrajectory(res, 'z')!.values;
    for (let i = 0; i < res.time.length; i++) {
      const t = res.time[i];
      if (t < 0.5 - 1e-6) {
        expect(y[i]).toBe(0);
        expect(z[i]).toBe(0);
      } else if (t > 0.5 + 1e-6) {
        expect(y[i]).toBe(1);
        expect(z[i]).toBe(2);
      }
    }
    // Before/after values are both present at the event time.
    const idx = res.time.findIndex((t) => Math.abs(t - 0.5) < 1e-6);
    expect(y[idx]).toBe(0);
    expect(y[idx + near.length - 1]).toBe(1);
  });

  it.each(ALL_SOLVERS)('%s fires sample() time events and updates the discrete counter', (solver) => {
    const res = simulate(M.sampleCounter(0.25, 0.25), opts({ solver, finalTime: 1, ncp: 20 }));
    expect(res.stats.events).toBe(4);
    const count = getTrajectory(res, 'count')!;
    expect(count.kind).toBe('discrete');
    expect(valueAt(res, 'count', 0.1)).toBe(0);
    expect(valueAt(res, 'count', 0.3)).toBe(1);
    expect(valueAt(res, 'count', 0.6)).toBe(2);
    expect(valueAt(res, 'count', 0.9)).toBe(3);
    expect(count.values[count.values.length - 1]).toBe(4);
    // Event times are recorded twice (pre and post).
    const eventTimes = res.time.filter((t, i) => i > 0 && res.time[i - 1] === t);
    expect(eventTimes.map((t) => Number(t.toFixed(9)))).toEqual([0.25, 0.5, 0.75, 1]);
    // y = x + count is consistent with the held discrete value.
    const y = getTrajectory(res, 'y')!.values;
    const x = getTrajectory(res, 'x')!.values;
    for (let i = 0; i < res.time.length; i++) expect(y[i]).toBeCloseTo(x[i] + count.values[i], 9);
  });

  it('handles a purely discrete model (no continuous unknowns)', () => {
    const res = simulate(M.pureDiscreteCounter(0.1), opts({ solver: 'CVode', finalTime: 1, ncp: 10 }));
    expect(res.stats.completed).toBe(true);
    expect(res.stats.events).toBe(11); // t = 0, 0.1, ..., 1.0
    const c = getTrajectory(res, 'count')!.values;
    expect(c[c.length - 1]).toBe(11);
  });

  it('fires when initial() during initialisation and edge() on Boolean algebraics', () => {
    // b = x > 0.5 (Boolean algebraic); when edge(b) then n = pre(n) + 10; when initial() then n = 5.
    const m = M.model(
      'T',
      [
        M.variable('x', { start: 0, fixed: true }),
        M.variable('b', { type: 'Boolean', variability: 'discrete', start: false }),
        M.variable('n', { type: 'Integer', variability: 'discrete', start: 0 }),
      ],
      [M.eq(M.der('x'), E.num(1)), M.eq(M.r('b'), M.gt(M.r('x'), E.num(0.5)))],
      {
        whenClauses: [
          M.when(E.call('initial'), [M.eq(M.r('n'), E.num(5))]),
          M.when(E.call('edge', [M.r('b')]), [M.eq(M.r('n'), M.add(M.pre('n'), E.num(10)))]),
        ],
      },
    );
    const res = simulate(m, opts({ solver: 'CVode', finalTime: 1, ncp: 10 }));
    expect(valueAt(res, 'n', 0)).toBe(5);
    expect(valueAt(res, 'n', 0.4)).toBe(5);
    expect(valueAt(res, 'n', 0.6)).toBe(15);
    expect(valueAt(res, 'n', 1)).toBe(15);
    expect(valueAt(res, 'b', 0.4)).toBe(0);
    expect(valueAt(res, 'b', 0.6)).toBe(1);
    expect(res.stats.events).toBe(1);
    const near = res.time.filter((t) => Math.abs(t - 0.5) < 1e-6);
    expect(near.length).toBe(2);
  });

  it('supports hysteresis with a Boolean algebraic variable and pre()', () => {
    const res = simulate(M.hysteresis(), opts({ solver: 'CVode', finalTime: 7, ncp: 700 }));
    const on = getTrajectory(res, 'on')!;
    expect(on.kind).toBe('discrete');
    expect(valueAt(res, 'on', 0.3)).toBe(0);
    expect(valueAt(res, 'on', 1)).toBe(1); // x = 2 sin t > 1 after t = pi/6
    expect(valueAt(res, 'on', 3)).toBe(1); // between 1 and -1: hold
    expect(valueAt(res, 'on', 4)).toBe(0); // x < -1 after t = 7pi/6 = 3.665
    expect(valueAt(res, 'on', 6)).toBe(0);
    expect(valueAt(res, 'on', 6.9)).toBe(1); // 2pi + pi/6 = 6.807
    const y = getTrajectory(res, 'y')!.values;
    for (let i = 0; i < res.time.length; i++) expect(y[i]).toBe(on.values[i]);
    expect(res.stats.events).toBe(5);
  });
});

describe('initialisation', () => {
  it('uses initial equations to determine a free state (steady state)', () => {
    const res = simulate(M.steadyStateInit(3), opts({ solver: 'CVode', finalTime: 1, ncp: 10 }));
    const x = getTrajectory(res, 'x')!.values;
    expect(x[0]).toBeCloseTo(3, 9);
    for (const xi of x) expect(xi).toBeCloseTo(3, 6);
    expect(getTrajectory(res, 'der(x)')!.values[0]).toBeCloseTo(0, 9);
  });

  it('reports an overdetermined initialisation problem', () => {
    const m = M.model('T', [M.variable('x', { start: 0, fixed: true })], [M.eq(M.der('x'), E.num(1))], {
      initialEquations: [M.eq(M.r('x'), E.num(2), 'T', 'initial')],
    });
    expect(() => simulate(m, opts({ solver: 'CVode' }))).toThrow(/overdetermined/);
  });

  it('reports initialisation failures with the largest residuals', () => {
    // x^2 + 1 = 0 has no real solution.
    const m = M.model('T', [M.variable('x', { start: 1 })], [M.eq(M.add(M.mul(M.r('x'), M.r('x')), E.num(1)), E.num(0), 'T.noRoot')]);
    expect(() => simulate(m, opts({ solver: 'CVode' }))).toThrow(/Initialization failed[\s\S]*x \* x \+ 1 = 0/);
  });

  it('solves a nonlinear initial system from poor start values (homotopy fallback)', () => {
    // atan(y) = 0.5 with start 10 (undamped Newton diverges); x integrates y.
    const m = M.model('T', [M.variable('x', { start: 0, fixed: true }), M.variable('y', { start: 10 })], [
      M.eq(M.der('x'), M.r('y')),
      M.eq(E.call('atan', [M.r('y')]), E.num(0.5)),
    ]);
    const res = simulate(m, opts({ solver: 'CVode', finalTime: 1, ncp: 10 }));
    expect(getTrajectory(res, 'y')!.values[0]).toBeCloseTo(Math.tan(0.5), 8);
  });
});

describe('output and hooks', () => {
  it('ncp = 0 records every accepted step', () => {
    const res = simulate(M.massSpringDamper(), opts({ solver: 'CVode', finalTime: 2, ncp: 0 }));
    expect(res.time.length).toBe(res.stats.steps + 1);
    for (let i = 1; i < res.time.length; i++) expect(res.time[i]).toBeGreaterThan(res.time[i - 1]);
    expect(res.time[res.time.length - 1]).toBeCloseTo(2, 12);
  });

  it('calls onProgress and stops when it returns false', () => {
    const progress: number[] = [];
    const res = simulate(M.massSpringDamper(), opts({ solver: 'CVode', finalTime: 10, ncp: 100 }), {
      onProgress(p) {
        progress.push(p);
        return p < 0.5;
      },
    });
    expect(res.stats.completed).toBe(false);
    expect(res.log.some((l) => l.message === 'Simulation cancelled')).toBe(true);
    expect(res.time[res.time.length - 1]).toBeLessThan(6);
    expect(progress.length).toBeGreaterThan(5);
    expect(progress[0]).toBe(0);
  });

  it('forwards log messages to onLog and result.log', () => {
    const messages: string[] = [];
    const res = simulate(M.rcCircuit(), opts({ solver: 'CVode', finalTime: 0.1, ncp: 5 }), { onLog: (_l, m) => void messages.push(m) });
    expect(messages.length).toBe(res.log.length);
    expect(messages.some((m) => /Simulating Examples.RC with CVode/.test(m))).toBe(true);
  });

  it('warns once when a variable leaves its min/max range', () => {
    const m = M.model('T', [M.variable('x', { start: 0, fixed: true, max: 0.5 })], [M.eq(M.der('x'), E.num(1))]);
    const res = simulate(m, opts({ solver: 'CVode', finalTime: 1, ncp: 10 }));
    const warnings = res.log.filter((l) => l.level === 'warning' && /above its max/.test(l.message));
    expect(warnings.length).toBe(1);
  });

  it('handles finalTime == startTime', () => {
    const res = simulate(M.massSpringDamper(), opts({ solver: 'CVode', finalTime: 0, ncp: 10 }));
    expect(res.time).toEqual([0]);
    expect(res.stats.completed).toBe(true);
  });

  it('honours a non-zero start time', () => {
    const res = simulate(M.algebraicModel(), opts({ solver: 'Radau5', startTime: 2, finalTime: 4, ncp: 20 }));
    expect(res.time[0]).toBe(2);
    expect(res.time[res.time.length - 1]).toBeCloseTo(4, 12);
    expect(maxError(res, 'y', Math.sin)).toBeLessThan(1e-9);
  });
});
