/**
 * Shared class analysis for the diagram view-model: component type classification, connector
 * facts (causality / physical / domain), inheritance walks with `extends` modifications and small
 * annotation readers. Everything is memoised in the per-registry cache (see `cache.ts`).
 */
import type { ComponentDecl, Expr, Modification, Modifier } from '../ast.js';
import type { Causality } from '../flat.js';
import type { Color, GraphicsLayer, Placement } from '../graphics.js';
import { DEFAULT_COORDINATE_SYSTEM } from '../graphics.js';
import { DEFAULT_TRANSFORMATION, evalBoolean, evalString, findAnnotation } from '../graphics/annotations.js';
import type { ClassRegistry, RegisteredClass, ResolvedType } from '../registry.js';
import type { RegistryCache } from './cache.js';

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

export function shortName(fullName: string): string {
  const i = fullName.lastIndexOf('.');
  return i < 0 ? fullName : fullName.slice(i + 1);
}

// ---------------------------------------------------------------------------
// Flattened modifications
// ---------------------------------------------------------------------------

export interface FlatMod {
  expr: Expr;
  final: boolean;
}

/** Dotted path (`R`, `R.start`, `p.v.start`) → binding. Later `set`s win, so callers add low-priority mods first. */
export type FlatMods = Map<string, FlatMod>;

/** Flattens nested/dotted modifiers into dotted paths. `redeclare` modifiers are ignored. */
export function flattenMods(mods: Modifier[] | undefined, into: FlatMods = new Map(), prefix = '', inheritedFinal = false): FlatMods {
  if (!mods) return into;
  for (const m of mods) {
    if (m.redeclare) continue;
    const path = prefix + m.name;
    const final = inheritedFinal || !!m.final;
    if (m.modification.value) into.set(path, { expr: m.modification.value, final });
    if (m.modification.mods.length) flattenMods(m.modification.mods, into, `${path}.`, final);
  }
  return into;
}

/** Copies `high` over `low` into a new map (entries of `high` win). */
export function mergeMods(low: FlatMods, high: FlatMods): FlatMods {
  if (high.size === 0) return new Map(low);
  const out = new Map(low);
  for (const [k, v] of high) out.set(k, v);
  return out;
}

/** Splits the modifications applying to component `name`: its direct binding and the `name.*` sub-modifiers (prefix stripped). */
export function splitMods(all: FlatMods, name: string): { binding?: FlatMod; sub: FlatMods } {
  const sub: FlatMods = new Map();
  let binding: FlatMod | undefined;
  if (all.size === 0) return { binding, sub };
  const prefix = `${name}.`;
  for (const [k, v] of all) {
    if (k === name) binding = v;
    else if (k.startsWith(prefix)) sub.set(k.slice(prefix.length), v);
  }
  return { binding, sub };
}

/** Modifications of a record-constructor binding `Data(a=1, b=2)` seen as field bindings. */
export function recordConstructorMods(value: Expr | undefined): FlatMods {
  const out: FlatMods = new Map();
  if (value && value.kind === 'call') for (const na of value.namedArgs) out.set(na.name, { expr: na.value, final: false });
  return out;
}

// ---------------------------------------------------------------------------
// Annotation readers
// ---------------------------------------------------------------------------

/** Value of field `name` of an annotation entry, whichever AST shape it has (`Dialog(group="x")` as nested modifier or as a call). */
export function annotationField(entry: Modifier | undefined, name: string): Expr | undefined {
  if (!entry) return undefined;
  const nested = entry.modification.mods.find((m) => m.name === name);
  if (nested?.modification.value) return nested.modification.value;
  const v = entry.modification.value;
  if (v && v.kind === 'call') return v.namedArgs.find((a) => a.name === name)?.value;
  return undefined;
}

export interface DialogInfo {
  tab: string;
  group: string;
  enableExpr?: Expr;
}

