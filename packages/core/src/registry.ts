/**
 * ClassRegistry: stores parsed Modelica files grouped by library and resolves class names.
 *
 * - `addLibrary` registers a library id (a project content id or the built-in `Modelica`).
 * - `addFile` parses a file and indexes every class (nested included) by fully-qualified name.
 * - `lookup` implements Modelica name lookup (enclosing scopes, inherited classes, imports).
 */
import type { ClassDef, Diagnostic, Modification, StoredDefinition } from './ast.js';
import { parse } from './parser/parser.js';

export interface LibraryInfo {
  id: string;
  name: string;
  readOnly: boolean;
}

export interface RegisteredFile {
  libraryId: string;
  path: string;
  text: string;
  definition: StoredDefinition;
  /** Fully-qualified names of the top-level classes declared in this file. */
  classNames: string[];
  diagnostics: Diagnostic[];
  version: number;
}

export interface RegisteredClass {
  def: ClassDef;
  fullName: string;
  /** Fully-qualified name of the enclosing class, undefined for top-level classes. */
  parentName?: string;
  libraryId: string;
  file: string;
  /** Built-in types `Real`, `Integer`, `Boolean`, `String`. */
  builtin?: boolean;
}

export const BUILTIN_TYPES = ['Real', 'Integer', 'Boolean', 'String'] as const;
export type BuiltinType = (typeof BUILTIN_TYPES)[number];

function builtinClass(name: BuiltinType): RegisteredClass {
  const def: ClassDef = {
    kind: 'class',
    restriction: 'type',
    name,
    partial: false,
    encapsulated: false,
    expandable: false,
    extends: [],
    imports: [],
    components: [],
    classes: [],
    equations: [],
    initialEquations: [],
  };
  return { def, fullName: name, libraryId: '<builtin>', file: '<builtin>', builtin: true };
}

export interface ResolvedType {
  /** The final (non short-class) class: a builtin type, a connector, a model, ... */
  base: RegisteredClass;
  /** Modifications collected along the short-class chain, innermost (closest to base) first. */
  modifications: Modification[];
  prefixes: { input: boolean; output: boolean; flow: boolean };
  /** Enumeration literals when the chain ends in `enumeration(...)`. */
  enumerationLiterals?: string[];
  /** Every class in the chain including `base`, outermost first. */
  chain: RegisteredClass[];
}

export class ClassRegistry {
  private libraries = new Map<string, LibraryInfo>();
  private files = new Map<string, RegisteredFile>();
  private classes = new Map<string, RegisteredClass>();
  /** Top-level class names in insertion order (per library). */
  private topLevel = new Map<string, string[]>();
  /**
   * Children by parent name. Includes nested classes (declaration order) and classes declared
   * in separate files via `within Parent;` (file insertion order, after nested ones).
   */
  private childrenMap = new Map<string, string[]>();
  private builtins = new Map<string, RegisteredClass>(BUILTIN_TYPES.map((n) => [n, builtinClass(n)]));

  static fileKey(libraryId: string, path: string): string {
    return `${libraryId}::${path}`;
  }

  addLibrary(info: LibraryInfo): void {
    this.libraries.set(info.id, info);
    if (!this.topLevel.has(info.id)) this.topLevel.set(info.id, []);
  }

  getLibrary(id: string): LibraryInfo | undefined {
    return this.libraries.get(id);
  }

  listLibraries(): LibraryInfo[] {
    return [...this.libraries.values()];
  }

