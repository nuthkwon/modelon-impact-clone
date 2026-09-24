/**
 * Expression flattening: rewrites an expression written inside a class into the flat
 * namespace of the instantiated model.
 *
 * - component references become flat refs (`resistor.p.v`);
 * - `time` is kept;
 * - class-level constants (`Modelica.Constants.pi`, imported constants, constants of enclosing
 *   packages) are evaluated and inlined as literals;
 * - enumeration literals (`Init.SteadyState`, `StateSelect.prefer`) become string literals;
 *   relational operators and `Integer()` on enumeration operands are rewritten to the 1-based
 *   ordinals of the literals (parameter operands are evaluated for that);
 * - builtin function calls pass through (a `Modelica.Math.` qualifier is stripped), any other
 *   call is an error.
 */
import type { Expr, RefPart, SourceLoc } from '../ast.js';
import { flatRef } from '../flat.js';
import { printExpr } from '../parser/printer.js';
import type { RegisteredClass } from '../registry.js';
import { builtinName, evaluateConstant, getBinaryBuiltin, getUnaryBuiltin, MODELICA_CONSTANTS, type ConstValue } from './evaluate.js';
import { getParamValue } from './parameters.js';
import { error, fileOf, isParamLike, pathOf, type ClassInstance, type Ctx, type Instance, type Scope, type VariableInstance } from './types.js';

const STATE_SELECT_ORDER = ['never', 'avoid', 'default', 'prefer', 'always'];
const STATE_SELECT_LITERALS = new Set(STATE_SELECT_ORDER);
const RELATIONAL_OPS = new Set(['<', '<=', '>', '>=']);

/** Builtin operators/functions that are passed through to the solver. */
const PASSTHROUGH_FUNCTIONS = new Set([
  'der', 'pre', 'initial', 'terminal', 'sample', 'edge', 'change', 'noEvent', 'smooth', 'homotopy', 'semiLinear',
  'String', 'Real', 'Integer', 'Boolean',
]);

export type ResolvedRef =
  | { kind: 'instance'; inst: Instance }
  | { kind: 'time' }
  | { kind: 'literal'; expr: Expr };

function literal(value: ConstValue, loc?: SourceLoc): Expr {
  if (typeof value === 'number') return { kind: 'number', value, loc };
  if (typeof value === 'boolean') return { kind: 'boolean', value, loc };
  return { kind: 'string', value, loc };
}

function unknownIdentifier(ctx: Ctx, name: string, scope: Scope, loc?: SourceLoc, detail?: string): never {
  throw error(`Unknown identifier '${name}' in ${scope.cls.fullName}${detail ? `: ${detail}` : ''}`, {
    path: pathOf(scope),
    loc,
    file: fileOf(ctx, scope.cls),
  });
}

/** Resolves a component reference in `scope`. Throws for unknown identifiers. */
export function resolveRef(ctx: Ctx, ref: Expr & { kind: 'ref' }, scope: Scope): ResolvedRef {
  const loc = ref.loc;
  if (ref.parts.some((p) => p.subscripts && p.subscripts.length > 0)) {
    throw error(`Arrays are not supported: ${printExpr(ref)}`, { path: pathOf(scope), loc, file: fileOf(ctx, scope.cls) });
  }
  const names = ref.parts.map((p) => p.name);
  const dotted = names.join('.');
  if (!ref.global && scope.inst) {
    const found = resolveInInstance(ctx, ref.parts, scope, scope.inst, loc);
    if (found) return { kind: 'instance', inst: found };
  }
  if (!ref.global && names.length === 1 && names[0] === 'time') return { kind: 'time' };
  const value = resolveClassLevel(ctx, names, ref.global === true, scope, loc);
  if (value !== undefined) return { kind: 'literal', expr: literal(value, loc) };
  return unknownIdentifier(ctx, dotted, scope, loc);
}

