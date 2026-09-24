import type { FlatModel } from '../flat.js';
import type { SimulationOptions, SimulationResult } from '../simulation.js';

export interface SimulationHooks {
  /** Called periodically with progress 0..1; return false to cancel. */
  onProgress?(progress: number, time: number): boolean | void;
  /** Log sink. */
  onLog?(level: 'debug' | 'info' | 'warning' | 'error', message: string): void;
}

/** Simulates a flat model. Throws `ModelicaError` on structural/initialisation failures. */
export function simulate(_flat: FlatModel, _options: SimulationOptions, _hooks?: SimulationHooks): SimulationResult {
  throw new Error('simulate: not implemented');
}
