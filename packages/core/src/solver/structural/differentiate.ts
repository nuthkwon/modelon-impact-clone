/**
 * Symbolic time derivative of Modelica expressions (for index reduction).
 *
 * `d/dt x = der(x)` for unknowns, 0 for parameters/constants/literals, `d/dt time = 1`;
 * `der(x)` itself differentiates to the nested symbol `der(der(x))`. Conditions of
 * if-expressions and relations are left untouched (their derivative is zero almost
 * everywhere); `min`/`max`/`abs` become piecewise expressions. Functions without a known
 * derivative make index reduction impossible and raise a ModelicaError.
 */
import { ModelicaError, type Expr } from '../../ast.js';
import { builtinName, formatExpr, refName } from '../../flatten/evaluate.js';
import { add, call, derExpr, derivativeSymbol, div, mul, neg, num, numValue, pow, sub } from './expr.js';

export type SymbolKind = 'constant' | 'real' | 'nonreal' | 'unknown-name';

export interface DifferentiationContext {
  /** Classifies a plain variable name. `time` is handled by the differentiator. */
  classify(name: string): SymbolKind;
  /** Numeric value of a constant sub-expression, if it is one (parameters included). */
  constantValue(e: Expr): number | undefined;
}

function fail(e: Expr, why: string): never {
  throw new ModelicaError(`Index reduction is not possible: cannot differentiate ${formatExpr(e)} (${why})`);
}

/** d/dt of `e`. */
export function differentiate(e: Expr, ctx: DifferentiationContext): Expr {
  const c = ctx.constantValue(e);
  if (c !== undefined) return num(0);
  const d = (x: Expr): Expr => differentiate(x, ctx);
  switch (e.kind) {
    case 'number':
    case 'boolean':
    case 'string':
      return num(0);
    case 'ref': {
      if (e.parts.some((p) => p.subscripts && p.subscripts.length > 0)) return fail(e, 'array subscripts are not supported');
      const name = refName(e);
      if (name === 'time') return num(1);
      switch (ctx.classify(name)) {
        case 'constant':
          return num(0);
        case 'real':
          return call('der', e);
        case 'nonreal':
          return fail(e, `'${name}' is not a Real variable`);
        default:
          return fail(e, `unknown variable '${name}'`);
      }
    }
    case 'unary':
      if (e.op === '-') return neg(d(e.operand));
      if (e.op === '+') return d(e.operand);
      return num(0); // `not`: Boolean, piecewise constant
    case 'binary': {
      switch (e.op) {
        case '+':
        case '.+':
          return add(d(e.left), d(e.right));
        case '-':
        case '.-':
          return sub(d(e.left), d(e.right));
        case '*':
        case '.*':
          return add(mul(d(e.left), e.right), mul(e.left, d(e.right)));
        case '/':
        case './': {
          const dl = d(e.left);
          const dr = d(e.right);
          if (numValue(dr) === 0) return div(dl, e.right);
          return div(sub(mul(dl, e.right), mul(e.left, dr)), pow(e.right, num(2)));
        }
        case '^':
        case '.^': {
          const n = ctx.constantValue(e.right);
          if (n !== undefined) {
            if (n === 0) return num(0);
            return mul(mul(num(n), pow(e.left, num(n - 1))), d(e.left));
          }
          const b = ctx.constantValue(e.left);
          if (b !== undefined) {
            return mul(mul(e, num(Math.log(b))), d(e.right));
          }
          // u^v = exp(v ln u): d = u^v (dv ln u + v du / u)
          return mul(e, add(mul(d(e.right), call('log', e.left)), div(mul(e.right, d(e.left)), e.left)));
        }
        default:
          // Relational and logical operators: Boolean valued, derivative 0.
          return num(0);
      }
    }
    case 'if':
      return { kind: 'if', branches: e.branches.map((b) => ({ cond: b.cond, value: d(b.value) })), else: d(e.else) };
    case 'call':
      return differentiateCall(e, ctx);
    case 'array':
    case 'range':
    case 'end':
      return fail(e, 'array expressions are not supported');
  }
  return fail(e as Expr, 'unsupported expression');
}

