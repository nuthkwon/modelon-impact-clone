/**
 * Parameter / constant evaluation and attribute evaluation.
 *
 * Values are computed lazily (`getParamValue`) so that conditional-component conditions and
 * if-equation conditions can use parameter values while the model is still being built.
 * Bindings are flattened on demand, evaluated in dependency order through recursion, and
 * cycles are reported as errors.
 */
import { ModelicaError, type Expr } from '../ast.js';
import type { BaseType, VariableAttributes } from '../flat.js';
import { printExpr } from '../parser/printer.js';
import { evaluateConstant, tryEvaluateConstant, type ConstValue, type EvalEnv } from './evaluate.js';
import { flattenExpr } from './scope.js';
import { diag, error, fileOf, isParamLike, type Ctx, type VariableInstance } from './types.js';

const ATTRIBUTE_NAMES = ['start', 'fixed', 'min', 'max', 'nominal', 'unit', 'displayUnit', 'quantity', 'stateSelect'] as const;
const STATE_SELECT = new Set(['never', 'avoid', 'default', 'prefer', 'always']);

export function isAttributeName(name: string): boolean {
  return (ATTRIBUTE_NAMES as readonly string[]).includes(name);
}

/** Flattens the binding expression of `v` (once). */
export function ensureBindingFlattened(ctx: Ctx, v: VariableInstance): Expr | undefined {
  if (v.bindingFlattened) return v.flatBinding;
  v.bindingFlattened = true;
  if (v.binding) v.flatBinding = flattenExpr(ctx, v.binding.expr, v.binding.scope);
  return v.flatBinding;
}

/** Flattens the attribute expressions of `v` (once). */
export function ensureAttributesFlattened(ctx: Ctx, v: VariableInstance): Map<string, Expr> {
  if (v.flatAttributes) return v.flatAttributes;
  const out = new Map<string, Expr>();
  v.flatAttributes = out;
  for (const [name, se] of v.attributeMods) out.set(name, flattenExpr(ctx, se.expr, se.scope));
  return out;
}

/** Evaluation environment resolving flat parameter/constant names to their values (lazily). */
export function paramEnv(ctx: Ctx): EvalEnv {
  return {
    lookup(name: string): ConstValue | undefined {
      const v = ctx.varsByPath.get(name);
      if (!v || !isParamLike(v)) return undefined;
      return getParamValue(ctx, v);
    },
  };
}

function typeOfValue(value: ConstValue): string {
  return typeof value === 'number' ? 'Real' : typeof value === 'boolean' ? 'Boolean' : 'String';
}

/** Coerces an evaluated value to the variable's type, throwing on incompatible types. */
export function coerceToType(value: ConstValue, type: BaseType, enumerationLiterals: string[] | undefined, name: string, what: string): ConstValue {
  switch (type) {
    case 'Real':
      if (typeof value === 'number') return value;
      if (typeof value === 'boolean') break;
      break;
    case 'Integer':
      if (typeof value === 'number') return Number.isInteger(value) ? value : Math.trunc(value);
      break;
    case 'Boolean':
      if (typeof value === 'boolean') return value;
      break;
    case 'String':
      if (typeof value === 'string') {
        if (enumerationLiterals && !enumerationLiterals.includes(value)) {
          throw new ModelicaError(`${what} of '${name}' is '${value}' which is not a literal of its enumeration type (${enumerationLiterals.join(', ')})`);
        }
        return value;
      }
      break;
  }
  const typeName = enumerationLiterals ? 'enumeration' : type;
  throw new ModelicaError(`${what} of '${name}' has type ${typeOfValue(value)} but the variable is of type ${typeName}`);
}

function defaultValue(type: BaseType): ConstValue {
  switch (type) {
    case 'Boolean':
      return false;
    case 'String':
      return '';
    default:
      return 0;
  }
}

