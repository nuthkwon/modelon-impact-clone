import { describe, expect, it } from 'vitest';
import { E } from '../../ast.js';
import type { FlatModel } from '../../flat.js';
import { getTrajectory } from '../../simulation.js';
import { createParameterEnvironment } from '../compile.js';
import { simulate } from '../index.js';
import * as M from '../test-models.js';
import { createWorkingModel, type WorkingModel } from './model.js';
import { detectPropagations, propagateKnownVariables } from './propagate.js';

function working(flat: FlatModel): WorkingModel {
  return createWorkingModel(flat, createParameterEnvironment(flat, {}).env);
}

const opts = { startTime: 0, finalTime: 1, ncp: 10, rtol: 1e-6, solver: 'CVode' as const };

/** The shipped Resistor's temperature-dependent resistance as flat equations. */
function resistorModel(alpha = 0.004): FlatModel {
  return M.model(
    'T',
    [
      M.param('R', 1000),
      M.param('alpha', alpha),
      M.param('T', 293.15),
      M.param('T_ref', 300.15),
      M.variable('T_heatPort', { start: 288.15 }),
      M.variable('R_actual'),
      M.variable('i'),
      M.variable('v'),
      M.variable('P'),
    ],
    [
      M.eq(M.r('T_heatPort'), M.r('T')),
      M.eq(M.r('R_actual'), M.mul(M.r('R'), M.add(M.n(1), M.mul(M.r('alpha'), M.sub(M.r('T_heatPort'), M.r('T_ref')))))),
      M.eq(M.r('v'), M.mul(M.r('R_actual'), M.r('i'))),
      M.eq(M.r('v'), M.mul(M.n(5), E.call('sin', [M.time]))),
      M.eq(M.r('P'), M.mul(M.r('v'), M.r('i'))),
    ],
  );
}

describe('known-variable propagation', () => {
  it('propagates the chain T_heatPort = T, R_actual = R*(1 + alpha*(T_heatPort - T_ref))', () => {
    const wm = working(resistorModel());
    // Only T_heatPort can be propagated at first; R_actual follows in the next round.
    expect(detectPropagations(wm).map((p) => p.name)).toEqual(['T_heatPort']);
    expect(propagateKnownVariables(wm)).toBe(2);
    expect(wm.constants.get('T_heatPort')).toBe(293.15);
    expect(wm.constants.get('R_actual')).toBeCloseTo(1000 * (1 + 0.004 * (293.15 - 300.15)), 9);
    const byName = new Map(wm.flat.variables.map((v) => [v.name, v]));
    expect(byName.get('R_actual')!.variability).toBe('constant');
    expect(byName.get('R_actual')!.value).toBe(wm.constants.get('R_actual'));
    expect(wm.flat.equations.length).toBe(3);
    // i, v, P stay unknowns: v depends on time, i and P depend on other unknowns.
    expect(wm.isUnknown('i') && wm.isUnknown('v') && wm.isUnknown('P')).toBe(true);
  });

  it('handles the coefficient forms c*x = f, x*c = f, x + g = 0 and x/c = f', () => {
    const flat = M.model(
      'T',
      [M.param('c', 4), M.param('g', 2), M.variable('a'), M.variable('b'), M.variable('d'), M.variable('f')],
      [
        M.eq(M.mul(M.r('c'), M.r('a')), M.n(8)),
        M.eq(M.mul(M.r('b'), M.r('c')), M.add(M.r('g'), M.n(6))),
        M.eq(M.add(M.r('d'), M.r('g')), M.n(0)),
        M.eq(M.div(M.r('f'), M.r('c')), M.mul(M.r('g'), M.r('g'))),
      ],
    );
    const wm = working(flat);
    expect(propagateKnownVariables(wm)).toBe(4);
    expect(wm.constants.get('a')).toBe(2);
    expect(wm.constants.get('b')).toBe(2);
    expect(wm.constants.get('d')).toBe(-2);
    expect(wm.constants.get('f')).toBe(16);
  });

  it('never propagates states, when-assigned discretes or variables with non-constant equations', () => {
    const flat = M.model(
      'T',
      [
        M.variable('x', { start: 1 }),
        M.variable('count', { type: 'Integer', variability: 'discrete', start: 0 }),
        M.variable('y'),
        M.variable('z'),
      ],
      [M.eq(M.r('x'), M.n(5)), M.eq(M.der('x'), M.n(1)), M.eq(M.r('y'), M.add(M.r('count'), M.n(1))), M.eq(M.r('z'), M.mul(M.n(2), M.time))],
      { whenClauses: [M.when(E.call('sample', [M.n(0.1), M.n(0.1)]), [M.eq(M.r('count'), M.add(M.pre('count'), M.n(1)))])] },
    );
    const wm = working(flat);
    expect(detectPropagations(wm)).toEqual([]);
    expect(propagateKnownVariables(wm)).toBe(0);
  });

  it('propagates Boolean and Integer constants', () => {
    const flat = M.model(
      'T',
      [M.param('p', true), M.variable('b', { type: 'Boolean', variability: 'discrete' }), M.variable('n', { type: 'Integer' }), M.variable('x')],
      [M.eq(M.r('b'), E.bin('and', M.r('p'), E.bool(true))), M.eq(M.n(3), M.r('n')), M.eq(M.r('x'), M.ifExpr(M.r('b'), M.mul(M.r('n'), M.time), M.n(0)))],
    );
    const wm = working(flat);
    expect(propagateKnownVariables(wm)).toBe(2);
    expect(wm.constants.get('b')).toBe(true);
    expect(wm.constants.get('n')).toBe(3);
    const res = simulate(flat, opts);
    expect(getTrajectory(res, 'b')!.kind).toBe('constant');
    expect(getTrajectory(res, 'b')!.values).toEqual([1]);
    expect(getTrajectory(res, 'x')!.values.at(-1)).toBeCloseTo(3, 9);
  });

  it('uses simulation modifiers when evaluating propagated values', () => {
    const res = simulate(resistorModel(0), { ...opts, modifiers: { R: 250 } });
    expect(getTrajectory(res, 'R_actual')!.values).toEqual([250]);
    const i = getTrajectory(res, 'i')!.values;
    for (let k = 0; k < res.time.length; k++) expect(i[k]).toBeCloseTo((5 * Math.sin(res.time[k])) / 250, 9);
  });

  it('reports propagated variables as constant trajectories and in the stats/log', () => {
    const res = simulate(resistorModel(), opts);
    expect(res.stats.propagated).toBe(2);
    const rActual = getTrajectory(res, 'R_actual')!;
    expect(rActual.kind).toBe('constant');
    expect(rActual.values).toHaveLength(1);
    expect(rActual.values[0]).toBeCloseTo(1000 * (1 + 0.004 * (293.15 - 300.15)), 9);
    expect(getTrajectory(res, 'T_heatPort')!.values).toEqual([293.15]);
    expect(res.log.some((l) => /2 variables propagated/.test(l.message))).toBe(true);
    // Every original variable is still in the result, in declaration order.
    expect(res.trajectories.map((t) => t.name)).toEqual(['R', 'alpha', 'T', 'T_ref', 'T_heatPort', 'R_actual', 'i', 'v', 'P']);
  });
});
