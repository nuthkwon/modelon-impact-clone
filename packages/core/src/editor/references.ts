/**
 * Walkers over component references (`ref` expressions) in a class body: used to rename a
 * component everywhere it is used and to find equations that still mention a deleted one.
 */
import type { ClassDef, ComponentDecl, Equation, Expr, Modification } from '../ast.js';
import { printExpr } from '../parser/printer.js';

export type RefExpr = Extract<Expr, { kind: 'ref' }>;
export type RefVisitor = (ref: RefExpr) => void;

/** Calls `fn` for every `ref` inside `e`, including refs nested in subscripts, calls, arrays, ... */
export function forEachRef(e: Expr | undefined, fn: RefVisitor): void {
  if (!e) return;
  switch (e.kind) {
    case 'ref':
      fn(e);
      for (const p of e.parts) for (const s of p.subscripts ?? []) forEachRef(s, fn);
      return;
    case 'binary':
      forEachRef(e.left, fn);
      forEachRef(e.right, fn);
      return;
    case 'unary':
      forEachRef(e.operand, fn);
      return;
    case 'call':
      for (const a of e.args) forEachRef(a, fn);
      for (const a of e.namedArgs) forEachRef(a.value, fn);
      return;
    case 'if':
      for (const b of e.branches) {
        forEachRef(b.cond, fn);
        forEachRef(b.value, fn);
      }
      forEachRef(e.else, fn);
      return;
    case 'array':
      for (const el of e.elements) forEachRef(el, fn);
      return;
    case 'range':
      forEachRef(e.start, fn);
      forEachRef(e.step, fn);
      forEachRef(e.end, fn);
      return;
    default:
      return;
  }
}

export function forEachModificationRef(mod: Modification | undefined, fn: RefVisitor): void {
  if (!mod) return;
  forEachRef(mod.value, fn);
  for (const m of mod.mods) forEachModificationRef(m.modification, fn);
}

export function forEachComponentRef(c: ComponentDecl, fn: RefVisitor): void {
  forEachModificationRef(c.modification, fn);
  forEachRef(c.condition, fn);
  for (const d of c.arrayDims ?? []) forEachRef(d, fn);
}

/** Visits every ref of an equation (nested equations of if/for/when included; annotations excluded). */
export function forEachEquationRef(eq: Equation, fn: RefVisitor): void {
  switch (eq.kind) {
    case 'equals':
      forEachRef(eq.left, fn);
      forEachRef(eq.right, fn);
      return;
    case 'connect':
      forEachRef(eq.a, fn);
      forEachRef(eq.b, fn);
      return;
    case 'call':
      forEachRef(eq.call, fn);
      return;
    case 'if':
      for (const b of eq.branches) {
        forEachRef(b.cond, fn);
        for (const q of b.equations) forEachEquationRef(q, fn);
      }
      for (const q of eq.else) forEachEquationRef(q, fn);
      return;
    case 'for':
      for (const i of eq.indices) forEachRef(i.range, fn);
      for (const q of eq.equations) forEachEquationRef(q, fn);
      return;
    case 'when':
      for (const b of eq.branches) {
        forEachRef(b.cond, fn);
        for (const q of b.equations) forEachEquationRef(q, fn);
      }
      return;
  }
}

/** First name of a (non-global) component reference, e.g. `resistor` for `resistor.p.v`. */
export function rootName(e: Expr): string | undefined {
  if (e.kind !== 'ref' || e.global || !e.parts.length) return undefined;
  return e.parts[0].name;
}

function referencesAny(visit: (fn: RefVisitor) => void, names: Set<string>): boolean {
  let hit = false;
  visit((ref) => {
    const root = rootName(ref);
    if (root !== undefined && names.has(root)) hit = true;
  });
  return hit;
}

export function equationReferences(eq: Equation, names: Set<string>): boolean {
  return referencesAny((fn) => forEachEquationRef(eq, fn), names);
}

export function componentReferences(c: ComponentDecl, names: Set<string>): boolean {
  return referencesAny((fn) => forEachComponentRef(c, fn), names);
}

export function modificationReferences(mod: Modification | undefined, names: Set<string>): boolean {
  return referencesAny((fn) => forEachModificationRef(mod, fn), names);
}

/**
 * Renames the root of every reference to component `oldName` in the class body: equations,
 * initial equations, component modifiers/conditions/dimensions and `extends` modifiers.
 * The class annotation is left alone (icons use `%name`, not component names).
 */
export function renameReferences(cls: ClassDef, oldName: string, newName: string): void {
  const rename: RefVisitor = (ref) => {
    if (!ref.global && ref.parts.length && ref.parts[0].name === oldName) ref.parts[0].name = newName;
  };
  for (const eq of cls.equations) forEachEquationRef(eq, rename);
  for (const eq of cls.initialEquations) forEachEquationRef(eq, rename);
  for (const c of cls.components) forEachComponentRef(c, rename);
  for (const ext of cls.extends) forEachModificationRef(ext.modification, rename);
}

/** Removes `connect` equations whose either side refers to one of `names` (nested equation blocks included). */
export function removeConnectsReferencing(eqs: Equation[], names: Set<string>): Equation[] {
  const out: Equation[] = [];
  for (const eq of eqs) {
    switch (eq.kind) {
      case 'connect': {
        const a = rootName(eq.a);
        const b = rootName(eq.b);
        if ((a !== undefined && names.has(a)) || (b !== undefined && names.has(b))) continue;
        out.push(eq);
        break;
      }
      case 'if':
        eq.branches = eq.branches.map((br) => ({ ...br, equations: removeConnectsReferencing(br.equations, names) }));
        eq.else = removeConnectsReferencing(eq.else, names);
        out.push(eq);
        break;
      case 'for':
        eq.equations = removeConnectsReferencing(eq.equations, names);
        out.push(eq);
        break;
      case 'when':
        eq.branches = eq.branches.map((br) => ({ ...br, equations: removeConnectsReferencing(br.equations, names) }));
        out.push(eq);
        break;
      default:
        out.push(eq);
    }
  }
  return out;
}

/** Short one-line rendering of an equation for diagnostics. */
export function describeEquation(eq: Equation): string {
  switch (eq.kind) {
    case 'equals':
      return `${printExpr(eq.left)} = ${printExpr(eq.right)}`;
    case 'connect':
      return `connect(${printExpr(eq.a)}, ${printExpr(eq.b)})`;
    case 'call':
      return printExpr(eq.call);
    case 'if':
      return `if ${printExpr(eq.branches[0].cond)} then ...`;
    case 'for':
      return `for ${eq.indices.map((i) => `${i.name} in ${printExpr(i.range)}`).join(', ')} loop ...`;
    case 'when':
      return `when ${printExpr(eq.branches[0].cond)} then ...`;
  }
}
