import { describe, expect, it } from 'vitest';
import { ModelicaError } from '../ast.js';
import { KEYWORDS, tokenize, type Token } from './lexer.js';

const kinds = (text: string) => tokenize(text).map((t) => `${t.kind}:${t.value}`);
const values = (text: string) => tokenize(text).filter((t) => t.kind !== 'eof').map((t) => t.value);

function expectError(text: string, message: RegExp, line: number, column: number) {
  let caught: unknown;
  try {
    tokenize(text, 'T.mo');
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(ModelicaError);
  const err = caught as ModelicaError;
  expect(err.message).toMatch(message);
  expect(err.diagnostics).toHaveLength(1);
  expect(err.diagnostics[0].severity).toBe('error');
  expect(err.diagnostics[0].file).toBe('T.mo');
  expect(err.diagnostics[0].loc).toMatchObject({ line, column });
}

describe('tokenize', () => {
  it('produces an eof token for empty input', () => {
    const tokens = tokenize('');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ kind: 'eof', loc: { line: 1, column: 1, offset: 0, length: 0 } });
  });

  it('distinguishes identifiers from keywords', () => {
    expect(kinds('model Resistor end Resistor;')).toEqual([
      'keyword:model', 'ident:Resistor', 'keyword:end', 'ident:Resistor', 'op:;', 'eof:<eof>',
    ]);
    expect(KEYWORDS.has('der')).toBe(true);
    expect(kinds('der(x) time _a1')).toEqual(['keyword:der', 'op:(', 'ident:x', 'op:)', 'ident:time', 'ident:_a1', 'eof:<eof>']);
  });

  it('keeps quoted identifiers verbatim including the quotes', () => {
    const [t] = tokenize("'abc def' 'a\\'b'");
    expect(t).toMatchObject({ kind: 'ident', value: "'abc def'", loc: { line: 1, column: 1, offset: 0, length: 9 } });
    expect(tokenize("'abc def' 'a\\'b'")[1]).toMatchObject({ kind: 'ident', value: "'a\\'b'" });
  });

  it('lexes numbers in all supported forms', () => {
    expect(values('1 1.5 .5 1e-3 1.5E+3 1. 12e2 0.25e-10')).toEqual(['1', '1.5', '.5', '1e-3', '1.5E+3', '1.', '12e2', '0.25e-10']);
    expect(tokenize('1.5E+3')[0].kind).toBe('number');
    expect(Number(tokenize('.5')[0].value)).toBe(0.5);
  });

  it('does not confuse `1.` with element-wise operators or ranges', () => {
    expect(values('{1,2}.*3')).toEqual(['{', '1', ',', '2', '}', '.*', '3']);
    expect(values('1:3')).toEqual(['1', ':', '3']);
    expect(values('a.b.c')).toEqual(['a', '.', 'b', '.', 'c']);
    expect(values('x[1].y')).toEqual(['x', '[', '1', ']', '.', 'y']);
  });

  it('decodes string escapes', () => {
    const [t] = tokenize('"a\\"b\\\\c\\n\\td\\\'e\\?"');
    expect(t.kind).toBe('string');
    expect(t.value).toBe('a"b\\c\n\td\'e?');
    expect(t.loc.length).toBe('"a\\"b\\\\c\\n\\td\\\'e\\?"'.length);
  });

  it('supports multi-line strings and keeps line numbers right afterwards', () => {
    const tokens = tokenize('"<html>\n<p>x</p>\n</html>" y');
    expect(tokens[0].value).toBe('<html>\n<p>x</p>\n</html>');
    expect(tokens[1]).toMatchObject({ kind: 'ident', value: 'y', loc: { line: 3, column: 10 } });
  });

  it('drops line and block comments', () => {
    expect(values('a // comment\n b /* block\n comment */ c')).toEqual(['a', 'b', 'c']);
    const tokens = tokenize('a // comment\n b /* block\n comment */ c');
    expect(tokens[2].loc).toMatchObject({ line: 3, column: 13 });
    // A comment marker inside a string is not a comment.
    expect(values('"a // b /* c */"')).toEqual(['a // b /* c */']);
  });

  it('lexes all operators with longest match', () => {
    const ops = '. , ; : = := ( ) [ ] { } + - * / ^ .+ .- .* ./ .^ < <= > >= == <>';
    expect(values(ops)).toEqual(ops.split(' '));
    expect(tokenize(ops).every((t) => t.kind === 'op' || t.kind === 'eof')).toBe(true);
    expect(values('a<=b<>c>=d==e')).toEqual(['a', '<=', 'b', '<>', 'c', '>=', 'd', '==', 'e']);
  });

  it('records accurate 1-based line/column, offset and length', () => {
    const text = 'model M\n  parameter Real R = 1.5 "res";\nend M;';
    const tokens = tokenize(text);
    const find = (value: string) => tokens.find((t) => t.value === value) as Token;
    expect(find('model').loc).toEqual({ line: 1, column: 1, offset: 0, length: 5 });
    expect(find('parameter').loc).toEqual({ line: 2, column: 3, offset: 10, length: 9 });
    expect(find('1.5').loc).toEqual({ line: 2, column: 22, offset: 29, length: 3 });
    expect(find('res').loc).toEqual({ line: 2, column: 26, offset: 33, length: 5 });
    expect(find('end').loc).toEqual({ line: 3, column: 1, offset: 40, length: 3 });
    expect(tokens[tokens.length - 1].loc).toEqual({ line: 3, column: 7, offset: text.length, length: 0 });
  });

  it('handles CRLF line endings', () => {
    const tokens = tokenize('a\r\nb');
    expect(tokens[1].loc).toMatchObject({ line: 2, column: 1, offset: 3 });
  });

  it('reports errors with locations', () => {
    expectError('model M\n  Real x = "abc;\nend M;', /Unterminated string literal \(line 2, column 12\)/, 2, 12);
    expectError('a /* never closed', /Unterminated block comment \(line 1, column 3\)/, 1, 3);
    expectError("x = 'abc", /Unterminated quoted identifier/, 1, 5);
    expectError('x = 1 $ 2', /Unexpected character '\$' \(line 1, column 7\)/, 1, 7);
    expectError('x = 1e;', /Malformed number '1e'/, 1, 5);
    expectError('x = 2abc;', /Malformed number '2a'/, 1, 5);
    expectError('x = "bad \\q escape"', /Unknown escape sequence '\\q'/, 1, 10);
  });
});
