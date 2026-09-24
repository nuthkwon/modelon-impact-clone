/**
 * Balance check and statistics. Unknowns are the continuous/discrete variables; equations
 * are the flat equations plus one per variable assigned in a when-clause (the solver counts
 * when-assigned discrete variables the same way).
 */
import { ModelicaError, type Diagnostic, type Expr } from '../ast.js';
import type { FlatEquation, FlatModel } from '../flat.js';
import { printExpr } from '../parser/printer.js';
import { refName } from './evaluate.js';
import type { Ctx } from './types.js';

export function equationText(eq: FlatEquation): string {
  return `${printExpr(eq.left)} = ${printExpr(eq.right)}`;
}

/** Names of variables appearing as `der(x)` anywhere in the model. */
export function collectStates(model: FlatModel): Set<string> {
  const states = new Set<string>();
  const visit = (e: Expr | undefined): void => {
    if (!e) return;
    switch (e.kind) {
      case 'call':
        if (e.callee === 'der' && e.args.length === 1 && e.args[0].kind === 'ref') states.add(refName(e.args[0]));
        e.args.forEach(visit);
        e.namedArgs.forEach((n) => visit(n.value));
        break;
      case 'binary':
        visit(e.left);
        visit(e.right);
        break;
      case 'unary':
        visit(e.operand);
        break;
      case 'if':
        e.branches.forEach((b) => {
          visit(b.cond);
          visit(b.value);
        });
        visit(e.else);
        break;
      case 'array':
        e.elements.forEach(visit);
        break;
      case 'range':
        visit(e.start);
        visit(e.step);
        visit(e.end);
        break;
      default:
        break;
    }
  };
  for (const eq of model.equations) {
    visit(eq.left);
    visit(eq.right);
  }
  for (const eq of model.initialEquations) {
    visit(eq.left);
    visit(eq.right);
  }
  for (const w of model.whenClauses) {
    visit(w.cond);
    for (const eq of w.equations) {
      visit(eq.left);
      visit(eq.right);
    }
  }
  return states;
}

/** Distinct variables assigned (not reinitialised) in when-clauses. */
export function whenAssignedVariables(model: FlatModel): Set<string> {
  const out = new Set<string>();
  for (const w of model.whenClauses) {
    for (const eq of w.equations) {
      if (eq.left.kind === 'ref') out.add(refName(eq.left));
    }
  }
  return out;
}

/**
 * Checks that the number of equations matches the number of unknowns. In strict mode an
 * unbalanced model throws a ModelicaError whose diagnostics list unknowns and equations;
 * otherwise the diagnostics are appended to the model.
 */
export function checkBalance(ctx: Ctx, model: FlatModel, strict: boolean): void {
  const unknowns = model.variables.filter((v) => v.variability === 'continuous' || v.variability === 'discrete');
  const whenAssigned = whenAssignedVariables(model);
  const states = collectStates(model);
  const nEq = model.equations.length + whenAssigned.size;
  const nU = unknowns.length;
  if (nEq === nU) return;

  const message = `The model is not balanced: ${nEq} equations and ${nU} variables`;
  const diagnostics: Diagnostic[] = [{ severity: 'error', message, path: model.className, code: 'unbalanced' }];
  diagnostics.push({ severity: 'info', message: `Unknowns (${nU}):`, path: model.className });
  for (const u of unknowns) {
    const tag = states.has(u.name) ? ' (state)' : whenAssigned.has(u.name) ? ' (discrete, assigned in when-clause)' : u.variability === 'discrete' ? ' (discrete)' : '';
    diagnostics.push({ severity: 'info', message: `  ${u.name}${tag}`, path: u.name, loc: u.loc, file: u.file });
  }
  diagnostics.push({ severity: 'info', message: `Equations (${nEq}):`, path: model.className });
  for (const eq of model.equations) {
    diagnostics.push({ severity: 'info', message: `  ${equationText(eq)}    [${eq.origin}]`, path: eq.origin, loc: eq.loc, file: eq.file });
  }
  for (const w of model.whenClauses) {
    for (const eq of w.equations) {
      if (eq.left.kind === 'ref') {
        diagnostics.push({ severity: 'info', message: `  when ${printExpr(w.cond)}: ${equationText(eq)}    [${w.origin}]`, path: w.origin, loc: eq.loc, file: eq.file });
      }
    }
  }
  if (strict) throw new ModelicaError(message, diagnostics);
  ctx.diagnostics.push(...diagnostics);
}
