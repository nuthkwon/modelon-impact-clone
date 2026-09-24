/**
 * Expression utilities shared by the structural pre-processing passes:
 *
 * - constant-folding builders (`add`, `mul`, ...) so that generated expressions stay small,
 * - derivative symbols `der(der(x))` <-> `{ base, order }`,
 * - structural incidence (which unknowns an equation can determine),
 * - linear forms `sum k_i x_i + c` with constant coefficients (alias/propagation detection),
 * - substitution of variables by `scale * rep + offset` (aliases) and of derivative symbols,
 * - a small numeric evaluator used to look at Jacobians at the start point.
 */
import { ModelicaError, type Expr } from '../../ast.js';
import { flatRef } from '../../flat.js';
import {
  formatExpr,
  getBinaryBuiltin,
  getUnaryBuiltin,
  MODELICA_CONSTANTS,
  refName,
  tryEvaluateConstant,
  type ConstValue,
  type EvalEnv,
} from '../../flatten/evaluate.js';

// -------------------------------------------------------------------------------------------
// Builders with constant folding
// -------------------------------------------------------------------------------------------

export const num = (v: number): Expr => ({ kind: 'number', value: v });

export function isNum(e: Expr, v?: number): boolean {
  return e.kind === 'number' && (v === undefined || e.value === v);
}

export function numValue(e: Expr): number | undefined {
  if (e.kind === 'number') return e.value;
  if (e.kind === 'unary' && e.op === '-' && e.operand.kind === 'number') return -e.operand.value;
  return undefined;
}

export function neg(a: Expr): Expr {
  const v = numValue(a);
  if (v !== undefined) return num(-v);
  if (a.kind === 'unary' && a.op === '-') return a.operand;
  return { kind: 'unary', op: '-', operand: a };
}

export function add(a: Expr, b: Expr): Expr {
  const va = numValue(a);
  const vb = numValue(b);
  if (va !== undefined && vb !== undefined) return num(va + vb);
  if (va === 0) return b;
  if (vb === 0) return a;
  if (b.kind === 'unary' && b.op === '-') return { kind: 'binary', op: '-', left: a, right: b.operand };
  if (vb !== undefined && vb < 0) return { kind: 'binary', op: '-', left: a, right: num(-vb) };
  return { kind: 'binary', op: '+', left: a, right: b };
}

export function sub(a: Expr, b: Expr): Expr {
  const va = numValue(a);
  const vb = numValue(b);
  if (va !== undefined && vb !== undefined) return num(va - vb);
  if (vb === 0) return a;
  if (va === 0) return neg(b);
  if (b.kind === 'unary' && b.op === '-') return add(a, b.operand);
  return { kind: 'binary', op: '-', left: a, right: b };
}

export function mul(a: Expr, b: Expr): Expr {
  const va = numValue(a);
  const vb = numValue(b);
  if (va !== undefined && vb !== undefined) return num(va * vb);
  if (va === 0 || vb === 0) return num(0);
  if (va === 1) return b;
  if (vb === 1) return a;
  if (va === -1) return neg(b);
  if (vb === -1) return neg(a);
  return { kind: 'binary', op: '*', left: a, right: b };
}

export function div(a: Expr, b: Expr): Expr {
  const va = numValue(a);
  const vb = numValue(b);
  if (va !== undefined && vb !== undefined && vb !== 0) return num(va / vb);
  if (va === 0) return num(0);
  if (vb === 1) return a;
  if (vb === -1) return neg(a);
  return { kind: 'binary', op: '/', left: a, right: b };
}

export function pow(a: Expr, b: Expr): Expr {
  const va = numValue(a);
  const vb = numValue(b);
  if (va !== undefined && vb !== undefined) return num(Math.pow(va, vb));
  if (vb === 1) return a;
  if (vb === 0) return num(1);
  return { kind: 'binary', op: '^', left: a, right: b };
}

export function call(callee: string, ...args: Expr[]): Expr {
  return { kind: 'call', callee, args, namedArgs: [] };
}

