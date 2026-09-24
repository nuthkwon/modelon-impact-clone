/**
 * Index reduction: Pantelides' algorithm to find the equations that must be differentiated,
 * followed by the dummy-derivative method of Mattsson & Söderlind to turn the extended system
 * back into a DAE of index 1 that the residual compiler understands.
 *
 * Pantelides works on the bipartite graph between the (current highest derivative of each)
 * equation and the highest derivative of each unknown. When an equation cannot be matched by
 * an alternating path, every equation reached by the search and every variable touched is
 * differentiated once, and the search restarts. Structurally dependent states ("x = y" for
 * two states, `phi_rel = phi_b - phi_a`) show up as constraint equations without a matchable
 * highest-order unknown.
 *
 * Dummy derivatives: let H be the highest differentiated versions of all differentiated
 * equations and C the highest derivatives of the variables in H. We select |H| variables of
 * C such that the Jacobian dH/dC is non-singular (numerically at the start point, with a
 * structural fallback), preferring variables of "families" with `stateSelect = never/avoid`,
 * without fixed start values, with relative (`_rel`) names, and the most connected ones. The
 * selected derivatives become ordinary algebraic variables (named `der(x)`, `der(der(x))`);
 * then H and C are replaced by their once-less-differentiated versions and the selection is
 * repeated. A state whose first derivative is a dummy is thereby demoted to an algebraic
 * variable; its `fixed=true` start value turns into an initial equation.
 */
import { ModelicaError, type Expr } from '../../ast.js';
import { flatRef, type FlatEquation, type FlatVariable } from '../../flat.js';
import { formatExpr, MODELICA_CONSTANTS, tryEvaluateConstant } from '../../flatten/evaluate.js';
import { differentiate, type DifferentiationContext, type SymbolKind } from './differentiate.js';
import {
  call,
  collectDerivatives,
  derivativeName,
  equationLinearForm,
  evalNumeric,
  incidence,
  num,
  startNumber,
  sub,
  substituteDerivatives,
  type DerivativeSymbol,
} from './expr.js';
import { maximumMatching } from './matching.js';
import { equationText, type WorkingModel } from './model.js';
import { compareKeys } from './alias.js';

export interface IndexReductionOptions {
  startTime?: number;
}

export interface IndexReductionResult {
  /** Number of equations added by differentiation. */
  differentiated: number;
  /** Original states that became algebraic variables. */
  dummyStates: string[];
  /** New algebraic variables representing derivatives: name -> symbol. */
  dummyDerivatives: Map<string, DerivativeSymbol>;
  /** New state variables named `der(...)` (only for chains of derivatives). */
  derivativeStates: string[];
  /** Info log lines. */
  messages: string[];
}

interface EqInfo {
  index: number;
  eq: FlatEquation;
  /** Unknown -> highest derivative order in the original equation. */
  inc: Map<string, number>;
  /** Number of times the equation has been differentiated. */
  d: number;
}

const STATE_SELECT_RANK: Record<string, number> = { never: 0, avoid: 1, default: 2, prefer: 3, always: 4 };
const MAX_DIFFERENTIATIONS = 8;

/**
 * Reduces the differentiation index of the working model in place. Returns a summary; the
 * model is unchanged when it already has a perfect matching (index <= 1).
 */