function differentiateCall(e: Expr & { kind: 'call' }, ctx: DifferentiationContext): Expr {
  const d = (x: Expr): Expr => differentiate(x, ctx);
  const callee = e.callee;
  if (callee === 'der') {
    const s = derivativeSymbol(e);
    if (!s) return fail(e, 'der() of a non-variable');
    if (ctx.classify(s.base) !== 'real') return fail(e, `'${s.base}' is not a Real variable`);
    return derExpr(e, 1);
  }
  const arg = (i: number): Expr => {
    const a = e.args[i];
    if (!a) return fail(e, `'${callee}' expects ${i + 1} argument${i ? 's' : ''}`);
    return a;
  };
  switch (callee) {
    case 'noEvent':
      return call('noEvent', d(arg(0)));
    case 'smooth':
      return d(arg(1));
    case 'homotopy': {
      const actual = e.args[0] ?? e.namedArgs.find((n) => n.name === 'actual')?.value;
      if (!actual) return fail(e, `'homotopy' expects an 'actual' argument`);
      return d(actual);
    }
    case 'pre':
    case 'edge':
    case 'change':
    case 'initial':
    case 'terminal':
    case 'sample':
      return num(0);
    case 'semiLinear': {
      const x = arg(0);
      const kp = arg(1);
      const kn = arg(2);
      const dx = d(x);
      const cond: Expr = { kind: 'binary', op: '>=', left: x, right: num(0) };
      return {
        kind: 'if',
        branches: [{ cond, value: add(mul(d(kp), x), mul(kp, dx)) }],
        else: add(mul(d(kn), x), mul(kn, dx)),
      };
    }
    case 'reinit':
    case 'assert':
    case 'terminate':
      return fail(e, `'${callee}' is a statement`);
  }
  if (e.namedArgs.length > 0) return fail(e, 'named arguments are not supported');
  const name = builtinName(callee);
  if (e.args.length === 1) {
    const u = e.args[0];
    const du = d(u);
    switch (name) {
      case 'sqrt':
        return div(du, mul(num(2), e));
      case 'exp':
        return mul(e, du);
      case 'log':
        return div(du, u);
      case 'log10':
        return div(du, mul(u, num(Math.LN10)));
      case 'sin':
        return mul(call('cos', u), du);
      case 'cos':
        return neg(mul(call('sin', u), du));
      case 'tan':
        return div(du, pow(call('cos', u), num(2)));
      case 'asin':
        return div(du, call('sqrt', sub(num(1), pow(u, num(2)))));
      case 'acos':
        return neg(div(du, call('sqrt', sub(num(1), pow(u, num(2))))));
      case 'atan':
        return div(du, add(num(1), pow(u, num(2))));
      case 'sinh':
        return mul(call('cosh', u), du);
      case 'cosh':
        return mul(call('sinh', u), du);
      case 'tanh':
        return mul(sub(num(1), pow(e, num(2))), du);
      case 'abs':
        return mul(call('sign', u), du);
      case 'sign':
      case 'floor':
      case 'ceil':
      case 'integer':
        return num(0);
      case 'Real':
        return du;
    }
  } else if (e.args.length === 2) {
    const a = e.args[0];
    const b = e.args[1];
    switch (name) {
      case 'atan2': {
        // atan2(y, x): (x dy - y dx) / (x^2 + y^2)
        return div(sub(mul(b, d(a)), mul(a, d(b))), add(pow(b, num(2)), pow(a, num(2))));
      }
      case 'min':
      case 'max': {
        const cond: Expr = { kind: 'binary', op: name === 'min' ? '<' : '>', left: a, right: b };
        return { kind: 'if', branches: [{ cond, value: d(a) }], else: d(b) };
      }
      case 'mod':
        // mod(a, b) = a - floor(a/b) b
        return sub(d(a), mul(call('floor', div(a, b)), d(b)));
      case 'rem':
        return sub(d(a), mul(call('div', a, b), d(b)));
      case 'div':
        return num(0);
    }
  }
  return fail(e, `no derivative rule for function '${callee}'`);
}
