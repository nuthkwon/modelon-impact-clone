import { describe, expect, it } from 'vitest';
import { E, ModelicaError, type Expr } from '../../ast.js';
import { formatExpr, tryEvaluateConstant, type EvalEnv } from '../../flatten/evaluate.js';
import * as M from '../test-models.js';
import { differentiate, type DifferentiationContext } from './differentiate.js';
import { evalNumeric } from './expr.js';

const env: EvalEnv = { lookup: (name) => (name === 'p' ? 3 : name === 'q' ? 0.5 : undefined) };
const ctx: DifferentiationContext = {
  classify(name) {
    if (name === 'p' || name === 'q') return 'constant';
    if (name === 'x' || name === 'y') return 'real';
    if (name === 'b') return 'nonreal';
    return 'unknown-name';
  },
  constantValue(e) {
    const c = tryEvaluateConstant(e, env);
    return typeof c === 'number' ? c : undefined;
  },
};

/** Deterministic pseudo-random numbers. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * Checks d/dt f(x(t), y(t), t) against a central difference along quadratic trajectories
 * x(t) = x0 + x1 t + x2 t^2 (so that der(der(x)) = 2 x2 is exact).
 */
function checkDerivative(f: Expr, samples = 5, tol = 1e-5): void {
  const df = differentiate(f, ctx);
  const rand = rng(f.kind.length * 31 + formatExpr(f).length);
  for (let k = 0; k < samples; k++) {
    const x = [0.6 + rand() * 1.2, -1 + 2 * rand(), -1 + 2 * rand()];
    const y = [0.6 + rand() * 1.2, -1 + 2 * rand(), -1 + 2 * rand()];
    const t = 0.1 + rand();
    const at = (tau: number) => ({
      time: tau,
      env,
      value(base: string, order: number): number | undefined {
        const c = base === 'x' ? x : base === 'y' ? y : undefined;
        if (!c) return undefined;
        if (order === 0) return c[0] + c[1] * (tau - t) + c[2] * (tau - t) ** 2;
        if (order === 1) return c[1] + 2 * c[2] * (tau - t);
        if (order === 2) return 2 * c[2];
        return 0;
      },
    });
    const h = 1e-5;
    const numeric = (evalNumeric(f, at(t + h)) - evalNumeric(f, at(t - h))) / (2 * h);
    const symbolic = evalNumeric(df, at(t));
    const scale = Math.max(1, Math.abs(numeric));
    expect(Math.abs(symbolic - numeric) / scale, `${formatExpr(f)}  ->  ${formatExpr(df)}`).toBeLessThan(tol);
  }
}

const x = M.r('x');
const y = M.r('y');
const p = M.r('p');
const call = (name: string, ...args: Expr[]): Expr => E.call(name, args);

describe('symbolic time derivative', () => {
  it('differentiates constants, parameters, variables and time', () => {
    expect(differentiate(M.n(3), ctx)).toEqual(M.n(0));
    expect(differentiate(p, ctx)).toEqual(M.n(0));
    expect(differentiate(M.mul(p, M.n(2)), ctx)).toEqual(M.n(0));
    expect(formatExpr(differentiate(x, ctx))).toBe('der(x)');
    expect(formatExpr(differentiate(M.der('x'), ctx))).toBe('der(der(x))');
    expect(differentiate(M.time, ctx)).toEqual(M.n(1));
    expect(formatExpr(differentiate(M.mul(p, x), ctx))).toBe('p * der(x)');
  });

  it.each<[string, Expr]>([
    ['x*y', M.mul(x, y)],
    ['x/y', M.div(x, y)],
    ['x^3', E.bin('^', x, M.n(3))],
    ['2^x', E.bin('^', M.n(2), x)],
    ['x^y', E.bin('^', x, y)],
    ['p*x + time*y', M.add(M.mul(p, x), M.mul(M.time, y))],
    ['sqrt(x)', call('sqrt', x)],
    ['exp(x)', call('exp', x)],
    ['log(x)', call('log', x)],
    ['log10(x)', call('log10', x)],
    ['sin(x)', call('sin', x)],
    ['cos(x*y)', call('cos', M.mul(x, y))],
    ['tan(x/2)', call('tan', M.div(x, M.n(2)))],
    ['asin(x/3)', call('asin', M.div(x, M.n(3)))],
    ['acos(x/3)', call('acos', M.div(x, M.n(3)))],
    ['atan(x)', call('atan', x)],
    ['atan2(y, x)', call('atan2', y, x)],
    ['sinh(x)', call('sinh', x)],
    ['cosh(x)', call('cosh', x)],
    ['tanh(x)', call('tanh', x)],
    ['abs(x - 1.2)', call('abs', M.sub(x, M.n(1.2)))],
    ['min(x, y)', call('min', x, y)],
    ['max(x, y)', call('max', x, y)],
    ['if x > y then x*x else y*y', M.ifExpr(M.gt(x, y), M.mul(x, x), M.mul(y, y))],
    ['noEvent(x*y)', call('noEvent', M.mul(x, y))],
    ['smooth(1, x*y)', call('smooth', M.n(1), M.mul(x, y))],
    ['der(x)*y', M.mul(M.der('x'), y)],
    ['-x + (x - y)', M.add(E.neg(x), M.sub(x, y))],
    ['Modelica.Math.sin(x)', call('Modelica.Math.sin', x)],
    ['semiLinear(x - 1.2, y, p)', call('semiLinear', M.sub(x, M.n(1.2)), y, p)],
    ['mod(x, 0.7)', call('mod', x, M.n(0.7))],
  ])('matches finite differences for %s', (_label, expr) => {
    checkDerivative(expr);
  });

  it('treats sign/floor/ceil/integer, relations, pre() and initial() as piecewise constant', () => {
    for (const e of [call('sign', x), call('floor', x), call('ceil', x), call('integer', x), M.gt(x, y), call('pre', x), call('initial'), E.bin('and', M.gt(x, M.n(0)), M.lt(y, M.n(1)))]) {
      expect(differentiate(e, ctx)).toEqual(M.n(0));
    }
  });

  it('keeps if-conditions unchanged', () => {
    const d = differentiate(M.ifExpr(M.gt(x, M.n(0)), M.mul(x, x), M.n(0)), ctx);
    expect(formatExpr(d)).toBe('if x > 0 then der(x) * x + x * der(x) else 0');
  });

  it('rejects functions without derivative rules, non-Real variables and unknown names', () => {
    expect(() => differentiate(call('myFunction', x), ctx)).toThrow(ModelicaError);
    expect(() => differentiate(call('myFunction', x), ctx)).toThrow(/Index reduction is not possible[\s\S]*myFunction/);
    expect(() => differentiate(M.r('b'), ctx)).toThrow(/not a Real variable/);
    expect(() => differentiate(M.r('nope'), ctx)).toThrow(/unknown variable 'nope'/);
  });
});