export function reduceIndex(wm: WorkingModel, options: IndexReductionOptions = {}): IndexReductionResult {
  const flat = wm.flat;
  const result: IndexReductionResult = { differentiated: 0, dummyStates: [], dummyDerivatives: new Map(), derivativeStates: [], messages: [] };
  const unknowns = flat.variables.filter((v) => wm.isUnknown(v.name));
  if (unknowns.length === 0 || flat.equations.length === 0) return result;

  // ---- structure ----------------------------------------------------------------------------
  const maxOrder = new Map<string, number>();
  for (const v of unknowns) maxOrder.set(v.name, 0);
  const allDers = new Map<string, number>();
  const scan = (e: Expr): void => void collectDerivatives(e, allDers);
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
  for (const [x, o] of allDers) if (maxOrder.has(x)) maxOrder.set(x, Math.max(maxOrder.get(x)!, o));
  const originalMaxOrder = new Map(maxOrder);

  const eqs: EqInfo[] = flat.equations.map((eq, index) => {
    const inc = incidence(eq.left, wm.isUnknown);
    incidence(eq.right, wm.isUnknown, inc);
    return { index, eq, inc, d: 0 };
  });

  // ---- Pantelides -----------------------------------------------------------------------------
  const assign = new Map<string, number>();
  const colorV = new Set<string>();
  const colorE = new Set<number>();
  const augment = (e: number): boolean => {
    colorE.add(e);
    const E = eqs[e];
    for (const [x, o] of E.inc) {
      if (o + E.d === maxOrder.get(x) && !assign.has(x)) {
        assign.set(x, e);
        return true;
      }
    }
    for (const [x, o] of E.inc) {
      if (o + E.d === maxOrder.get(x) && !colorV.has(x)) {
        colorV.add(x);
        if (augment(assign.get(x)!)) {
          assign.set(x, e);
          return true;
        }
      }
    }
    return false;
  };
  const limit = 2 * eqs.length + 2;
  for (let i = 0; i < eqs.length; i++) {
    if (eqs[i].inc.size === 0) {
      throw new ModelicaError(
        `The model is structurally singular: equation '${equationText(eqs[i].eq)}' [${eqs[i].eq.origin}] does not contain any unknown (${flat.className})`,
      );
    }
    let iterations = 0;
    for (;;) {
      colorV.clear();
      colorE.clear();
      if (augment(i)) break;
      if (++iterations > limit || eqs[i].d >= MAX_DIFFERENTIATIONS) throw indexReductionFailure(wm, eqs, i, colorE);
      for (const x of colorV) maxOrder.set(x, maxOrder.get(x)! + 1);
      for (const e of colorE) eqs[e].d++;
    }
  }
  const maxD = Math.max(...eqs.map((E) => E.d));
  if (maxD === 0) return result;

  // ---- differentiated equations ------------------------------------------------------------
  const dctx: DifferentiationContext = {
    classify(name: string): SymbolKind {
      const v = wm.byName.get(name);
      if (v && wm.isUnknown(name)) return v.type === 'Real' ? 'real' : 'nonreal';
      if (v) return 'constant'; // parameters, constants, when-assigned discretes (piecewise constant)
      if (wm.env.lookup(name) !== undefined || MODELICA_CONSTANTS[name] !== undefined) return 'constant';
      return 'unknown-name';
    },
    constantValue(e: Expr): number | undefined {
      const c = tryEvaluateConstant(e, wm.env);
      return typeof c === 'number' ? c : undefined;
    },
  };
  const versions: { left: Expr; right: Expr }[][] = eqs.map((E) => {
    const list = [{ left: E.eq.left, right: E.eq.right }];
    for (let k = 1; k <= E.d; k++) {
      const prev = list[k - 1];
      list.push({ left: differentiate(prev.left, dctx), right: differentiate(prev.right, dctx) });
    }
    return list;
  });

  // ---- dummy derivative selection ------------------------------------------------------------
  const preference = buildPreference(wm, eqs);
  const selected: DerivativeSymbol[][] = [];
  const dummies = new Set<string>();
  const key = (s: DerivativeSymbol): string => `${s.base}|${s.order}`;
  for (let round = 0; ; round++) {
    const H = eqs.filter((E) => E.d - round >= 1).map((E) => ({ E, k: E.d - round }));
    if (H.length === 0) break;
    let candidates: DerivativeSymbol[];
    if (round === 0) {
      const set = new Map<string, DerivativeSymbol>();
      for (const { E, k } of H) {
        for (const [x, o] of E.inc) {
          if (o + k === maxOrder.get(x)) set.set(x, { base: x, order: o + k });
        }
      }
      candidates = [...set.values()];
    } else {
      candidates = selected[round - 1].map((s) => ({ base: s.base, order: s.order - 1 }));
    }
    candidates.sort((a, b) => compareKeys(preference(a), preference(b)));
    const chosen = selectDummies(wm, H, candidates, versions, options.startTime ?? 0);
    selected.push(chosen);
    for (const s of chosen) dummies.add(key(s));
  }

  // ---- materialisation -----------------------------------------------------------------------
  const newVariables: FlatVariable[] = [];
  const consistency: FlatEquation[] = [];
  const fixedInitial: FlatEquation[] = [];
  const resolvers = new Map<string, (order: number) => Expr | undefined>();
  for (const v of unknowns) {
    const x = v.name;
    const M = maxOrder.get(x)!;
    if (M === 0) continue;
    let s = M + 1;
    for (let j = 1; j <= M; j++) {
      if (dummies.has(`${x}|${j}`)) {
        s = j;
        break;
      }
    }
    if (s === 1) {
      if (originalMaxOrder.get(x)! >= 1) {
        result.dummyStates.push(x);
        result.messages.push(`Selected dummy derivative for ${x}`);
        // A fixed start without an explicit value is the Modelica default start (0).
        if (v.attributes.fixed === true) {
          fixedInitial.push({
            kind: 'initial',
            left: flatRef(x),
            right: num(startNumber(v.attributes.start)),
            origin: `${x} (fixed = true start value; ${x} is no longer a state)`,
            loc: v.loc,
            file: v.file,
          });
        }
        if (wm.reinitTargets.has(x)) {
          throw new ModelicaError(
            `reinit(${x}, ...) is not possible: '${x}' is constrained by other states and was selected as a dummy derivative during index reduction. Give it stateSelect = StateSelect.always or re-initialise another state (${flat.className})`,
          );
        }
      }
    }
    for (let j = 1; j <= s - 2; j++) {
      const name = derivativeName(x, j);
      newVariables.push(derivedVariable(v, name, j));
      result.derivativeStates.push(name);
      consistency.push({
        kind: 'equation',
        left: call('der', flatRef(derivativeName(x, j - 1))),
        right: flatRef(name),
        origin: `${x} (derivative chain introduced by index reduction)`,
      });
    }
    for (let j = s; j <= M; j++) {
      const name = derivativeName(x, j);
      newVariables.push(derivedVariable(v, name, j));
      result.dummyDerivatives.set(name, { base: x, order: j });
    }
    resolvers.set(x, (order: number): Expr | undefined => {
      if (order >= s) return flatRef(derivativeName(x, order));
      if (order <= s - 2) return flatRef(derivativeName(x, order));
      // order === s - 1: the true derivative of the last state of the chain
      if (order === 1) return undefined;
      return call('der', flatRef(derivativeName(x, order - 1)));
    });
  }
  const resolve = (base: string, order: number): Expr | undefined => resolvers.get(base)?.(order);
  const substEq = (eq: FlatEquation): FlatEquation => ({ ...eq, left: substituteDerivatives(eq.left, resolve), right: substituteDerivatives(eq.right, resolve) });

  const equations: FlatEquation[] = [];
  eqs.forEach((E, i) => {
    for (let k = 0; k <= E.d; k++) {
      const ver = versions[i][k];
      equations.push(
        substEq({
          ...E.eq,
          left: ver.left,
          right: ver.right,
          origin: k === 0 ? E.eq.origin : `${E.eq.origin} [differentiated${k > 1 ? ` ${k}x` : ''}]`,
        }),
      );
    }
  });
  for (const c of consistency) equations.push(substEq(c));
  result.differentiated = equations.length - flat.equations.length;
  flat.equations = equations;
  flat.initialEquations = [...flat.initialEquations.map(substEq), ...fixedInitial];
  flat.whenClauses = flat.whenClauses.map((w) => ({ ...w, cond: substituteDerivatives(w.cond, resolve), equations: w.equations.map(substEq) }));
  for (const nv of newVariables) {
    flat.variables.push(nv);
    wm.byName.set(nv.name, nv);
  }
  wm.refreshStates();
  return result;
}

