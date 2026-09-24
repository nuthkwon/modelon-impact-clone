/**
 * Instantiation: builds the instance tree of a class.
 *
 * For every class instance the elements of the whole inheritance chain are collected (base
 * classes first, depth-first), applying `extends` modifications. Modifications are merged
 * "outermost wins": the modifier written closest to the root of the instance tree overrides
 * modifiers written deeper (declaration bindings are the innermost layer, `options.modifiers`
 * the outermost). Every modifier keeps the scope in which its expression was written.
 *
 * Builtin-typed components (Real, Integer, Boolean, String, enumerations) become
 * `VariableInstance`s; connector/record/model/block components recurse. Unconditional
 * components (leaf variables first, then class-typed ones) are created before conditional
 * ones so that a condition can use parameters declared anywhere in the same class, including
 * parameters of class-typed components declared after the conditional component.
 *
 * A base class reached through several extends paths (diamond inheritance) is instantiated
 * once; the modifications arriving through the different paths must be identical (Modelica §7.1).
 */
import type { ComponentDecl, Expr, Modification, SourceLoc } from '../ast.js';
import type { BaseType, Causality, Variability } from '../flat.js';
import { printExpr } from '../parser/printer.js';
import type { RegisteredClass, ResolvedType } from '../registry.js';
import { evaluateConstant, type ConstValue } from './evaluate.js';
import { isAttributeName, paramEnv } from './parameters.js';
import { declText, flattenExpr } from './scope.js';
import { diag, error, fileOf, pathOf, type ClassInstance, type Ctx, type ModEntry, type Scope, type ScopedExpr, type VariableInstance } from './types.js';

// ---------------------------------------------------------------------------
// Modifications
// ---------------------------------------------------------------------------

export function emptyMod(): ModEntry {
  return { sub: new Map() };
}

/** Converts a syntactic modification into a ModEntry whose expressions are resolved in `scope`. */
export function modFromModification(ctx: Ctx, mod: Modification | undefined, scope: Scope, final = false): ModEntry {
  const entry = emptyMod();
  if (!mod) return entry;
  if (mod.value) entry.value = { expr: mod.value, scope, final, loc: mod.loc };
  for (const m of mod.mods) {
    if (m.redeclare) throw error('redeclare is not supported', { path: pathOf(scope), loc: m.loc, file: fileOf(ctx, scope.cls) });
    const parts = m.name.split('.');
    let cur = entry;
    for (let i = 0; i < parts.length - 1; i++) {
      let next = cur.sub.get(parts[i]);
      if (!next) {
        next = emptyMod();
        cur.sub.set(parts[i], next);
      }
      cur = next;
    }
    const last = parts[parts.length - 1];
    const leaf = modFromModification(ctx, m.modification, scope, final || m.final === true);
    const existing = cur.sub.get(last);
    cur.sub.set(last, existing ? mergeMods(ctx, leaf, existing, m.name) : leaf);
  }
  return entry;
}

/** Merges two modifications of the same element: `outer` wins over `inner`, except that final inner bindings are kept (with a warning). */
export function mergeMods(ctx: Ctx, outer: ModEntry, inner: ModEntry, name: string): ModEntry {
  const out: ModEntry = { sub: new Map(inner.sub), value: inner.value };
  if (outer.value) {
    if (inner.value?.final) {
      diag(ctx, 'warning', `Modification '${name} = ${printExpr(outer.value.expr)}' ignored: the element is final`, {
        path: name,
        loc: outer.value.loc ?? outer.value.expr.loc,
        file: fileOf(ctx, outer.value.scope.cls),
      });
    } else {
      out.value = outer.value;
    }
  }
  for (const [k, o] of outer.sub) {
    const i = inner.sub.get(k);
    out.sub.set(k, i ? mergeMods(ctx, o, i, `${name}.${k}`) : o);
  }
  return out;
}

