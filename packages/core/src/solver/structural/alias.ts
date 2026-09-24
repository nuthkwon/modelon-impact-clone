/**
 * Alias elimination.
 *
 * An alias equation relates exactly two unknowns linearly with constant coefficients:
 * `a = b`, `a = -b`, `a + b = 0`, `0 = a - b`, `a = b + c`, `a = k*b` (k, c parameter
 * expressions), ... Every such equation is removed together with one of the two variables,
 * which is expressed as `x = scale * rep + offset` in terms of the class representative.
 *
 * Two equations that define the same derivative, `v = k1*der(x) + c1` and `w = k2*der(x) + c2`,
 * imply the alias `w = (k2/k1)*v + ...` ("derivative aliases": `emf.w = der(phi)` together with
 * `inertia.w = der(phi)` after the angle aliases collapsed).
 *
 * The representative of a class is chosen to keep states, reinit targets, `stateSelect`
 * preferences, fixed/explicit start values and short absolute (non `_rel`) names. Attributes
 * of eliminated variables are merged into the representative; conflicting `fixed=true` start
 * values of two states are an error.
 */
import { ModelicaError } from '../../ast.js';
import type { FlatEquation, FlatVariable, VariableAttributes } from '../../flat.js';
import { refName } from '../../flatten/evaluate.js';
import { equationLinearForm, substituteAliases, type Replacement } from './expr.js';
import { trivialEquationError, type WorkingModel } from './model.js';

/** `x = scale * rep + offset`. */
export interface AliasEntry {
  rep: string;
  scale: number;
  offset: number;
}

/** Eliminated variable -> its expression in terms of a variable of the reduced model. */
export type AliasMap = Map<string, AliasEntry>;

/** A detected alias equation `a = scale * b + offset` (equation index in `flat.equations`). */
export interface DetectedAlias {
  equation: number;
  a: string;
  b: string;
  scale: number;
  offset: number;
}

const STATE_SELECT_RANK: Record<string, number> = { always: 0, prefer: 1, default: 2, avoid: 3, never: 4 };

function isRelative(name: string): boolean {
  return /_rel(\.|$)/.test(name);
}

/** Preference key of a variable as class representative (lexicographically smaller wins). */
export function representativeKey(v: FlatVariable, wm: WorkingModel): (number | string)[] {
  const a = v.attributes;
  return [
    wm.reinitTargets.has(v.name) ? 0 : 1,
    wm.states.has(v.name) ? 0 : 1,
    STATE_SELECT_RANK[a.stateSelect ?? 'default'] ?? 2,
    a.fixed === true && a.start !== undefined ? 0 : 1,
    isRelative(v.name) ? 1 : 0,
    a.start !== undefined ? 0 : 1,
    v.name.length,
    v.name,
  ];
}

