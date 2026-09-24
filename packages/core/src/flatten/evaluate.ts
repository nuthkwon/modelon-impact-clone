import type { Expr } from '../ast.js';

export type ConstValue = number | boolean | string;

/** Environment for constant evaluation: dotted name -> value (or a thunk evaluated lazily). */
export interface EvalEnv {
  lookup(name: string): ConstValue | undefined;
  /** Optional hook for user function calls; return undefined if unknown. */
  callFunction?(name: string, args: ConstValue[]): ConstValue | undefined;
}

/** Evaluates a constant expression (parameters, constants, literals, builtin math). Throws ModelicaError if not constant. */
export function evaluateConstant(_expr: Expr, _env: EvalEnv): ConstValue {
  throw new Error('evaluateConstant: not implemented');
}

/** Like evaluateConstant but returns undefined instead of throwing. */
export function tryEvaluateConstant(_expr: Expr, _env: EvalEnv): ConstValue | undefined {
  throw new Error('tryEvaluateConstant: not implemented');
}