/** Looks `parts` up as a (possibly dotted) component of `inst`. Returns undefined when the first part is not a component. */
function resolveInInstance(ctx: Ctx, parts: RefPart[], scope: Scope, inst: ClassInstance, loc?: SourceLoc): Instance | undefined {
  const first = parts[0].name;
  const dotted = parts.map((p) => p.name).join('.');
  const disabledError = (name: string): never => {
    throw error(`Component '${name}' is conditionally disabled and cannot be referenced in ${scope.cls.fullName}`, {
      path: pathOf(scope),
      loc,
      file: fileOf(ctx, scope.cls),
    });
  };
  let cur: Instance | undefined = inst.components.get(first);
  if (!cur) {
    if (inst.disabled.has(first)) disabledError(first);
    return undefined;
  }
  for (let i = 1; i < parts.length; i++) {
    const name = parts[i].name;
    if (cur.kind !== 'class') {
      return unknownIdentifier(ctx, dotted, scope, loc, `'${parts.slice(0, i).map((p) => p.name).join('.')}' is a scalar ${cur.type} variable`);
    }
    const next: Instance | undefined = cur.components.get(name);
    if (!next) {
      if (cur.disabled.has(name)) disabledError(parts.slice(0, i + 1).map((p) => p.name).join('.'));
      return unknownIdentifier(ctx, dotted, scope, loc, `'${name}' is not a component of ${cur.cls.fullName}`);
    }
    cur = next;
  }
  return cur;
}

/**
 * Resolves a dotted name that is not a component of the current instance: a class-level
 * constant, an enumeration literal, or a `Modelica.Constants.*` value. Returns undefined when
 * nothing matches.
 */
function resolveClassLevel(ctx: Ctx, names: string[], global: boolean, scope: Scope, loc?: SourceLoc): ConstValue | undefined {
  const registry = ctx.registry;
  const lookup = (name: string): RegisteredClass | undefined => registry.lookup(global ? `.${name}` : name, scope.cls.fullName);

  // Builtin enumeration StateSelect (not declared in the libraries).
  if (names.length === 2 && names[0] === 'StateSelect' && STATE_SELECT_LITERALS.has(names[1]) && !lookup('StateSelect')) {
    return names[1];
  }

  // Imported constants: `import Modelica.Constants.pi;`, `import Modelica.Constants.*;`, `import C = Modelica.Constants;`
  if (!global) {
    const viaImport = resolveImportedConstant(ctx, names, scope, loc);
    if (viaImport !== undefined) return viaImport;
  }

  // Longest class prefix followed by a constant or an enumeration literal.
  for (let k = names.length - 1; k >= 1; k--) {
    const cls = lookup(names.slice(0, k).join('.'));
    if (!cls) continue;
    const rest = names.slice(k);
    const v = memberValue(ctx, cls, rest, scope, loc);
    if (v !== undefined) return v;
  }

  // Constants of the scope class itself (package scope) and of its enclosing classes.
  if (!global && names.length === 1) {
    let cur: RegisteredClass | undefined = scope.inst ? (scope.cls.parentName ? registry.get(scope.cls.parentName) : undefined) : scope.cls;
    while (cur) {
      const v = memberValue(ctx, cur, names, scope, loc, /*enclosing*/ true);
      if (v !== undefined) return v;
      cur = cur.parentName ? registry.get(cur.parentName) : undefined;
    }
  }

  // Fallback table of Modelica.Constants when the library is not loaded.
  const dotted = names.join('.');
  const c = MODELICA_CONSTANTS[dotted];
  if (c !== undefined) return c;
  if (names.length === 1) {
    // `pi` after `import Modelica.Constants.pi` when the library is not loaded.
    const imported = importTargetOf(ctx, names[0], scope);
    if (imported && MODELICA_CONSTANTS[imported] !== undefined) return MODELICA_CONSTANTS[imported];
  }
  return undefined;
}

/** Returns the fully-qualified target of an import that makes `name` visible in `scope`, or undefined. */
function importTargetOf(ctx: Ctx, name: string, scope: Scope): string | undefined {
  let cur: RegisteredClass | undefined = scope.cls;
  while (cur) {
    for (const imp of cur.def.imports) {
      if (imp.alias) {
        if (imp.alias === name) return imp.path;
        continue;
      }
      if (imp.names) {
        if (imp.names.includes(name)) return `${imp.path}.${name}`;
        continue;
      }
      if (imp.wildcard) continue;
      if (imp.path.split('.').pop() === name) return imp.path;
    }
    cur = cur.parentName ? ctx.registry.get(cur.parentName) : undefined;
  }
  return undefined;
}

