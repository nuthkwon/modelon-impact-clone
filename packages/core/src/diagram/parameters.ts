/**
 * Parameters and variables of a class for the Details panel (PROPERTIES / VARIABLES tabs) and
 * for `%R` substitution in icon texts.
 *
 * `getParameters` walks the inheritance chain (bases first) and collects `parameter`/`constant`
 * components of builtin, short-class or enumeration type (record-typed parameters are flattened
 * one level: `data.a`). Default bindings honour the `extends` modifications on the path
 * (`extends Base(R=100)`); when an owner component is given, its modifiers (and the `extends`
 * modifications on the owner's inheritance path) provide `valueText` and `attributes`.
 * Values are constant-folded with an environment that resolves sibling parameters, constants of
 * other classes (`Modelica.Constants.pi`) and enumeration literals through the registry.
 */
import type { Expr, SourceLoc } from '../ast.js';
import type { ParameterInfo, VariableInfo } from '../diagram.js';
import type { Causality } from '../flat.js';
import { tryEvaluateConstant, type ConstValue, type EvalEnv } from '../flatten/evaluate.js';
import { evalBoolean, evalString, parsePlacement } from '../graphics/annotations.js';
import { printExpr } from '../parser/printer.js';
import type { ClassRegistry } from '../registry.js';
import { cacheFor, type RegistryCache } from './cache.js';
import {
  causalityOf,
  classifyClass,
  collectComponents,
  definingClassName,
  extendsPath,
  findComponent,
  flattenMods,
  isEvaluateAnnotation,
  mergeMods,
  readDialog,
  recordConstructorMods,
  resolveTypeName,
  splitMods,
  type BaseTypeName,
  type ComponentType,
  type DialogInfo,
  type FlatMod,
  type FlatMods,
} from './classes.js';

export interface ParameterOwner {
  ownerClassName: string;
  componentName: string;
}

// ---------------------------------------------------------------------------
// Raw (owner-independent) parameter collection
// ---------------------------------------------------------------------------

interface RawParameter {
  name: string;
  typeName: string;
  baseType: BaseTypeName;
  description?: string;
  literals?: string[];
  /** Class the declaration lives in: scope for resolving names in its default binding. */
  declaringClass: string;
  /** Default binding after `extends` modifications along the chain. */
  defaultExpr?: Expr;
  /** Attribute modifications of the type chain (`type Resistance = Real(unit="Ohm")`). */
  typeAttrs: FlatMods;
  /** Attribute modifications of the declaration and of the `extends` path (`R(start=1)`). */
  attrs: FlatMods;
  final: boolean;
  constant: boolean;
  dialog: DialogInfo;
  structural: boolean;
  loc?: SourceLoc;
}

/** Attribute modifications collected along a short-class chain, outer types overriding inner ones. */
function typeAttrsOf(t: ComponentType): FlatMods {
  const out: FlatMods = new Map();
  if (t.resolved) for (const m of t.resolved.modifications) flattenMods(m.mods, out);
  return out;
}

function isScalarKind(t: ComponentType): boolean {
  return t.kind === 'builtin' || t.kind === 'scalar' || t.kind === 'unresolved';
}

