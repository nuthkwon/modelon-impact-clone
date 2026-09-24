/**
 * Constant folding for the Modelica subset: literals, references to parameters/constants
 * (resolved through an `EvalEnv`), arithmetic/relational/logical operators, if-expressions
 * and the built-in math functions. Used by the flattener (parameter evaluation) and by the
 * solver (baking parameters into residual closures).
 */
import { ModelicaError, type Expr } from '../ast.js';

export type ConstValue = number | boolean | string;

/** Environment for constant evaluation: dotted name -> value (or a thunk evaluated lazily). */
export interface EvalEnv {
  lookup(name: string): ConstValue | undefined;
  /** Optional hook for user function calls; return undefined if unknown. */
  callFunction?(name: string, args: ConstValue[]): ConstValue | undefined;
}

/** Values of `Modelica.Constants.*` (MSL 4 / ModelicaServices.Machine defaults). */
export const MODELICA_CONSTANTS: Readonly<Record<string, number>> = {
  'Modelica.Constants.pi': Math.PI,
  'Modelica.Constants.e': Math.E,
  'Modelica.Constants.eps': 1e-15,
  'Modelica.Constants.small': 1e-60,
  'Modelica.Constants.inf': 1e60,
  'Modelica.Constants.Integer_inf': 2147483647,
  'Modelica.Constants.g_n': 9.80665,
  'Modelica.Constants.D2R': Math.PI / 180,
  'Modelica.Constants.R2D': 180 / Math.PI,
  'Modelica.Constants.T_zero': -273.15,
  'Modelica.Constants.R': 8.314462618,
  'Modelica.Constants.k': 1.380649e-23,
  'Modelica.Constants.N_A': 6.02214076e23,
  'Modelica.Constants.c': 299792458,
  'Modelica.Constants.h': 6.62607015e-34,
  'Modelica.Constants.q': 1.602176634e-19,
  'Modelica.Constants.F': 96485.33212,
  'Modelica.Constants.G': 6.6743e-11,
  'Modelica.Constants.sigma': 5.670374419e-8,
  'Modelica.Constants.mu_0': 1.25663706212e-6,
  'Modelica.Constants.epsilon_0': 8.8541878128e-12,
  'Modelica.Constants.gamma': 0.57721566490153286,
};

/** Evaluates a constant expression (parameters, constants, literals, builtin math). Throws ModelicaError if not constant. */
export function evaluateConstant(expr: Expr, env: EvalEnv): ConstValue {
  return evalNode(expr, env, expr);
}

/** Like evaluateConstant but returns undefined instead of throwing. */
export function tryEvaluateConstant(expr: Expr, env: EvalEnv): ConstValue | undefined {
  try {
    return evalNode(expr, env, expr);
  } catch (e) {
    if (e instanceof ModelicaError) return undefined;
    throw e;
  }
}

