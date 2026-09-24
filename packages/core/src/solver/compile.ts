/**
 * Turns a `FlatModel` into residual closures over `Float64Array`s.
 *
 * Layout of the unknown vector `v` (length nU):
 *   [0, nS)            states            (variables appearing as `der(x)`)
 *   [nS, nS+nA)        algebraics        (continuous + discrete variables without when-equations)
 *   [nS+nA, nU)        when-discretes    (variables assigned in when-clauses; held between events)
 * `dv` (length nS) holds the state derivatives.
 *
 * Parameters and constants are baked in as numbers. Relational expressions (`<`, `<=`, `>`,
 * `>=`) that are not constant become zero-crossing "relations": during a step their Boolean
 * value is frozen (`ctx.frozen`) so that residuals stay smooth for Newton; the event handler
 * re-evaluates them after each step and locates crossings by bisection.
 */
import { ModelicaError, type Diagnostic, type Expr } from '../ast.js';
import type { BaseType, FlatEquation, FlatEquationKind, FlatModel, FlatVariable } from '../flat.js';
import type { SimulationOptions } from '../simulation.js';
import {
  evaluateConstant,
  formatExpr,
  getBinaryBuiltin,
  getUnaryBuiltin,
  refName,
  tryEvaluateConstant,
  type ConstValue,
  type EvalEnv,
} from '../flatten/evaluate.js';

export interface EvalContext {
  t: number;
  v: Float64Array;
  dv: Float64Array;
  /** Values before the current event (`pre(x)`), same layout as `v`. */
  pre: Float64Array;
  /** Frozen Boolean values (0/1) of the zero-crossing relations. */
  relVals: Uint8Array;
  /** When true relations read `relVals`; when false they are evaluated from their operands. */
  frozen: boolean;
  /** 1 for `sample(...)` operators that fire at the current time event. */
  sampleActive: Uint8Array;
  /** `initial()` */
  initial: boolean;
}

/** Compiled expression. Boolean results are 0/1; any value >= 0.5 counts as true. */
export type Fn = (ctx: EvalContext) => number;

export type UnknownKind = 'state' | 'algebraic' | 'discrete';

export interface UnknownInfo {
  name: string;
  index: number;
  kind: UnknownKind;
  type: BaseType;
  start: number;
  nominal: number;
  fixed?: boolean;
  min?: number;
  max?: number;
  variable: FlatVariable;
}

export interface CompiledResidual {
  index: number;
  fn: Fn;
  origin: string;
  text: string;
  kind: FlatEquationKind;
}

export type RelationOp = '<' | '<=' | '>' | '>=';

export interface CompiledRelation {
  index: number;
  op: RelationOp;
  left: Fn;
  right: Fn;
  text: string;
}

export type WhenAction =
  | { kind: 'reinit'; target: number; value: Fn; text: string }
  | { kind: 'assign'; target: number; value: Fn; text: string };

export interface CompiledWhen {
  index: number;
  cond: Fn;
  actions: WhenAction[];
  origin: string;
  text: string;
}

export interface Sampler {
  index: number;
  start: number;
  interval: number;
}

export interface CompiledParameter {
  variable: FlatVariable;
  value: ConstValue;
}

export interface CompiledModel {
  flat: FlatModel;
  unknowns: UnknownInfo[];
  /** Name -> index in `v`. */
  index: Map<string, number>;
  nS: number;
  nA: number;
  nD: number;
  nU: number;
  parameters: CompiledParameter[];
  paramValues: Map<string, ConstValue>;
  residuals: CompiledResidual[];
  initialResiduals: CompiledResidual[];
  whens: CompiledWhen[];
  relations: CompiledRelation[];
  samplers: Sampler[];
  /** Non-fatal findings collected while compiling (reported to the simulation log). */
  warnings: string[];
}

export function createContext(m: CompiledModel): EvalContext {
  return {
    t: 0,
    v: new Float64Array(m.nU),
    dv: new Float64Array(m.nS),
    pre: new Float64Array(m.nU),
    relVals: new Uint8Array(m.relations.length),
    frozen: true,
    sampleActive: new Uint8Array(m.samplers.length),
    initial: false,
  };
}

export function relationHolds(op: RelationOp, l: number, r: number): boolean {
  switch (op) {
    case '<':
      return l < r;
    case '<=':
      return l <= r;
    case '>':
      return l > r;
    case '>=':
      return l >= r;
  }
}