/** `Dialog(tab=..., group=..., enable=...)` with the Modelica defaults `General` / `Parameters`. */
export function readDialog(annotation: Modification | undefined): DialogInfo {
  const entry = findAnnotation(annotation, 'Dialog');
  const tab = evalString(annotationField(entry, 'tab')) ?? 'General';
  const group = evalString(annotationField(entry, 'group')) ?? 'Parameters';
  const enableExpr = annotationField(entry, 'enable');
  return enableExpr ? { tab, group, enableExpr } : { tab, group };
}

/** `annotation(Evaluate=true)`. */
export function isEvaluateAnnotation(annotation: Modification | undefined): boolean {
  const entry = findAnnotation(annotation, 'Evaluate');
  return evalBoolean(entry?.modification.value) === true;
}

/** True if the `Icon`/`Diagram` entry of a class annotation spells out its own `coordinateSystem`. */
export function hasOwnCoordinateSystem(annotation: Modification | undefined, kind: 'Icon' | 'Diagram'): boolean {
  const entry = findAnnotation(annotation, kind);
  if (!entry) return false;
  if (entry.modification.mods.some((m) => m.name === 'coordinateSystem' || m.name.startsWith('coordinateSystem.'))) return true;
  const v = entry.modification.value;
  return !!v && v.kind === 'call' && v.namedArgs.some((a) => a.name === 'coordinateSystem');
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function emptyLayer(): GraphicsLayer {
  const d = DEFAULT_COORDINATE_SYSTEM;
  return {
    coordinateSystem: { extent: [[d.extent[0][0], d.extent[0][1]], [d.extent[1][0], d.extent[1][1]]], preserveAspectRatio: d.preserveAspectRatio, initialScale: d.initialScale, grid: [d.grid[0], d.grid[1]] },
    graphics: [],
  };
}

/** Placement used for declarations without a `Placement` annotation: invisible, default transformation. */
export function hiddenPlacement(): Placement {
  const t = DEFAULT_TRANSFORMATION;
  return {
    visible: false,
    transformation: { origin: [t.origin[0], t.origin[1]], extent: [[t.extent[0][0], t.extent[0][1]], [t.extent[1][0], t.extent[1][1]]], rotation: t.rotation },
  };
}

// ---------------------------------------------------------------------------
// Type classification
// ---------------------------------------------------------------------------

export type BaseTypeName = 'Real' | 'Integer' | 'Boolean' | 'String' | 'enumeration';

/**
 * - `builtin`: `Real`, `Integer`, `Boolean`, `String` themselves
 * - `scalar`: a short-class chain ending in a builtin (`SI.Voltage`) or an enumeration type
 * - `connector`: a connector class, or a short class with `connector` restriction (`RealInput`)
 * - `record`: a record class
 * - `class`: model / block / package / function / partial class ... (a sub-component)
 * - `unresolved`: the type name could not be looked up
 */
export type TypeKind = 'builtin' | 'scalar' | 'connector' | 'record' | 'class' | 'unresolved';

export interface ComponentType {
  kind: TypeKind;
  /** Fully-qualified name of the resolved class (the type name as written when unresolved). */
  fullName: string;
  /** The resolved class (outermost of a short-class chain). */
  cls?: RegisteredClass;
  /** The registry's short-class resolution, when available. */
  resolved?: ResolvedType;
  /** Base type of scalar / causal-connector types. */
  baseType?: BaseTypeName;
  literals?: string[];
  /** Causality from short-class prefixes (`connector RealInput = input Real`). */
  causality: Causality;
  /** `flow` prefix from a short-class chain. */
  flow: boolean;
}

function baseTypeOf(rt: ResolvedType): BaseTypeName | undefined {
  if (rt.enumerationLiterals) return 'enumeration';
  if (rt.base.builtin) return rt.base.fullName as BaseTypeName;
  return undefined;
}

/** Classifies the class `fullName` (memoised). */
export function classifyClass(registry: ClassRegistry, cache: RegistryCache, fullName: string): ComponentType {
  return cache.memo('classify', fullName, (): ComponentType => {
    const cls = registry.get(fullName);
    if (!cls) return { kind: 'unresolved', fullName, causality: 'none', flow: false };
    if (cls.builtin) return { kind: 'builtin', fullName, cls, baseType: fullName as BaseTypeName, causality: 'none', flow: false };
    const rt = registry.resolveType(fullName);
    if (!rt) return { kind: restrictionKind(cls), fullName, cls, causality: 'none', flow: false };
    const baseType = baseTypeOf(rt);
    const causality: Causality = rt.prefixes.input ? 'input' : rt.prefixes.output ? 'output' : 'none';
    if (baseType) {
      const kind: TypeKind = cls.def.restriction === 'connector' ? 'connector' : 'scalar';
      return { kind, fullName, cls, resolved: rt, baseType, literals: rt.enumerationLiterals, causality, flow: rt.prefixes.flow };
    }
    return { kind: restrictionKind(rt.base), fullName, cls, resolved: rt, causality, flow: rt.prefixes.flow };
  });
}

function restrictionKind(cls: RegisteredClass): TypeKind {
  switch (cls.def.restriction) {
    case 'connector':
      return 'connector';
    case 'record':
      return 'record';
    default:
      return 'class';
  }
}

/** Resolves the type name of a declaration inside `scope` and classifies it (memoised). */
export function resolveTypeName(registry: ClassRegistry, cache: RegistryCache, typeName: string, scope: string): ComponentType {
  return cache.memo('resolveType', `${scope}\u0000${typeName}`, (): ComponentType => {
    const cls = registry.lookup(typeName, scope);
    if (!cls) return { kind: 'unresolved', fullName: typeName, causality: 'none', flow: false };
    return classifyClass(registry, cache, cls.fullName);
  });
}

/** The class whose components/equations define `t` (the end of a short-class chain), if any. */
export function definingClassName(t: ComponentType): string | undefined {
  if (t.kind === 'unresolved' || t.kind === 'builtin') return undefined;
  return t.resolved?.base.fullName ?? t.fullName;
}

// ---------------------------------------------------------------------------
// Inheritance walk with extends modifications
// ---------------------------------------------------------------------------

export interface InheritedComponent {
  decl: ComponentDecl;
  declaringClass: RegisteredClass;
  /** True when declared in a base class of the walked class. */
  inherited: boolean;
  /** Direct modification of this component from the `extends` clauses on the path (`extends Base(R=100)`). */
  binding?: FlatMod;
  /** Sub-modifications from the `extends` path relative to the component (`extends Base(r(R=5))` → `R`). */
  sub: FlatMods;
}

/**
 * Every component declaration of `className` and its bases (bases first, depth-first in `extends`
 * order, like `ClassRegistry.inheritanceChain`), with the `extends` modifications on the path
 * applied (outer classes win). Memoised per class.
 */
export function collectComponents(registry: ClassRegistry, cache: RegistryCache, className: string): InheritedComponent[] {
  return cache.memo('components', className, () => {
    const out: InheritedComponent[] = [];
    const visited = new Set<string>();
    const visit = (cls: RegisteredClass, mods: FlatMods): void => {
      for (const ext of cls.def.extends) {
        const base = registry.lookup(ext.typeName, cls.fullName);
        if (!base || base.builtin || base.fullName === cls.fullName || visited.has(base.fullName)) continue;
        visited.add(base.fullName);
        visit(base, mergeMods(flattenMods(ext.modification?.mods), mods));
      }
      for (const decl of cls.def.components) {
        const { binding, sub } = splitMods(mods, decl.name);
        out.push({ decl, declaringClass: cls, inherited: cls.fullName !== className, binding, sub });
      }
    };
    const root = registry.get(className);
    if (root && !root.builtin) {
      visited.add(className);
      visit(root, new Map());
    }
    return out;
  });
}

/** The `extends` clauses leading from `from` down to `target` (outermost first), or undefined if `target` is not a base. */
export function extendsPath(registry: ClassRegistry, from: string, target: string): { typeName: string; modification?: Modification }[] | undefined {
  const visited = new Set<string>();
  const walk = (name: string): { typeName: string; modification?: Modification }[] | undefined => {
    if (name === target) return [];
    if (visited.has(name)) return undefined;
    visited.add(name);
    const cls = registry.get(name);
    if (!cls || cls.builtin) return undefined;
    for (const ext of cls.def.extends) {
      const base = registry.lookup(ext.typeName, cls.fullName);
      if (!base || base.fullName === name) continue;
      const rest = walk(base.fullName);
      if (rest) return [ext, ...rest];
    }
    return undefined;
  };
  return walk(from);
}

/** Finds the declaration of component `name` in `className` or its bases (the class itself first). */
export function findComponent(registry: ClassRegistry, cache: RegistryCache, className: string, name: string): InheritedComponent | undefined {
  const comps = collectComponents(registry, cache, className);
  for (let i = comps.length - 1; i >= 0; i--) if (comps[i].decl.name === name) return comps[i];
  return undefined;
}

// ---------------------------------------------------------------------------
// Connector facts
// ---------------------------------------------------------------------------

export interface ConnectorFacts {
  causality: Causality;
  /** Declares at least one `flow` variable (acausal physical connector). */
  physical: boolean;
  domain: string;
}

const DOMAIN_PATTERNS: [RegExp, string][] = [
  [/\.Electrical\./, 'electrical'],
  [/\.Rotational\./, 'rotational'],
  [/\.Translational\./, 'translational'],
  [/\.Thermal\.|HeatPort/, 'thermal'],
  [/Fluid/, 'fluid'],
  [/RealInput|RealOutput/, 'real'],
  [/BooleanInput|BooleanOutput/, 'boolean'],
  [/IntegerInput|IntegerOutput/, 'integer'],
];

/** Domain heuristic from a connector class name (`Modelica.Electrical.Analog.Interfaces.Pin` → `electrical`). */
export function domainOfName(fullName: string): string {
  for (const [re, domain] of DOMAIN_PATTERNS) if (re.test(fullName)) return domain;
  return 'other';
}

export const DOMAIN_COLORS: Readonly<Record<string, Color>> = {
  electrical: [0, 0, 255],
  rotational: [95, 95, 95],
  translational: [0, 127, 0],
  thermal: [191, 0, 0],
  real: [0, 0, 127],
  boolean: [255, 0, 255],
  integer: [255, 127, 0],
};

/** Default connection colour of a domain (black for unknown domains). */
export function domainColor(domain: string): Color {
  const c = DOMAIN_COLORS[domain];
  return c ? [c[0], c[1], c[2]] : [0, 0, 0];
}

/** Causality / physical / domain of a connector class (memoised). Works for non-connector classes too (all `none`/false). */
export function connectorFacts(registry: ClassRegistry, cache: RegistryCache, fullName: string): ConnectorFacts {
  return cache.memo('connector', fullName, (): ConnectorFacts => {
    const t = classifyClass(registry, cache, fullName);
    let physical = t.flow;
    const defining = definingClassName(t);
    if (!physical && defining && t.kind === 'connector' && !t.baseType) {
      for (const ic of collectComponents(registry, cache, defining)) {
        if (ic.decl.prefixes.flow) {
          physical = true;
          break;
        }
        const ft = resolveTypeName(registry, cache, ic.decl.typeName, ic.declaringClass.fullName);
        if (ft.flow) {
          physical = true;
          break;
        }
      }
    }
    let domain = 'other';
    const names = t.resolved ? t.resolved.chain.map((c) => c.fullName) : [fullName];
    for (const n of names) {
      domain = domainOfName(n);
      if (domain !== 'other') break;
    }
    if (domain === 'other' && t.baseType && t.causality !== 'none') {
      if (t.baseType === 'Real') domain = 'real';
      else if (t.baseType === 'Boolean') domain = 'boolean';
      else if (t.baseType === 'Integer') domain = 'integer';
    }
    return { causality: t.causality, physical, domain };
  });
}

/** Causality of a declaration: its own `input`/`output` prefix, else that of its type. */
export function causalityOf(decl: ComponentDecl, t: ComponentType): Causality {
  if (decl.prefixes.input) return 'input';
  if (decl.prefixes.output) return 'output';
  return t.causality;
}
