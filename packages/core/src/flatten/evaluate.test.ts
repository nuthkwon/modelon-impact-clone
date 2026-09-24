import { describe, expect, it } from 'vitest';
import { E, ModelicaError, type Expr } from '../ast.js';
import { applyBuiltinFunction, evaluateConstant, formatExpr, tryEvaluateConstant, type ConstValue, type EvalEnv } from './evaluate.js';

function env(values: Record<string, ConstValue> = {}, fns?: EvalEnv['callFunction']): EvalEnv {
  return { lookup: (n) => values[n], callFunction: fns };
}

const n = E.num;
const r = E.refPath;
const b = E.bin;

describe('evaluateConstant', () => {
  it('evaluates literals', () => {
    expect(evaluateConstant(n(1.5), env())).toBe(1.5);
    expect(evaluateConstant(E.str('abc'), env())).toBe('abc');
    expect(evaluateConstant(E.bool(true), env())).toBe(true);
  });

  it('respects operator structure (precedence is encoded in the tree)', () => {
    // 1 + 2 * 3 = 7
    expect(evaluateConstant(b('+', n(1), b('*', n(2), n(3))), env())).toBe(7);
    // (1 + 2) * 3 = 9
    expect(evaluateConstant(b('*', b('+', n(1), n(2)), n(3)), env())).toBe(9);
    // 2 ^ 3 ^ 2 as parsed right-to-left? Modelica ^ is non-associative; we just evaluate the tree.
    expect(evaluateConstant(b('^', n(2), b('^', n(3), n(2))), env())).toBe(512);
    expect(evaluateConstant(b('^', b('^', n(2), n(3)), n(2)), env())).toBe(64);
    // -2 ^ 2: unary minus applied to 2^2 -> -4
    expect(evaluateConstant(E.neg(b('^', n(2), n(2))), env())).toBe(-4);
    // 7 / 2 is Real division
    expect(evaluateConstant(b('/', n(7), n(2)), env())).toBe(3.5);
    // 1 - 2 - 3 = -4 (left associative tree)
    expect(evaluateConstant(b('-', b('-', n(1), n(2)), n(3)), env())).toBe(-4);
  });

  it('resolves references through the environment and Modelica.Constants', () => {
    const e = env({ R: 100, 'resistor.R': 200, flag: true, name: 'x' });
    expect(evaluateConstant(r('R'), e)).toBe(100);
    expect(evaluateConstant(r('resistor.R'), e)).toBe(200);
    expect(evaluateConstant(r('flag'), e)).toBe(true);
    expect(evaluateConstant(r('Modelica.Constants.pi'), e)).toBeCloseTo(Math.PI, 15);
    expect(evaluateConstant(r('Modelica.Constants.g_n'), e)).toBe(9.80665);
    expect(evaluateConstant(r('Modelica.Constants.D2R'), e)).toBeCloseTo(Math.PI / 180, 15);
    expect(evaluateConstant(b('*', n(2), r('Modelica.Constants.e')), e)).toBeCloseTo(2 * Math.E, 15);
    // The environment wins over the built-in table.
    expect(evaluateConstant(r('Modelica.Constants.pi'), env({ 'Modelica.Constants.pi': 3 }))).toBe(3);
  });

  it('throws a ModelicaError for unknown references, naming the offending variable', () => {
    const expr = b('+', n(1), b('*', r('x'), n(2)));
    expect(() => evaluateConstant(expr, env())).toThrow(ModelicaError);
    expect(() => evaluateConstant(expr, env())).toThrow(/Could not evaluate 1 \+ x \* 2: 'x' is not a constant/);
    expect(() => evaluateConstant(r('time'), env())).toThrow(/'time' is not a constant/);
    expect(tryEvaluateConstant(expr, env())).toBeUndefined();
    expect(tryEvaluateConstant(expr, env({ x: 3 }))).toBe(7);
  });

  it('evaluates comparisons and logic with short-circuit', () => {
    const e = env({ a: 1, c: 3, s: 'on' });
    expect(evaluateConstant(b('<', r('a'), r('c')), e)).toBe(true);
    expect(evaluateConstant(b('>=', r('a'), r('c')), e)).toBe(false);
    expect(evaluateConstant(b('==', r('s'), E.str('on')), e)).toBe(true);
    expect(evaluateConstant(b('<>', r('s'), E.str('off')), e)).toBe(true);
    expect(evaluateConstant(b('and', E.bool(true), E.bool(false)), e)).toBe(false);
    expect(evaluateConstant(b('or', E.bool(true), r('undefinedVar')), e)).toBe(true); // short-circuit
    expect(evaluateConstant(b('and', E.bool(false), r('undefinedVar')), e)).toBe(false);
    expect(evaluateConstant({ kind: 'unary', op: 'not', operand: E.bool(false) }, e)).toBe(true);
    expect(() => evaluateConstant(b('and', n(1), E.bool(true)), e)).toThrow(/expects a Boolean/);
  });

  it('evaluates if-expressions', () => {
    const e = env({ useR: true, R: 10 });
    const expr: Expr = {
      kind: 'if',
      branches: [
        { cond: b('<', r('R'), n(5)), value: n(1) },
        { cond: r('useR'), value: b('*', r('R'), n(2)) },
      ],
      else: n(0),
    };
    expect(evaluateConstant(expr, e)).toBe(20);
    expect(evaluateConstant(expr, env({ useR: false, R: 10 }))).toBe(0);
    expect(evaluateConstant(expr, env({ useR: false, R: 1 }))).toBe(1);
  });

  it('concatenates strings with +', () => {
    expect(evaluateConstant(b('+', E.str('a'), E.str('b')), env())).toBe('ab');
    expect(() => evaluateConstant(b('+', E.str('a'), n(1)), env())).toThrow(/cannot add/);
  });

  it('evaluates builtin math functions', () => {
    const e = env({ x: -2.5 });
    const c = (name: string, ...args: Expr[]) => evaluateConstant(E.call(name, args), e);
    expect(c('abs', r('x'))).toBe(2.5);
    expect(c('sign', r('x'))).toBe(-1);
    expect(c('sign', n(0))).toBe(0);
    expect(c('sqrt', n(16))).toBe(4);
    expect(c('exp', n(0))).toBe(1);
    expect(c('log', r('Modelica.Constants.e'))).toBeCloseTo(1, 14);
    expect(c('log10', n(1000))).toBeCloseTo(3, 14);
    expect(c('sin', n(0))).toBe(0);
    expect(c('cos', n(0))).toBe(1);
    expect(c('tan', n(0))).toBe(0);
    expect(c('asin', n(1))).toBeCloseTo(Math.PI / 2, 14);
    expect(c('acos', n(1))).toBe(0);
    expect(c('atan', n(1))).toBeCloseTo(Math.PI / 4, 14);
    expect(c('atan2', n(1), n(1))).toBeCloseTo(Math.PI / 4, 14);
    expect(c('sinh', n(0))).toBe(0);
    expect(c('cosh', n(0))).toBe(1);
    expect(c('tanh', n(0))).toBe(0);
    expect(c('min', n(3), n(-1))).toBe(-1);
    expect(c('max', n(3), n(-1))).toBe(3);
    expect(c('floor', r('x'))).toBe(-3);
    expect(c('ceil', r('x'))).toBe(-2);
    expect(c('integer', n(2.7))).toBe(2);
    expect(c('integer', n(-2.7))).toBe(-3);
    expect(c('noEvent', b('<', n(1), n(2)))).toBe(true);
    expect(c('smooth', n(1), b('*', n(3), n(4)))).toBe(12);
    expect(c('homotopy', n(3), n(4))).toBe(3);
    expect(c('Modelica.Math.sin', n(0))).toBe(0);
    expect(c('String', n(3))).toBe('3');
  });

  it('implements Modelica div/mod/rem semantics', () => {
    const c = (name: string, a: number, bb: number) => evaluateConstant(E.call(name, [n(a), n(bb)]), env());
    expect(c('div', 7, 2)).toBe(3);
    expect(c('div', -7, 2)).toBe(-3); // truncation towards zero
    expect(c('mod', 7, 2)).toBe(1);
    expect(c('mod', -7, 2)).toBe(1); // sign of the divisor
    expect(c('mod', 7, -2)).toBe(-1);
    expect(c('rem', 7, 2)).toBe(1);
    expect(c('rem', -7, 2)).toBe(-1); // sign of the dividend
    expect(c('mod', 5.5, 2)).toBeCloseTo(1.5, 12);
  });

  it('rejects wrong arity and non-constant operators', () => {
    expect(() => evaluateConstant(E.call('sin', [n(1), n(2)]), env())).toThrow(/expects 1 argument/);
    expect(() => evaluateConstant(E.call('der', [r('x')]), env({ x: 1 }))).toThrow(/not a constant/);
    expect(() => evaluateConstant(E.call('sample', [n(0), n(1)]), env())).toThrow(ModelicaError);
    expect(tryEvaluateConstant(E.call('pre', [r('x')]), env({ x: 1 }))).toBeUndefined();
  });

  it('calls user functions through the environment hook', () => {
    const e = env({}, (name, args) => (name === 'MyLib.twice' ? (args[0] as number) * 2 : undefined));
    expect(evaluateConstant(E.call('MyLib.twice', [n(21)]), e)).toBe(42);
    expect(() => evaluateConstant(E.call('MyLib.unknown', [n(21)]), e)).toThrow(/function 'MyLib.unknown' is not a constant function/);
  });

  it('rejects arrays, ranges and subscripts', () => {
    expect(() => evaluateConstant(E.array([n(1), n(2)]), env())).toThrow(/array expressions are not supported/);
    expect(() => evaluateConstant({ kind: 'range', start: n(1), end: n(3) }, env())).toThrow(/range expressions are not supported/);
    const sub: Expr = { kind: 'ref', parts: [{ name: 'x', subscripts: [n(1)] }] };
    expect(() => evaluateConstant(sub, env({ x: 1 }))).toThrow(/subscripts are not supported/);
    expect(tryEvaluateConstant(E.array([n(1)]), env())).toBeUndefined();
  });

  it('exposes applyBuiltinFunction for already evaluated arguments', () => {
    expect(applyBuiltinFunction('max', [1, 2])).toBe(2);
    expect(applyBuiltinFunction('notABuiltin', [1])).toBeUndefined();
  });

  it('formats expressions for diagnostics', () => {
    expect(formatExpr(b('*', b('+', n(1), r('a.b')), n(3)))).toBe('(1 + a.b) * 3');
    expect(formatExpr(b('+', n(1), b('*', r('x'), n(2))))).toBe('1 + x * 2');
    expect(formatExpr(E.call('der', [r('x')]))).toBe('der(x)');
    expect(formatExpr({ kind: 'if', branches: [{ cond: b('>', r('x'), n(0)), value: n(1) }], else: n(0) })).toBe('if x > 0 then 1 else 0');
    expect(formatExpr(E.neg(r('v')))).toBe('-v');
  });
});