/** `scale * ref(name) + offset`, folded. */
export function affine(name: string, scale: number, offset: number): Expr {
  return add(mul(num(scale), flatRef(name)), num(offset));
}

// -------------------------------------------------------------------------------------------
// Derivative symbols
// -------------------------------------------------------------------------------------------

export interface DerivativeSymbol {
  base: string;
  /** 0 for the variable itself, 1 for `der(x)`, 2 for `der(der(x))`, ... */
  order: number;
}

/** Parses `der(der(x))` (any depth, including 0) into `{ base, order }`; undefined for anything else. */
export function derivativeSymbol(e: Expr): DerivativeSymbol | undefined {
  let order = 0;
  let cur = e;
  while (cur.kind === 'call' && cur.callee === 'der' && cur.args.length === 1 && cur.namedArgs.length === 0) {
    order++;
    cur = cur.args[0];
  }
  if (cur.kind !== 'ref' || cur.parts.some((p) => p.subscripts && p.subscripts.length > 0)) return undefined;
  return { base: refName(cur), order };
}

/** Wraps `inner` in `order` nested `der(...)` calls. */
export function derExpr(inner: Expr, order: number): Expr {
  let e = inner;
  for (let i = 0; i < order; i++) e = call('der', e);
  return e;
}

/** Name of the variable that represents the `order`-th derivative of `base`: `der(der(x))`. */
export function derivativeName(base: string, order: number): string {
  let s = base;
  for (let i = 0; i < order; i++) s = `der(${s})`;
  return s;
}

// -------------------------------------------------------------------------------------------
// Incidence
// -------------------------------------------------------------------------------------------

const RELATIONAL_OPS = new Set(['<', '<=', '>', '>=', '==', '<>']);
/** Operators whose arguments never count as structural incidence (they read the past or fire events). */
const OPAQUE_CALLS = new Set(['pre', 'edge', 'change', 'initial', 'terminal', 'sample', 'reinit', 'assert', 'terminate']);

export interface IncidenceOptions {
  /**
   * Also count variables inside relations and if-conditions. False (default) gives the
   * incidence used for matching (an equation cannot be solved for a variable that only
   * influences it through a Boolean condition); true gives the dependencies used for
   * ordering blocks (the condition must be known before the equation is solved).
   */
  conditions?: boolean;
}

/**
 * Structural incidence of an expression: every unknown (as decided by `isUnknown`) with the
 * highest derivative order it appears at. Variables inside `pre()`/`edge()`/`change()` are
 * never counted; variables inside relations (`a < b`, if-conditions) only with
 * `options.conditions`.
 */
export function incidence(e: Expr, isUnknown: (name: string) => boolean, out: Map<string, number> = new Map(), options: IncidenceOptions = {}): Map<string, number> {
  const conditions = options.conditions === true;
  const note = (base: string, order: number): void => {
    if (!isUnknown(base)) return;
    const prev = out.get(base);
    if (prev === undefined || order > prev) out.set(base, order);
  };
  const visit = (x: Expr): void => {
    switch (x.kind) {
      case 'ref':
        if (!x.parts.some((p) => p.subscripts && p.subscripts.length > 0)) note(refName(x), 0);
        return;
      case 'call': {
        if (x.callee === 'der') {
          const s = derivativeSymbol(x);
          if (s) {
            note(s.base, s.order);
            return;
          }
        }
        if (OPAQUE_CALLS.has(x.callee)) return;
        x.args.forEach(visit);
        x.namedArgs.forEach((n) => visit(n.value));
        return;
      }
      case 'binary':
        if (RELATIONAL_OPS.has(x.op) && !conditions) return;
        visit(x.left);
        visit(x.right);
        return;
      case 'unary':
        visit(x.operand);
        return;
      case 'if':
        for (const b of x.branches) {
          if (conditions) visit(b.cond);
          visit(b.value);
        }
        visit(x.else);
        return;
      case 'array':
        x.elements.forEach(visit);
        return;
      case 'range':
        visit(x.start);
        if (x.step) visit(x.step);
        visit(x.end);
        return;
      default:
        return;
    }
  };
  visit(e);
  return out;
}

