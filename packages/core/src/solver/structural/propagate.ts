/**
 * Known-variable propagation: an equation with exactly one unknown that appears linearly with
 * a constant coefficient (`x = f(params)`, `c*x = f(params)`, `x + g(params) = 0`, ...) is
 * solved at compile time. The variable becomes a constant of the reduced model and the
 * equation is dropped. Iterated to a fixed point, so chains like
 * `T_heatPort = T; R_actual = R*(1 + alpha*(T_heatPort - T_ref))` collapse completely.
 *
 * States and when-assigned discrete variables are never propagated.
 */
import { ModelicaError, type Expr } from '../../ast.js';
import type { FlatEquation, FlatVariable } from '../../flat.js';
import { refName, tryEvaluateConstant, type ConstValue } from '../../flatten/evaluate.js';
import { equationLinearForm } from './expr.js';
import { equationText, trivialEquationError, type WorkingModel } from './model.js';

/** A variable that can be turned into a constant by a single equation. */
export interface Propagation {
  equation: number;
  name: string;
  value: ConstValue;
}

function canPropagate(wm: WorkingModel, name: string): FlatVariable | undefined {
  const v = wm.byName.get(name);
  if (!v || !wm.isUnknown(name)) return undefined;
  if (wm.states.has(name)) return undefined;
  return v;
}

function coerce(v: FlatVariable, value: ConstValue, eq: FlatEquation): ConstValue {
  if (v.type === 'Boolean') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value >= 0.5;
  } else if (v.type === 'Integer' || v.type === 'Real') {
    if (typeof value === 'number') return v.type === 'Integer' ? Math.round(value) : value;
    if (typeof value === 'boolean') return value ? 1 : 0;
  }
  throw new ModelicaError(`Equation '${equationText(eq)}' (${eq.origin}) assigns a ${typeof value} value to the ${v.type} variable '${v.name}'`);
}

/** Finds all single-unknown equations of the current model (without applying them). */
export function detectPropagations(wm: WorkingModel): Propagation[] {
  const out: Propagation[] = [];
  const seen = new Set<string>();
  wm.flat.equations.forEach((eq, index) => {
    const lf = equationLinearForm(eq.left, eq.right, wm.env, wm.isRealUnknown);
    if (lf) {
      if (lf.coeffs.size === 0) throw trivialEquationError(eq, lf.constant, wm.flat.className);
      if (lf.coeffs.size !== 1) return;
      const [[name, k]] = [...lf.coeffs.entries()];
      const v = canPropagate(wm, name);
      if (!v || v.type === 'Boolean' || seen.has(name)) return;
      const value = -lf.constant / k;
      if (!Number.isFinite(value)) return;
      seen.add(name);
      out.push({ equation: index, name, value: coerce(v, value, eq) });
      return;
    }
    // Boolean / Integer: `x = <constant>` or `<constant> = x`.
    const sides: [Expr, Expr][] = [
      [eq.left, eq.right],
      [eq.right, eq.left],
    ];
    for (const [lhs, rhs] of sides) {
      if (lhs.kind !== 'ref' || lhs.parts.some((p) => p.subscripts && p.subscripts.length > 0)) continue;
      const name = refName(lhs);
      const v = canPropagate(wm, name);
      if (!v || v.type === 'Real' || seen.has(name)) continue;
      const c = tryEvaluateConstant(rhs, wm.env);
      if (c === undefined || typeof c === 'string') continue;
      seen.add(name);
      out.push({ equation: index, name, value: coerce(v, c, eq) });
      return;
    }
  });
  return out;
}

/**
 * Propagates known variables until no equation with a single unknown remains. Returns the
 * number of variables turned into constants.
 */
export function propagateKnownVariables(wm: WorkingModel): number {
  let total = 0;
  for (let round = 0; round < 1000; round++) {
    const found = detectPropagations(wm);
    if (found.length === 0) break;
    const dropped = new Set<number>();
    for (const p of found) {
      const v = wm.byName.get(p.name)!;
      v.variability = 'constant';
      v.value = coerce(v, p.value, wm.flat.equations[p.equation]);
      v.binding = undefined;
      wm.constants.set(p.name, v.value);
      dropped.add(p.equation);
      total++;
    }
    wm.flat.equations = wm.flat.equations.filter((_, i) => !dropped.has(i));
  }
  return total;
}
