/**
 * Component naming helpers for the editor: identifier validation, `defaultComponentName` /
 * `defaultComponentPrefixes` annotations and unique-name generation (`resistor`, `resistor1`, ...).
 */
import type { ClassDef, ComponentPrefixes, Modifier } from '../ast.js';
import { evalString } from '../graphics/annotations.js';
import { KEYWORDS } from '../parser/lexer.js';
import type { ClassRegistry, RegisteredClass } from '../registry.js';

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const QUOTED_IDENT_RE = /^'(?:[^'\\]|\\.)+'$/;

/** True for a Modelica identifier: `[A-Za-z_][A-Za-z0-9_]*` that is not a keyword, or a quoted identifier `'a b'`. */
export function isValidIdentifier(name: string): boolean {
  if (QUOTED_IDENT_RE.test(name)) return true;
  return IDENT_RE.test(name) && !KEYWORDS.has(name);
}

/** Last segment of a dotted class name. */
export function shortClassName(fullName: string): string {
  const i = fullName.lastIndexOf('.');
  return i < 0 ? fullName : fullName.slice(i + 1);
}

/** Lower-cases the first character only: `Resistor` → `resistor`, `SineVoltage` → `sineVoltage`, `PID` → `pID`. */
export function lowerFirst(s: string): string {
  return s.length ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function topLevelModifier(def: ClassDef, name: string): Modifier | undefined {
  return def.annotation?.mods.find((m) => m.name === name && !m.redeclare);
}

/**
 * String-valued class annotation entry (`defaultComponentName`, `defaultComponentPrefixes`, ...),
 * searched on the class itself first and then on its base classes.
 */
export function classAnnotationString(registry: ClassRegistry, cls: RegisteredClass, key: string): string | undefined {
  const own = evalString(topLevelModifier(cls.def, key)?.modification.value);
  if (own !== undefined) return own;
  const chain = registry.inheritanceChain(cls.fullName);
  for (let i = chain.length - 1; i >= 0; i--) {
    if (chain[i].fullName === cls.fullName) continue;
    const v = evalString(topLevelModifier(chain[i].def, key)?.modification.value);
    if (v !== undefined) return v;
  }
  return undefined;
}

const PREFIX_KEYS: (keyof ComponentPrefixes)[] = [
  'flow', 'stream', 'input', 'output', 'parameter', 'constant', 'discrete', 'final', 'inner', 'outer', 'replaceable', 'redeclare',
];

/** Prefixes requested by a `defaultComponentPrefixes="inner"` annotation (unknown words are ignored). */
export function defaultPrefixesOf(registry: ClassRegistry, cls: RegisteredClass): Partial<ComponentPrefixes> {
  const text = classAnnotationString(registry, cls, 'defaultComponentPrefixes');
  const out: Partial<ComponentPrefixes> = {};
  if (!text) return out;
  for (const word of text.split(/\s+/)) {
    const key = PREFIX_KEYS.find((k) => k === word);
    if (key) out[key] = true;
  }
  return out;
}

/**
 * Names that a new component of `className` may not use: own components and nested classes
 * (from `own` when given — e.g. an edited copy — otherwise from the registry) plus inherited ones.
 */
export function takenNames(registry: ClassRegistry, className: string, own?: ClassDef): Set<string> {
  const names = new Set<string>();
  const collect = (def: ClassDef | undefined) => {
    if (!def) return;
    for (const c of def.components) names.add(c.name);
    for (const c of def.classes) names.add(c.name);
  };
  collect(own ?? registry.get(className)?.def);
  for (const cls of registry.inheritanceChain(className)) {
    if (cls.fullName === className) continue;
    collect(cls.def);
  }
  return names;
}

/** `base` if free, otherwise `base1`, `base2`, ... */
export function pickComponentName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 1; ; i++) {
    const candidate = `${base}${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Base name for a component of `cls`: its `defaultComponentName` annotation when present, else
 * the lower-camel short class name. Always a valid identifier (`Model` → `model1`, since
 * `model` is a keyword).
 */
export function defaultBaseName(registry: ClassRegistry, cls: RegisteredClass | undefined, classNameText: string): string {
  const annotated = cls ? classAnnotationString(registry, cls, 'defaultComponentName') : undefined;
  let base = annotated && isValidIdentifier(annotated) ? annotated : lowerFirst(shortClassName(cls?.fullName ?? classNameText));
  if (!isValidIdentifier(base)) base = base.replace(/[^A-Za-z0-9_]/g, '_');
  if (!isValidIdentifier(base)) base = /^[0-9]/.test(base) ? `c${base}` : `${base}1`;
  return base;
}

/**
 * The name a component of `className` dropped onto `targetClass` would get:
 * `defaultComponentName` or the lower-camel short class name, made unique with a numeric suffix.
 */
export function generateComponentName(registry: ClassRegistry, className: string, targetClass: string): string {
  const cls = registry.lookup(className, targetClass) ?? registry.get(className);
  return pickComponentName(defaultBaseName(registry, cls, className), takenNames(registry, targetClass));
}