function resolveImportedConstant(ctx: Ctx, names: string[], scope: Scope, loc?: SourceLoc): ConstValue | undefined {
  const registry = ctx.registry;
  let cur: RegisteredClass | undefined = scope.cls;
  const first = names[0];
  while (cur) {
    for (const imp of cur.def.imports) {
      let target: string | undefined;
      if (imp.alias) {
        if (imp.alias === first) target = imp.path;
      } else if (imp.names) {
        if (imp.names.includes(first)) target = `${imp.path}.${first}`;
      } else if (imp.wildcard) {
        target = `${imp.path}.${first}`;
      } else if (imp.path.split('.').pop() === first) {
        target = imp.path;
      }
      if (!target) continue;
      const full = [...target.split('.'), ...names.slice(1)];
      // The target may name a class (then the rest are members) or a constant inside a class.
      for (let k = full.length - 1; k >= 1; k--) {
        const cls = registry.get(full.slice(0, k).join('.'));
        if (!cls) continue;
        const v = memberValue(ctx, cls, full.slice(k), scope, loc);
        if (v !== undefined) return v;
        break;
      }
      if (imp.wildcard) continue;
      return undefined;
    }
    cur = cur.parentName ? registry.get(cur.parentName) : undefined;
  }
  return undefined;
}

/**
 * Value of member `rest` of class `cls`: an enumeration literal or a constant component
 * (own or inherited). Returns undefined when no such member exists.
 */
function memberValue(ctx: Ctx, cls: RegisteredClass, rest: string[], scope: Scope, loc?: SourceLoc, enclosing = false): ConstValue | undefined {
  const registry = ctx.registry;
  if (rest.length === 0) return undefined;
  const resolved = registry.resolveType(cls.fullName);
  if (resolved?.enumerationLiterals) {
    if (rest.length === 1 && resolved.enumerationLiterals.includes(rest[0])) return rest[0];
    if (rest.length === 1) {
      throw error(`'${rest[0]}' is not a literal of enumeration ${cls.fullName} (${resolved.enumerationLiterals.join(', ')})`, {
        path: pathOf(scope),
        loc,
        file: fileOf(ctx, scope.cls),
      });
    }
    return undefined;
  }
  if (cls.builtin) return undefined;
  for (const c of registry.inheritanceChain(cls.fullName)) {
    const decl = c.def.components.find((d) => d.name === rest[0]);
    if (!decl) continue;
    if (rest.length > 1) {
      throw error(`Reference to '${rest.join('.')}' in ${cls.fullName} is not supported (only scalar constants can be referenced through a class name)`, {
        path: pathOf(scope),
        loc,
        file: fileOf(ctx, scope.cls),
      });
    }
    if (!decl.prefixes.constant) {
      if (enclosing && !decl.prefixes.parameter) return undefined;
      throw error(`'${decl.name}' of ${cls.fullName} is not a constant and cannot be referenced from ${scope.cls.fullName}`, {
        path: pathOf(scope),
        loc,
        file: fileOf(ctx, scope.cls),
      });
    }
    return evaluateClassConstant(ctx, c, decl.name, loc);
  }
  return undefined;
}

