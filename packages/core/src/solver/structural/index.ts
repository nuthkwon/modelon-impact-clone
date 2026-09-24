/**
 * Structural pre-processing of a flat model before simulation:
 *
 *  A. alias elimination      (`alias.ts`)       `a = ±b + c` -> one variable
 *  B. known-variable propagation (`propagate.ts`) `x = f(params)` -> constant
 *  E. index reduction        (`indexReduction.ts`) Pantelides + dummy derivatives
 *
 * A and B are iterated to a fixed point (each can expose new instances of the other), then
 * the index is reduced. `prepareModel` returns the reduced model together with everything the
 * output stage needs to reconstruct the trajectories of the original variables.
 */
import type { FlatModel } from '../../flat.js';
import type { SimulationOptions } from '../../simulation.js';
import { createParameterEnvironment } from '../compile.js';
import type { LogFn } from '../system.js';
import { eliminateAliases, type AliasEntry, type AliasMap } from './alias.js';
import type { DerivativeSymbol } from './expr.js';
import { reduceIndex } from './indexReduction.js';
import { collectStates, createWorkingModel } from './model.js';
import { propagateKnownVariables } from './propagate.js';

export type { AliasEntry, AliasMap } from './alias.js';
export type { DerivativeSymbol } from './expr.js';
export { reduceIndex } from './indexReduction.js';
export { eliminateAliases, detectAliases } from './alias.js';
export { propagateKnownVariables, detectPropagations } from './propagate.js';
export { differentiate } from './differentiate.js';
export { maximumMatching, bltSort, analyzeStructure } from './matching.js';
export { createWorkingModel, collectStates } from './model.js';

export interface PreparedModel {
  /** The reduced model to compile and simulate. */
  model: FlatModel;
  /** Eliminated variable -> `scale * rep + offset` (rep is a variable of `model`). */
  aliases: AliasMap;
  /** Original states that index reduction turned into algebraic variables. */
  dummyStates: string[];
  /** Variables found to be constant, with their values. */
  constants: Record<string, number | boolean>;
  /** New algebraic variables of `model` that represent derivatives (`der(x)`, `der(der(x))`). */
  dummyDerivatives: Map<string, DerivativeSymbol>;
  /** New state variables of `model` named `der(...)`. */
  derivativeStates: string[];
  /** Variables of the original model that appear inside `der()`. */
  originalStates: Set<string>;
  stats: { aliasEliminated: number; propagated: number; differentiated: number };
}

export interface PrepareOptions extends Partial<Pick<SimulationOptions, 'modifiers' | 'startTime'>> {}

/** Runs alias elimination, propagation and index reduction. Throws `ModelicaError` for structurally singular models. */
export function prepareModel(flat: FlatModel, log?: LogFn, options: PrepareOptions = {}): PreparedModel {
  const base = createParameterEnvironment(flat, { modifiers: options.modifiers });
  const wm = createWorkingModel(flat, base.env);
  const aliases: AliasMap = new Map();
  let aliasEliminated = 0;
  let propagated = 0;
  for (let round = 0; round < 100; round++) {
    const p = propagateKnownVariables(wm);
    const a = eliminateAliases(wm, aliases);
    propagated += p;
    aliasEliminated += a;
    if (p + a === 0) break;
  }
  const ir = reduceIndex(wm, { startTime: options.startTime ?? 0 });

  const model = wm.flat;
  const unknowns = model.variables.filter((v) => v.variability === 'continuous' || v.variability === 'discrete');
  model.stats = {
    ...model.stats,
    unknowns: unknowns.length,
    equations: model.equations.length,
    parameters: model.variables.filter((v) => v.variability === 'parameter').length,
    constants: model.variables.filter((v) => v.variability === 'constant').length,
    states: wm.states.size,
  };

  const constants: Record<string, number | boolean> = {};
  for (const [name, value] of wm.constants) {
    if (typeof value === 'number' || typeof value === 'boolean') constants[name] = value;
  }

  if (log) {
    for (const w of wm.warnings) log('warning', w);
    if (aliasEliminated + propagated + ir.dummyStates.length + ir.differentiated > 0) {
      const dummies = ir.dummyStates.length ? ` (${ir.dummyStates.join(', ')})` : '';
      log(
        'info',
        `Structural analysis: ${aliasEliminated} alias variable${aliasEliminated === 1 ? '' : 's'} eliminated, ${propagated} variable${propagated === 1 ? '' : 's'} propagated, ${ir.dummyStates.length} dummy derivative${ir.dummyStates.length === 1 ? '' : 's'} selected${dummies}` +
          (ir.differentiated ? `; ${ir.differentiated} equation${ir.differentiated === 1 ? '' : 's'} added by differentiation` : ''),
      );
      for (const msg of ir.messages) log('info', msg);
    }
  }

  return {
    model,
    aliases,
    dummyStates: ir.dummyStates,
    constants,
    dummyDerivatives: ir.dummyDerivatives,
    derivativeStates: ir.derivativeStates,
    originalStates: collectStates(flat),
    stats: { aliasEliminated, propagated, differentiated: ir.differentiated },
  };
}

/** Value of an eliminated variable given its representative's value. */
export function aliasValue(entry: AliasEntry, rep: number): number {
  return entry.scale * rep + entry.offset;
}