export function compareKeys(a: (number | string)[], b: (number | string)[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}

// -------------------------------------------------------------------------------------------
// Detection
// -------------------------------------------------------------------------------------------

interface DerivativeDefinition {
  equation: number;
  /** `v = k * der(x) + c` */
  v: string;
  x: string;
  k: number;
  c: number;
}

/**
 * Finds alias equations (`a = scale*b + offset`, both Real, or `a = b` for Boolean/Integer)
 * and derivative-definition duplicates in the current equations.
 */
export function detectAliases(wm: WorkingModel): DetectedAlias[] {
  const out: DetectedAlias[] = [];
  const derDefs = new Map<string, DerivativeDefinition[]>();
  const isVar = (name: string): boolean => wm.byName.has(name) && wm.isUnknown(name);
  wm.flat.equations.forEach((eq, index) => {
    const lf = equationLinearForm(eq.left, eq.right, wm.env, wm.isRealUnknown);
    if (lf) {
      if (lf.coeffs.size === 0) throw trivialEquationError(eq, lf.constant, wm.flat.className);
      if (lf.coeffs.size === 2) {
        const [[n1, k1], [n2, k2]] = [...lf.coeffs.entries()];
        if (isVar(n1) && isVar(n2)) {
          const v1 = wm.byName.get(n1)!;
          const v2 = wm.byName.get(n2)!;
          if (v1.type === 'Real' && v2.type === 'Real' && v1.variability === v2.variability && Number.isFinite(k1) && Number.isFinite(k2) && k1 !== 0 && k2 !== 0) {
            // k1*n1 + k2*n2 + c = 0  ->  n1 = -(k2/k1) n2 - c/k1
            out.push({ equation: index, a: n1, b: n2, scale: -k2 / k1, offset: -lf.constant / k1 || 0 });
          }
          return;
        }
        // v = k*der(x) + c
        const der1 = n1.startsWith('der(');
        const der2 = n2.startsWith('der(');
        if (der1 !== der2) {
          const v = der1 ? n2 : n1;
          const d = der1 ? n1 : n2;
          const kv = der1 ? k2 : k1;
          const kd = der1 ? k1 : k2;
          const x = d.slice(4, -1);
          if (isVar(v) && wm.byName.get(v)!.type === 'Real' && kv !== 0 && Number.isFinite(kv) && Number.isFinite(kd) && v !== x) {
            // kv*v + kd*der(x) + c = 0 -> v = -(kd/kv) der(x) - c/kv
            const list = derDefs.get(x) ?? [];
            list.push({ equation: index, v, x, k: -kd / kv, c: -lf.constant / kv });
            derDefs.set(x, list);
          }
        }
      }
      return;
    }
    // Boolean / Integer aliases `a = b` (same type).
    if (eq.left.kind === 'ref' && eq.right.kind === 'ref') {
      const n1 = refName(eq.left);
      const n2 = refName(eq.right);
      if (n1 !== n2 && isVar(n1) && isVar(n2)) {
        const v1 = wm.byName.get(n1)!;
        const v2 = wm.byName.get(n2)!;
        if (v1.type === v2.type && v1.type !== 'Real' && v1.variability === v2.variability) {
          out.push({ equation: index, a: n1, b: n2, scale: 1, offset: 0 });
        }
      }
    }
  });
  // Derivative aliases: the first definition of der(x) stays, the others become aliases.
  for (const defs of derDefs.values()) {
    if (defs.length < 2) continue;
    const first = defs[0];
    for (let i = 1; i < defs.length; i++) {
      const d = defs[i];
      if (d.v === first.v || d.k === 0) continue;
      // der(x) = (v1 - c1)/k1  ->  v_i = k_i (v1 - c1)/k1 + c_i
      const scale = d.k / first.k;
      out.push({ equation: d.equation, a: d.v, b: first.v, scale, offset: d.c - scale * first.c || 0 });
    }
  }
  return out;
}

// -------------------------------------------------------------------------------------------
// Union-find with affine transforms
// -------------------------------------------------------------------------------------------

interface Node {
  parent: string;
  /** this = scale * parent + offset */
  scale: number;
  offset: number;
}

class AffineUnionFind {
  private readonly nodes = new Map<string, Node>();

  private ensure(x: string): Node {
    let n = this.nodes.get(x);
    if (!n) {
      n = { parent: x, scale: 1, offset: 0 };
      this.nodes.set(x, n);
    }
    return n;
  }

  /** Returns the root of `x` and the transform `x = scale * root + offset`. */
  find(x: string): { root: string; scale: number; offset: number } {
    const n = this.ensure(x);
    if (n.parent === x) return { root: x, scale: 1, offset: 0 };
    const up = this.find(n.parent);
    // x = s1 * parent + o1 and parent = s2 * root + o2  ->  x = (s1 s2) root + (s1 o2 + o1)
    const s1 = n.scale;
    const o1 = n.offset;
    n.parent = up.root;
    n.scale = s1 * up.scale;
    n.offset = s1 * up.offset + o1;
    return { root: up.root, scale: n.scale, offset: n.offset };
  }

  /**
   * Records `a = k * b + c`. Returns 'merged' when two classes were joined, 'redundant' if the
   * relation was already implied, or the constant value the class root is forced to when the
   * relation contradicts the existing transform (the class collapses to a constant).
   */
  union(a: string, b: string, k: number, c: number): 'merged' | 'redundant' | { root: string; value: number } {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra.root === rb.root) {
      // sa*r + oa = k*(sb*r + ob) + c  ->  (sa - k sb) r = k ob + c - oa
      const coef = ra.scale - k * rb.scale;
      const rhs = k * rb.offset + c - ra.offset;
      const scaleRef = Math.abs(ra.scale) + Math.abs(k * rb.scale);
      if (Math.abs(coef) <= 1e-12 * scaleRef) {
        return 'redundant';
      }
      return { root: ra.root, value: rhs / coef };
    }
    // a = sa*ra + oa = k*(sb*rb + ob) + c  ->  ra = (k sb / sa) rb + (k ob + c - oa)/sa
    const node = this.nodes.get(ra.root)!;
    node.parent = rb.root;
    node.scale = (k * rb.scale) / ra.scale;
    node.offset = (k * rb.offset + c - ra.offset) / ra.scale;
    return 'merged';
  }

  members(): string[] {
    return [...this.nodes.keys()];
  }
}

