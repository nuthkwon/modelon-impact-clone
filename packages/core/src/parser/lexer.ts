import type { SourceLoc } from '../ast.js';

export type TokenKind = 'ident' | 'number' | 'string' | 'keyword' | 'op' | 'eof';

export interface Token {
  kind: TokenKind;
  value: string;
  loc: SourceLoc;
}

export const KEYWORDS = new Set([
  'algorithm', 'and', 'annotation', 'block', 'break', 'class', 'connect', 'connector', 'constant', 'constrainedby',
  'der', 'discrete', 'each', 'else', 'elseif', 'elsewhen', 'encapsulated', 'end', 'enumeration', 'equation',
  'expandable', 'extends', 'external', 'false', 'final', 'flow', 'for', 'function', 'if', 'import', 'impure',
  'in', 'initial', 'inner', 'input', 'loop', 'model', 'not', 'operator', 'or', 'outer', 'output', 'package',
  'parameter', 'partial', 'protected', 'public', 'pure', 'record', 'redeclare', 'replaceable', 'return',
  'stream', 'then', 'true', 'type', 'when', 'while', 'within',
]);

/** Converts Modelica source text into tokens; comments are dropped. Throws ModelicaError on bad input. */
export function tokenize(_text: string, _file?: string): Token[] {
  throw new Error('tokenize: not implemented');
}
