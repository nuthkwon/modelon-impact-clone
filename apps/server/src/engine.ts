/**
 * The compile/simulate functions used by the job runner. Injectable so tests can replace
 * them with a fake (`createApp({ engine: { flatten, simulate } })`).
 */
import { flatten as coreFlatten, simulate as coreSimulate } from '@impact/core';

export interface Engine {
  flatten: typeof coreFlatten;
  simulate: typeof coreSimulate;
}

export function createEngine(overrides: Partial<Engine> = {}): Engine {
  return {
    // Late-bound wrappers: the core modules may be stubs that throw until implemented.
    flatten: overrides.flatten ?? ((registry, className, options) => coreFlatten(registry, className, options)),
    simulate: overrides.simulate ?? ((flat, options, hooks) => coreSimulate(flat, options, hooks)),
  };
}