  /**
   * Parses `text` and indexes its classes. Re-adding an existing path replaces the previous
   * content. Returns parse diagnostics; on a parse error the previous content is kept and the
   * returned diagnostics contain the error.
   */
  addFile(libraryId: string, path: string, text: string): Diagnostic[] {
    if (!this.libraries.has(libraryId)) this.addLibrary({ id: libraryId, name: libraryId, readOnly: false });
    let definition: StoredDefinition;
    try {
      definition = parse(text, path);
    } catch (e) {
      const diags = e instanceof Error && 'diagnostics' in e ? (e as { diagnostics: Diagnostic[] }).diagnostics : [{ severity: 'error' as const, message: String(e) }];
      return diags.map((d) => ({ ...d, file: d.file ?? path }));
    }
    const key = ClassRegistry.fileKey(libraryId, path);
    const previous = this.files.get(key);
    if (previous) this.unindexFile(previous);
    const prefix = definition.within ? `${definition.within}.` : '';
    const classNames: string[] = [];
    for (const cls of definition.classes) {
      const fullName = prefix + cls.name;
      classNames.push(fullName);
      this.indexClass(cls, fullName, definition.within, libraryId, path);
      if (definition.within) {
        const siblings = this.childrenMap.get(definition.within) ?? [];
        if (!siblings.includes(fullName)) siblings.push(fullName);
        this.childrenMap.set(definition.within, siblings);
      } else {
        const top = this.topLevel.get(libraryId)!;
        if (!top.includes(fullName)) top.push(fullName);
      }
    }
    this.files.set(key, {
      libraryId,
      path,
      text,
      definition,
      classNames,
      diagnostics: [],
      version: (previous?.version ?? 0) + 1,
    });
    return [];
  }

  removeFile(libraryId: string, path: string): void {
    const key = ClassRegistry.fileKey(libraryId, path);
    const file = this.files.get(key);
    if (!file) return;
    this.unindexFile(file);
    this.files.delete(key);
  }

  removeLibrary(libraryId: string): void {
    for (const file of [...this.files.values()]) if (file.libraryId === libraryId) this.removeFile(libraryId, file.path);
    this.libraries.delete(libraryId);
    this.topLevel.delete(libraryId);
  }

  private unindexFile(file: RegisteredFile): void {
    const removed = new Set<string>();
    for (const [name, cls] of [...this.classes]) {
      if (cls.libraryId === file.libraryId && cls.file === file.path) {
        this.classes.delete(name);
        removed.add(name);
      }
    }
    // Drop the removed classes from every children list. The list of a removed class is kept
    // when it still holds children declared in other files (`within Parent;`): re-adding the
    // parent's file (`indexClass`) preserves them; `children()` ignores lists of unknown parents.
    for (const [parent, names] of [...this.childrenMap]) {
      const kept = names.filter((n) => !removed.has(n));
      if (removed.has(parent) && kept.length === 0) this.childrenMap.delete(parent);
      else if (kept.length !== names.length) this.childrenMap.set(parent, kept);
    }
    const top = this.topLevel.get(file.libraryId);
    if (top) this.topLevel.set(file.libraryId, top.filter((n) => !file.classNames.includes(n)));
  }

  private indexClass(cls: ClassDef, fullName: string, parentName: string | undefined, libraryId: string, file: string): void {
    this.classes.set(fullName, { def: cls, fullName, parentName, libraryId, file });
    // Nested classes come first in declaration order; classes added later via `within` are appended.
    const existing = (this.childrenMap.get(fullName) ?? []).filter((n) => !cls.classes.some((c) => `${fullName}.${c.name}` === n));
    this.childrenMap.set(fullName, [...cls.classes.map((c) => `${fullName}.${c.name}`), ...existing]);
    for (const nested of cls.classes) this.indexClass(nested, `${fullName}.${nested.name}`, fullName, libraryId, file);
  }

  /** Re-orders the children of `parent` according to `order` (names not listed keep their relative order at the end). Used for `package.order`. */
  setChildOrder(parent: string, order: string[]): void {
    const current = this.childrenMap.get(parent) ?? [];
    const ordered = order.map((n) => (n.includes('.') ? n : `${parent}.${n}`)).filter((n) => current.includes(n));
    this.childrenMap.set(parent, [...ordered, ...current.filter((n) => !ordered.includes(n))]);
  }

  getFile(libraryId: string, path: string): RegisteredFile | undefined {
    return this.files.get(ClassRegistry.fileKey(libraryId, path));
  }

  listFiles(libraryId?: string): RegisteredFile[] {
    return [...this.files.values()].filter((f) => !libraryId || f.libraryId === libraryId);
  }

  /** The file that declares `fullName` (or its top-level ancestor). */
  fileOf(fullName: string): RegisteredFile | undefined {
    const cls = this.classes.get(fullName);
    if (!cls) return undefined;
    return this.files.get(ClassRegistry.fileKey(cls.libraryId, cls.file));
  }

  get(fullName: string): RegisteredClass | undefined {
    return this.classes.get(fullName) ?? this.builtins.get(fullName);
  }

