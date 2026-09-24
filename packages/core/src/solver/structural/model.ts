/**
 * Mutable working copy of a `FlatModel` used by the structural passes. Variables are cloned
 * so that the caller's model is never modified; equations are replaced wholesale by each pass.
 */
import { ModelicaError, type Expr } from '../../ast.js';
import type { FlatEquation, FlatModel, FlatVariable } from '../../flat.js';
import { formatExpr, refName, type ConstValue, type EvalEnv } from '../../flatten/evaluate.js';
import { collectDerivatives } from './expr.js';

export interface WorkingModel {
  flat: FlatModel;
  byName: Map<string, FlatVariable>;
  /** Variables appearing inside `der()` anywhere (equations, initial equations, when-clauses). */
  states: Set<string>;
  /** Variables assigned in when-clauses (`x = expr`, not `reinit`). */
  whenAssigned: Set<string>;
  /** States re-initialised by `reinit(x, ...)`. */
  reinitTargets: Set<string>;
  /** Values of variables that were propagated to constants. */
  constants: Map<string, ConstValue>;
  /** Parameters, constants and propagated variables. */
  env: EvalEnv;
  /** Non-fatal findings for the log. */
  warnings: string[];
  /** True for a variable that is an unknown of the continuous/algebraic system. */
  isUnknown(name: string): boolean;
  /** `isUnknown` restricted to Real variables (the only ones that can be terms of a linear form). */
  isRealUnknown(name: string): boolean;
  /** Recomputes `states` after equations changed. */
  refreshStates(): void;
}

export function cloneFlatModel(flat: FlatModel): FlatModel {
  return {
    ...flat,
    variables: flat.variables.map((v) => ({ ...v, attributes: { ...v.attributes } })),
    equations: flat.equations.map((eq) => ({ ...eq })),
    initialEquations: flat.initialEquations.map((eq) => ({ ...eq })),
    whenClauses: flat.whenClauses.map((w) => ({ ...w, equations: w.equations.map((eq) => ({ ...eq })) })),
    stats: { ...flat.stats },
  };
}

export function createWorkingModel(flat: FlatModel, baseEnv: EvalEnv): WorkingModel {
  const copy = cloneFlatModel(flat);
  const byName = new Map<string, FlatVariable>();
  for (const v of copy.variables) byName.set(v.name, v);
  const constants = new Map<string, ConstValue>();
  const whenAssigned = new Set<string>();
  const reinitTargets = new Set<string>();
  for (const w of copy.whenClauses) {
    for (const eq of w.equations) {
      if (eq.left.kind === 'call' && eq.left.callee === 'reinit') {
        const target = eq.left.args[0];
        if (target?.kind === 'ref') reinitTargets.add(refName(target));
      } else if (eq.left.kind === 'ref') {
        whenAssigned.add(refName(eq.left));
      }
    }
  }
  const env: EvalEnv = {
    lookup(name: string): ConstValue | undefined {
      const c = constants.get(name);
      if (c !== undefined) return c;
      return baseEnv.lookup(name);
    },
    callFunction: baseEnv.callFunction?.bind(baseEnv),
  };
  const wm: WorkingModel = {
    flat: copy,
    byName,
    states: new Set(),
    whenAssigned,
    reinitTargets,
    constants,
    env,
    warnings: [],
    isUnknown(name: string): boolean {
      const v = byName.get(name);
      if (!v) return false;
      if (v.variability !== 'continuous' && v.variability !== 'discrete') return false;
      if (v.type === 'String') return false;
      return !whenAssigned.has(name);
    },
    isRealUnknown(name: string): boolean {
      return wm.isUnknown(name) && byName.get(name)!.type === 'Real';
    },
    refreshStates(): void {
      wm.states = collectStates(wm.flat);
    },
  };
  wm.refreshStates();
  return wm;
}

/** Names of variables appearing as `der(x)` (any order) in equations, initial equations and when-clauses. */
export function collectStates(flat: FlatModel): Set<string> {
  const ders = new Map<string, number>();
  const scan = (e: Expr): void => void collectDerivatives(e, ders);
  for (const eq of flat.equations) {
    scan(eq.left);
    scan(eq.right);
  }
  for (const eq of flat.initialEquations) {
    scan(eq.left);
    scan(eq.right);
  }
  for (const w of flat.whenClauses) {
    scan(w.cond);
    for (const eq of w.equations) {
      scan(eq.left);
      scan(eq.right);
    }
  }
  return new Set(ders.keys());
}

export function equationText(eq: FlatEquation): string {
  return `${formatExpr(eq.left)} = ${formatExpr(eq.right)}`;
}

/** Error for an equation that reduced to `0 = c` after substitutions. */
export function trivialEquationError(eq: FlatEquation, constant: number, className: string): ModelicaError {
  if (Math.abs(constant) <= 1e-10) {
    return new ModelicaError(
      `The model is structurally singular: equation '${equationText(eq)}' [${eq.origin}] is redundant (it reduces to 0 = 0 after alias elimination), so some variable is not determined by the equations (${className})`,
    );
  }
  return new ModelicaError(
    `The model is inconsistent: equation '${equationText(eq)}' [${eq.origin}] reduces to 0 = ${constant} after alias elimination (${className})`,
  );
}
