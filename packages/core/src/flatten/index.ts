import type { FlatModel } from '../flat.js';
import type { ClassRegistry } from '../registry.js';

export interface FlattenOptions {
  /** Parameter overrides applied before evaluation: flat name -> Modelica expression text or value. */
  modifiers?: Record<string, number | boolean | string>;
  /** When false, an unbalanced model does not throw; diagnostics are recorded instead. */
  strict?: boolean;
}

/** Flattens `className` into a FlatModel. Throws `ModelicaError` on unrecoverable errors. */
export function flatten(_registry: ClassRegistry, _className: string, _options?: FlattenOptions): FlatModel {
  throw new Error('flatten: not implemented');
}
