import type { Expr, Modification, StoredDefinition } from '../ast.js';

/** Parses a Modelica file. Throws `ModelicaError` with diagnostics on syntax errors. */
export function parse(_text: string, _file?: string): StoredDefinition {
  throw new Error('parse: not implemented');
}

/** Parses a single expression, e.g. a parameter value typed by the user. */
export function parseExpression(_text: string): Expr {
  throw new Error('parseExpression: not implemented');
}

/** Parses the inside of a modification list, e.g. `R=100, i(start=1)`. */
export function parseModification(_text: string): Modification {
  throw new Error('parseModification: not implemented');
}
