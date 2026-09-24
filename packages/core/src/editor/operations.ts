import type { EditOperation, EditResult } from '../diagram.js';
import type { ClassRegistry } from '../registry.js';

/**
 * Applies an edit to `className` and returns the re-printed text of the file that declares it.
 * The registry is NOT mutated; callers re-add the file (`registry.addFile`) to commit.
 */
export function applyEdit(_registry: ClassRegistry, _className: string, _op: EditOperation): EditResult {
  throw new Error('applyEdit: not implemented');
}