// -------------------------------------------------------------------------------------------
// Elimination
// -------------------------------------------------------------------------------------------

/**
 * Detects and eliminates aliases in the working model (one pass). Returns the number of
 * variables eliminated; `aliases` is extended (and re-targeted so that every entry refers to a
 * variable that still exists in the model).
 */
export function eliminateAliases(wm: WorkingModel, aliases: AliasMap): number {
  const detected = detectAliases(wm);
  if (detected.length === 0) return 0;

  const uf = new AffineUnionFind();
  const dropped = new Set<number>();
  const forced = new Map<string, number>();
  for (const al of detected) {
    if (dropped.has(al.equation)) continue;
    const res = uf.union(al.a, al.b, al.scale, al.offset);
    if (res === 'redundant') {
      throw trivialEquationError(wm.flat.equations[al.equation], 0, wm.flat.className);
    }
    dropped.add(al.equation);
    if (res !== 'merged') forced.set(res.root, res.value);
  }

  // Classes and representatives.
  const classes = new Map<string, string[]>();
  for (const x of uf.members()) {
    const { root } = uf.find(x);
    const list = classes.get(root) ?? [];
    list.push(x);
    classes.set(root, list);
  }
  const replacements = new Map<string, Replacement>();
  let eliminated = 0;
  for (const [root, members] of classes) {
    if (members.length < 2 && !forced.has(root)) continue;
    const forcedValue = forced.get(root);
    if (forcedValue !== undefined) {
      // Whole class is constant: x = scale*root + offset with root = value.
      for (const x of members) {
        const t = uf.find(x);
        const value = t.scale * forcedValue + t.offset;
        const v = wm.byName.get(x)!;
        v.variability = 'constant';
        v.value = v.type === 'Boolean' ? value >= 0.5 : value;
        v.binding = undefined;
        wm.constants.set(x, v.value);
        replacements.set(x, { scale: 1, offset: 0, value: v.value });
      }
      continue;
    }
    let rep = members[0];
    let repKey = representativeKey(wm.byName.get(rep)!, wm);
    for (let i = 1; i < members.length; i++) {
      const key = representativeKey(wm.byName.get(members[i])!, wm);
      if (compareKeys(key, repKey) < 0) {
        rep = members[i];
        repKey = key;
      }
    }
    const tr = uf.find(rep); // rep = sr*root + or -> root = (rep - or)/sr
    const repVar = wm.byName.get(rep)!;
    for (const x of members) {
      if (x === rep) continue;
      const t = uf.find(x); // x = s*root + o = (s/sr) rep + (o - s*or/sr)
      const scale = t.scale / tr.scale;
      const offset = (t.offset - (t.scale * tr.offset) / tr.scale) || 0;
      mergeAttributes(wm, wm.byName.get(x)!, repVar, scale, offset);
      replacements.set(x, { rep, scale, offset });
      eliminated++;
    }
  }

  // Compose the previously recorded aliases with the new replacements.
  for (const [name, entry] of aliases) {
    const r = replacements.get(entry.rep);
    if (!r) continue;
    if (r.rep === undefined) {
      // The representative became constant: keep the entry pointing at the (now constant) variable.
      continue;
    }
    aliases.set(name, { rep: r.rep, scale: entry.scale * r.scale, offset: (entry.scale * r.offset + entry.offset) || 0 });
  }
  for (const [name, r] of replacements) {
    if (r.rep !== undefined) aliases.set(name, { rep: r.rep, scale: r.scale, offset: r.offset || 0 });
  }

  // Substitute and drop.
  const resolve = (name: string): Replacement | undefined => replacements.get(name);
  const subst = (eq: FlatEquation): FlatEquation => ({ ...eq, left: substituteAliases(eq.left, resolve), right: substituteAliases(eq.right, resolve) });
  const flat = wm.flat;
  flat.equations = flat.equations.filter((_, i) => !dropped.has(i)).map(subst);
  flat.initialEquations = flat.initialEquations.map(subst);
  flat.whenClauses = flat.whenClauses.map((w) => ({ ...w, cond: substituteAliases(w.cond, resolve), equations: w.equations.map(subst) }));
  const removed = new Set([...replacements.keys()].filter((x) => replacements.get(x)!.rep !== undefined));
  flat.variables = flat.variables.filter((v) => !removed.has(v.name));
  for (const x of removed) wm.byName.delete(x);
  wm.refreshStates();
  return eliminated;
}