/** Returns (computing and caching) the value of a parameter or constant variable. */
export function getParamValue(ctx: Ctx, v: VariableInstance): ConstValue {
  if (v.value !== undefined) return v.value;
  const file = fileOf(ctx, v.declaredIn);
  const opts = { path: v.path, loc: v.decl.loc, file };
  if (ctx.paramVisiting.has(v.path)) {
    throw error(`Parameter '${v.path}' has a cyclic binding`, opts);
  }
  ctx.paramVisiting.add(v.path);
  try {
    const env = paramEnv(ctx);
    const binding = ensureBindingFlattened(ctx, v);
    let value: ConstValue;
    if (binding) {
      value = coerceToType(evaluateConstant(binding, env), v.type, v.enumerationLiterals, v.path, 'Binding');
    } else {
      const attrs = ensureAttributesFlattened(ctx, v);
      const startExpr = attrs.get('start');
      const start = startExpr ? tryEvaluateConstant(startExpr, env) : undefined;
      value = start !== undefined ? coerceToType(start, v.type, v.enumerationLiterals, v.path, 'Start value') : defaultValue(v.type);
      const shown = typeof value === 'string' ? JSON.stringify(value) : String(value);
      diag(ctx, 'warning', `${v.variability === 'constant' ? 'Constant' : 'Parameter'} '${v.path}' has no value; using start value ${shown}`, opts);
    }
    v.value = value;
    return value;
  } catch (e) {
    if (e instanceof ModelicaError && !/cyclic binding|has no value/.test(e.message) && !e.diagnostics.some((d) => d.loc)) {
      throw error(`Could not evaluate ${v.variability} '${v.path}': ${e.message}`, opts);
    }
    throw e;
  } finally {
    ctx.paramVisiting.delete(v.path);
  }
}

/** Evaluates every parameter/constant (in declaration order) and every variable's attributes. */
export function evaluateAll(ctx: Ctx, vars: VariableInstance[]): void {
  for (const v of vars) {
    if (isParamLike(v)) getParamValue(ctx, v);
  }
  const env = paramEnv(ctx);
  for (const v of vars) {
    const flat = v.flat!;
    flat.attributes = evaluateAttributes(ctx, v, env);
    if (isParamLike(v)) {
      flat.value = v.value;
      if (flat.attributes.fixed === false) {
        diag(ctx, 'warning', `Parameter '${v.path}' has fixed=false, which is not supported; its start/binding value is used`, {
          path: v.path,
          loc: v.decl.loc,
          file: fileOf(ctx, v.declaredIn),
        });
      }
    }
  }
}

function evaluateAttributes(ctx: Ctx, v: VariableInstance, env: EvalEnv): VariableAttributes {
  const out: VariableAttributes = {};
  const attrs = ensureAttributesFlattened(ctx, v);
  const opts = { path: v.path, loc: v.decl.loc, file: fileOf(ctx, v.declaredIn) };
  for (const [name, expr] of attrs) {
    const value = tryEvaluateConstant(expr, env);
    if (value === undefined) {
      diag(ctx, 'warning', `Attribute '${name}' of '${v.path}' is not a constant expression (${printExpr(expr)}); ignored`, opts);
      continue;
    }
    switch (name) {
      case 'start':
        out.start = typeof value === 'number' && v.type === 'Boolean' ? value !== 0 : value;
        if (v.type === 'Real' && typeof value === 'boolean') out.start = value ? 1 : 0;
        break;
      case 'fixed':
        if (typeof value !== 'boolean') throw error(`Attribute 'fixed' of '${v.path}' must be a Boolean`, opts);
        out.fixed = value;
        break;
      case 'min':
      case 'max':
      case 'nominal':
        if (typeof value !== 'number') throw error(`Attribute '${name}' of '${v.path}' must be a number`, opts);
        out[name] = value;
        break;
      case 'unit':
      case 'displayUnit':
      case 'quantity':
        if (typeof value !== 'string') throw error(`Attribute '${name}' of '${v.path}' must be a String`, opts);
        out[name] = value;
        break;
      case 'stateSelect':
        if (typeof value !== 'string' || !STATE_SELECT.has(value)) throw error(`Attribute 'stateSelect' of '${v.path}' must be a StateSelect literal`, opts);
        out.stateSelect = value as VariableAttributes['stateSelect'];
        break;
    }
  }
  return out;
}
