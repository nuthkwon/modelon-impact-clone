/**
 * Class tree and search for the Libraries panel.
 */
import type { ClassRestriction } from '../ast.js';
import type { ClassTreeNode } from '../diagram.js';
import type { ClassRegistry, RegisteredClass } from '../registry.js';
import { resolveIcon } from './icons.js';

/** Restrictions that can be dropped onto a canvas (when not partial). */
export const DROPPABLE_RESTRICTIONS: ReadonlySet<ClassRestriction> = new Set<ClassRestriction>(['model', 'block', 'connector', 'record']);

/** Tree node of a registered class (icon = own + inherited graphics; undefined when there are none). */
export function classTreeNode(registry: ClassRegistry, cls: RegisteredClass): ClassTreeNode {
  const restriction = cls.def.restriction;
  const node: ClassTreeNode = {
    name: cls.fullName,
    shortName: cls.def.name,
    restriction,
    partial: cls.def.partial,
    hasChildren: registry.children(cls.fullName).length > 0,
    libraryId: cls.libraryId,
    readOnly: registry.isReadOnly(cls.fullName),
    droppable: DROPPABLE_RESTRICTIONS.has(restriction) && !cls.def.partial,
  };
  if (cls.def.description !== undefined) node.description = cls.def.description;
  const icon = resolveIcon(registry, cls.fullName);
  if (icon && icon.graphics.length > 0) node.icon = icon;
  return node;
}

/** Children of `parent` (or the top level) for the Libraries panel. */
export function buildClassTree(registry: ClassRegistry, parent?: string): ClassTreeNode[] {
  return registry
    .children(parent)
    .filter((c) => !c.builtin)
    .map((c) => classTreeNode(registry, c));
}

/**
 * Case-insensitive search over short names, full names and descriptions for the Filter field.
 * Results are ordered: short-name prefix matches, then names containing the query, then
 * description matches (registry order within each group), at most `limit` (default 500).
 */
export function searchClasses(registry: ClassRegistry, query: string, limit = 500): ClassTreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q || limit <= 0) return [];
  const prefix: RegisteredClass[] = [];
  const contains: RegisteredClass[] = [];
  const described: RegisteredClass[] = [];
  for (const name of registry.allClassNames()) {
    const cls = registry.get(name);
    if (!cls || cls.builtin) continue;
    if (cls.def.name.toLowerCase().startsWith(q)) {
      prefix.push(cls);
      if (prefix.length >= limit) break;
      continue;
    }
    if (prefix.length + contains.length >= limit) continue;
    if (name.toLowerCase().includes(q)) {
      contains.push(cls);
      continue;
    }
    if (prefix.length + contains.length + described.length >= limit) continue;
    if (cls.def.description && cls.def.description.toLowerCase().includes(q)) described.push(cls);
  }
  return [...prefix, ...contains, ...described].slice(0, limit).map((c) => classTreeNode(registry, c));
}