function derivedVariable(base: FlatVariable, name: string, order: number): FlatVariable {
  const unit = base.attributes.unit;
  return {
    name,
    type: 'Real',
    variability: 'continuous',
    causality: 'none',
    flow: false,
    typeName: 'Real',
    attributes: {
      start: 0,
      nominal: base.attributes.nominal,
      unit: unit ? `${unit}/s${order > 1 ? order : ''}` : undefined,
    },
    description: `${'der('.repeat(order)}${base.name}${')'.repeat(order)}${base.description ? ` (${base.description})` : ''}`,
    protected: true,
    componentPath: base.componentPath,
    declaredIn: base.declaredIn,
    loc: base.loc,
    file: base.file,
  };
}

// -------------------------------------------------------------------------------------------
// Preference of a variable as a dummy derivative
// -------------------------------------------------------------------------------------------

/**
 * Variables are grouped into "families" through derivative definitions (`w = der(phi)`,
 * `a = der(w)`): a compliant element's `phi_rel`, `w_rel`, `a_rel` form one family. The
 * preference of a candidate is decided on the family so that the whole chain is demoted
 * together.
 */
function buildPreference(wm: WorkingModel, eqs: EqInfo[]): (s: DerivativeSymbol) => (number | string)[] {
  const velocityOf = new Map<string, string>();
  for (const E of eqs) {
    const lf = equationLinearForm(E.eq.left, E.eq.right, wm.env, wm.isRealUnknown);
    if (!lf || lf.coeffs.size !== 2) continue;
    const names = [...lf.coeffs.keys()];
    const derIdx = names.findIndex((n) => n.startsWith('der(') && !wm.byName.has(n));
    if (derIdx < 0) continue;
    const v = names[1 - derIdx];
    const x = names[derIdx].slice(4, -1);
    if (wm.byName.has(v) && wm.byName.has(x) && v !== x && !velocityOf.has(v)) velocityOf.set(v, x);
  }
  const root = (x: string): string => {
    const seen = new Set<string>();
    let cur = x;
    while (velocityOf.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = velocityOf.get(cur)!;
    }
    return cur;
  };
  const families = new Map<string, string[]>();
  for (const v of wm.flat.variables) {
    if (!wm.isUnknown(v.name)) continue;
    const r = root(v.name);
    const list = families.get(r) ?? [];
    list.push(v.name);
    families.set(r, list);
  }
  const connectivity = new Map<string, number>();
  for (const E of eqs) for (const x of E.inc.keys()) connectivity.set(x, (connectivity.get(x) ?? 0) + 1);

  const familyKey = new Map<string, (number | string)[]>();
  const keyOf = (x: string): (number | string)[] => {
    const r = root(x);
    let k = familyKey.get(r);
    if (k) return k;
    const members = families.get(r) ?? [x];
    const rankOf = (m: string): number | undefined => {
      if (wm.reinitTargets.has(m)) return 4;
      const ss = wm.byName.get(m)!.attributes.stateSelect;
      return ss === undefined ? undefined : STATE_SELECT_RANK[ss];
    };
    // The root's explicit stateSelect decides; otherwise a `prefer`/`always` on any member
    // protects the family, and a `never`/`avoid` on any member exposes it.
    let stateSelect = rankOf(r) ?? 2;
    if (rankOf(r) === undefined) {
      const ranks = members.map(rankOf).filter((v): v is number => v !== undefined);
      if (ranks.some((v) => v > 2)) stateSelect = Math.max(...ranks);
      else if (ranks.length) stateSelect = Math.min(...ranks);
    }
    let hasFixed = 0;
    let isRel = 0;
    for (const m of members) {
      const v = wm.byName.get(m)!;
      if (v.attributes.fixed === true) hasFixed = 1;
      if (/_rel(\.|$)/.test(m)) isRel = 1;
    }
    k = [stateSelect, hasFixed, isRel ? 0 : 1];
    familyKey.set(r, k);
    return k;
  };
  return (s: DerivativeSymbol): (number | string)[] => [-s.order, ...keyOf(s.base), -(connectivity.get(s.base) ?? 0), s.base, s.order];
}

