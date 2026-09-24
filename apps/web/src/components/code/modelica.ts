/**
 * Modelica language mode for CodeMirror 6 (StreamLanguage): keywords, built-in types and
 * functions, numbers, strings, comments, operators; `annotation(...)` blocks are dimmed as
 * `meta` tokens. Colours come from CSS variables defined in code.css (light/dark).
 */
import { HighlightStyle, LanguageSupport, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import type { StreamParser, StringStream } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

export const MODELICA_KEYWORDS = new Set(
  (
    'algorithm and block break class connect connector constant constrainedby der discrete each else elseif elsewhen encapsulated end enumeration equation expandable extends external final flow for function if import impure in initial inner input loop model not operator or outer output package parameter partial protected public pure record redeclare replaceable return stream then type when while within'
  ).split(' '),
);

export const MODELICA_TYPES = new Set(['Real', 'Integer', 'Boolean', 'String', 'StateSelect', 'ExternalObject', 'AssertionLevel', 'Clock']);

export const MODELICA_BUILTINS = new Set(
  (
    'der pre edge change reinit noEvent smooth sample initial terminal delay cardinality homotopy semiLinear inStream actualStream spatialDistribution getInstanceName abs sign sqrt sin cos tan asin acos atan atan2 sinh cosh tanh exp log log10 integer floor ceil div mod rem min max sum product size ndims fill zeros ones identity diagonal linspace cat transpose outerProduct symmetric cross skew scalar vector matrix array assert terminate String Integer Real Boolean'
  ).split(' '),
);

interface ModelicaState {
  inBlockComment: boolean;
  /** Waiting for the `(` that opens an annotation. */
  pendingAnnotation: boolean;
  /** Parenthesis depth inside an annotation (0 = not inside). */
  annotationDepth: number;
}

const STRING_RE = /^"(?:[^"\\]|\\.)*"/;
const UNTERMINATED_STRING_RE = /^"(?:[^"\\]|\\.)*$/;
const NUMBER_RE = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/;
const IDENT_RE = /^(?:[A-Za-z_][A-Za-z0-9_]*|'(?:[^'\\]|\\.)*')/;
const OPERATOR_RE = /^(?::=|==|<>|<=|>=|\.\+|\.-|\.\*|\.\/|\.\^|[-+*/^<>=:])/;
const PUNCT_RE = /^[;,(){}[\]]/;

function blockComment(stream: StringStream, state: ModelicaState): string {
  let ch: string | void;
  let prev = '';
  while ((ch = stream.next()) !== undefined) {
    if (prev === '*' && ch === '/') {
      state.inBlockComment = false;
      break;
    }
    prev = ch;
  }
  return state.annotationDepth > 0 ? 'meta' : 'comment';
}

const parser: StreamParser<ModelicaState> = {
  name: 'modelica',
  startState: () => ({ inBlockComment: false, pendingAnnotation: false, annotationDepth: 0 }),
  copyState: (s) => ({ ...s }),
  token(stream, state) {
    if (state.inBlockComment) return blockComment(stream, state);
    if (stream.eatSpace()) return null;

    if (stream.match('//')) {
      stream.skipToEnd();
      return state.annotationDepth > 0 ? 'meta' : 'comment';
    }
    if (stream.match('/*')) {
      state.inBlockComment = true;
      return blockComment(stream, state);
    }

    // Inside annotation(...): everything is dimmed, only structure is tracked.
    if (state.annotationDepth > 0) {
      if (stream.match(STRING_RE) || stream.match(UNTERMINATED_STRING_RE)) return 'meta';
      if (stream.eat('(')) {
        state.annotationDepth++;
        return 'meta';
      }
      if (stream.eat(')')) {
        state.annotationDepth--;
        return 'meta';
      }
      if (!stream.match(/^[^()"\s/]+/)) stream.next();
      return 'meta';
    }

    if (state.pendingAnnotation) {
      state.pendingAnnotation = false;
      if (stream.eat('(')) {
        state.annotationDepth = 1;
        return 'meta';
      }
    }

    if (stream.match(STRING_RE) || stream.match(UNTERMINATED_STRING_RE)) return 'string';
    if (stream.match(NUMBER_RE)) return 'number';

    const ident = stream.match(IDENT_RE);
    if (ident) {
      const word = stream.current();
      if (word === 'annotation') {
        state.pendingAnnotation = true;
        return 'meta';
      }
      if (word === 'true' || word === 'false') return 'atom';
      if (MODELICA_KEYWORDS.has(word)) return 'keyword';
      if (MODELICA_TYPES.has(word)) return 'typeName';
      if (MODELICA_BUILTINS.has(word) && stream.peek() === '(') return 'builtin';
      if (/^[A-Z]/.test(word)) return 'className';
      return 'variableName';
    }

    if (stream.match(OPERATOR_RE)) return 'operator';
    if (stream.match(PUNCT_RE)) return 'punctuation';
    stream.next();
    return null;
  },
  languageData: {
    name: 'modelica',
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
    closeBrackets: { brackets: ['(', '[', '{', '"'] },
    indentOnInput: /^\s*(?:end|else|elseif|elsewhen|equation|algorithm|protected|public)\b/,
    wordChars: '_',
  },
};

export const modelicaLanguage = StreamLanguage.define(parser);

export const modelicaHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--code-keyword)', fontWeight: '500' },
  { tag: t.string, color: 'var(--code-string)' },
  { tag: t.number, color: 'var(--code-number)' },
  { tag: t.comment, color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: t.typeName, color: 'var(--code-type)' },
  { tag: t.className, color: 'var(--code-class)' },
  { tag: t.atom, color: 'var(--code-atom)' },
  { tag: t.meta, color: 'var(--code-annotation)' },
  { tag: t.operator, color: 'var(--code-operator)' },
  { tag: t.punctuation, color: 'var(--code-punctuation)' },
  { tag: t.standard(t.variableName), color: 'var(--code-builtin)' },
  { tag: t.variableName, color: 'var(--code-variable)' },
]);

/** Language support bundle: `[modelica()]` in EditorState extensions. */
export function modelica(): LanguageSupport {
  return new LanguageSupport(modelicaLanguage, [syntaxHighlighting(modelicaHighlightStyle)]);
}