/** Evaluates (and caches) the constant `name` declared in class `cls`. */
export function evaluateClassConstant(ctx: Ctx, cls: RegisteredClass, name: string, loc?: SourceLoc): ConstValue {
  const key = `${cls.fullName}.${name}`;
  const cached = ctx.constCache.get(key);
  if (cached !== undefined) return cached;
  const decl = cls.def.components.find((d) => d.name === name)!;
  const file = fileOf(ctx, cls);
  if (decl.arrayDims && decl.arrayDims.length) {
    throw error(`Arrays are not supported: ${declText(decl)}`, { path: key, loc: decl.loc, file });
  }
  if (!decl.modification?.value) {
    throw error(`Constant '${key}' has no value`, { path: key, loc: loc ?? decl.loc, file });
  }
  if (ctx.constVisiting.has(key)) {
    throw error(`Constant '${key}' has a cyclic binding`, { path: key, loc: decl.loc, file });
  }
  ctx.constVisiting.add(key);
  try {
    const flat = flattenExpr(ctx, decl.modification.value, { cls });
    const value = evaluateConstant(flat, { lookup: () => undefined });
    const typeCls = ctx.registry.lookup(decl.typeName, cls.fullName);
    const base = typeCls ? ctx.registry.resolveType(typeCls.fullName)?.base : undefined;
    const coerced = base?.builtin && base.fullName === 'Integer' && typeof value === 'number' ? Math.trunc(value) : value;
    ctx.constCache.set(key, coerced);
    return coerced;
  } catch (e) {
    if (e instanceof Error && e.name === 'ModelicaError' && !/Constant '/.test(e.message)) {
      throw error(`Could not evaluate constant '${key}': ${e.message}`, { path: key, loc: decl.loc, file });
    }
    throw e;
  } finally {
    ctx.constVisiting.delete(key);
  }
}

export function declText(decl: { typeName: string; name: string; arrayDims?: Expr[] }): string {
  const dims = decl.arrayDims && decl.arrayDims.length ? `[${decl.arrayDims.map((d) => printExpr(d)).join(', ')}]` : '';
  return `${decl.typeName} ${decl.name}${dims}`;
}

/** Flattens `e` (written in `scope`) into the flat namespace. */
export function flattenExpr(ctx: Ctx, e: Expr, scope: Scope): Expr {
  switch (e.kind) {
    case 'number':
    case 'string':
    case 'boolean':
      return e;
    case 'ref': {
      const r = resolveRef(ctx, e, scope);
      switch (r.kind) {
        case 'time':
          return e;
        case 'literal':
          return r.expr;
        case 'instance': {
          if (r.inst.kind === 'variable') {
            const ref = flatRef(r.inst.path);
            if (e.loc) ref.loc = e.loc;
            return ref;
          }
          throw error(
            `Component '${r.inst.path}' of type ${r.inst.cls.fullName} cannot be used as a value in ${scope.cls.fullName} (only scalar variables are supported in expressions)`,
            { path: pathOf(scope), loc: e.loc, file: fileOf(ctx, scope.cls) },
          );
        }
      }
      break;
    }
    case 'unary':
      return { ...e, operand: flattenExpr(ctx, e.operand, scope) };
    case 'binary': {
      if (RELATIONAL_OPS.has(e.op)) {
        const enumRelation = flattenEnumerationRelation(ctx, e, scope);
        if (enumRelation) return enumRelation;
      }
      return { ...e, left: flattenExpr(ctx, e.left, scope), right: flattenExpr(ctx, e.right, scope) };
    }
    case 'if':
      return {
        ...e,
        branches: e.branches.map((b) => ({ cond: flattenExpr(ctx, b.cond, scope), value: flattenExpr(ctx, b.value, scope) })),
        else: flattenExpr(ctx, e.else, scope),
      };
    case 'call':
      return flattenCall(ctx, e, scope);
    case 'array':
    case 'range':
      throw error(`Arrays are not supported: ${printExpr(e)}`, { path: pathOf(scope), loc: e.loc, file: fileOf(ctx, scope.cls) });
    case 'end':
      throw error(`'end' is only allowed inside array subscripts`, { path: pathOf(scope), loc: e.loc, file: fileOf(ctx, scope.cls) });
  }
  throw error(`Unsupported expression ${printExpr(e)}`, { path: pathOf(scope), file: fileOf(ctx, scope.cls) });
}