  has(fullName: string): boolean {
    return this.classes.has(fullName) || this.builtins.has(fullName);
  }

  isBuiltin(fullName: string): boolean {
    return this.builtins.has(fullName);
  }

  isReadOnly(fullName: string): boolean {
    const cls = this.classes.get(fullName);
    if (!cls) return true;
    return this.libraries.get(cls.libraryId)?.readOnly ?? false;
  }

  allClassNames(): string[] {
    return [...this.classes.keys()];
  }

  /** Top-level classes (all libraries, library insertion order) or the nested classes of `parent` in declaration order. */
  children(parent?: string): RegisteredClass[] {
    if (!parent) {
      const out: RegisteredClass[] = [];
      for (const names of this.topLevel.values()) for (const n of names) {
        const c = this.classes.get(n);
        if (c) out.push(c);
      }
      return out;
    }
    if (!this.classes.has(parent)) return [];
    return (this.childrenMap.get(parent) ?? []).map((n) => this.classes.get(n)!).filter(Boolean);
  }

  parentOf(fullName: string): RegisteredClass | undefined {
    const cls = this.classes.get(fullName);
    return cls?.parentName ? this.classes.get(cls.parentName) : undefined;
  }

  /** Directly extended classes of `fullName`, resolved. Unresolvable bases are skipped (callers report diagnostics via `unresolvedBases`). */
  baseClasses(fullName: string): RegisteredClass[] {
    const cls = this.get(fullName);
    if (!cls) return [];
    const out: RegisteredClass[] = [];
    for (const ext of cls.def.extends) {
      const base = this.lookupInClass(ext.typeName, cls, /*includeInherited*/ false);
      if (base && base.fullName !== fullName) out.push(base);
    }
    return out;
  }

  unresolvedBases(fullName: string): string[] {
    const cls = this.get(fullName);
    if (!cls) return [];
    return cls.def.extends.map((e) => e.typeName).filter((t) => !this.lookupInClass(t, cls, false));
  }

  /**
   * Full inheritance chain of `fullName`: base classes first (depth-first, in `extends` order),
   * deduplicated, the class itself last.
   */
  inheritanceChain(fullName: string): RegisteredClass[] {
    const out: RegisteredClass[] = [];
    const seen = new Set<string>();
    const visit = (name: string) => {
      if (seen.has(name)) return;
      seen.add(name);
      const cls = this.get(name);
      if (!cls) return;
      for (const base of this.baseClasses(name)) visit(base.fullName);
      out.push(cls);
    };
    visit(fullName);
    return out;
  }

  /**
   * Modelica name lookup of `name` as used inside class `scope` (a fully-qualified name, or
   * undefined for the global scope). Returns undefined when not found.
   */
  lookup(name: string, scope?: string): RegisteredClass | undefined {
    if (name.startsWith('.')) return this.resolveDotted(name.slice(1));
    const scopeClass = scope ? this.get(scope) : undefined;
    if (scope && !scopeClass) return this.resolveDotted(name);
    return this.lookupInClass(name, scopeClass, true);
  }

  /**
   * Resolves a fully-qualified name. `visiting` (see `findNested`) is threaded through so that
   * an extends/import clause whose resolution leads back into a class being searched terminates.
   */
  private resolveDotted(dotted: string, visiting: Set<string> = new Set()): RegisteredClass | undefined {
    const direct = this.get(dotted);
    if (direct) return direct;
    // The dotted name may traverse inherited nested classes: resolve part by part.
    const parts = dotted.split('.');
    let cur = this.get(parts[0]);
    for (let i = 1; cur && i < parts.length; i++) cur = this.findNested(cur, parts[i], visiting);
    return cur;
  }

  private lookupInClass(name: string, scopeClass: RegisteredClass | undefined, includeInherited: boolean, visiting: Set<string> = new Set()): RegisteredClass | undefined {
    // A leading '.' selects the global scope (Modelica §5.3.3).
    if (name.startsWith('.')) return this.resolveDotted(name.slice(1), visiting);
    const parts = name.split('.');
    const first = parts[0];
    let found: RegisteredClass | undefined;
    let cur: RegisteredClass | undefined = scopeClass;
    let inherit = includeInherited;
    // Walk enclosing scopes.
    while (cur) {
      found = inherit ? this.findNested(cur, first, visiting) : this.findOwnNested(cur, first);
      if (!found) found = this.findImport(cur, first, visiting);
      if (found) break;
      cur = cur.parentName ? this.get(cur.parentName) : undefined;
      inherit = true;
    }
    if (!found) found = this.get(first);
    if (!found) return undefined;
    for (let i = 1; found && i < parts.length; i++) found = this.findNested(found, parts[i], visiting);
    return found;
  }