/** Modifications collected along a short-class chain (`type Voltage = Real(unit="V")`), innermost first, merged so that outer types win. */
function chainMods(ctx: Ctx, resolved: ResolvedType, name: string): ModEntry {
  let merged = emptyMod();
  const chain = resolved.chain;
  for (let i = chain.length - 1; i >= 0; i--) {
    const sc = chain[i].def.shortClass;
    if (!sc || sc.typeName === 'enumeration' || !sc.modification) continue;
    merged = mergeMods(ctx, modFromModification(ctx, sc.modification, { cls: chain[i] }), merged, name);
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Type resolution
// ---------------------------------------------------------------------------

interface ComponentType {
  typeCls: RegisteredClass;
  resolved: ResolvedType;
}

function resolveComponentType(ctx: Ctx, decl: ComponentDecl, declaredIn: RegisteredClass, path: string): ComponentType {
  const opts = { path, loc: decl.loc, file: fileOf(ctx, declaredIn) };
  if (decl.arrayDims && decl.arrayDims.length) throw error(`Arrays are not supported: ${declText(decl)}`, opts);
  const typeCls = ctx.registry.lookup(decl.typeName, declaredIn.fullName);
  if (!typeCls) throw error(`Unknown type '${decl.typeName}' of component '${decl.name}' in ${declaredIn.fullName}`, opts);
  const resolved = ctx.registry.resolveType(typeCls.fullName);
  if (!resolved) throw error(`Type '${typeCls.fullName}' of component '${decl.name}' cannot be resolved (cyclic short class definition)`, opts);
  const extendsSpecifier = resolved.chain.find((c) => c.def.classExtends);
  if (extendsSpecifier) {
    throw error(`'extends' class specifiers are not supported: ${declText(decl)} (${extendsSpecifier.def.restriction} extends ${extendsSpecifier.fullName})`, opts);
  }
  if (resolved.chain.some((c) => c.def.shortClass?.arrayDims && c.def.shortClass.arrayDims.length)) {
    throw error(`Arrays are not supported: ${declText(decl)} (type ${typeCls.fullName} is an array type)`, opts);
  }
  return { typeCls, resolved };
}

function isLeafType(t: ComponentType): boolean {
  return t.resolved.base.builtin === true || t.resolved.enumerationLiterals !== undefined;
}

function checkPrefixes(decl: ComponentDecl, opts: { path: string; loc?: SourceLoc; file?: string }): void {
  const p = decl.prefixes;
  if (p.stream) throw error(`stream variables are not supported: ${declText(decl)}`, opts);
  if (p.inner || p.outer) throw error(`inner/outer components are not supported: ${declText(decl)}`, opts);
  if (p.redeclare) throw error('redeclare is not supported', opts);
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

function literalExpr(value: ConstValue): Expr {
  if (typeof value === 'number') return { kind: 'number', value };
  if (typeof value === 'boolean') return { kind: 'boolean', value };
  return { kind: 'string', value };
}

/** Coerces an `options.modifiers` value to the variable type. */
function coerceModifier(raw: number | boolean | string, type: BaseType, name: string): ConstValue {
  if (type === 'String') return String(raw);
  if (type === 'Boolean') {
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') return raw !== 0;
    const s = raw.trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
    throw error(`Modifier '${name}' must be a Boolean, got '${raw}'`, { path: name });
  }
  if (typeof raw === 'number') return type === 'Integer' ? Math.trunc(raw) : raw;
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  const n = Number(raw.trim());
  if (!Number.isFinite(n)) throw error(`Modifier '${name}' must be a number, got '${raw}'`, { path: name });
  return type === 'Integer' ? Math.trunc(n) : n;
}

function createVariable(ctx: Ctx, parent: ClassInstance, decl: ComponentDecl, declaredIn: RegisteredClass, type: ComponentType, incoming: ModEntry): VariableInstance {
  const { resolved, typeCls } = type;
  const path = parent.path ? `${parent.path}.${decl.name}` : decl.name;
  const opts = { path, loc: decl.loc, file: fileOf(ctx, declaredIn) };
  checkPrefixes(decl, opts);
  const p = decl.prefixes;
  const isEnum = resolved.enumerationLiterals !== undefined;
  const baseType: BaseType = isEnum ? 'String' : (resolved.base.fullName as BaseType);
  let variability: Variability = p.constant ? 'constant' : p.parameter ? 'parameter' : p.discrete || baseType !== 'Real' ? 'discrete' : 'continuous';
  if (parent.forcedVariability && (variability === 'continuous' || variability === 'discrete' || parent.forcedVariability === 'constant')) {
    variability = parent.forcedVariability;
  }
  const causality: Causality = p.input || resolved.prefixes.input ? 'input' : p.output || resolved.prefixes.output ? 'output' : 'none';
  const scope: Scope = { cls: declaredIn, inst: parent };
  const own = modFromModification(ctx, decl.modification, scope, p.final);
  const total = mergeMods(ctx, mergeMods(ctx, incoming, own, path), chainMods(ctx, resolved, path), path);

  const attributeMods = new Map<string, ScopedExpr>();
  for (const [name, entry] of total.sub) {
    if (!isAttributeName(name)) {
      throw error(`'${name}' is not an attribute of ${isEnum ? `enumeration ${typeCls.fullName}` : baseType} (modification of '${path}')`, {
        path,
        loc: entry.value?.loc ?? entry.value?.expr.loc ?? decl.loc,
        file: entry.value ? fileOf(ctx, entry.value.scope.cls) : opts.file,
      });
    }
    if (entry.sub.size) throw error(`Attribute '${name}' of '${path}' cannot have nested modifications`, opts);
    if (entry.value) attributeMods.set(name, entry.value);
  }

  const v: VariableInstance = {
    kind: 'variable',
    name: decl.name,
    path,
    parent,
    decl,
    declaredIn,
    type: baseType,
    typeName: typeCls.fullName,
    enumerationLiterals: resolved.enumerationLiterals,
    variability,
    causality,
    flow: p.flow || resolved.prefixes.flow,
    protected: p.protected || parent.protected,
    binding: total.value,
    attributeMods,
  };

  const raw = ctx.options.modifiers?.[path];
  if (raw !== undefined) {
    ctx.usedModifiers.add(path);
    if (variability !== 'parameter' && variability !== 'constant') {
      diag(ctx, 'warning', `Modifier '${path}' does not refer to a parameter of ${ctx.className}; ignored`, { path });
    } else if (total.value?.final) {
      diag(ctx, 'warning', `Modifier '${path}' ignored: the parameter is final`, { path });
    } else {
      const value = coerceModifier(raw, baseType, path);
      v.binding = { expr: literalExpr(value), scope };
      v.overridden = true;
    }
  }
  ctx.varsByPath.set(path, v);
  return v;
}

// ---------------------------------------------------------------------------
// Class instances
// ---------------------------------------------------------------------------

function newClassInstance(name: string, path: string, cls: RegisteredClass, typeName: string, parent?: ClassInstance): ClassInstance {
  return {
    kind: 'class',
    name,
    path,
    parent,
    cls,
    typeName,
    isConnector: cls.def.restriction === 'connector',
    protected: false,
    components: new Map(),
    order: [],
    disabled: new Set(),
    equations: [],
    initialEquations: [],
    connects: [],
  };
}

/** Instantiates the class to simulate. */
export function instantiateRoot(ctx: Ctx, cls: RegisteredClass): ClassInstance {
  const file = fileOf(ctx, cls);
  const opts = { path: cls.fullName, loc: cls.def.nameLoc ?? cls.def.loc, file };
  if (cls.builtin) throw error(`Cannot simulate builtin type '${cls.fullName}'`, opts);
  const resolved = ctx.registry.resolveType(cls.fullName);
  if (!resolved) throw error(`Class '${cls.fullName}' cannot be resolved (cyclic short class definition)`, opts);
  const base = resolved.base;
  if (base.builtin || resolved.enumerationLiterals) throw error(`Cannot simulate '${cls.fullName}': it is a type, not a model`, opts);
  const restriction = base.def.restriction;
  if (restriction === 'package' || restriction === 'function' || restriction === 'type' || restriction === 'operator') {
    throw error(`Cannot simulate '${cls.fullName}': it is a ${restriction}`, opts);
  }
  if (cls.def.partial || base.def.partial) throw error(`Cannot simulate partial class '${cls.fullName}'`, opts);
  const root = newClassInstance('', '', base, cls.fullName);
  populate(ctx, root, chainMods(ctx, resolved, cls.fullName));
  return root;
}

interface Element {
  decl: ComponentDecl;
  declaredIn: RegisteredClass;
  mods: ModEntry;
}

/** First element modified differently in `a` and `b` (element names restricted to `relevant`), as `name = a vs b`; undefined when identical. */
function findModConflict(a: ModEntry, b: ModEntry, relevant: Set<string> | undefined, prefix = ''): { name: string; a: string; b: string } | undefined {
  const ta = a.value ? printExpr(a.value.expr) : undefined;
  const tb = b.value ? printExpr(b.value.expr) : undefined;
  if (ta !== tb) return { name: prefix, a: ta ?? '<no modification>', b: tb ?? '<no modification>' };
  for (const k of new Set([...a.sub.keys(), ...b.sub.keys()])) {
    if (relevant && !relevant.has(k)) continue;
    const r = findModConflict(a.sub.get(k) ?? emptyMod(), b.sub.get(k) ?? emptyMod(), undefined, prefix ? `${prefix}.${k}` : k);
    if (r) return r;
  }
  return undefined;
}

function populate(ctx: Ctx, inst: ClassInstance, incoming: ModEntry): void {
  const registry = ctx.registry;
  const elements: Element[] = [];
  /** Base classes already collected, with the modifications they received and the path they were reached through. */
  const visited = new Map<string, { mods: ModEntry; via: string }>();
  const modKeys: { name: string; from: string; loc?: SourceLoc; file?: string }[] = [];
  const instPath = inst.path || inst.cls.fullName;

  for (const k of incoming.sub.keys()) {
    const v = incoming.sub.get(k)!;
    modKeys.push({ name: k, from: `modification of '${inst.path || inst.cls.fullName}'`, loc: v.value?.loc, file: v.value ? fileOf(ctx, v.value.scope.cls) : undefined });
  }

  const collect = (cls: RegisteredClass, mods: ModEntry, via: string, viaOpts: { path: string; loc?: SourceLoc; file?: string }): void => {
    const previous = visited.get(cls.fullName);
    if (previous) {
      // Repeated inheritance (diamond): the elements of `cls` are instantiated once, so the
      // modifications arriving through every path must agree.
      const relevant = new Set(registry.inheritanceChain(cls.fullName).flatMap((c) => c.def.components.map((d) => d.name)));
      const conflict = findModConflict(previous.mods, mods, relevant);
      if (conflict) {
        throw error(
          `Class ${cls.fullName} is inherited more than once by ${inst.cls.fullName} with different modifications: '${conflict.name}' is ${conflict.a} (${previous.via}) but ${conflict.b} (${via})`,
          viaOpts,
        );
      }
      return;
    }
    visited.set(cls.fullName, { mods, via });
    const file = fileOf(ctx, cls);
    const clsOpts = { path: instPath, loc: cls.def.nameLoc ?? cls.def.loc, file };
    if (cls.def.restriction === 'function') throw error(`Functions are not supported: ${cls.fullName}`, clsOpts);
    if (cls.def.algorithms && cls.def.algorithms.length) throw error(`Algorithm sections are not supported (${cls.fullName})`, clsOpts);
    if (cls.def.expandable) throw error(`Expandable connectors are not supported: ${cls.fullName}`, clsOpts);
    for (const ext of cls.def.extends) {
      const extOpts = { path: instPath, loc: ext.loc, file };
      const baseCls = registry.lookup(ext.typeName, cls.fullName);
      if (!baseCls) throw error(`Unknown base class '${ext.typeName}' in ${cls.fullName}`, extOpts);
      if (baseCls.fullName === cls.fullName) throw error(`Class ${cls.fullName} extends itself`, extOpts);
      const resolved = registry.resolveType(baseCls.fullName);
      if (!resolved || resolved.base.builtin || resolved.enumerationLiterals) {
        throw error(`Cannot extend from '${ext.typeName}' in ${cls.fullName}: extending builtin types is not supported`, extOpts);
      }
      const extMods = modFromModification(ctx, ext.modification, { cls, inst });
      for (const k of extMods.sub.keys()) modKeys.push({ name: k, from: `extends ${ext.typeName} in ${cls.fullName}`, loc: ext.loc, file });
      let merged = mergeMods(ctx, mods, extMods, instPath);
      merged = mergeMods(ctx, merged, chainMods(ctx, resolved, instPath), instPath);
      collect(resolved.base, merged, `via extends ${ext.typeName} in ${cls.fullName}`, extOpts);
    }
    for (const decl of cls.def.components) elements.push({ decl, declaredIn: cls, mods: mods.sub.get(decl.name) ?? emptyMod() });
    for (const eq of cls.def.equations) inst.equations.push({ eq, scope: { cls, inst } });
    for (const eq of cls.def.initialEquations) inst.initialEquations.push({ eq, scope: { cls, inst } });
  };
  collect(inst.cls, incoming, 'the class itself', { path: instPath, loc: inst.cls.def.nameLoc ?? inst.cls.def.loc, file: fileOf(ctx, inst.cls) });

  const declaredNames = new Map<string, RegisteredClass>();
  for (const el of elements) {
    const prev = declaredNames.get(el.decl.name);
    if (prev) {
      throw error(`Duplicate component '${el.decl.name}' in ${inst.cls.fullName} (declared in ${prev.fullName} and ${el.declaredIn.fullName})`, {
        path: instPath,
        loc: el.decl.loc,
        file: fileOf(ctx, el.declaredIn),
      });
    }
    declaredNames.set(el.decl.name, el.declaredIn);
  }
  for (const k of modKeys) {
    if (!declaredNames.has(k.name)) {
      throw error(`Modified element '${k.name}' not found in ${inst.cls.fullName} (${k.from})`, { path: instPath, loc: k.loc, file: k.file });
    }
  }

  const typed = elements.map((el) => ({ ...el, type: resolveComponentType(ctx, el.decl, el.declaredIn, inst.path ? `${inst.path}.${el.decl.name}` : el.decl.name) }));
  inst.order = typed.map((el) => el.decl.name);

  // Unconditional components first (pass 1: leaf variables, pass 2: class-typed components),
  // then the conditional ones (pass 3: leaves, pass 4: class-typed). Declaration order is
  // irrelevant in Modelica, so a condition may refer to parameters of any unconditional
  // component, including class-typed ones declared later (`Gain g2 if g1.k > 0; Gain g1(k=1);`).
  const create = (el: (typeof typed)[number]): void => {
    if (isLeafType(el.type)) inst.components.set(el.decl.name, createVariable(ctx, inst, el.decl, el.declaredIn, el.type, el.mods));
    else createSubInstance(ctx, inst, el.decl, el.declaredIn, el.type, el.mods);
  };
  for (const el of typed) if (isLeafType(el.type) && !el.decl.condition) create(el);
  for (const el of typed) if (!isLeafType(el.type) && !el.decl.condition) create(el);
  for (const leaf of [true, false]) {
    for (const el of typed) {
      if (!el.decl.condition || isLeafType(el.type) !== leaf) continue;
      if (evaluateCondition(ctx, inst, el.decl, el.declaredIn)) create(el);
      else inst.disabled.add(el.decl.name);
    }
  }
  inst.order = inst.order.filter((n) => !inst.disabled.has(n));
}

function evaluateCondition(ctx: Ctx, inst: ClassInstance, decl: ComponentDecl, declaredIn: RegisteredClass): boolean {
  const path = inst.path ? `${inst.path}.${decl.name}` : decl.name;
  const opts = { path, loc: decl.condition?.loc ?? decl.loc, file: fileOf(ctx, declaredIn) };
  const flat = flattenExpr(ctx, decl.condition!, { cls: declaredIn, inst });
  let value: ConstValue;
  try {
    value = evaluateConstant(flat, paramEnv(ctx));
  } catch (e) {
    if (e instanceof Error && e.name === 'ModelicaError') {
      throw error(`The condition of conditional component '${path}' must be a parameter expression: ${e.message}`, opts);
    }
    throw e;
  }
  if (typeof value !== 'boolean') throw error(`The condition of conditional component '${path}' must be a Boolean, got ${printExpr(flat)}`, opts);
  return value;
}

function createSubInstance(ctx: Ctx, parent: ClassInstance, decl: ComponentDecl, declaredIn: RegisteredClass, type: ComponentType, incoming: ModEntry): ClassInstance {
  const base = type.resolved.base;
  const path = parent.path ? `${parent.path}.${decl.name}` : decl.name;
  const opts = { path, loc: decl.loc, file: fileOf(ctx, declaredIn) };
  checkPrefixes(decl, opts);
  const restriction = base.def.restriction;
  if (restriction === 'package') throw error(`Component '${path}' has type ${base.fullName}, which is a package`, opts);
  if (restriction === 'function' || restriction === 'operator') throw error(`Functions are not supported: component '${path}' has type ${base.fullName}`, opts);
  if (restriction === 'type') throw error(`Component '${path}' has type ${base.fullName}, which is not a builtin type, an enumeration or a class`, opts);
  if (base.def.partial) throw error(`Cannot instantiate partial class ${base.fullName} (component '${path}')`, opts);
  if (base.def.expandable) throw error(`Expandable connectors are not supported: ${base.fullName} (component '${path}')`, opts);

  const scope: Scope = { cls: declaredIn, inst: parent };
  const own = modFromModification(ctx, decl.modification, scope, decl.prefixes.final);
  const total = mergeMods(ctx, mergeMods(ctx, incoming, own, path), chainMods(ctx, type.resolved, path), path);
  if (total.value) {
    throw error(`Binding equations for components of class type are not supported: ${path} = ${printExpr(total.value.expr)}`, {
      path,
      loc: total.value.loc ?? decl.loc,
      file: fileOf(ctx, total.value.scope.cls),
    });
  }
  const sub = newClassInstance(decl.name, path, base, type.typeCls.fullName, parent);
  sub.decl = decl;
  sub.declaredIn = declaredIn;
  sub.protected = decl.prefixes.protected || parent.protected;
  sub.forcedVariability = decl.prefixes.constant ? 'constant' : decl.prefixes.parameter ? 'parameter' : parent.forcedVariability;
  parent.components.set(decl.name, sub);
  populate(ctx, sub, total);
  return sub;
}

/** All variables of the tree in declaration order (bases first, depth-first). */
export function collectVariables(inst: ClassInstance, out: VariableInstance[] = []): VariableInstance[] {
  for (const name of inst.order) {
    const c = inst.components.get(name);
    if (!c) continue;
    if (c.kind === 'variable') out.push(c);
    else collectVariables(c, out);
  }
  return out;
}

/** All class instances of the tree (excluding `inst` itself), depth-first in declaration order. */
export function collectClassInstances(inst: ClassInstance, out: ClassInstance[] = []): ClassInstance[] {
  for (const name of inst.order) {
    const c = inst.components.get(name);
    if (c && c.kind === 'class') {
      out.push(c);
      collectClassInstances(c, out);
    }
  }
  return out;
}