function flattenCall(ctx: Ctx, e: Expr & { kind: 'call' }, scope: Scope): Expr {
  const opts = { path: pathOf(scope), loc: e.loc, file: fileOf(ctx, scope.cls) };
  const name = builtinName(e.callee);
  const qualified = name.includes('.');
  const isBuiltin = !qualified && (PASSTHROUGH_FUNCTIONS.has(name) || getUnaryBuiltin(name) !== undefined || getBinaryBuiltin(name) !== undefined);
  if (!isBuiltin) {
    if (name === 'reinit' || name === 'assert' || name === 'terminate') {
      throw error(
        name === 'reinit' ? `'reinit' is only allowed as a statement inside a when-clause` : `'${name}' is only allowed as an equation statement`,
        opts,
      );
    }
    throw error(`Function calls are not supported: ${e.callee}`, opts);
  }
  if (name === 'Integer' && e.args.length === 1 && e.namedArgs.length === 0) {
    // `Integer(E.x)` is the ordinal of the literal (Modelica §4.8.5.2).
    const literals = enumerationLiteralsOf(ctx, e.args[0], scope);
    if (literals) return ordinalExpr(ctx, e.args[0], literals, scope);
  }
  if (name === 'der') {
    if (e.args.length !== 1 || e.namedArgs.length) throw error(`'der' expects exactly one argument: ${printExpr(e)}`, opts);
    const arg = e.args[0];
    if (arg.kind !== 'ref') throw error(`'der' expects a variable reference: ${printExpr(e)}`, opts);
    const r = resolveRef(ctx, arg, scope);
    if (r.kind !== 'instance' || r.inst.kind !== 'variable') throw error(`'der' expects a variable reference: ${printExpr(e)}`, opts);
    if (r.inst.type !== 'Real') throw error(`der(${r.inst.path}): only Real variables can be differentiated`, opts);
    return { kind: 'call', callee: 'der', args: [flatRef(r.inst.path)], namedArgs: [], loc: e.loc };
  }
  return {
    kind: 'call',
    callee: name,
    args: e.args.map((a) => flattenExpr(ctx, a, scope)),
    namedArgs: e.namedArgs.map((n) => ({ name: n.name, value: flattenExpr(ctx, n.value, scope) })),
    loc: e.loc,
  };
}

// ---------------------------------------------------------------------------
// Enumerations in relational operators and Integer()
// ---------------------------------------------------------------------------

/**
 * `a < b` etc. with enumeration operands: enumeration literals are ordered by declaration
 * (Modelica §3.5), so both operands are replaced by their 1-based ordinals. Returns undefined
 * when neither operand has an enumeration type.
 */
function flattenEnumerationRelation(ctx: Ctx, e: Expr & { kind: 'binary' }, scope: Scope): Expr | undefined {
  const left = enumerationLiteralsOf(ctx, e.left, scope);
  const right = enumerationLiteralsOf(ctx, e.right, scope);
  if (!left && !right) return undefined;
  if (left && right && left.join(',') !== right.join(',')) {
    throw error(`Cannot compare ${printExpr(e.left)} with ${printExpr(e.right)}: the operands have different enumeration types`, {
      path: pathOf(scope),
      loc: e.loc,
      file: fileOf(ctx, scope.cls),
    });
  }
  return {
    ...e,
    left: left ? ordinalExpr(ctx, e.left, left, scope) : flattenExpr(ctx, e.left, scope),
    right: right ? ordinalExpr(ctx, e.right, right, scope) : flattenExpr(ctx, e.right, scope),
  };
}

/**
 * The literals (in declaration order) of the enumeration type of `e`, when `e` references an
 * enumeration-typed component, a class-level constant of enumeration type or an enumeration
 * literal (`Init.SteadyState`, `StateSelect.prefer`); undefined otherwise.
 */
