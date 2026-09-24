/**
 * Equation flattening: equalities, if-equations (constant conditions select a branch,
 * variable conditions pair the branch equations position by position), when-clauses
 * (`reinit` and discrete assignments), initial equations, and the `assert`/`terminate`
 * statements (dropped with a diagnostic). `connect` statements are collected on the instance
 * and expanded later by `connections.ts`.
 */
import { E, type Equation, type Expr } from '../ast.js';
import { flatRef, type FlatEquation, type FlatEquationKind, type FlatWhenClause } from '../flat.js';
import { printExpr } from '../parser/printer.js';
import { tryEvaluateConstant } from './evaluate.js';
import { paramEnv } from './parameters.js';
import { flattenExpr, resolveVariable } from './scope.js';
import { diag, error, fileOf, isParamLike, originOf, pathOf, type ClassInstance, type ConnectStatement, type Ctx, type Scope } from './types.js';

export interface EquationTargets {
  equations: FlatEquation[];
  initialEquations: FlatEquation[];
  whenClauses: FlatWhenClause[];
}

/** Flattens the equations of `inst` and, depth-first, of its sub-instances. */
export function flattenInstanceEquations(ctx: Ctx, inst: ClassInstance, model: EquationTargets): void {
  for (const se of inst.equations) flattenEquation(ctx, se.eq, se.scope, 'equation', model.equations, model.whenClauses, inst.connects);
  for (const se of inst.initialEquations) flattenEquation(ctx, se.eq, se.scope, 'initial', model.initialEquations, undefined, undefined);
  for (const name of inst.order) {
    const c = inst.components.get(name);
    if (c && c.kind === 'class') flattenInstanceEquations(ctx, c, model);
  }
}

function flattenEquation(
  ctx: Ctx,
  eq: Equation,
  scope: Scope,
  kind: 'equation' | 'initial',
  out: FlatEquation[],
  whens: FlatWhenClause[] | undefined,
  connects: ConnectStatement[] | undefined,
): void {
  const file = fileOf(ctx, scope.cls);
  const origin = originOf(scope);
  const opts = { path: pathOf(scope), loc: eq.loc, file };
  switch (eq.kind) {
    case 'equals': {
      const left = flattenExpr(ctx, eq.left, scope);
      const right = flattenExpr(ctx, eq.right, scope);
      out.push({ kind, left, right, origin, loc: eq.loc, file });
      return;
    }
    case 'connect': {
      if (!connects) {
        throw error(
          kind === 'initial'
            ? 'connect statements are not allowed in initial equation sections'
            : 'connect statements are only supported at the top level of an equation section or inside if-equations with parameter conditions',
          opts,
        );
      }
      connects.push({ a: eq.a, b: eq.b, scope, loc: eq.loc });
      return;
    }
    case 'if':
      flattenIfEquation(ctx, eq, scope, kind, out, whens, connects);
      return;
    case 'for':
      throw error('for-equations are not supported', opts);
    case 'when':
      if (kind === 'initial') throw error('when-equations are not allowed in initial equation sections', opts);
      if (!whens) throw error('when-equations are only supported at the top level of an equation section or inside if-equations with parameter conditions', opts);
      flattenWhen(ctx, eq, scope, whens);
      return;
    case 'call':
      flattenCallStatement(ctx, eq, scope, opts);
      return;
  }
}

function flattenCallStatement(ctx: Ctx, eq: Equation & { kind: 'call' }, scope: Scope, opts: { path: string; loc?: Expr['loc']; file?: string }): void {
  const call = eq.call;
  if (call.kind !== 'call') throw error(`Unsupported equation statement: ${printExpr(call)}`, opts);
  switch (call.callee) {
    case 'assert': {
      const cond = call.args[0] ? printExpr(call.args[0]) : '';
      diag(ctx, 'info', `assert(${cond}) in ${originOf(scope)} is not checked during simulation`, opts);
      return;
    }
    case 'terminate':
      diag(ctx, 'warning', `${printExpr(call)} in ${originOf(scope)} is ignored`, opts);
      return;
    case 'reinit':
      throw error(`'reinit' is only allowed inside a when-clause`, opts);
    default:
      throw error(`Function calls are not supported: ${call.callee}`, opts);
  }
}

function difference(left: Expr, right: Expr): Expr {
  if (right.kind === 'number' && right.value === 0) return left;
  return E.bin('-', left, right);
}

