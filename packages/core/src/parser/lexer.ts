import { ModelicaError, type SourceLoc } from '../ast.js';

export type TokenKind = 'ident' | 'number' | 'string' | 'keyword' | 'op' | 'eof';

export interface Token {
  kind: TokenKind;
  /**
   * Identifier text (quoted identifiers keep their quotes: `'a b'`), keyword, operator text,
   * the raw number text, or the *decoded* string value (escapes resolved, no quotes).
   */
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

/** Two-character operators, tried before single-character ones. */
const TWO_CHAR_OPS = new Set([':=', '<=', '>=', '==', '<>', '.+', '.-', '.*', './', '.^']);
const ONE_CHAR_OPS = new Set(['.', ',', ';', ':', '=', '(', ')', '[', ']', '{', '}', '+', '-', '*', '/', '^', '<', '>']);

const ESCAPES: Record<string, string> = {
  '"': '"', "'": "'", '\\': '\\', '?': '?', a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v',
};

function isIdentStart(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
}
function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}
function isIdentPart(c: string): boolean {
  return isIdentStart(c) || isDigit(c);
}

/** Converts Modelica source text into tokens; comments are dropped. Throws ModelicaError on bad input. */
export function tokenize(text: string, file?: string): Token[] {
  const tokens: Token[] = [];
  const n = text.length;
  let i = 0;
  let line = 1;
  let lineStart = 0; // offset of the first character of the current line

  const locAt = (offset: number, length: number, l: number, ls: number): SourceLoc => ({
    line: l,
    column: offset - ls + 1,
    offset,
    length,
  });
  const fail = (message: string, offset: number, length: number, l = line, ls = lineStart): never => {
    const loc = locAt(offset, Math.max(1, length), l, ls);
    throw new ModelicaError(`${message} (line ${loc.line}, column ${loc.column})`, [
      { severity: 'error', message: `${message} (line ${loc.line}, column ${loc.column})`, file, loc },
    ]);
  };
  const push = (kind: TokenKind, value: string, start: number, startLine: number, startLineStart: number) => {
    tokens.push({ kind, value, loc: locAt(start, i - start, startLine, startLineStart) });
  };
  /** Advances over one character, keeping line bookkeeping. */
  const advance = () => {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
    i++;
  };

  while (i < n) {
    const c = text[i];
    // Whitespace
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f' || c === '\v' || c === '\uFEFF') {
      advance();
      continue;
    }
    // Comments
    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const start = i;
      const startLine = line;
      const startLineStart = lineStart;
      i += 2;
      let closed = false;
      while (i < n) {
        if (text[i] === '*' && text[i + 1] === '/') {
          i += 2;
          closed = true;
          break;
        }
        advance();
      }
      if (!closed) fail('Unterminated block comment', start, 2, startLine, startLineStart);
      continue;
    }
    const start = i;
    const startLine = line;
    const startLineStart = lineStart;
    // Identifiers and keywords
    if (isIdentStart(c)) {
      while (i < n && isIdentPart(text[i])) i++;
      const word = text.slice(start, i);
      push(KEYWORDS.has(word) ? 'keyword' : 'ident', word, start, startLine, startLineStart);
      continue;
    }
    // Quoted identifiers: 'a b' (kept verbatim including the quotes)
    if (c === "'") {
      i++;
      let closed = false;
      while (i < n) {
        const ch = text[i];
        if (ch === '\\') {
          i += 2;
          continue;
        }
        if (ch === "'") {
          i++;
          closed = true;
          break;
        }
        if (ch === '\n') break;
        i++;
      }
      if (!closed) fail('Unterminated quoted identifier', start, i - start, startLine, startLineStart);
      push('ident', text.slice(start, i), start, startLine, startLineStart);
      continue;
    }
    // Numbers: digits [. digits] [e[+-]digits]  |  . digits [e[+-]digits]
    if (isDigit(c) || (c === '.' && isDigit(text[i + 1] ?? ''))) {
      while (i < n && isDigit(text[i])) i++;
      if (text[i] === '.' && !(text[i + 1] === '+' || text[i + 1] === '-' || text[i + 1] === '*' || text[i + 1] === '/' || text[i + 1] === '^')) {
        i++;
        while (i < n && isDigit(text[i])) i++;
      }
      if (text[i] === 'e' || text[i] === 'E') {
        let j = i + 1;
        if (text[j] === '+' || text[j] === '-') j++;
        if (!isDigit(text[j] ?? '')) fail(`Malformed number '${text.slice(start, j)}'`, start, j - start);
        i = j;
        while (i < n && isDigit(text[i])) i++;
      }
      if (isIdentStart(text[i] ?? '')) fail(`Malformed number '${text.slice(start, i + 1)}'`, start, i + 1 - start);
      push('number', text.slice(start, i), start, startLine, startLineStart);
      continue;
    }
    // Strings
    if (c === '"') {
      i++;
      let value = '';
      let closed = false;
      while (i < n) {
        const ch = text[i];
        if (ch === '\\') {
          const esc = text[i + 1];
          if (esc === undefined) break;
          const decoded = ESCAPES[esc];
          if (decoded === undefined) fail(`Unknown escape sequence '\\${esc}' in string`, i, 2);
          value += decoded;
          i += 2;
          continue;
        }
        if (ch === '"') {
          i++;
          closed = true;
          break;
        }
        value += ch;
        advance();
      }
      if (!closed) fail('Unterminated string literal', start, 1, startLine, startLineStart);
      tokens.push({ kind: 'string', value, loc: locAt(start, i - start, startLine, startLineStart) });
      continue;
    }
    // Operators
    const two = text.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      i += 2;
      push('op', two, start, startLine, startLineStart);
      continue;
    }
    if (ONE_CHAR_OPS.has(c)) {
      i++;
      push('op', c, start, startLine, startLineStart);
      continue;
    }
    fail(`Unexpected character '${c}'`, i, 1);
  }
  tokens.push({ kind: 'eof', value: '<eof>', loc: locAt(n, 0, line, lineStart) });
  return tokens;
}