/** All derivative symbols `der^k(x)` (k >= 1) of unknowns anywhere in the expression, including inside conditions. */
export function collectDerivatives(e: Expr, out: Map<string, number> = new Map()): Map<string, number> {
  const visit = (x: Expr): void => {
    switch (x.kind) {
      case 'call': {
        if (x.callee === 'der') {
          const s = derivativeSymbol(x);
          if (s) {
            const prev = out.get(s.base);
            if (prev === undefined || s.order > prev) out.set(s.base, s.order);
            return;
          }
        }
        x.args.forEach(visit);
        x.namedArgs.forEach((n) => visit(n.value));
        return;
      }
      case 'binary':
        visit(x.left);
        visit(x.right);
        return;
      case 'unary':
        visit(x.operand);
        return;
      case 'if':
        for (const b of x.branches) {
          visit(b.cond);
          visit(b.value);
        }
        visit(x.else);
        return;
      case 'array':
        x.elements.forEach(visit);
        return;
      case 'range':
        visit(x.start);
        if (x.step) visit(x.step);
        visit(x.end);
        return;
      default:
        return;
    }
  };
  visit(e);
  return out;
}

/** True if the variable `name` (as a plain ref) appears anywhere in the expression, conditions included. */
export function mentions(e: Expr, name: string): boolean {
  let found = false;
  const visit = (x: Expr): void => {
    if (found) return;
    switch (x.kind) {
      case 'ref':
        if (refName(x) === name) found = true;
        return;
      case 'call':
        x.args.forEach(visit);
        x.namedArgs.forEach((n) => visit(n.value));
        return;
      case 'binary':
        visit(x.left);
        visit(x.right);
        return;
      case 'unary':
        visit(x.operand);
        return;
      case 'if':
        for (const b of x.branches) {
          visit(b.cond);
          visit(b.value);
        }
        visit(x.else);
        return;
      case 'array':
        x.elements.forEach(visit);
        return;
      case 'range':
        visit(x.start);
        if (x.step) visit(x.step);
        visit(x.end);
        return;
      default:
        return;
    }
  };
  visit(e);
  return found;
}

// -------------------------------------------------------------------------------------------
// Linear forms
// -------------------------------------------------------------------------------------------

/** `sum_i coeffs[i] * term_i + constant`. Terms are unknown names or derivative symbols `der(x)`. */
export interface LinearForm {
  coeffs: Map<string, number>;
  constant: number;
}

/**
 * Tries to write `e` as a linear combination of unknowns (and first derivatives `der(x)` of
 * unknowns, keyed `der(x)`) with numeric coefficients. Sub-expressions that evaluate to a
 * constant with `env` become part of `constant`. Returns undefined when the expression is
 * not linear with constant coefficients (products of unknowns, functions, if-expressions, `time`).
 */