function flattenIfEquation(
  ctx: Ctx,
  eq: Equation & { kind: 'if' },
  scope: Scope,
  kind: 'equation' | 'initial',
  out: FlatEquation[],
  whens: FlatWhenClause[] | undefined,
  connects: ConnectStatement[] | undefined,
): void {
  const env = paramEnv(ctx);
  const file = fileOf(ctx, scope.cls);
  const opts = { path: pathOf(scope), loc: eq.loc, file };
  let i = 0;
  let pendingCond: Expr | undefined;
  for (; i < eq.branches.length; i++) {
    const cond = flattenExpr(ctx, eq.branches[i].cond, scope);
    const c = tryEvaluateConstant(cond, env);
    if (c === undefined) {
      pendingCond = cond;
      break;
    }
    if (typeof c !== 'boolean') throw error(`The condition of an if-equation must be a Boolean: ${printExpr(eq.branches[i].cond)}`, { ...opts, loc: eq.branches[i].cond.loc });
    if (c) {
      for (const sub of eq.branches[i].equations) flattenEquation(ctx, sub, scope, kind, out, whens, connects);
      return;
    }
  }
  if (i === eq.branches.length) {
    for (const sub of eq.else) flattenEquation(ctx, sub, scope, kind, out, whens, connects);
    return;
  }
  // Variable condition: pair the equations of the remaining branches position by position.
  const rest = eq.branches.slice(i);
  const lists = rest.map((b, j) => {
    const list: FlatEquation[] = [];
    for (const sub of b.equations) flattenEquation(ctx, sub, scope, kind, list, undefined, undefined);
    return { cond: j === 0 ? pendingCond! : flattenExpr(ctx, b.cond, scope), list };
  });
  const elseList: FlatEquation[] = [];
  for (const sub of eq.else) flattenEquation(ctx, sub, scope, kind, elseList, undefined, undefined);
  const n = lists[0].list.length;
  if (lists.some((l) => l.list.length !== n) || elseList.length !== n) {
    const counts = [...lists.map((l) => l.list.length), elseList.length];
    throw error(
      `All branches of an if-equation with a non-parameter condition must have the same number of equations (found ${counts.join(', ')}${eq.else.length === 0 ? '; an else branch is required' : ''}) in ${originOf(scope)}`,
      opts,
    );
  }
  const origin = originOf(scope);
  for (let j = 0; j < n; j++) {
    const branches = lists.map((l) => ({ cond: l.cond, value: difference(l.list[j].left, l.list[j].right) }));
    const elseValue = difference(elseList[j].left, elseList[j].right);
    const left: Expr = { kind: 'if', branches, else: elseValue, loc: eq.loc };
    out.push({ kind: kind as FlatEquationKind, left, right: E.num(0), origin, loc: eq.loc, file });
  }
}

function flattenWhen(ctx: Ctx, eq: Equation & { kind: 'when' }, scope: Scope, whens: FlatWhenClause[]): void {
  const origin = originOf(scope);
  const conds = eq.branches.map((b) => flattenExpr(ctx, b.cond, scope));
  for (let k = 0; k < eq.branches.length; k++) {
    let cond = conds[k];
    if (k > 0) {
      // `elsewhen c_k` fires only when none of the earlier conditions hold.
      let earlier = conds[0];
      for (let j = 1; j < k; j++) earlier = E.bin('or', earlier, conds[j]);
      cond = E.bin('and', cond, { kind: 'unary', op: 'not', operand: earlier });
    }
    const equations: FlatEquation[] = [];
    for (const sub of eq.branches[k].equations) flattenWhenBody(ctx, sub, scope, equations);
    whens.push({ cond, equations, origin });
  }
}

function flattenWhenBody(ctx: Ctx, eq: Equation, scope: Scope, equations: FlatEquation[]): void {
  const file = fileOf(ctx, scope.cls);
  const origin = originOf(scope);
  const opts = { path: pathOf(scope), loc: eq.loc, file };
  switch (eq.kind) {
    case 'equals': {
      const target = resolveVariable(ctx, eq.left, scope, 'The left-hand side of a when-equation');
      if (isParamLike(target)) throw error(`Cannot assign ${target.variability} '${target.path}' in a when-clause`, opts);
      const right = flattenExpr(ctx, eq.right, scope);
      equations.push({ kind: 'equation', left: flatRef(target.path), right, origin, loc: eq.loc, file });
      ctx.whenTargets.add(target.path);
      return;
    }
    case 'call': {
      const call = eq.call;
      if (call.kind !== 'call') throw error(`Unsupported statement in when-clause: ${printExpr(call)}`, opts);
      if (call.callee === 'reinit') {
        if (call.args.length !== 2 || call.namedArgs.length) throw error(`'reinit' expects two arguments: ${printExpr(call)}`, opts);
        const target = resolveVariable(ctx, call.args[0], scope, 'The first argument of reinit');
        if (isParamLike(target)) throw error(`reinit(${target.path}, ...): cannot reinitialize a ${target.variability}`, opts);
        if (target.type !== 'Real') throw error(`reinit(${target.path}, ...): only Real variables can be reinitialized`, opts);
        const value = flattenExpr(ctx, call.args[1], scope);
        equations.push({
          kind: 'equation',
          left: { kind: 'call', callee: 'reinit', args: [flatRef(target.path), value], namedArgs: [], loc: call.loc },
          right: E.num(0),
          origin,
          loc: eq.loc,
          file,
        });
        return;
      }
      flattenCallStatement(ctx, eq, scope, opts);
      return;
    }
    case 'if': {
      const env = paramEnv(ctx);
      for (const b of eq.branches) {
        const c = tryEvaluateConstant(flattenExpr(ctx, b.cond, scope), env);
        if (typeof c !== 'boolean') throw error(`if-equations inside when-clauses must have parameter conditions: ${printExpr(b.cond)}`, opts);
        if (c) {
          for (const sub of b.equations) flattenWhenBody(ctx, sub, scope, equations);
          return;
        }
      }
      for (const sub of eq.else) flattenWhenBody(ctx, sub, scope, equations);
      return;
    }
    case 'when':
      throw error('Nested when-clauses are not supported', opts);
    case 'for':
      throw error('for-equations are not supported', opts);
    case 'connect':
      throw error('connect statements are not allowed inside when-clauses', opts);
  }
}