/** Merges the attributes of `x` (eliminated, `x = scale*rep + offset`) into `rep`. */
function mergeAttributes(wm: WorkingModel, x: FlatVariable, rep: FlatVariable, scale: number, offset: number): void {
  const a = x.attributes;
  const r = rep.attributes;
  if (x.type !== 'Real') {
    if (r.start === undefined && a.start !== undefined) r.start = a.start;
    if (a.fixed === true && r.fixed === undefined) r.fixed = true;
    return;
  }
  const toRep = (v: number): number => (v - offset) / scale;
  const xStart = typeof a.start === 'number' ? a.start : undefined;
  const rStart = typeof r.start === 'number' ? r.start : undefined;
  if (a.fixed === true && xStart !== undefined) {
    if (r.fixed === true && rStart !== undefined) {
      const expected = scale * rStart + offset;
      const tol = 1e-9 * Math.max(1, Math.abs(xStart), Math.abs(expected));
      if (Math.abs(xStart - expected) > tol) {
        const relation = describeAlias(x.name, rep.name, scale, offset);
        if (wm.states.has(x.name) && wm.states.has(rep.name)) {
          throw new ModelicaError(
            `Conflicting start values: '${x.name}' (start=${xStart}, fixed=true) and '${rep.name}' (start=${rStart}, fixed=true) are aliases (${relation}) but the start values differ`,
          );
        }
        wm.warnings.push(`Start value of '${x.name}' (${xStart}, fixed=true) is ignored: it is an alias of '${rep.name}' (${relation}) whose fixed start value is ${rStart}`);
      }
    } else {
      r.start = toRep(xStart);
      r.fixed = true;
    }
  } else if (xStart !== undefined && rStart === undefined) {
    r.start = toRep(xStart);
  }
  // min/max: intersect the admissible intervals.
  if (a.min !== undefined || a.max !== undefined) {
    let lo = a.min !== undefined ? toRep(a.min) : undefined;
    let hi = a.max !== undefined ? toRep(a.max) : undefined;
    if (scale < 0) [lo, hi] = [hi, lo];
    if (lo !== undefined && Number.isFinite(lo)) r.min = r.min === undefined ? lo : Math.max(r.min, lo);
    if (hi !== undefined && Number.isFinite(hi)) r.max = r.max === undefined ? hi : Math.min(r.max, hi);
  }
  if (r.nominal === undefined && a.nominal !== undefined && Number.isFinite(a.nominal) && a.nominal !== 0) {
    r.nominal = Math.abs(a.nominal / scale);
  }
  mergeStateSelect(r, a);
}

function mergeStateSelect(r: VariableAttributes, a: VariableAttributes): void {
  if (r.stateSelect === undefined && a.stateSelect !== undefined) r.stateSelect = a.stateSelect;
}

export function describeAlias(x: string, rep: string, scale: number, offset: number): string {
  let s = scale === 1 ? rep : scale === -1 ? `-${rep}` : `${scale}*${rep}`;
  if (offset !== 0) s += offset > 0 ? ` + ${offset}` : ` - ${-offset}`;
  return `${x} = ${s}`;
}