/** Zero-crossing indicator of a relation: positive when the relation holds (with `<=`/`>=` treated like the strict variants). */
export function relationIndicator(op: RelationOp, l: number, r: number): number {
  return op === '<' || op === '<=' ? r - l : l - r;
}

export function equationText(eq: FlatEquation): string {
  return `${formatExpr(eq.left)} = ${formatExpr(eq.right)}`;
}

// ---------------------------------------------------------------------------

export function compileModel(flat: FlatModel, options: SimulationOptions): CompiledModel {
  const warnings: string[] = [];
  const varByName = new Map<string, FlatVariable>();
  for (const v of flat.variables) varByName.set(v.name, v);

  // ---- parameters & constants -------------------------------------------------------------
  const paramValues = new Map<string, ConstValue>();
  const isParam = (v: FlatVariable) => v.variability === 'parameter' || v.variability === 'constant';
  for (const v of flat.variables) {
    if (isParam(v) && v.value !== undefined) paramValues.set(v.name, v.value);
  }
  for (const [name, raw] of Object.entries(options.modifiers ?? {})) {
    const v = varByName.get(name);
    if (!v || !isParam(v)) {
      warnings.push(`Modifier '${name}' does not refer to a parameter of ${flat.className}; ignored`);
      continue;
    }
    paramValues.set(name, coerceValue(raw, v.type, name));
  }
  const visiting = new Set<string>();
  const env: EvalEnv = {
    lookup(name: string): ConstValue | undefined {
      const cached = paramValues.get(name);
      if (cached !== undefined) return cached;
      const v = varByName.get(name);
      if (!v || !isParam(v)) return undefined;
      if (visiting.has(name)) {
        throw new ModelicaError(`Parameter '${name}' has a cyclic binding`);
      }
      let value: ConstValue | undefined;
      if (v.binding) {
        visiting.add(name);
        try {
          value = evaluateConstant(v.binding, env);
        } finally {
          visiting.delete(name);
        }
      } else if (v.attributes.start !== undefined) {
        value = v.attributes.start;
      }
      if (value !== undefined) paramValues.set(name, value);
      return value;
    },
  };
  const parameters: CompiledParameter[] = [];
  for (const v of flat.variables) {
    if (!isParam(v)) continue;
    let value = env.lookup(v.name);
    if (value === undefined) {
      if (v.type === 'Real' || v.type === 'Integer') {
        value = 0;
        warnings.push(`Parameter '${v.name}' has no value; using 0`);
      } else if (v.type === 'Boolean') {
        value = false;
        warnings.push(`Parameter '${v.name}' has no value; using false`);
      } else {
        throw new ModelicaError(`Parameter '${v.name}' has no value`);
      }
      paramValues.set(v.name, value);
    }
    parameters.push({ variable: v, value });
  }

  // ---- states and when-assigned variables ------------------------------------------------
  const stateNames = new Set<string>();
  const collectDer = (e: Expr | undefined): void => {
    if (!e) return;
    switch (e.kind) {
      case 'call':
        if (e.callee === 'der' && e.args.length === 1 && e.args[0].kind === 'ref') stateNames.add(refName(e.args[0]));
        e.args.forEach(collectDer);
        e.namedArgs.forEach((n) => collectDer(n.value));
        break;
      case 'binary':
        collectDer(e.left);
        collectDer(e.right);
        break;
      case 'unary':
        collectDer(e.operand);
        break;
      case 'if':
        e.branches.forEach((b) => {
          collectDer(b.cond);
          collectDer(b.value);
        });
        collectDer(e.else);
        break;
      case 'array':
        e.elements.forEach(collectDer);
        break;
      case 'range':
        collectDer(e.start);
        collectDer(e.step);
        collectDer(e.end);
        break;
      default:
        break;
    }
  };
  for (const eq of flat.equations) {
    collectDer(eq.left);
    collectDer(eq.right);
  }
  for (const eq of flat.initialEquations) {
    collectDer(eq.left);
    collectDer(eq.right);
  }
  for (const w of flat.whenClauses) {
    collectDer(w.cond);
    for (const eq of w.equations) {
      collectDer(eq.left);
      collectDer(eq.right);
    }
  }
  for (const name of stateNames) {
    const v = varByName.get(name);
    if (!v) throw new ModelicaError(`der(${name}): unknown variable '${name}'`);
    if (isParam(v)) throw new ModelicaError(`der(${name}): '${name}' is a ${v.variability} and cannot be differentiated`);
    if (v.type !== 'Real') throw new ModelicaError(`der(${name}): only Real variables can be differentiated ('${name}' is ${v.type})`);
  }

  const whenTargets = new Set<string>();
  for (const w of flat.whenClauses) {
    for (const eq of w.equations) {
      if (eq.left.kind === 'call' && eq.left.callee === 'reinit') continue;
      if (eq.left.kind !== 'ref') {
        throw new ModelicaError(`Invalid when-equation '${equationText(eq)}' in ${w.origin}: the left-hand side must be a variable`);
      }
      const name = refName(eq.left);
      const v = varByName.get(name);
      if (!v) throw new ModelicaError(`Unknown variable '${name}' assigned in when-clause (${w.origin})`);
      if (isParam(v)) throw new ModelicaError(`Cannot assign ${v.variability} '${name}' in a when-clause (${w.origin})`);
      if (stateNames.has(name)) {
        throw new ModelicaError(`State '${name}' cannot be assigned in a when-clause; use reinit(${name}, ...) instead (${w.origin})`);
      }
      whenTargets.add(name);
    }
  }

  // ---- unknown layout ---------------------------------------------------------------------
  const unknownVars = flat.variables.filter((v) => v.variability === 'continuous' || v.variability === 'discrete');
  for (const v of unknownVars) {
    if (v.type === 'String') throw new ModelicaError(`String variable '${v.name}' cannot be simulated (only String parameters/constants are supported)`);
  }
  const stateVars = unknownVars.filter((v) => stateNames.has(v.name));
  const discVars = unknownVars.filter((v) => !stateNames.has(v.name) && whenTargets.has(v.name));
  const algVars = unknownVars.filter((v) => !stateNames.has(v.name) && !whenTargets.has(v.name));
  const nS = stateVars.length;
  const nA = algVars.length;
  const nD = discVars.length;
  const nU = nS + nA + nD;

  const unknowns: UnknownInfo[] = [];
  const index = new Map<string, number>();
  const push = (v: FlatVariable, kind: UnknownKind) => {
    const i = unknowns.length;
    unknowns.push({
      name: v.name,
      index: i,
      kind,
      type: v.type,
      start: startValue(v),
      nominal: nominalValue(v),
      fixed: v.attributes.fixed,
      min: v.attributes.min,
      max: v.attributes.max,
      variable: v,
    });
    index.set(v.name, i);
  };
  stateVars.forEach((v) => push(v, 'state'));
  algVars.forEach((v) => push(v, 'algebraic'));
  discVars.forEach((v) => push(v, 'discrete'));

  // ---- balance check ----------------------------------------------------------------------
  const nEq = flat.equations.length + nD;
  if (nEq !== nU) {
    const eqList = flat.equations.map((e) => `  ${equationText(e)}    [${e.origin}]`);
    for (const w of flat.whenClauses) {
      for (const eq of w.equations) {
        if (eq.left.kind === 'ref') eqList.push(`  when ${formatExpr(w.cond)}: ${equationText(eq)}    [${w.origin}]`);
      }
    }
    const varList = unknowns.map((u) => `  ${u.name}${u.kind === 'state' ? ' (state)' : u.kind === 'discrete' ? ' (discrete)' : ''}`);
    const message =
      `The model is not balanced: ${nEq} equation${nEq === 1 ? '' : 's'}, ${nU} variable${nU === 1 ? '' : 's'} (${flat.className})`;
    const diagnostics: Diagnostic[] = [
      { severity: 'error', message, path: flat.className, code: 'unbalanced' },
      { severity: 'info', message: `Variables (${nU}):\n${varList.join('\n')}`, path: flat.className },
      { severity: 'info', message: `Equations (${nEq}):\n${eqList.join('\n')}`, path: flat.className },
    ];
    throw new ModelicaError(`${message}\nVariables (${nU}):\n${varList.join('\n')}\nEquations (${nEq}):\n${eqList.join('\n')}`, diagnostics);
  }

  // ---- expression compiler ----------------------------------------------------------------
  const relations: CompiledRelation[] = [];
  const samplers: Sampler[] = [];

  interface Mode {
    noEvent: boolean;
    inWhen: boolean;
    where: string;
  }

  const fail = (mode: Mode, msg: string): never => {
    throw new ModelicaError(`${msg} (in ${mode.where})`);
  };

  const constFn = (c: ConstValue, mode: Mode, e: Expr): Fn => {
    if (typeof c === 'number') {
      return () => c;
    }
    if (typeof c === 'boolean') {
      const n = c ? 1 : 0;
      return () => n;
    }
    return fail(mode, `String value '${c}' of ${formatExpr(e)} cannot be used in a numeric expression`);
  };

  const compile = (e: Expr, mode: Mode): Fn => {
    const c = tryEvaluateConstant(e, env);
    if (c !== undefined) return constFn(c, mode, e);
    switch (e.kind) {
      case 'number':
      case 'boolean':
      case 'string':
        return constFn(e.value, mode, e);
      case 'ref': {
        if (e.parts.some((p) => p.subscripts && p.subscripts.length > 0)) {
          return fail(mode, `Array subscripts are not supported: ${formatExpr(e)}`);
        }
        const name = refName(e);
        if (name === 'time') return (ctx) => ctx.t;
        const i = index.get(name);
        if (i !== undefined) return (ctx) => ctx.v[i];
        const p = env.lookup(name);
        if (p !== undefined) return constFn(p, mode, e);
        return fail(mode, `Unknown variable '${name}'`);
      }
      case 'unary': {
        const a = compile(e.operand, mode);
        switch (e.op) {
          case '-':
            return (ctx) => -a(ctx);
          case '+':
            return a;
          case 'not':
            return (ctx) => (a(ctx) >= 0.5 ? 0 : 1);
        }
        return fail(mode, `Unknown unary operator '${(e as { op: string }).op}'`);
      }
      case 'binary':
        return compileBinary(e, mode);
      case 'if': {
        let result: Fn = compile(e.else, mode);
        for (let i = e.branches.length - 1; i >= 0; i--) {
          const cond = compile(e.branches[i].cond, mode);
          const val = compile(e.branches[i].value, mode);
          const next = result;
          result = (ctx) => (cond(ctx) >= 0.5 ? val(ctx) : next(ctx));
        }
        return result;
      }
      case 'call':
        return compileCall(e, mode);
      case 'array':
      case 'range':
        return fail(mode, `Array expressions are not supported: ${formatExpr(e)}`);
      case 'end':
        return fail(mode, `'end' is only allowed inside subscripts`);
    }
    return fail(mode, `Unsupported expression ${formatExpr(e as Expr)}`);
  };

  const compileBinary = (e: Expr & { kind: 'binary' }, mode: Mode): Fn => {
    const op = e.op;
    if (op === 'and') {
      const l = compile(e.left, mode);
      const r = compile(e.right, mode);
      return (ctx) => (l(ctx) >= 0.5 && r(ctx) >= 0.5 ? 1 : 0);
    }
    if (op === 'or') {
      const l = compile(e.left, mode);
      const r = compile(e.right, mode);
      return (ctx) => (l(ctx) >= 0.5 || r(ctx) >= 0.5 ? 1 : 0);
    }
    const l = compile(e.left, mode);
    const r = compile(e.right, mode);
    switch (op) {
      case '+':
      case '.+':
        return (ctx) => l(ctx) + r(ctx);
      case '-':
      case '.-':
        return (ctx) => l(ctx) - r(ctx);
      case '*':
      case '.*':
        return (ctx) => l(ctx) * r(ctx);
      case '/':
      case './':
        return (ctx) => l(ctx) / r(ctx);
      case '^':
      case '.^':
        return (ctx) => Math.pow(l(ctx), r(ctx));
      case '==':
        return (ctx) => (l(ctx) === r(ctx) ? 1 : 0);
      case '<>':
        return (ctx) => (l(ctx) !== r(ctx) ? 1 : 0);
      case '<':
      case '<=':
      case '>':
      case '>=': {
        if (mode.noEvent) {
          switch (op) {
            case '<':
              return (ctx) => (l(ctx) < r(ctx) ? 1 : 0);
            case '<=':
              return (ctx) => (l(ctx) <= r(ctx) ? 1 : 0);
            case '>':
              return (ctx) => (l(ctx) > r(ctx) ? 1 : 0);
            case '>=':
              return (ctx) => (l(ctx) >= r(ctx) ? 1 : 0);
          }
        }
        const idx = relations.length;
        relations.push({ index: idx, op, left: l, right: r, text: formatExpr(e) });
        switch (op) {
          case '<':
            return (ctx) => (ctx.frozen ? ctx.relVals[idx] : l(ctx) < r(ctx) ? 1 : 0);
          case '<=':
            return (ctx) => (ctx.frozen ? ctx.relVals[idx] : l(ctx) <= r(ctx) ? 1 : 0);
          case '>':
            return (ctx) => (ctx.frozen ? ctx.relVals[idx] : l(ctx) > r(ctx) ? 1 : 0);
          case '>=':
            return (ctx) => (ctx.frozen ? ctx.relVals[idx] : l(ctx) >= r(ctx) ? 1 : 0);
        }
      }
    }
    return fail(mode, `Unsupported operator '${op}'`);
  };

  const unknownRefArg = (e: Expr & { kind: 'call' }, mode: Mode): UnknownInfo | undefined => {
    if (e.args.length !== 1) return fail(mode, `'${e.callee}' expects exactly one argument: ${formatExpr(e)}`);
    const a = e.args[0];
    if (a.kind !== 'ref') return fail(mode, `'${e.callee}' expects a variable reference: ${formatExpr(e)}`);
    const name = refName(a);
    const i = index.get(name);
    if (i === undefined) {
      if (env.lookup(name) !== undefined) return undefined; // parameter: handled by caller as constant
      return fail(mode, `Unknown variable '${name}' in ${formatExpr(e)}`);
    }
    return unknowns[i];
  };

  const compileCall = (e: Expr & { kind: 'call' }, mode: Mode): Fn => {
    const callee = e.callee;
    switch (callee) {
      case 'der': {
        const u = unknownRefArg(e, mode);
        if (!u) return fail(mode, `Cannot differentiate a parameter: ${formatExpr(e)}`);
        if (u.kind !== 'state') return fail(mode, `Internal error: '${u.name}' is not a state`);
        const si = u.index;
        return (ctx) => ctx.dv[si];
      }
      case 'pre': {
        const u = unknownRefArg(e, mode);
        if (!u) return compile(e.args[0], mode);
        const i = u.index;
        if (mode.inWhen || u.kind === 'discrete' || u.type !== 'Real') return (ctx) => ctx.pre[i];
        return (ctx) => ctx.v[i];
      }
      case 'edge': {
        const u = unknownRefArg(e, mode);
        if (!u) return () => 0;
        const i = u.index;
        return (ctx) => (ctx.v[i] >= 0.5 && ctx.pre[i] < 0.5 ? 1 : 0);
      }
      case 'change': {
        const u = unknownRefArg(e, mode);
        if (!u) return () => 0;
        const i = u.index;
        return (ctx) => (Math.abs(ctx.v[i] - ctx.pre[i]) >= 0.5 ? 1 : 0);
      }
      case 'initial':
        return (ctx) => (ctx.initial ? 1 : 0);
      case 'terminal':
        return () => 0;
      case 'sample': {
        if (e.args.length !== 2) return fail(mode, `'sample' expects 2 arguments: ${formatExpr(e)}`);
        const start = evaluateConstant(e.args[0], env);
        const interval = evaluateConstant(e.args[1], env);
        if (typeof start !== 'number' || typeof interval !== 'number') return fail(mode, `'sample' expects numeric arguments: ${formatExpr(e)}`);
        if (!(interval > 0)) return fail(mode, `'sample' interval must be positive: ${formatExpr(e)}`);
        const k = samplers.length;
        samplers.push({ index: k, start, interval });
        return (ctx) => ctx.sampleActive[k];
      }
      case 'noEvent': {
        if (e.args.length !== 1) return fail(mode, `'noEvent' expects 1 argument: ${formatExpr(e)}`);
        return compile(e.args[0], { ...mode, noEvent: true });
      }
      case 'smooth': {
        if (e.args.length !== 2) return fail(mode, `'smooth' expects 2 arguments: ${formatExpr(e)}`);
        return compile(e.args[1], mode);
      }
      case 'homotopy': {
        const actual = e.args[0] ?? e.namedArgs.find((n) => n.name === 'actual')?.value;
        if (!actual) return fail(mode, `'homotopy' expects an 'actual' argument: ${formatExpr(e)}`);
        return compile(actual, mode);
      }
      case 'semiLinear': {
        if (e.args.length !== 3) return fail(mode, `'semiLinear' expects 3 arguments: ${formatExpr(e)}`);
        const x = compile(e.args[0], mode);
        const kp = compile(e.args[1], mode);
        const kn = compile(e.args[2], mode);
        return (ctx) => {
          const xv = x(ctx);
          return xv >= 0 ? kp(ctx) * xv : kn(ctx) * xv;
        };
      }
      case 'reinit':
        return fail(mode, `'reinit' is only allowed as a statement inside a when-clause`);
      case 'assert':
      case 'terminate':
        return fail(mode, `'${callee}' is not supported inside expressions`);
    }
    if (e.namedArgs.length > 0) return fail(mode, `Named arguments are not supported for '${callee}': ${formatExpr(e)}`);
    const un = getUnaryBuiltin(callee);
    if (un) {
      if (e.args.length !== 1) return fail(mode, `'${callee}' expects 1 argument: ${formatExpr(e)}`);
      const a = compile(e.args[0], mode);
      return (ctx) => un(a(ctx));
    }
    const bi = getBinaryBuiltin(callee);
    if (bi) {
      if (e.args.length !== 2) return fail(mode, `'${callee}' expects 2 arguments: ${formatExpr(e)}`);
      const a = compile(e.args[0], mode);
      const b = compile(e.args[1], mode);
      return (ctx) => bi(a(ctx), b(ctx));
    }
    return fail(mode, `Function '${callee}' is not supported in equations`);
  };

  const compileEquation = (eq: FlatEquation, i: number): CompiledResidual => {
    const text = equationText(eq);
    const mode: Mode = { noEvent: false, inWhen: false, where: `equation '${text}' from ${eq.origin}` };
    const l = compile(eq.left, mode);
    const r = compile(eq.right, mode);
    return { index: i, fn: (ctx) => l(ctx) - r(ctx), origin: eq.origin, text, kind: eq.kind };
  };

  const residuals = flat.equations.map(compileEquation);
  const initialResiduals = flat.initialEquations.map(compileEquation);

  const whens: CompiledWhen[] = flat.whenClauses.map((w, wi) => {
    const condText = formatExpr(w.cond);
    const cond = compile(w.cond, { noEvent: false, inWhen: false, where: `when-condition '${condText}' from ${w.origin}` });
    const actions: WhenAction[] = w.equations.map((eq) => {
      const text = equationText(eq);
      const mode: Mode = { noEvent: false, inWhen: true, where: `when-equation '${text}' from ${w.origin}` };
      if (eq.left.kind === 'call' && eq.left.callee === 'reinit') {
        const call = eq.left;
        if (call.args.length !== 2 || call.args[0].kind !== 'ref') {
          return fail(mode, `'reinit' expects (state, expression): ${formatExpr(call)}`);
        }
        const name = refName(call.args[0]);
        const i = index.get(name);
        if (i === undefined || unknowns[i].kind !== 'state') {
          return fail(mode, `reinit(${name}, ...): '${name}' is not a state`);
        }
        return { kind: 'reinit', target: i, value: compile(call.args[1], mode), text: formatExpr(call) };
      }
      const name = refName(eq.left as Expr & { kind: 'ref' });
      const i = index.get(name)!;
      return { kind: 'assign', target: i, value: compile(eq.right, mode), text };
    });
    return { index: wi, cond, actions, origin: w.origin, text: `when ${condText}` };
  });

  return {
    flat,
    unknowns,
    index,
    nS,
    nA,
    nD,
    nU,
    parameters,
    paramValues,
    residuals,
    initialResiduals,
    whens,
    relations,
    samplers,
    warnings,
  };
}

// ---------------------------------------------------------------------------

function coerceValue(raw: number | boolean | string, type: BaseType, name: string): ConstValue {
  if (type === 'String') return String(raw);
  if (type === 'Boolean') {
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') return raw !== 0;
    const s = raw.trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
    throw new ModelicaError(`Modifier '${name}' must be a Boolean, got '${raw}'`);
  }
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  const n = Number(raw.trim());
  if (!Number.isFinite(n)) throw new ModelicaError(`Modifier '${name}' must be a number, got '${raw}'`);
  return n;
}

function startValue(v: FlatVariable): number {
  const s = v.attributes.start;
  if (s === undefined) return 0;
  if (typeof s === 'number') return Number.isFinite(s) ? s : 0;
  if (typeof s === 'boolean') return s ? 1 : 0;
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  throw new ModelicaError(`Start value of '${v.name}' is not numeric: '${s}'`);
}

function nominalValue(v: FlatVariable): number {
  const n = v.attributes.nominal;
  if (n === undefined || !Number.isFinite(n) || n === 0) return 1;
  return Math.abs(n);
}