function collectRawParameters(registry: ClassRegistry, cache: RegistryCache, className: string): RawParameter[] {
  return cache.memo('rawParameters', className, () => {
    const out: RawParameter[] = [];
    // Every field of a record is parameter-like data, whether or not it carries the `parameter` prefix.
    const isRecord = registry.get(className)?.def.restriction === 'record';
    for (const ic of collectComponents(registry, cache, className)) {
      const { decl, declaringClass } = ic;
      if (!(isRecord || decl.prefixes.parameter || decl.prefixes.constant) || decl.prefixes.protected) continue;
      const t = resolveTypeName(registry, cache, decl.typeName, declaringClass.fullName);
      if (t.kind === 'connector' || t.kind === 'class') continue;
      const declMods = flattenMods(decl.modification?.mods);
      const dialog = readDialog(decl.annotation);
      const structural = isEvaluateAnnotation(decl.annotation);
      if (t.kind === 'record') {
        const recordClass = definingClassName(t);
        if (!recordClass) continue;
        // Field bindings, lowest priority first: `= Data(a=1)`, `data(a=1)`, extends `data = Data(a=2)`, extends `data(a=2)`.
        const fieldMods = mergeMods(
          mergeMods(recordConstructorMods(decl.modification?.value), declMods),
          mergeMods(recordConstructorMods(ic.binding?.expr), ic.sub),
        );
        for (const f of collectComponents(registry, cache, recordClass)) {
          if (f.decl.prefixes.protected) continue;
          const ft = resolveTypeName(registry, cache, f.decl.typeName, f.declaringClass.fullName);
          if (!isScalarKind(ft)) continue;
          const { binding, sub } = splitMods(fieldMods, f.decl.name);
          out.push({
            name: `${decl.name}.${f.decl.name}`,
            typeName: ft.fullName,
            baseType: ft.baseType ?? 'Real',
            description: f.decl.description ?? decl.description,
            literals: ft.literals,
            declaringClass: declaringClass.fullName,
            defaultExpr: binding?.expr ?? f.binding?.expr ?? f.decl.modification?.value,
            typeAttrs: typeAttrsOf(ft),
            attrs: mergeMods(mergeMods(flattenMods(f.decl.modification?.mods), f.sub), sub),
            final: decl.prefixes.final || f.decl.prefixes.final || !!binding?.final,
            constant: decl.prefixes.constant || f.decl.prefixes.constant,
            dialog,
            structural,
            loc: decl.loc,
          });
        }
        continue;
      }
      out.push({
        name: decl.name,
        typeName: t.fullName,
        baseType: t.baseType ?? 'Real',
        description: decl.description,
        literals: t.literals,
        declaringClass: declaringClass.fullName,
        defaultExpr: ic.binding?.expr ?? decl.modification?.value,
        typeAttrs: typeAttrsOf(t),
        attrs: mergeMods(declMods, ic.sub),
        final: decl.prefixes.final || !!ic.binding?.final,
        constant: decl.prefixes.constant,
        dialog,
        structural,
        loc: decl.loc,
      });
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// Owner modifiers
// ---------------------------------------------------------------------------

/**
 * Record-typed parameters of `className`, flattened one level by `collectRawParameters`
 * (`data` for `data.a`): the keys whose record-constructor bindings are expanded into fields.
 */
function recordParameterNames(registry: ClassRegistry, cache: RegistryCache, className: string): Set<string> {
  const out = new Set<string>();
  for (const raw of collectRawParameters(registry, cache, className)) {
    const dot = raw.name.lastIndexOf('.');
    if (dot > 0) out.add(raw.name.slice(0, dot));
  }
  return out;
}

/**
 * Expands a record-constructor binding of a record-typed parameter into its fields, so that
 * `m(data = Data(a=3))` reads like `m(data(a=3))` (`data.a`). Explicit dotted entries of the same
 * modification level win over the constructor's fields, as on a declaration
 * (`data(b=6) = Data(a=5)`). Bindings of other keys (function calls) are left alone.
 */
function expandRecordConstructors(mods: FlatMods, recordKeys: ReadonlySet<string>): FlatMods {
  if (recordKeys.size === 0 || mods.size === 0) return mods;
  let out: FlatMods | undefined;
  for (const [key, mod] of mods) {
    if (!recordKeys.has(key) || mod.expr.kind !== 'call') continue;
    for (const [field, fieldMod] of recordConstructorMods(mod.expr)) {
      const path = `${key}.${field}`;
      if (mods.has(path)) continue;
      (out ??= new Map(mods)).set(path, { expr: fieldMod.expr, final: mod.final });
    }
  }
  return out ?? mods;
}

/**
 * Modifiers applying to component `owner.componentName` as seen from `owner.ownerClassName`:
 * the declaration's own modification (lowest priority) plus the `extends` modifications on the
 * path from the owner down to the declaring class (`extends Base(comp(R=5))`), outermost winning.
 * Keys are dotted paths relative to the component (`R`, `R.start`, `data.a`); record-constructor
 * bindings of record-typed parameters (`data = Data(a=3)`) also appear as fields (`data.a`).
 */
export function ownerModifiers(registry: ClassRegistry, cache: RegistryCache, owner: ParameterOwner): FlatMods {
  return cache.memo('ownerModifiers', `${owner.ownerClassName}\u0000${owner.componentName}`, (): FlatMods => {
    const ic = findComponent(registry, cache, owner.ownerClassName, owner.componentName);
    if (!ic) return new Map();
    const t = resolveTypeName(registry, cache, ic.decl.typeName, ic.declaringClass.fullName);
    const recordKeys = t.kind === 'unresolved' || t.kind === 'builtin' ? new Set<string>() : recordParameterNames(registry, cache, t.fullName);
    let mods = expandRecordConstructors(flattenMods(ic.decl.modification?.mods), recordKeys);
    if (ic.declaringClass.fullName !== owner.ownerClassName) {
      const path = extendsPath(registry, owner.ownerClassName, ic.declaringClass.fullName) ?? [];
      // Closest to the declaring class first, the owner's own extends clause last (highest priority).
      for (let i = path.length - 1; i >= 0; i--) {
        const all = flattenMods(path[i].modification?.mods);
        const { binding, sub } = splitMods(all, owner.componentName);
        mods = mergeMods(mods, expandRecordConstructors(sub, recordKeys));
        if (binding) mods = mergeMods(mods, expandRecordConstructors(recordConstructorMods(binding.expr), recordKeys));
      }
    }
    return mods;
  });
}

// ---------------------------------------------------------------------------
// Constant lookup through the registry
// ---------------------------------------------------------------------------

/**
 * Value of a dotted constant reference such as `Modelica.Constants.pi`, `Constants.small` (looked
 * up from `scope`) or an enumeration literal `Types.Init.SteadyState`. Undefined when unknown.
 */
export function lookupConstant(registry: ClassRegistry, cache: RegistryCache, dotted: string, scope: string): ConstValue | undefined {
  const i = dotted.lastIndexOf('.');
  if (i <= 0) return undefined;
  const clsName = dotted.slice(0, i);
  const member = dotted.slice(i + 1);
  const cls = registry.lookup(clsName, scope);
  if (!cls || cls.builtin) return undefined;
  const t = classifyClass(registry, cache, cls.fullName);
  if (t.literals && t.literals.includes(member)) return member;
  const param = getParameters(registry, cls.fullName).find((p) => p.name === member);
  return param?.evaluated;
}

/**
 * Value of a name used in a modifier expression of a component inside `ownerClassName`: a
 * parameter of the owner, a `component.parameter` reference or a constant.
 */
function ownerValue(registry: ClassRegistry, cache: RegistryCache, ownerClassName: string, name: string): ConstValue | undefined {
  const own = getParameters(registry, ownerClassName).find((p) => p.name === name);
  if (own) return own.evaluated;
  const dot = name.indexOf('.');
  if (dot > 0) {
    const componentName = name.slice(0, dot);
    const rest = name.slice(dot + 1);
    const ic = findComponent(registry, cache, ownerClassName, componentName);
    if (ic) {
      const t = resolveTypeName(registry, cache, ic.decl.typeName, ic.declaringClass.fullName);
      if (t.kind !== 'unresolved' && t.kind !== 'builtin') {
        const p = getParameters(registry, t.fullName, { ownerClassName, componentName }).find((x) => x.name === rest);
        if (p) return p.evaluated;
      }
    }
  }
  return lookupConstant(registry, cache, name, ownerClassName);
}

// ---------------------------------------------------------------------------
// getParameters
// ---------------------------------------------------------------------------

/**
 * Parameters of `className` (declared + inherited, bases first). When `owner` (a component
 * `componentName` inside `ownerClassName`) is given, the component's modifiers are reflected in
 * `valueText` / `attributes` / `evaluated`. Results are memoised per registry content and shared:
 * treat them as read-only.
 */
export function getParameters(registry: ClassRegistry, className: string, owner?: ParameterOwner): ParameterInfo[] {
  const cache = cacheFor(registry);
  const key = owner ? `${className}\u0000${owner.ownerClassName}\u0000${owner.componentName}` : className;
  const guard = `parameters:${key}`;
  if (cache.computing.has(guard)) return []; // cyclic constant references across classes: best effort
  cache.computing.add(guard);
  try {
    return cache.memo('parameters', key, () => computeParameters(registry, cache, className, owner));
  } finally {
    cache.computing.delete(guard);
  }
}

interface Entry {
  raw: RawParameter;
  valueExpr?: Expr;
  valueFinal: boolean;
  ownerAttrs: FlatMods;
}

function computeParameters(registry: ClassRegistry, cache: RegistryCache, className: string, owner?: ParameterOwner): ParameterInfo[] {
  const raws = collectRawParameters(registry, cache, className);
  if (raws.length === 0) return [];
  const ownerMods: FlatMods = owner ? ownerModifiers(registry, cache, owner) : new Map();
  const entries: Entry[] = raws.map((raw) => {
    const { binding, sub } = splitMods(ownerMods, raw.name);
    return { raw, valueExpr: binding?.expr, valueFinal: !!binding?.final, ownerAttrs: sub };
  });
  const byName = new Map(entries.map((e) => [e.raw.name, e]));

  // Evaluation environments: names of the class resolve to sibling parameters (recursively, cycle
  // guarded), everything else to constants looked up from the declaring class.
  const values = new Map<string, ConstValue | undefined>();
  const visiting = new Set<string>();
  const envs = new Map<string, EvalEnv>();
  const envFor = (scope: string): EvalEnv => {
    let env = envs.get(scope);
    if (!env) {
      env = { lookup: (n) => (byName.has(n) ? valueOf(n) : lookupConstant(registry, cache, n, scope)) };
      envs.set(scope, env);
    }
    return env;
  };
  const ownerEnv: EvalEnv | undefined = owner ? { lookup: (n) => ownerValue(registry, cache, owner.ownerClassName, n) } : undefined;
  const valueOf = (name: string): ConstValue | undefined => {
    if (values.has(name)) return values.get(name);
    if (visiting.has(name)) return undefined;
    const e = byName.get(name);
    if (!e) return undefined;
    visiting.add(name);
    let v: ConstValue | undefined;
    try {
      if (e.valueExpr) v = tryEvaluateConstant(e.valueExpr, ownerEnv ?? envFor(e.raw.declaringClass));
      else if (e.raw.defaultExpr) v = tryEvaluateConstant(e.raw.defaultExpr, envFor(e.raw.declaringClass));
    } finally {
      visiting.delete(name);
    }
    values.set(name, v);
    return v;
  };

  const out: ParameterInfo[] = [];
  for (const e of entries) {
    const raw = e.raw;
    const env = envFor(raw.declaringClass);
    const attrs = mergeMods(mergeMods(raw.typeAttrs, raw.attrs), e.ownerAttrs);
    const info: ParameterInfo = {
      name: raw.name,
      typeName: raw.typeName,
      baseType: raw.baseType,
      final: raw.final || e.valueFinal,
      constant: raw.constant,
      dialog: { tab: raw.dialog.tab, group: raw.dialog.group },
    };
    if (raw.description !== undefined) info.description = raw.description;
    const unit = evalString(attrs.get('unit')?.expr);
    if (unit !== undefined) info.unit = unit;
    const displayUnit = evalString(attrs.get('displayUnit')?.expr);
    if (displayUnit !== undefined) info.displayUnit = displayUnit;
    if (raw.defaultExpr) info.defaultText = printExpr(raw.defaultExpr);
    if (e.valueExpr) info.valueText = printExpr(e.valueExpr);
    const v = valueOf(raw.name);
    if (v !== undefined) info.evaluated = v;
    if (raw.literals) info.literals = raw.literals;
    const min = numberOf(attrs.get('min'), env);
    if (min !== undefined) info.min = min;
    const max = numberOf(attrs.get('max'), env);
    if (max !== undefined) info.max = max;
    if (raw.dialog.enableExpr) {
      const enable = evalBoolean(raw.dialog.enableExpr) ?? tryEvaluateConstant(raw.dialog.enableExpr, env);
      if (typeof enable === 'boolean') info.dialog!.enable = enable;
    }
    const attributes = attributeTexts(mergeMods(raw.attrs, e.ownerAttrs));
    if (attributes) info.attributes = attributes;
    const fixed = attrs.get('fixed');
    if (raw.structural || (fixed && evalBoolean(fixed.expr) === false)) info.structural = true;
    if (raw.loc) info.loc = raw.loc;
    out.push(info);
  }
  return out;
}

function numberOf(mod: FlatMod | undefined, env: EvalEnv): number | undefined {
  if (!mod) return undefined;
  const v = tryEvaluateConstant(mod.expr, env);
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Single-level attribute modifiers as Modelica text (`{ start: '1', fixed: 'true' }`), undefined when empty. */
function attributeTexts(mods: FlatMods): Record<string, string> | undefined {
  let out: Record<string, string> | undefined;
  for (const [k, m] of mods) {
    if (k.includes('.')) continue;
    (out ??= {})[k] = printExpr(m.expr);
  }
  return out;
}

// ---------------------------------------------------------------------------
// getVariables
// ---------------------------------------------------------------------------

/**
 * Non-parameter variables of a class (declared + inherited, protected included): scalar
 * components, causal connectors (`u`, `y`), the variables of physical connectors (`p.v`, `p.i`)
 * and record fields one level deep (`r.x`). Sub-components (model/block typed) are excluded.
 */
export function getVariables(registry: ClassRegistry, className: string): VariableInfo[] {
  const cache = cacheFor(registry);
  return cache.memo('variables', className, () => computeVariables(registry, cache, className));
}

function computeVariables(registry: ClassRegistry, cache: RegistryCache, className: string): VariableInfo[] {
  const out: VariableInfo[] = [];
  for (const ic of collectComponents(registry, cache, className)) {
    const { decl, declaringClass } = ic;
    if (decl.prefixes.parameter || decl.prefixes.constant) continue;
    const t = resolveTypeName(registry, cache, decl.typeName, declaringClass.fullName);
    // A placed declaration of unknown type is a (broken) component, not a variable.
    if (t.kind === 'unresolved' && parsePlacement(decl.annotation)) continue;
    const attrs = mergeMods(mergeMods(typeAttrsOf(t), flattenMods(decl.modification?.mods)), ic.sub);
    if (isScalarKind(t)) {
      out.push(variableInfo(decl.name, t, decl.description, attrs, false, causalityOf(decl, t), decl.prefixes.flow || t.flow, decl.prefixes.discrete));
      continue;
    }
    if (t.kind === 'class') continue;
    if (t.kind === 'connector' && t.baseType) {
      out.push(variableInfo(decl.name, t, decl.description, attrs, true, causalityOf(decl, t), decl.prefixes.flow || t.flow, decl.prefixes.discrete));
      continue;
    }
    const defining = definingClassName(t);
    if (!defining) continue;
    const inConnector = t.kind === 'connector';
    for (const f of collectComponents(registry, cache, defining)) {
      if (f.decl.prefixes.parameter || f.decl.prefixes.constant) continue;
      const ft = resolveTypeName(registry, cache, f.decl.typeName, f.declaringClass.fullName);
      if (!isScalarKind(ft) && !(ft.kind === 'connector' && ft.baseType)) continue; // one level only
      const { sub } = splitMods(attrs, f.decl.name);
      const fattrs = mergeMods(mergeMods(mergeMods(typeAttrsOf(ft), flattenMods(f.decl.modification?.mods)), f.sub), sub);
      const causality: Causality = inConnector ? causalityOf(f.decl, ft) : 'none';
      out.push(variableInfo(`${decl.name}.${f.decl.name}`, ft, f.decl.description, fattrs, inConnector, causality, f.decl.prefixes.flow || ft.flow, f.decl.prefixes.discrete));
    }
  }
  return out;
}

function variableInfo(name: string, t: ComponentType, description: string | undefined, attrs: FlatMods, inConnector: boolean, causality: Causality, flow: boolean, discretePrefix: boolean): VariableInfo {
  const baseType = t.baseType;
  const discrete = discretePrefix || baseType === 'Boolean' || baseType === 'Integer' || baseType === 'String' || baseType === 'enumeration';
  const info: VariableInfo = {
    name,
    typeName: t.fullName,
    causality,
    variability: discrete ? 'discrete' : 'continuous',
    flow,
    inConnector,
  };
  if (description !== undefined) info.description = description;
  const unit = evalString(attrs.get('unit')?.expr);
  if (unit !== undefined) info.unit = unit;
  return info;
}