export function linearForm(e: Expr, env: EvalEnv, isUnknown: (name: string) => boolean): LinearForm | undefined {
  const c = tryEvaluateConstant(e, env);
  if (c !== undefined) return typeof c === 'number' ? { coeffs: new Map(), constant: c } : undefined;
  switch (e.kind) {
    case 'ref': {
      if (e.parts.some((p) => p.subscripts && p.subscripts.length > 0)) return undefined;
      const name = refName(e);
      if (name === 'time' || !isUnknown(name)) return undefined;
      return { coeffs: new Map([[name, 1]]), constant: 0 };
    }
    case 'unary': {
      if (e.op === 'not') return undefined;
      const a = linearForm(e.operand, env, isUnknown);
      if (!a) return undefined;
      return e.op === '-' ? scaleForm(a, -1) : a;
    }
    case 'binary': {
      switch (e.op) {
        case '+':
        case '.+':
        case '-':
        case '.-': {
          const l = linearForm(e.left, env, isUnknown);
          if (!l) return undefined;
          const r = linearForm(e.right, env, isUnknown);
          if (!r) return undefined;
          return addForms(l, e.op === '+' || e.op === '.+' ? r : scaleForm(r, -1));
        }
        case '*':
        case '.*': {
          const l = linearForm(e.left, env, isUnknown);
          if (!l) return undefined;
          const r = linearForm(e.right, env, isUnknown);
          if (!r) return undefined;
          if (l.coeffs.size === 0) return scaleForm(r, l.constant);
          if (r.coeffs.size === 0) return scaleForm(l, r.constant);
          return undefined;
        }
        case '/':
        case './': {
          const r = linearForm(e.right, env, isUnknown);
          if (!r || r.coeffs.size !== 0 || r.constant === 0 || !Number.isFinite(r.constant)) return undefined;
          const l = linearForm(e.left, env, isUnknown);
          if (!l) return undefined;
          return scaleForm(l, 1 / r.constant);
        }
        default:
          return undefined;
      }
    }
    case 'call': {
      if (e.namedArgs.length > 0) return undefined;
      if (e.callee === 'der') {
        const s = derivativeSymbol(e);
        if (!s || s.order !== 1 || !isUnknown(s.base)) return undefined;
        return { coeffs: new Map([[derivativeName(s.base, 1), 1]]), constant: 0 };
      }
      if (e.callee === 'noEvent' && e.args.length === 1) return linearForm(e.args[0], env, isUnknown);
      if (e.callee === 'smooth' && e.args.length === 2) return linearForm(e.args[1], env, isUnknown);
      if (e.callee === 'homotopy' && e.args.length >= 1) return linearForm(e.args[0], env, isUnknown);
      return undefined;
    }
    default:
      return undefined;
  }
}

function scaleForm(f: LinearForm, k: number): LinearForm {
  const coeffs = new Map<string, number>();
  for (const [name, c] of f.coeffs) {
    const v = c * k;
    if (v !== 0) coeffs.set(name, v);
  }
  return { coeffs, constant: f.constant * k };
}

function addForms(a: LinearForm, b: LinearForm): LinearForm {
  const coeffs = new Map(a.coeffs);
  for (const [name, c] of b.coeffs) {
    const v = (coeffs.get(name) ?? 0) + c;
    if (v === 0) coeffs.delete(name);
    else coeffs.set(name, v);
  }
  return { coeffs, constant: a.constant + b.constant };
}

/** Linear form of the residual `left - right` of an equation. */
export function equationLinearForm(left: Expr, right: Expr, env: EvalEnv, isUnknown: (name: string) => boolean): LinearForm | undefined {
  const l = linearForm(left, env, isUnknown);
  if (!l) return undefined;
  const r = linearForm(right, env, isUnknown);
  if (!r) return undefined;
  return addForms(l, scaleForm(r, -1));
}

// -------------------------------------------------------------------------------------------
// Substitution
// -------------------------------------------------------------------------------------------

/** Replacement of a variable: `x = scale * rep + offset`, or a constant when `rep` is undefined. */
export interface Replacement {
  rep?: string;
  scale: number;
  offset: number;
  /** Constant value when `rep` is undefined (numbers; Booleans as true/false). */
  value?: ConstValue;
}

function replacementExpr(r: Replacement): Expr {
  if (r.rep === undefined) {
    const v = r.value;
    if (typeof v === 'boolean') return { kind: 'boolean', value: v };
    if (typeof v === 'string') return { kind: 'string', value: v };
    return num(typeof v === 'number' ? v : r.offset);
  }
  return affine(r.rep, r.scale, r.offset);
}

/**
 * Replaces variables by their alias/constant replacement everywhere in `e`. `der(x)` becomes
 * `scale * der(rep)` (or 0 for constants), `pre(x)` becomes `scale * pre(rep) + offset`,
 * `edge(x)`/`change(x)` follow the representative and `reinit(x, v)` becomes
 * `reinit(rep, (v - offset) / scale)`.
 */