function enumerationLiteralsOf(ctx: Ctx, e: Expr, scope: Scope): string[] | undefined {
  if (e.kind !== 'ref' || e.parts.some((p) => p.subscripts && p.subscripts.length > 0)) return undefined;
  const registry = ctx.registry;
  const names = e.parts.map((p) => p.name);
  // A component of the instance.
  if (!e.global && scope.inst) {
    let cur: Instance | undefined = scope.inst.components.get(names[0]);
    if (cur) {
      for (let i = 1; cur && i < names.length; i++) cur = cur.kind === 'class' ? cur.components.get(names[i]) : undefined;
      return cur?.kind === 'variable' ? cur.enumerationLiterals : undefined;
    }
  }
  const lookup = (name: string): RegisteredClass | undefined => registry.lookup(e.global ? `.${name}` : name, scope.cls.fullName);
  if (names.length >= 2) {
    const last = names[names.length - 1];
    if (!e.global && names.length === 2 && names[0] === 'StateSelect' && STATE_SELECT_LITERALS.has(last) && !lookup('StateSelect')) return STATE_SELECT_ORDER;
    const cls = lookup(names.slice(0, -1).join('.'));
    if (!cls) return undefined;
    const literals = registry.resolveType(cls.fullName)?.enumerationLiterals;
    if (literals) return literals.includes(last) ? literals : undefined;
    return enumerationLiteralsOfMember(ctx, cls, last);
  }
  // A constant of the scope class (package scope) or of an enclosing class.
  let cur: RegisteredClass | undefined = scope.inst ? (scope.cls.parentName ? registry.get(scope.cls.parentName) : undefined) : scope.cls;
  while (cur) {
    const literals = enumerationLiteralsOfMember(ctx, cur, names[0]);
    if (literals) return literals;
    cur = cur.parentName ? registry.get(cur.parentName) : undefined;
  }
  return undefined;
}

/** Literals of the enumeration type of the constant `name` declared in `cls` (or a base class), if any. */
function enumerationLiteralsOfMember(ctx: Ctx, cls: RegisteredClass, name: string): string[] | undefined {
  if (cls.builtin) return undefined;
  for (const c of ctx.registry.inheritanceChain(cls.fullName)) {
    const decl = c.def.components.find((d) => d.name === name);
    if (!decl) continue;
    const typeCls = ctx.registry.lookup(decl.typeName, c.fullName);
    return typeCls ? ctx.registry.resolveType(typeCls.fullName)?.enumerationLiterals : undefined;
  }
  return undefined;
}

/** Flattens an enumeration-typed expression to the (1-based) ordinal of its value. */
function ordinalExpr(ctx: Ctx, e: Expr, literals: string[], scope: Scope): Expr {
  const opts = { path: pathOf(scope), loc: e.loc, file: fileOf(ctx, scope.cls) };
  const flat = flattenExpr(ctx, e, scope);
  let value: ConstValue | undefined;
  if (flat.kind === 'string') {
    value = flat.value;
  } else if (isFlatVariableRef(flat)) {
    const v = ctx.varsByPath.get(flat.parts[0].name);
    if (!v || !isParamLike(v)) {
      throw error(`Enumeration variable '${printExpr(e)}' must be a parameter or constant to be used in relational operators or Integer()`, opts);
    }
    value = getParamValue(ctx, v);
  }
  if (typeof value !== 'string') throw error(`Cannot determine the enumeration value of ${printExpr(e)}`, opts);
  const ordinal = literals.indexOf(value) + 1;
  if (ordinal === 0) throw error(`'${value}' is not a literal of the enumeration type of ${printExpr(e)} (${literals.join(', ')})`, opts);
  return { kind: 'number', value: ordinal, loc: e.loc };
}

function isFlatVariableRef(e: Expr): e is Expr & { kind: 'ref' } {
  return e.kind === 'ref' && e.parts.length === 1;
}

/** Flattens a reference that must denote a scalar variable (e.g. the target of `reinit` or a when-assignment). */
export function resolveVariable(ctx: Ctx, e: Expr, scope: Scope, what: string): VariableInstance {
  const opts = { path: pathOf(scope), loc: e.loc, file: fileOf(ctx, scope.cls) };
  if (e.kind !== 'ref') throw error(`${what} must be a variable reference, got ${printExpr(e)}`, opts);
  const r = resolveRef(ctx, e, scope);
  if (r.kind !== 'instance' || r.inst.kind !== 'variable') throw error(`${what} must be a variable reference, got ${printExpr(e)}`, opts);
  return r.inst;
}