/** Dotted name of a `ref` (without subscripts). */
export function refName(expr: Expr & { kind: 'ref' }): string {
  return expr.parts.map((p) => p.name).join('.');
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function fail(root: Expr, reason: string): never {
  throw new ModelicaError(`Could not evaluate ${formatExpr(root)}: ${reason}`);
}

function evalNode(e: Expr, env: EvalEnv, root: Expr): ConstValue {
  switch (e.kind) {
    case 'number':
    case 'string':
    case 'boolean':
      return e.value;
    case 'ref': {
      if (e.parts.some((p) => p.subscripts && p.subscripts.length > 0)) {
        return fail(root, 'array subscripts are not supported');
      }
      const name = refName(e);
      if (name === 'time') return fail(root, `'time' is not a constant`);
      const v = env.lookup(name);
      if (v !== undefined) return v;
      const c = MODELICA_CONSTANTS[name];
      if (c !== undefined) return c;
      return fail(root, `'${name}' is not a constant`);
    }
    case 'unary': {
      const v = evalNode(e.operand, env, root);
      switch (e.op) {
        case '-':
          return -num(v, root, `unary '-'`);
        case '+':
          return num(v, root, `unary '+'`);
        case 'not':
          return !bool(v, root, `'not'`);
      }
      return fail(root, `unknown unary operator`);
    }
    case 'binary':
      return evalBinary(e, env, root);
    case 'if': {
      for (const b of e.branches) {
        if (bool(evalNode(b.cond, env, root), root, 'if-condition')) return evalNode(b.value, env, root);
      }
      return evalNode(e.else, env, root);
    }
    case 'call':
      return evalCall(e, env, root);
    case 'array':
      return fail(root, 'array expressions are not supported');
    case 'range':
      return fail(root, 'range expressions are not supported');
    case 'end':
      return fail(root, `'end' is only allowed inside subscripts`);
  }
  return fail(root, 'unknown expression');
}

function evalBinary(e: Expr & { kind: 'binary' }, env: EvalEnv, root: Expr): ConstValue {
  const op = e.op;
  if (op === 'and') {
    const l = bool(evalNode(e.left, env, root), root, `'and'`);
    if (!l) return false;
    return bool(evalNode(e.right, env, root), root, `'and'`);
  }
  if (op === 'or') {
    const l = bool(evalNode(e.left, env, root), root, `'or'`);
    if (l) return true;
    return bool(evalNode(e.right, env, root), root, `'or'`);
  }
  const l = evalNode(e.left, env, root);
  const r = evalNode(e.right, env, root);
  switch (op) {
    case '+':
    case '.+':
      if (typeof l === 'string' || typeof r === 'string') {
        if (typeof l === 'string' && typeof r === 'string') return l + r;
        return fail(root, `cannot add ${typeName(l)} and ${typeName(r)}`);
      }
      return num(l, root, `'+'`) + num(r, root, `'+'`);
    case '-':
    case '.-':
      return num(l, root, `'-'`) - num(r, root, `'-'`);
    case '*':
    case '.*':
      return num(l, root, `'*'`) * num(r, root, `'*'`);
    case '/':
    case './':
      return num(l, root, `'/'`) / num(r, root, `'/'`);
    case '^':
    case '.^':
      return Math.pow(num(l, root, `'^'`), num(r, root, `'^'`));
    case '==':
      return equalValues(l, r, root);
    case '<>':
      return !equalValues(l, r, root);
    case '<':
      return num(l, root, `'<'`) < num(r, root, `'<'`);
    case '<=':
      return num(l, root, `'<='`) <= num(r, root, `'<='`);
    case '>':
      return num(l, root, `'>'`) > num(r, root, `'>'`);
    case '>=':
      return num(l, root, `'>='`) >= num(r, root, `'>='`);
  }
  return fail(root, `unknown operator '${op}'`);
}

function equalValues(l: ConstValue, r: ConstValue, root: Expr): boolean {
  if (typeof l !== typeof r) return fail(root, `cannot compare ${typeName(l)} with ${typeName(r)}`);
  return l === r;
}

function evalCall(e: Expr & { kind: 'call' }, env: EvalEnv, root: Expr): ConstValue {
  const callee = e.callee;
  // Operators that are transparent for constant evaluation.
  if (callee === 'noEvent' || callee === 'smooth' || callee === 'homotopy') {
    const target = callee === 'smooth' ? e.args[1] : e.args[0];
    if (!target) return fail(root, `'${callee}' expects an argument`);
    return evalNode(target, env, root);
  }
  if (NON_CONSTANT_FUNCTIONS.has(callee)) return fail(root, `'${callee}(...)' is not a constant`);
  const args = e.args.map((a) => evalNode(a, env, root));
  if (e.namedArgs.length > 0) {
    if (isBuiltinFunction(callee)) return fail(root, `named arguments are not supported for '${callee}'`);
    for (const na of e.namedArgs) args.push(evalNode(na.value, env, root));
  }
  const b = applyBuiltinFunction(callee, args, root);
  if (b !== undefined) return b;
  const u = env.callFunction?.(callee, args);
  if (u !== undefined) return u;
  return fail(root, `function '${callee}' is not a constant function`);
}

const NON_CONSTANT_FUNCTIONS = new Set([
  'der', 'pre', 'initial', 'terminal', 'sample', 'edge', 'change', 'reinit', 'delay', 'cardinality',
]);

const UNARY_MATH: Record<string, (x: number) => number> = {
  abs: Math.abs,
  sign: (x) => (x > 0 ? 1 : x < 0 ? -1 : 0),
  sqrt: Math.sqrt,
  exp: Math.exp,
  log: Math.log,
  log10: Math.log10,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  floor: Math.floor,
  ceil: Math.ceil,
  integer: Math.floor,
};

const BINARY_MATH: Record<string, (a: number, b: number) => number> = {
  atan2: Math.atan2,
  min: Math.min,
  max: Math.max,
  /** Modelica `mod`: a - floor(a/b)*b (result has the sign of b). */
  mod: (a, b) => a - Math.floor(a / b) * b,
  /** Modelica `rem`: a - div(a,b)*b (result has the sign of a). */
  rem: (a, b) => a - Math.trunc(a / b) * b,
  /** Modelica `div`: algebraic quotient with the fractional part discarded (truncation towards zero). */
  div: (a, b) => Math.trunc(a / b),
};

/** Returns the numeric implementation of a unary builtin (`sin`, `abs`, `floor`, ...) or undefined. */
export function getUnaryBuiltin(callee: string): ((x: number) => number) | undefined {
  return UNARY_MATH[builtinName(callee)];
}

/** Returns the numeric implementation of a binary builtin (`atan2`, `min`, `mod`, ...) or undefined. */
export function getBinaryBuiltin(callee: string): ((a: number, b: number) => number) | undefined {
  return BINARY_MATH[builtinName(callee)];
}

/** Strips a `Modelica.Math.` qualification so that `Modelica.Math.sin` resolves to `sin`. */
export function builtinName(callee: string): string {
  if (callee.startsWith('Modelica.Math.')) return callee.slice('Modelica.Math.'.length);
  if (callee.startsWith('.Modelica.Math.')) return callee.slice('.Modelica.Math.'.length);
  return callee;
}

export function isBuiltinFunction(callee: string): boolean {
  const n = builtinName(callee);
  return n in UNARY_MATH || n in BINARY_MATH || n === 'String' || n === 'Real' || n === 'Integer' || n === 'Boolean';
}

/**
 * Applies a builtin function to already-evaluated arguments. Returns undefined if the name
 * is not a builtin; throws ModelicaError on wrong arity / argument types.
 */
export function applyBuiltinFunction(callee: string, args: ConstValue[], root?: Expr): ConstValue | undefined {
  const name = builtinName(callee);
  const r = root ?? { kind: 'call', callee, args: [], namedArgs: [] };
  const un = UNARY_MATH[name];
  if (un) {
    if (args.length !== 1) return fail(r, `'${name}' expects 1 argument, got ${args.length}`);
    return un(num(args[0], r, `'${name}'`));
  }
  const bi = BINARY_MATH[name];
  if (bi) {
    if (args.length !== 2) return fail(r, `'${name}' expects 2 arguments, got ${args.length}`);
    return bi(num(args[0], r, `'${name}'`), num(args[1], r, `'${name}'`));
  }
  switch (name) {
    case 'String': {
      if (args.length < 1) return fail(r, `'String' expects an argument`);
      const a = args[0];
      return typeof a === 'string' ? a : String(a);
    }
    case 'Real':
      if (args.length !== 1) return fail(r, `'Real' expects 1 argument`);
      return num(args[0], r, `'Real'`);
    case 'Integer':
      if (args.length !== 1) return fail(r, `'Integer' expects 1 argument`);
      return Math.floor(num(args[0], r, `'Integer'`));
    case 'Boolean':
      if (args.length !== 1) return fail(r, `'Boolean' expects 1 argument`);
      return bool(args[0], r, `'Boolean'`);
  }
  return undefined;
}

function typeName(v: ConstValue): string {
  return typeof v === 'number' ? 'Real' : typeof v === 'boolean' ? 'Boolean' : 'String';
}

function num(v: ConstValue, root: Expr, where: string): number {
  if (typeof v === 'number') return v;
  return fail(root, `${where} expects a number but got ${typeName(v)}`);
}

function bool(v: ConstValue, root: Expr, where: string): boolean {
  if (typeof v === 'boolean') return v;
  return fail(root, `${where} expects a Boolean but got ${typeName(v)}`);
}

// ---------------------------------------------------------------------------
// Minimal expression formatter for diagnostics (independent of the pretty-printer).
// ---------------------------------------------------------------------------

const PRECEDENCE: Record<string, number> = {
  or: 1,
  and: 2,
  '<': 4, '<=': 4, '>': 4, '>=': 4, '==': 4, '<>': 4,
  '+': 5, '-': 5, '.+': 5, '.-': 5,
  '*': 6, '/': 6, '.*': 6, './': 6,
  '^': 7, '.^': 7,
};

/** Formats an expression as Modelica source text (used in error messages). */
export function formatExpr(e: Expr, parentPrec = 0): string {
  switch (e.kind) {
    case 'number':
      return formatNumberLiteral(e.value);
    case 'string':
      return JSON.stringify(e.value);
    case 'boolean':
      return e.value ? 'true' : 'false';
    case 'ref':
      return (
        (e.global ? '.' : '') +
        e.parts
          .map((p) => (p.subscripts && p.subscripts.length ? `${p.name}[${p.subscripts.map((s) => formatExpr(s)).join(', ')}]` : p.name))
          .join('.')
      );
    case 'unary': {
      const inner = formatExpr(e.operand, 8);
      const s = e.op === 'not' ? `not ${inner}` : `${e.op}${inner}`;
      return parentPrec > 3 && e.op === 'not' ? `(${s})` : s;
    }
    case 'binary': {
      const p = PRECEDENCE[e.op] ?? 5;
      const s = `${formatExpr(e.left, p)} ${e.op} ${formatExpr(e.right, p + 1)}`;
      return p < parentPrec ? `(${s})` : s;
    }
    case 'if': {
      const s =
        e.branches.map((b, i) => `${i === 0 ? 'if' : 'elseif'} ${formatExpr(b.cond)} then ${formatExpr(b.value)}`).join(' ') +
        ` else ${formatExpr(e.else)}`;
      return parentPrec > 0 ? `(${s})` : s;
    }
    case 'call': {
      const args = e.args.map((a) => formatExpr(a));
      for (const na of e.namedArgs) args.push(`${na.name} = ${formatExpr(na.value)}`);
      return `${e.callee}(${args.join(', ')})`;
    }
    case 'array':
      return `{${e.elements.map((x) => formatExpr(x)).join(', ')}}`;
    case 'range':
      return e.step ? `${formatExpr(e.start)}:${formatExpr(e.step)}:${formatExpr(e.end)}` : `${formatExpr(e.start)}:${formatExpr(e.end)}`;
    case 'end':
      return 'end';
  }
  return '?';
}

function formatNumberLiteral(v: number): string {
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  return String(v);
}