// -------------------------------------------------------------------------------------------
// Selection
// -------------------------------------------------------------------------------------------

/**
 * Chooses |H| candidates whose Jacobian block is non-singular, greedily in preference order
 * (candidates are pre-sorted). Numeric rank test at the start point; if the point is
 * degenerate, structural (transversal matroid) selection.
 */
function selectDummies(
  wm: WorkingModel,
  H: { E: EqInfo; k: number }[],
  candidates: DerivativeSymbol[],
  versions: { left: Expr; right: Expr }[][],
  startTime: number,
): DerivativeSymbol[] {
  const m = H.length;
  if (candidates.length < m) throw selectionFailure(wm, H, candidates);
  const numeric = numericSelection(wm, H, candidates, versions, startTime);
  if (numeric) return numeric;
  // Structural fallback: candidate (x, j) is incident to e^(k) when x appears in e at an order o with o + k >= j.
  const incident = (h: { E: EqInfo; k: number }, c: DerivativeSymbol): boolean => {
    const o = h.E.inc.get(c.base);
    return o !== undefined && o + h.k >= c.order;
  };
  const chosen: DerivativeSymbol[] = [];
  for (const c of candidates) {
    if (chosen.length === m) break;
    const trial = [...chosen, c];
    const adj = H.map((h) => trial.map((t, j) => (incident(h, t) ? j : -1)).filter((j) => j >= 0));
    if (maximumMatching(m, trial.length, adj).size === trial.length) chosen.push(c);
  }
  if (chosen.length < m) throw selectionFailure(wm, H, candidates);
  return chosen;
}

