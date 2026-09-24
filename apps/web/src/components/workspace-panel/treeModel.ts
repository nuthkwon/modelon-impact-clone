/**
 * Pure helpers behind the Workspace panel tree: node building (with a fallback while
 * `buildClassTree` / `resolveIcon` / `searchClasses` from @impact/core are not implemented),
 * filtering, flattening into rows, error markers and text highlighting. No React in here so
 * everything is unit-testable.
 */
import { ClassRegistry, DEFAULT_COORDINATE_SYSTEM, buildClassTree, parseGraphicsLayer, resolveIcon, searchClasses } from '@impact/core';
import type { ClassRestriction, ClassTreeNode, CoordinateSystem, Diagnostic, GraphicItem, GraphicsLayer, LibraryInfo, RegisteredClass } from '@impact/core';

export type CreateRestriction = 'model' | 'package' | 'block' | 'connector' | 'record' | 'type' | 'function';

/** Classes that can be dropped onto the canvas (when not partial). */
export const DROPPABLE_RESTRICTIONS: ReadonlySet<ClassRestriction> = new Set<ClassRestriction>(['model', 'block', 'connector', 'record']);
/** Maximum number of matches shown while filtering. */
export const MAX_MATCHES = 500;

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

export function shortNameOf(fullName: string): string {
  const i = fullName.lastIndexOf('.');
  return i < 0 ? fullName : fullName.slice(i + 1);
}

export function parentNameOf(fullName: string): string | undefined {
  const i = fullName.lastIndexOf('.');
  return i < 0 ? undefined : fullName.slice(0, i);
}

/** `a.b.c` -> `['a', 'a.b']` (outermost first). */
export function ancestorsOf(fullName: string): string[] {
  const parts = fullName.split('.');
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('.'));
  return out;
}

/** Adds every ancestor of every name. */
export function withAncestors(names: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const n of names) {
    out.add(n);
    for (const a of ancestorsOf(n)) out.add(a);
  }
  return out;
}

/** Maps any parsed restriction onto the restrictions the server can create. */
export function createRestriction(r: ClassRestriction): CreateRestriction {
  switch (r) {
    case 'package':
    case 'model':
    case 'block':
    case 'connector':
    case 'record':
    case 'type':
    case 'function':
      return r;
    default:
      return 'model';
  }
}

export const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ---------------------------------------------------------------------------
// Icons & nodes
// ---------------------------------------------------------------------------

/**
 * Icon layer of `name` computed directly from the registry: walks the inheritance chain
 * base-first and concatenates the `Icon` graphics; the most derived coordinate system wins.
 */
export function resolveIconFallback(registry: ClassRegistry, name: string): GraphicsLayer | undefined {
  const graphics: GraphicItem[] = [];
  let coordinateSystem: CoordinateSystem | undefined;
  for (const cls of registry.inheritanceChain(name)) {
    const layer = parseGraphicsLayer(cls.def.annotation, 'Icon');
    if (!layer) continue;
    coordinateSystem = layer.coordinateSystem;
    graphics.push(...layer.graphics);
  }
  if (!graphics.length) return undefined;
  return { coordinateSystem: coordinateSystem ?? DEFAULT_COORDINATE_SYSTEM, graphics };
}

/** Icon of a class: core `resolveIcon` when it works, otherwise the fallback above. */
export function iconOf(registry: ClassRegistry, name: string): GraphicsLayer | undefined {
  try {
    return resolveIcon(registry, name);
  } catch {
    return resolveIconFallback(registry, name);
  }
}

/** Builds a tree node straight from a registered class (no dependency on `buildClassTree`). */
export function nodeFromClass(registry: ClassRegistry, cls: RegisteredClass): ClassTreeNode {
  const restriction = cls.def.restriction;
  const lib = registry.getLibrary(cls.libraryId);
  return {
    name: cls.fullName,
    shortName: cls.def.name,
    restriction,
    description: cls.def.description,
    partial: cls.def.partial,
    hasChildren: registry.children(cls.fullName).length > 0,
    icon: iconOf(registry, cls.fullName),
    libraryId: cls.libraryId,
    readOnly: lib ? lib.readOnly : registry.isReadOnly(cls.fullName),
    droppable: DROPPABLE_RESTRICTIONS.has(restriction) && !cls.def.partial,
  };
}

