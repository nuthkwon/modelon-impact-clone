/**
 * `flatten(registry, className, options)`: instantiates a Modelica class and produces the
 * `FlatModel` consumed by the solver.
 *
 * Phases:
 *  A. instantiate the class (`instantiate.ts`): inheritance, modifications, conditional components;
 *  B. create the flat variables and flatten their bindings/attribute expressions (`scope.ts`);
 *  C. evaluate parameters and constants in dependency order, then attributes (`parameters.ts`);
 *  D. flatten equations, when-clauses and initial equations (`equations.ts`), expand connections
 *     (`connections.ts`), add declaration equations of non-parameter variables;
 *  E. balance check and statistics (`balance.ts`).
 */
import type { FlatModel, FlatVariable } from '../flat.js';
import { flatRef } from '../flat.js';
import { parseExperiment } from '../graphics/annotations.js';
import type { ClassRegistry } from '../registry.js';
import { checkBalance, collectStates } from './balance.js';
import { expandConnections } from './connections.js';
import { flattenInstanceEquations } from './equations.js';
import { collectClassInstances, collectVariables, instantiateRoot } from './instantiate.js';
import { ensureAttributesFlattened, ensureBindingFlattened, evaluateAll } from './parameters.js';
import { diag, error, fileOf, isParamLike, type Ctx } from './types.js';

export interface FlattenOptions {
  /** Parameter overrides applied before evaluation: flat name -> Modelica expression text or value. */
  modifiers?: Record<string, number | boolean | string>;
  /** When false, an unbalanced model does not throw; diagnostics are recorded instead. */
  strict?: boolean;
}

/** Flattens `className` into a FlatModel. Throws `ModelicaError` on unrecoverable errors. */
export function flatten(registry: ClassRegistry, className: string, options: FlattenOptions = {}): FlatModel {
  const cls = registry.get(className) ?? registry.lookup(className);
  if (!cls) throw error(`Class '${className}' not found`, { path: className });
  const ctx: Ctx = {
    registry,
    options,
    className: cls.fullName,
    diagnostics: [],
    varsByPath: new Map(),
    constCache: new Map(),
    constVisiting: new Set(),
    paramVisiting: new Set(),
    usedModifiers: new Set(),
    whenTargets: new Set(),
    connectionEquations: [],
  };

  // A. instance tree
  const root = instantiateRoot(ctx, cls);

  // B. flat variables
  const vars = collectVariables(root);
  const variables: FlatVariable[] = [];
  for (const v of vars) {
    const binding = ensureBindingFlattened(ctx, v);
    ensureAttributesFlattened(ctx, v);
    const flat: FlatVariable = {
      name: v.path,
      type: v.type,
      variability: v.variability,
      causality: v.causality,
      flow: v.flow,
      typeName: v.typeName,
      attributes: {},
      description: v.decl.description,
      binding,
      protected: v.protected,
      componentPath: v.path.split('.').slice(0, -1),
      declaredIn: v.declaredIn.fullName,
      loc: v.decl.loc,
      file: fileOf(ctx, v.declaredIn),
    };
    v.flat = flat;
    variables.push(flat);
  }
  for (const name of Object.keys(options.modifiers ?? {})) {
    if (!ctx.usedModifiers.has(name)) diag(ctx, 'warning', `Modifier '${name}' does not refer to a parameter of ${cls.fullName}; ignored`, { path: name });
  }

  // C. parameters, constants and attributes
  evaluateAll(ctx, vars);

  // D. equations, when-clauses, connections, declaration equations
  const model: FlatModel = {
    className: cls.fullName,
    variables,
    equations: [],
    initialEquations: [],
    whenClauses: [],
    experiment: undefined,
    diagnostics: ctx.diagnostics,
    stats: { components: 0, unknowns: 0, equations: 0, parameters: 0, constants: 0, states: 0, connections: 0 },
  };
  flattenInstanceEquations(ctx, root, model);
  for (const v of vars) {
    if (isParamLike(v) || !v.flatBinding) continue;
    model.equations.push({
      kind: 'binding',
      left: flatRef(v.path),
      right: v.flatBinding,
      origin: `${v.path} (declaration equation)`,
      loc: v.decl.loc,
      file: fileOf(ctx, v.declaredIn),
    });
  }
  const connections = expandConnections(ctx, root, model.equations);
  for (const name of ctx.whenTargets) {
    const v = ctx.varsByPath.get(name);
    if (v?.flat && !isParamLike(v)) v.flat.variability = 'discrete';
  }

  // Experiment annotation: the class's own, else the nearest base class's.
  for (const c of registry.inheritanceChain(cls.fullName).reverse()) {
    const exp = parseExperiment(c.def.annotation);
    if (exp) {
      model.experiment = exp;
      break;
    }
  }

  // E. statistics and balance
  const states = collectStates(model);
  model.stats = {
    components: collectClassInstances(root).filter((c) => !c.isConnector).length,
    unknowns: variables.filter((v) => v.variability === 'continuous' || v.variability === 'discrete').length,
    equations: model.equations.length,
    parameters: variables.filter((v) => v.variability === 'parameter').length,
    constants: variables.filter((v) => v.variability === 'constant').length,
    states: states.size,
    connections,
  };
  checkBalance(ctx, model, options.strict !== false);
  return model;
}