export function substituteAliases(e: Expr, resolve: (name: string) => Replacement | undefined): Expr {
  const visit = (x: Expr): Expr => {
    switch (x.kind) {
      case 'ref': {
        if (x.parts.some((p) => p.subscripts && p.subscripts.length > 0)) return x;
        const r = resolve(refName(x));
        return r ? replacementExpr(r) : x;
      }
      case 'call': {
        if (x.callee === 'der') {
          const s = derivativeSymbol(x);
          if (s && s.order >= 1) {
            const r = resolve(s.base);
            if (!r) return x;
            if (r.rep === undefined) return num(0);
            return mul(num(r.scale), derExpr(flatRef(r.rep), s.order));
          }
        }
        if ((x.callee === 'pre' || x.callee === 'edge' || x.callee === 'change') && x.args.length === 1 && x.args[0].kind === 'ref') {
          const r = resolve(refName(x.args[0]));
          if (!r) return x;
          if (r.rep === undefined) {
            if (x.callee === 'pre') return replacementExpr(r);
            return { kind: 'boolean', value: false };
          }
          const inner = call(x.callee, flatRef(r.rep));
          if (x.callee === 'pre') return add(mul(num(r.scale), inner), num(r.offset));
          return inner;
        }
        if (x.callee === 'reinit' && x.args.length === 2 && x.args[0].kind === 'ref') {
          const r = resolve(refName(x.args[0]));
          const value = visit(x.args[1]);
          if (!r) return { ...x, args: [x.args[0], value] };
          if (r.rep === undefined) {
            throw new ModelicaError(`reinit(${formatExpr(x.args[0])}, ...): the variable was found to be constant and cannot be re-initialized`);
          }
          return call('reinit', flatRef(r.rep), div(sub(value, num(r.offset)), num(r.scale)));
        }
        return { ...x, args: x.args.map(visit), namedArgs: x.namedArgs.map((n) => ({ name: n.name, value: visit(n.value) })) };
      }
      case 'binary': {
        const left = visit(x.left);
        const right = visit(x.right);
        if (left === x.left && right === x.right) return x;
        return { ...x, left, right };
      }
      case 'unary': {
        const operand = visit(x.operand);
        return operand === x.operand ? x : { ...x, operand };
      }
      case 'if':
        return { ...x, branches: x.branches.map((b) => ({ cond: visit(b.cond), value: visit(b.value) })), else: visit(x.else) };
      case 'array':
        return { ...x, elements: x.elements.map(visit) };
      case 'range':
        return { ...x, start: visit(x.start), step: x.step ? visit(x.step) : undefined, end: visit(x.end) };
      default:
        return x;
    }
  };
  return visit(e);
}

/**
 * Replaces derivative symbols `der^k(x)` (k >= 1) by whatever `resolve(base, order)` returns
 * (undefined keeps the symbol). Used to materialise dummy derivatives as variables.
 */
export function substituteDerivatives(e: Expr, resolve: (base: string, order: number) => Expr | undefined): Expr {
  const visit = (x: Expr): Expr => {
    switch (x.kind) {
      case 'call': {
        if (x.callee === 'der') {
          const s = derivativeSymbol(x);
          if (s && s.order >= 1) {
            const r = resolve(s.base, s.order);
            if (r) return r;
            return x;
          }
        }
        return { ...x, args: x.args.map(visit), namedArgs: x.namedArgs.map((n) => ({ name: n.name, value: visit(n.value) })) };
      }
      case 'binary':
        return { ...x, left: visit(x.left), right: visit(x.right) };
      case 'unary':
        return { ...x, operand: visit(x.operand) };
      case 'if':
        return { ...x, branches: x.branches.map((b) => ({ cond: visit(b.cond), value: visit(b.value) })), else: visit(x.else) };
      case 'array':
        return { ...x, elements: x.elements.map(visit) };
      case 'range':
        return { ...x, start: visit(x.start), step: x.step ? visit(x.step) : undefined, end: visit(x.end) };
      default:
        return x;
    }
  };
  return visit(e);
}

// -------------------------------------------------------------------------------------------
// Numeric evaluation at a point
// -------------------------------------------------------------------------------------------

export interface NumericContext {
  time: number;
  env: EvalEnv;
  /** Value of `der^order(base)` (order 0 = the variable). Undefined -> not available. */
  value(base: string, order: number): number | undefined;
}