/** Children of `parent` (top level when omitted): `buildClassTree` when available, else built from the registry. */
export function childNodes(registry: ClassRegistry, parent?: string): ClassTreeNode[] {
  try {
    return buildClassTree(registry, parent);
  } catch {
    return registry.children(parent).map((c) => nodeFromClass(registry, c));
  }
}

/** Node of a single class or undefined for unknown/builtin names. */
export function nodeOf(registry: ClassRegistry, name: string): ClassTreeNode | undefined {
  const cls = registry.get(name);
  if (!cls || cls.builtin) return undefined;
  return nodeFromClass(registry, cls);
}

// ---------------------------------------------------------------------------
// Children cache (per registry version)
// ---------------------------------------------------------------------------

export interface ChildrenCache {
  registry?: ClassRegistry;
  version: number;
  children: Map<string, ClassTreeNode[]>;
}

export function createChildrenCache(): ChildrenCache {
  return { registry: undefined, version: -1, children: new Map() };
}

/** Cached `childNodes`; the cache resets whenever the registry object or its version changes. */
export function cachedChildren(cache: ChildrenCache, registry: ClassRegistry, version: number, parent?: string): ClassTreeNode[] {
  if (cache.registry !== registry || cache.version !== version) {
    cache.registry = registry;
    cache.version = version;
    cache.children.clear();
  }
  const key = parent ?? '';
  let nodes = cache.children.get(key);
  if (!nodes) {
    nodes = childNodes(registry, parent);
    cache.children.set(key, nodes);
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// Search / filter
// ---------------------------------------------------------------------------

export function matchesQuery(shortName: string, description: string | undefined, lowerQuery: string): boolean {
  if (!lowerQuery) return false;
  if (shortName.toLowerCase().includes(lowerQuery)) return true;
  return !!description && description.toLowerCase().includes(lowerQuery);
}

export interface SearchOptions {
  limit?: number;
  /** Restricts matches to some libraries (e.g. the "Limit libraries" filter). */
  includeLibrary?: (libraryId: string) => boolean;
}

/**
 * Every class whose short name or description contains `query` (case-insensitive), at most
 * `limit` results. Uses core `searchClasses` when implemented and no library filter is active,
 * otherwise walks the registry.
 */
export function searchNodes(registry: ClassRegistry, query: string, opts: SearchOptions = {}): ClassTreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const limit = opts.limit ?? MAX_MATCHES;
  if (!opts.includeLibrary) {
    try {
      return searchClasses(registry, query.trim(), limit).slice(0, limit);
    } catch {
      /* fall through to the registry walk */
    }
  }
  const out: ClassTreeNode[] = [];
  for (const name of registry.allClassNames()) {
    const cls = registry.get(name);
    if (!cls || cls.builtin) continue;
    if (opts.includeLibrary && !opts.includeLibrary(cls.libraryId)) continue;
    if (!matchesQuery(cls.def.name, cls.def.description, q)) continue;
    out.push(nodeFromClass(registry, cls));
    if (out.length >= limit) break;
  }
  return out;
}

export interface HighlightPart {
  text: string;
  match: boolean;
}

/** Splits `text` into matching / non-matching parts for `<mark>` rendering (case-insensitive). */
export function highlightParts(text: string, query: string): HighlightPart[] {
  const q = query.trim().toLowerCase();
  if (!q || !text) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const parts: HighlightPart[] = [];
  let i = 0;
  for (;;) {
    const j = lower.indexOf(q, i);
    if (j < 0) break;
    if (j > i) parts.push({ text: text.slice(i, j), match: false });
    parts.push({ text: text.slice(j, j + q.length), match: true });
    i = j + q.length;
  }
  if (i < text.length) parts.push({ text: text.slice(i), match: false });
  return parts.length ? parts : [{ text, match: false }];
}

// ---------------------------------------------------------------------------
// Sections & rows
// ---------------------------------------------------------------------------

export type SectionId = 'projects' | 'libraries';

/** A library that has no parseable class at all but does have diagnostics (shown as a broken row). */
export interface BrokenLibrary {
  libraryId: string;
  name: string;
  message: string;
}

export interface TreeSection {
  id: SectionId;
  title: string;
  roots: ClassTreeNode[];
  broken: BrokenLibrary[];
  /** Placeholder text when the section has no rows. */
  emptyText: string;
}

export type TreeRow =
  | { kind: 'header'; key: string; section: SectionId; title: string }
  | { kind: 'node'; key: string; section: SectionId; node: ClassTreeNode; depth: number; expanded: boolean; isRoot: boolean }
  | { kind: 'broken'; key: string; section: SectionId; library: BrokenLibrary }
  | { kind: 'empty'; key: string; section: SectionId; text: string };

export interface FlattenOptions {
  expanded: ReadonlySet<string>;
  childrenOf: (name: string) => ClassTreeNode[];
  /** Filter mode: only these names are shown and every shown package is expanded. */
  visible?: ReadonlySet<string>;
}

/** Splits the top-level nodes into the PROJECTS (editable) and LIBRARIES (read-only) sections. */
export function splitSections(top: ClassTreeNode[], libraries: LibraryInfo[], hiddenLibraries: ReadonlySet<string>, broken: BrokenLibrary[] = []): TreeSection[] {
  const readOnlyOf = new Map(libraries.map((l) => [l.id, l.readOnly]));
  const projects: ClassTreeNode[] = [];
  const libs: ClassTreeNode[] = [];
  for (const node of top) {
    if (hiddenLibraries.has(node.libraryId)) continue;
    const ro = readOnlyOf.get(node.libraryId) ?? node.readOnly;
    (ro ? libs : projects).push(node);
  }
  const brokenProjects = broken.filter((b) => !hiddenLibraries.has(b.libraryId) && !(readOnlyOf.get(b.libraryId) ?? false));
  const brokenLibs = broken.filter((b) => !hiddenLibraries.has(b.libraryId) && (readOnlyOf.get(b.libraryId) ?? false));
  return [
    { id: 'projects', title: 'Projects', roots: projects, broken: brokenProjects, emptyText: 'No editable projects' },
    { id: 'libraries', title: 'Libraries', roots: libs, broken: brokenLibs, emptyText: 'No libraries' },
  ];
}

/** Depth-first flattening of the sections into the rows the tree renders. */
export function flattenTree(sections: TreeSection[], opts: FlattenOptions): TreeRow[] {
  const rows: TreeRow[] = [];
  const filtering = !!opts.visible;
  const visit = (section: SectionId, node: ClassTreeNode, depth: number) => {
    if (opts.visible && !opts.visible.has(node.name)) return;
    let children: ClassTreeNode[] = [];
    let expanded = false;
    if (node.hasChildren) {
      if (opts.visible) {
        children = opts.childrenOf(node.name).filter((c) => opts.visible!.has(c.name));
        expanded = children.length > 0;
      } else if (opts.expanded.has(node.name)) {
        children = opts.childrenOf(node.name);
        expanded = true;
      }
    }
    rows.push({ kind: 'node', key: node.name, section, node, depth, expanded, isRoot: depth === 0 });
    if (expanded) for (const c of children) visit(section, c, depth + 1);
  };
  for (const section of sections) {
    const start = rows.length;
    rows.push({ kind: 'header', key: `header:${section.id}`, section: section.id, title: section.title });
    for (const root of section.roots) visit(section.id, root, 0);
    if (!filtering) for (const b of section.broken) rows.push({ kind: 'broken', key: `broken:${b.libraryId}`, section: section.id, library: b });
    if (rows.length === start + 1) {
      if (filtering) rows.pop();
      else rows.push({ kind: 'empty', key: `empty:${section.id}`, section: section.id, text: section.emptyText });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Error markers
// ---------------------------------------------------------------------------

export interface ErrorMarkers {
  /** File keys (`libraryId::path`) that have diagnostics. */
  files: ReadonlySet<string>;
  /** Class names whose subtree contains a file with diagnostics (light red dot). */
  containers: ReadonlySet<string>;
}

export const NO_ERRORS: ErrorMarkers = { files: new Set(), containers: new Set() };

/** `Modelica/Electrical/Analog/Basic/Resistor.mo` -> `Modelica.Electrical.Analog.Basic.Resistor`; `A/B/package.mo` -> `A.B`. */
export function classNameOfPath(path: string): string | undefined {
  let p = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!p.endsWith('.mo')) return undefined;
  p = p.slice(0, -3);
  if (p === 'package' || p.endsWith('/package')) p = p.slice(0, -'package'.length).replace(/\/$/, '');
  if (!p) return undefined;
  return p.split('/').filter(Boolean).join('.');
}

/** Computes which files have diagnostics and which packages contain such files. */
export function errorMarkers(registry: ClassRegistry, fileDiagnostics: Record<string, Diagnostic[]>): ErrorMarkers {
  const files = new Set<string>();
  const containers = new Set<string>();
  for (const [key, diags] of Object.entries(fileDiagnostics)) {
    if (!diags || !diags.length) continue;
    files.add(key);
    const sep = key.indexOf('::');
    const libraryId = sep < 0 ? key : key.slice(0, sep);
    const path = sep < 0 ? '' : key.slice(sep + 2);
    const derived = classNameOfPath(path);
    if (derived) for (const a of ancestorsOf(derived)) containers.add(a);
    const file = registry.getFile(libraryId, path);
    if (file) for (const name of file.classNames) for (const a of ancestorsOf(name)) containers.add(a);
  }
  return { files, containers };
}

export type ErrorState = 'none' | 'own' | 'contains';

/** Error marker of a node: red dot for classes in a file with diagnostics, light dot for containing packages. */
export function errorStateOf(registry: ClassRegistry, markers: ErrorMarkers, name: string): ErrorState {
  if (!markers.files.size) return 'none';
  const cls = registry.get(name);
  if (cls && !cls.builtin && markers.files.has(ClassRegistry.fileKey(cls.libraryId, cls.file))) return 'own';
  return markers.containers.has(name) ? 'contains' : 'none';
}

/** Libraries with diagnostics but no registered top-level class (e.g. a broken `Examples.mo`). */
export function brokenLibraries(registry: ClassRegistry, fileDiagnostics: Record<string, Diagnostic[]>): BrokenLibrary[] {
  const out: BrokenLibrary[] = [];
  const top = registry.children();
  for (const lib of registry.listLibraries()) {
    if (top.some((c) => c.libraryId === lib.id)) continue;
    const prefix = `${lib.id}::`;
    const entry = Object.entries(fileDiagnostics).find(([k, d]) => k.startsWith(prefix) && d.length);
    if (!entry) continue;
    const d = entry[1][0];
    const where = d.loc ? ` (line ${d.loc.line})` : '';
    out.push({ libraryId: lib.id, name: lib.name, message: `${entry[0].slice(prefix.length)}${where}: ${d.message}` });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Editable locations (for "Extend…" / "Duplicate to…")
// ---------------------------------------------------------------------------

export interface LocationOption {
  value: string;
  label: string;
}

/** Packages of editable libraries (plus the top level), used as target locations for new classes. */
export function editableLocations(registry: ClassRegistry): LocationOption[] {
  const editable = new Set(registry.listLibraries().filter((l) => !l.readOnly).map((l) => l.id));
  const out: LocationOption[] = [];
  for (const name of registry.allClassNames()) {
    const cls = registry.get(name);
    if (!cls || cls.builtin || !editable.has(cls.libraryId) || cls.def.restriction !== 'package') continue;
    out.push({ value: name, label: name });
  }
  out.sort((a, b) => a.value.localeCompare(b.value));
  out.push({ value: '', label: 'Top level (new file in the project)' });
  return out;
}

/** Default target location for a class created from `source`: its own package when editable, else the first editable package. */
export function defaultLocation(registry: ClassRegistry, source: string, options: LocationOption[]): string {
  if (!registry.isReadOnly(source)) {
    const parent = parentNameOf(source);
    if (parent !== undefined && options.some((o) => o.value === parent)) return parent;
    const cls = registry.get(source);
    if (cls?.def.restriction === 'package' && parent === undefined) return '';
    if (parent === undefined) return '';
  }
  return options.find((o) => o.value !== '')?.value ?? '';
}

/** `base`, `base1`, `base2`, … the first one that does not exist in `location`. */
export function uniqueClassName(registry: ClassRegistry, location: string, base: string): string {
  const full = (n: string) => (location ? `${location}.${n}` : n);
  if (!registry.has(full(base))) return base;
  for (let i = 1; i < 1000; i++) if (!registry.has(full(`${base}${i}`))) return `${base}${i}`;
  return `${base}${Date.now()}`;
}
