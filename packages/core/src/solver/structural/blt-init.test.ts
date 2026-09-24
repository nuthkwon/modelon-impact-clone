import { describe, expect, it } from 'vitest';
import { E, ModelicaError } from '../../ast.js';
import { getTrajectory } from '../../simulation.js';
import { simulate } from '../index.js';
import * as M from '../test-models.js';
import { solveScalar } from './blt-init.js';

const opts = { startTime: 0, finalTime: 1, ncp: 10, rtol: 1e-6, solver: 'CVode' as const };

describe('scalar solver', () => {
  it('solves linear residuals in one step', () => {
    let calls = 0;
    const r = solveScalar(
      (x) => {
        calls++;
        return 3 * x - 6;
      },
      0,
      1,
      0,
    );
    expect(r.converged).toBe(true);
    expect(r.x).toBeCloseTo(2, 12);
    expect(calls).toBeLessThanOrEqual(6);
  });

  it('solves nonlinear residuals from poor starting points', () => {
    const r = solveScalar((x) => x * x * x - 8, 0.1, 1, 0);
    expect(r.converged).toBe(true);
    expect(r.x).toBeCloseTo(2, 9);
    const a = solveScalar((x) => Math.atan(x) - 0.5, 10, 1, 0);
    expect(a.converged).toBe(true);
    expect(a.x).toBeCloseTo(Math.tan(0.5), 9);
  });

  it('falls back to bisection when the slope vanishes but a bracket exists', () => {
    // f has zero slope at the start (x^3 at 0 is flat) but the iteration finds a sign change.
    const r = solveScalar((x) => (x - 1) ** 3, 1.0000001, 1, 0);
    expect(r.converged).toBe(true);
    expect(Math.abs(r.x - 1)).toBeLessThan(1e-4);
  });

  it('handles Boolean unknowns with the unit perturbation', () => {
    const r = solveScalar((x) => x - 1, 0, 1, 1);
    expect(r.converged).toBe(true);
    expect(r.x).toBe(1);
  });

  it('gives up on residuals without a root', () => {
    const r = solveScalar((x) => x * x + 1, 1, 1, 0);
    expect(r.converged).toBe(false);
  });
});

