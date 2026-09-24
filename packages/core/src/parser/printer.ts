import type { ClassDef, Expr, Modification, StoredDefinition } from '../ast.js';

export interface PrintOptions {
  indent?: string;
}

/** Canonical pretty-printer. `parse(print(parse(text)))` must equal `parse(text)` structurally. */
export function printStoredDefinition(_def: StoredDefinition, _opts?: PrintOptions): string {
  throw new Error('printStoredDefinition: not implemented');
}

export function printClass(_cls: ClassDef, _opts?: PrintOptions): string {
  throw new Error('printClass: not implemented');
}

export function printExpr(_e: Expr): string {
  throw new Error('printExpr: not implemented');
}

/** Prints `(a=1, b(start=2))` including the parentheses; the `= value` part is printed as ` = value`. */
export function printModification(_m: Modification): string {
  throw new Error('printModification: not implemented');
}
