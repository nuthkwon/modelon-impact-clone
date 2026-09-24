import type { ClassTreeNode } from '../diagram.js';
import type { ClassRegistry } from '../registry.js';

/** Children of `parent` (or the top level) for the Libraries panel. */
export function buildClassTree(_registry: ClassRegistry, _parent?: string): ClassTreeNode[] {
  throw new Error('buildClassTree: not implemented');
}

/** Case-insensitive search over all class names/descriptions for the Filter field. */
export function searchClasses(_registry: ClassRegistry, _query: string, _limit?: number): ClassTreeNode[] {
  throw new Error('searchClasses: not implemented');
}