/**
 * Evaluates an expression at a point (Booleans as 0/1). Relations are evaluated exactly,
 * `pre(x)` reads `x`, `initial()` is true, `sample`/`edge`/`change` are false. Throws a
 * ModelicaError for constructs it cannot evaluate.
 */
export function evalNumeric(e: Expr, ctx: NumericContext): number {
  const fail = (msg: string): never => {
    throw new ModelicaError(`Cannot evaluate ${formatExpr(e)}: ${msg}`);
  };
  const ev = (x: Expr): number => {
    switch (x.kind) {
      case 'number':
        return x.value;
      case 'boolean':
        return x.value ? 1 : 0;
      case 'string':
        return fail('string value');
      case 'ref': {
        if (x.parts.some((p) => p.subscripts && p.subscripts.length > 0)) return fail('array subscripts');
        const name = refName(x);
        if (name === 'time') return ctx.time;
        const v = ctx.value(name, 0);
        if (v !== undefined) return v;
        const c = ctx.env.lookup(name) ?? MODELICA_CONSTANTS[name];
        if (typeof c === 'number') return c;
        if (typeof c === 'boolean') return c ? 1 : 0;
        return fail(`unknown symbol '${name}'`);
      }
      case 'unary': {
        const a = ev(x.operand);
        return x.op === '-' ? -a : x.op === 'not' ? (a >= 0.5 ? 0 : 1) : a;
      }
      case 'binary': {
        if (x.op === 'and') return ev(x.left) >= 0.5 && ev(x.right) >= 0.5 ? 1 : 0;
        if (x.op === 'or') return ev(x.left) >= 0.5 || ev(x.right) >= 0.5 ? 1 : 0;
        const l = ev(x.left);
        const r = ev(x.right);
        switch (x.op) {
          case '+': case '.+': return l + r;
          case '-': case '.-': return l - r;
          case '*': case '.*': return l * r;
          case '/': case './': return l / r;
          case '^': case '.^': return Math.pow(l, r);
          case '==': return l === r ? 1 : 0;
          case '<>': return l !== r ? 1 : 0;
          case '<': return l < r ? 1 : 0;
          case '<=': return l <= r ? 1 : 0;
          case '>': return l > r ? 1 : 0;
          case '>=': return l >= r ? 1 : 0;
        }
        return fail(`operator '${x.op}'`);
      }
      case 'if': {
        for (const b of x.branches) if (ev(b.cond) >= 0.5) return ev(b.value);
        return ev(x.else);
      }
      case 'call': {
        const callee = x.callee;
        if (callee === 'der') {
          const s = derivativeSymbol(x);
          if (!s) return fail('der of a non-variable');
          const v = ctx.value(s.base, s.order);
          return v === undefined ? fail(`no value for ${formatExpr(x)}`) : v;
        }
        switch (callee) {
          case 'noEvent':
          case 'homotopy':
            return ev(x.args[0]);
          case 'smooth':
            return ev(x.args[1]);
          case 'pre':
            return ev(x.args[0]);
          case 'initial':
            return 1;
          case 'terminal':
          case 'sample':
          case 'edge':
          case 'change':
            return 0;
          case 'semiLinear': {
            const s = ev(x.args[0]);
            return s >= 0 ? ev(x.args[1]) * s : ev(x.args[2]) * s;
          }
        }
        const un = getUnaryBuiltin(callee);
        if (un && x.args.length === 1) return un(ev(x.args[0]));
        const bi = getBinaryBuiltin(callee);
        if (bi && x.args.length === 2) return bi(ev(x.args[0]), ev(x.args[1]));
        return fail(`function '${callee}'`);
      }
      default:
        return fail('unsupported expression');
    }
  };
  return ev(e);
}

/** Numeric start value of a variable attribute (0 when missing). */
export function startNumber(start: number | boolean | string | undefined): number {
  if (start === undefined) return 0;
  if (typeof start === 'number') return Number.isFinite(start) ? start : 0;
  if (typeof start === 'boolean') return start ? 1 : 0;
  const n = Number(start);
  return Number.isFinite(n) ? n : 0;
}
