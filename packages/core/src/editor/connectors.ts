/**
 * Connector lookup for `connect()` editing: which references (`resistor.p`, `u`) exist in a
 * class and whether a reference the canvas hands us denotes a connector. Resolution goes
 * through the class registry and is deliberately tolerant: a component whose class cannot be
 * resolved (missing library) is accepted, so the user still gets a connect equation and a
 * compile diagnostic later rather than a blocked edit.
 */
import type { ClassDef, ComponentDecl } from '../ast.js';
import type { ClassRegistry, RegisteredClass } from '../registry.js';

export interface ComponentEntry {
  decl: ComponentDecl;
  /** Fully-qualified name of the class that declares the component (lookup scope for its type). */
  declaringClass: string;
  inherited: boolean;
}

/**
 * Components visible in `className`: inherited ones (base classes first) then its own. `own`
 * replaces the registry's copy of the class itself — the editor passes its edited clone.
 */
export function componentsOf(registry: ClassRegistry, className: string, own?: ClassDef): ComponentEntry[] {
  const out: ComponentEntry[] = [];
  const add = (def: ClassDef, declaringClass: string, inherited: boolean) => {
    for (const decl of def.components) {
      if (!out.some((e) => e.decl.name === decl.name)) out.push({ decl, declaringClass, inherited });
    }
  };
  const chain = registry.inheritanceChain(className);
  let sawSelf = false;
  for (const cls of chain) {
    if (cls.fullName === className) {
      sawSelf = true;
      add(own ?? cls.def, className, false);
    } else {
      add(cls.def, cls.fullName, true);
    }
  }
  if (!sawSelf && own) add(own, className, false);
  return out;
}

/** True if `fullName` is a connector class (directly or through a short-class chain such as `connector RealInput = input Real`). */
export function isConnectorClass(registry: ClassRegistry, fullName: string): boolean {
  const resolved = registry.resolveType(fullName);
  const chain: RegisteredClass[] = resolved ? resolved.chain : [];
  if (!chain.length) {
    const cls = registry.get(fullName);
    if (cls) chain.push(cls);
  }
  return chain.some((c) => c.def.restriction === 'connector');
}

export function resolveComponentClass(registry: ClassRegistry, entry: ComponentEntry): RegisteredClass | undefined {
  return registry.lookup(entry.decl.typeName, entry.declaringClass);
}

/**
 * Every connector reference that `connect()` may use inside `className`: `comp.port` for each
 * connector `port` of each component `comp` (inherited included) and `u` for the class's own
 * connector components. Protected components are skipped.
 */
export function listConnectorRefs(registry: ClassRegistry, className: string, own?: ClassDef): string[] {
  const out: string[] = [];
  for (const entry of componentsOf(registry, className, own)) {
    if (entry.decl.prefixes.protected) continue;
    const cls = resolveComponentClass(registry, entry);
    if (!cls) continue;
    if (isConnectorClass(registry, cls.fullName)) {
      out.push(entry.decl.name);
      continue;
    }
    if (cls.builtin) continue;
    for (const port of componentsOf(registry, cls.fullName)) {
      if (port.decl.prefixes.protected) continue;
      const portClass = resolveComponentClass(registry, port);
      if (portClass && isConnectorClass(registry, portClass.fullName)) out.push(`${entry.decl.name}.${port.decl.name}`);
    }
  }
  return out;
}

/**
 * Checks that the dotted reference `parts` (e.g. `['resistor', 'p']`) denotes a connector
 * reachable from `className`. Returns an error message, or undefined when the reference is
 * valid or cannot be checked because a class along the path is unresolvable.
 */
export function validateConnectorRef(registry: ClassRegistry, className: string, parts: string[], own?: ClassDef): string | undefined {
  if (!parts.length) return 'Empty connector reference';
  let scope = className;
  let scopeDef: ClassDef | undefined = own;
  for (let i = 0; i < parts.length; i++) {
    const name = parts[i];
    const entry = componentsOf(registry, scope, scopeDef).find((e) => e.decl.name === name);
    if (!entry) {
      return i === 0
        ? `Unknown component '${name}' in class '${className}'`
        : `Unknown connector '${parts.slice(0, i + 1).join('.')}': '${scope}' has no component '${name}'`;
    }
    const cls = resolveComponentClass(registry, entry);
    if (!cls) return undefined;
    const last = i === parts.length - 1;
    if (last) return isConnectorClass(registry, cls.fullName) ? undefined : `'${parts.join('.')}' is not a connector`;
    if (cls.builtin) return `'${parts.slice(0, i + 1).join('.')}' has no connectors`;
    scope = cls.fullName;
    scopeDef = undefined;
  }
  return undefined;
}