describe('block-wise initialisation', () => {
  /**
   * Bilinear equation with both factors starting at 0 that propagation cannot remove:
   * R_actual depends on a time-varying temperature.
   */
  function bilinear() {
    return M.model(
      'T',
      [M.variable('T'), M.variable('R_actual'), M.variable('i'), M.variable('v'), M.variable('P')],
      [
        M.eq(M.r('T'), M.add(M.n(293.15), M.mul(M.n(10), E.call('sin', [M.time])))),
        M.eq(M.r('R_actual'), M.mul(M.n(1000), M.add(M.n(1), M.mul(M.n(0.004), M.sub(M.r('T'), M.n(293.15)))))),
        M.eq(M.r('v'), M.mul(M.r('R_actual'), M.r('i'))),
        M.eq(M.r('v'), M.add(M.n(5), M.time)),
        M.eq(M.r('P'), M.mul(M.r('v'), M.r('i'))),
      ],
    );
  }

  it('initialises a bilinear system at a zero start point where the simultaneous Newton is singular', () => {
    const flat = bilinear();
    const res = simulate(flat, opts);
    expect(res.stats.completed).toBe(true);
    expect(getTrajectory(res, 'i')!.values[0]).toBeCloseTo(0.005, 10);
    expect(getTrajectory(res, 'P')!.values[0]).toBeCloseTo(0.025, 10);
    const i = getTrajectory(res, 'i')!.values;
    for (let k = 0; k < res.time.length; k++) {
      const t = res.time[k];
      const R = 1000 * (1 + 0.004 * 10 * Math.sin(t));
      expect(i[k]).toBeCloseTo((5 + t) / R, 8);
    }
  });

  it('falls back to the simultaneous strategies when a block does not converge', () => {
    // x^2 + 1 = 0 has no solution: block-wise fails, then the fallback reports the residuals.
    const flat = M.model('T', [M.variable('x', { start: 1 }), M.variable('y')], [M.eq(M.add(M.mul(M.r('x'), M.r('x')), M.n(1)), M.n(0), 'T.noRoot'), M.eq(M.r('y'), M.r('x'))]);
    expect(() => simulate(flat, opts)).toThrow(ModelicaError);
    expect(() => simulate(flat, opts)).toThrow(/Initialization failed/);
  });

  it('orders blocks by if-condition dependencies (ideal diode)', () => {
    // v = s*(if off then 1 else Ron); i = s*(if off then Goff else 1); off = s < 0; v = -9 + 0*time
    const flat = M.model(
      'T',
      [M.variable('s', { start: 0 }), M.variable('v'), M.variable('i'), M.variable('off', { type: 'Boolean', variability: 'discrete', start: true }), M.variable('P')],
      [
        M.eq(M.r('v'), M.mul(M.r('s'), M.ifExpr(M.r('off'), M.n(1), M.n(0.1)))),
        M.eq(M.r('i'), M.mul(M.r('s'), M.ifExpr(M.r('off'), M.n(0.1), M.n(1)))),
        M.eq(M.r('off'), M.lt(M.r('s'), M.n(0))),
        M.eq(M.r('v'), M.add(M.n(-9), M.mul(M.n(2), M.time))),
        M.eq(M.r('P'), M.mul(M.r('v'), M.r('i'))),
      ],
    );
    const res = simulate(flat, { ...opts, finalTime: 8, ncp: 80 });
    const s = getTrajectory(res, 's')!.values;
    const v = getTrajectory(res, 'v')!.values;
    const off = getTrajectory(res, 'off')!.values;
    const i = getTrajectory(res, 'i')!.values;
    // Consistent from the very first point (s = v when off, i = 0.1 s).
    expect(off[0]).toBe(1);
    expect(s[0]).toBeCloseTo(-9, 9);
    expect(i[0]).toBeCloseTo(-0.9, 9);
    for (let k = 0; k < res.time.length; k++) {
      const isOff = off[k] >= 0.5;
      expect(v[k]).toBeCloseTo(s[k] * (isOff ? 1 : 0.1), 8);
      expect(i[k]).toBeCloseTo(s[k] * (isOff ? 0.1 : 1), 8);
    }
    expect(res.stats.events).toBeGreaterThanOrEqual(1);
  });

  it('orders blocks by pre() of continuous variables (pre(x) = x at initialisation)', () => {
    // y = pre(x) + 1 must be solved after x = sin(time) + 2, otherwise y(0) is computed from the start value of x.
    const flat = M.model('T', [M.variable('y'), M.variable('x')], [M.eq(M.r('y'), M.add(M.pre('x'), M.n(1))), M.eq(M.r('x'), M.add(E.call('sin', [M.time]), M.n(2)))]);
    const res = simulate(flat, opts);
    expect(res.log.some((l) => /block-wise solve failed/.test(l.message))).toBe(false);
    const x = getTrajectory(res, 'x')!.values;
    const y = getTrajectory(res, 'y')!.values;
    expect(x[0]).toBeCloseTo(2, 12);
    expect(y[0]).toBeCloseTo(3, 12);
    for (let k = 0; k < res.time.length; k++) expect(y[k]).toBeCloseTo(x[k] + 1, 9);
  });

  it('falls back to the simultaneous solve when an equation changes after its block was solved (hidden dependency)', () => {
    // edge(b) reads the current value of b but is structurally opaque: y = if edge(b) ... may be ordered before b.
    const flat = M.model(
      'T',
      [M.variable('y'), M.variable('b', { type: 'Boolean', variability: 'discrete', start: false })],
      [M.eq(M.r('y'), M.ifExpr(E.call('edge', [M.r('b')]), M.n(1), M.n(0))), M.eq(M.r('b'), M.gt(M.time, M.n(-1)))],
    );
    const res = simulate(flat, opts);
    expect(res.log.some((l) => /block-wise solve failed \(equation 'y = if edge\(b\) then 1 else 0 \[Test\]' changed after its block was solved/.test(l.message))).toBe(true);
    expect(getTrajectory(res, 'b')!.values[0]).toBe(1);
    expect(getTrajectory(res, 'y')!.values[0]).toBe(1);
  });
});