function numericSelection(
  wm: WorkingModel,
  H: { E: EqInfo; k: number }[],
  candidates: DerivativeSymbol[],
  versions: { left: Expr; right: Expr }[][],
  startTime: number,
): DerivativeSymbol[] | undefined {
  const m = H.length;
  const values = new Map<string, number>();
  const ctx = {
    time: startTime,
    env: wm.env,
    value(base: string, order: number): number | undefined {
      const v = values.get(`${base}|${order}`);
      if (v !== undefined) return v;
      if (!wm.isUnknown(base)) return undefined;
      return order === 0 ? startNumber(wm.byName.get(base)!.attributes.start) : 0;
    },
  };
  const residual = (h: { E: EqInfo; k: number }): number => {
    const ver = versions[h.E.index][h.k];
    return evalNumeric(sub(ver.left, ver.right), ctx);
  };
  // Jacobian columns by central differences.
  const columns: Float64Array[] = [];
  try {
    for (const c of candidates) {
      const key = `${c.base}|${c.order}`;
      const v0 = ctx.value(c.base, c.order) ?? 0;
      const h = 1e-6 * Math.max(1, Math.abs(v0));
      const col = new Float64Array(m);
      values.set(key, v0 + h);
      for (let i = 0; i < m; i++) col[i] = residual(H[i]);
      values.set(key, v0 - h);
      for (let i = 0; i < m; i++) col[i] = (col[i] - residual(H[i])) / (2 * h);
      values.delete(key);
      for (let i = 0; i < m; i++) if (!Number.isFinite(col[i])) return undefined;
      columns.push(col);
    }
  } catch (e) {
    if (e instanceof ModelicaError) return undefined;
    throw e;
  }
  // Greedy independent columns (modified Gram-Schmidt).
  const basis: Float64Array[] = [];
  const chosen: DerivativeSymbol[] = [];
  for (let c = 0; c < candidates.length && chosen.length < m; c++) {
    const v = Float64Array.from(columns[c]);
    let norm0 = 0;
    for (let i = 0; i < m; i++) norm0 += v[i] * v[i];
    norm0 = Math.sqrt(norm0);
    if (norm0 === 0) continue;
    for (const q of basis) {
      let dot = 0;
      for (let i = 0; i < m; i++) dot += q[i] * v[i];
      for (let i = 0; i < m; i++) v[i] -= dot * q[i];
    }
    let norm = 0;
    for (let i = 0; i < m; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    if (norm <= 1e-8 * norm0) continue;
    for (let i = 0; i < m; i++) v[i] /= norm;
    basis.push(v);
    chosen.push(candidates[c]);
  }
  return chosen.length === m ? chosen : undefined;
}

// -------------------------------------------------------------------------------------------
// Errors
// -------------------------------------------------------------------------------------------

function indexReductionFailure(wm: WorkingModel, eqs: EqInfo[], unmatched: number, colored: Set<number>): ModelicaError {
  const lines = [...colored].sort((a, b) => a - b).map((e) => `  ${equationText(eqs[e].eq)}    [${eqs[e].eq.origin}]${eqs[e].d ? ` (differentiated ${eqs[e].d}x)` : ''}`);
  return new ModelicaError(
    `Index reduction failed: equation '${equationText(eqs[unmatched].eq)}' [${eqs[unmatched].eq.origin}] cannot be matched to an unknown even after differentiation. ` +
      `The following equations determine fewer unknowns than their number (the model is structurally singular):\n${lines.join('\n')}\n(${wm.flat.className})`,
  );
}

function selectionFailure(wm: WorkingModel, H: { E: EqInfo; k: number }[], candidates: DerivativeSymbol[]): ModelicaError {
  const eqLines = H.map((h) => `  ${equationText(h.E.eq)} [${h.E.eq.origin}] (derivative ${h.k})`);
  const cand = candidates.map((c) => formatExpr(derivativeRef(c))).join(', ');
  return new ModelicaError(
    `Index reduction failed: could not select ${H.length} dummy derivative${H.length === 1 ? '' : 's'} among {${cand}} for the differentiated equations\n${eqLines.join('\n')}\n(${wm.flat.className})`,
  );
}

function derivativeRef(s: DerivativeSymbol): Expr {
  let e: Expr = flatRef(s.base);
  for (let i = 0; i < s.order; i++) e = call('der', e);
  return e;
}