  private findOwnNested(cls: RegisteredClass, name: string): RegisteredClass | undefined {
    if (cls.builtin) return undefined;
    const full = `${cls.fullName}.${name}`;
    if (this.childrenMap.get(cls.fullName)?.includes(full)) return this.classes.get(full);
    return undefined;
  }

  /**
   * Nested class `name` of `cls`, searching inherited classes too. `visiting` holds the
   * `class::name` searches currently in progress: resolving the base classes and imports of
   * `cls` may lead back to a class under search (e.g. `model M extends M.X;` or an MSL-style
   * `extends MyLib.Icons.Package` before `Icons` exists), which would otherwise recurse forever.
   * Such a re-entrant search is unresolvable and yields undefined.
   */
  private findNested(cls: RegisteredClass, name: string, visiting: Set<string>): RegisteredClass | undefined {
    const key = `${cls.fullName}::${name}`;
    if (visiting.has(key)) return undefined;
    visiting.add(key);
    try {
      const own = this.findOwnNested(cls, name);
      if (own) return own;
      for (const ext of cls.def.extends) {
        const base = this.lookupInClass(ext.typeName, cls, false, visiting);
        if (!base || base.fullName === cls.fullName) continue;
        const r = this.findNested(base, name, visiting);
        if (r) return r;
      }
      // Short class definitions inherit nested classes of their target (rare; e.g. `package X = Y`).
      if (cls.def.shortClass) {
        const target = this.lookupInClass(cls.def.shortClass.typeName, cls.parentName ? this.get(cls.parentName) : undefined, true, visiting);
        if (target && target.fullName !== cls.fullName) return this.findNested(target, name, visiting);
      }
      return undefined;
    } finally {
      visiting.delete(key);
    }
  }

  private findImport(cls: RegisteredClass, name: string, visiting: Set<string>): RegisteredClass | undefined {
    if (cls.builtin) return undefined;
    for (const imp of cls.def.imports) {
      if (imp.alias) {
        if (imp.alias === name) return this.resolveDotted(imp.path, visiting);
        continue;
      }
      if (imp.names) {
        if (imp.names.includes(name)) return this.resolveDotted(`${imp.path}.${name}`, visiting);
        continue;
      }
      if (imp.wildcard) {
        const r = this.resolveDotted(`${imp.path}.${name}`, visiting);
        if (r) return r;
        continue;
      }
      const last = imp.path.split('.').pop();
      if (last === name) return this.resolveDotted(imp.path, visiting);
    }
    return undefined;
  }

  /**
   * Follows short-class definitions (`type Voltage = Real(unit="V")`, `connector RealInput = input Real`)
   * down to the final class, collecting modifications and prefixes.
   */
  resolveType(fullName: string): ResolvedType | undefined {
    const chain: RegisteredClass[] = [];
    const modifications: Modification[] = [];
    const prefixes = { input: false, output: false, flow: false };
    let enumerationLiterals: string[] | undefined;
    let cur = this.get(fullName);
    const seen = new Set<string>();
    while (cur) {
      if (seen.has(cur.fullName)) return undefined;
      seen.add(cur.fullName);
      chain.push(cur);
      const sc = cur.def.shortClass;
      if (!sc) break;
      if (sc.modification) modifications.unshift(sc.modification);
      if (sc.input) prefixes.input = true;
      if (sc.output) prefixes.output = true;
      if (sc.flow) prefixes.flow = true;
      if (sc.typeName === 'enumeration') {
        enumerationLiterals = sc.modification?.mods.map((m) => m.name) ?? [];
        break;
      }
      const next = this.lookupInClass(sc.typeName, cur.parentName ? this.get(cur.parentName) : undefined, true) ?? this.get(sc.typeName);
      if (!next) return undefined;
      cur = next;
    }
    if (!cur) return undefined;
    return { base: cur, modifications, prefixes, enumerationLiterals, chain };
  }
}
