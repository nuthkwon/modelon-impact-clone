/**
 * Canonical Modelica pretty-printer.
 *
 * Formatting rules (see docs/ARCHITECTURE.md "Text as source of truth"):
 * - `within A.B;` followed by a blank line; 2-space indentation per nesting level.
 * - One element per line: `<prefixes> Type name[dims](mods) = value if cond "desc" annotation(...);`
 *   the annotation stays on the same line when it is short (<= 60 characters), otherwise it moves to a
 *   continuation line indented by one level.
 * - `connect(a, b) annotation(Line(...));` always on one line; `points` arrays are never broken.
 * - The class annotation is printed as `annotation (` … `);` before `end Name;` with each top-level entry
 *   (Icon, Diagram, Documentation, experiment, ...) on its own line and `graphics={...}` items one per line.
 * - Expressions use minimal parentheses respecting Modelica precedence; numbers use at most 15 significant
 *   digits; algorithm sections are re-emitted verbatim (re-indented).
 *
 * Round-trip guarantee: `parse(print(parse(text)))` is structurally equal to `parse(text)` ignoring `loc`.
 */
import type { ClassDef, ComponentDecl, Equation, Expr, Modification, Modifier, StoredDefinition } from '../ast.js';

export interface PrintOptions {
  indent?: string;
}

const DEFAULT_INDENT = '  ';
const SHORT_ANNOTATION = 60;

// -------------------------------------------------------------------------------------------------
// Literals
// -------------------------------------------------------------------------------------------------

const STRING_ESCAPES: Record<string, string> = {
  '\\': '\\\\', '"': '\\"', '\x07': '\\a', '\b': '\\b', '\f': '\\f', '\r': '\\r', '\v': '\\v',
};

/** Quotes a string literal. Newlines and tabs are kept verbatim (Modelica strings may span lines). */
export function printString(s: string): string {
  return `"${s.replace(/[\\"\x07\b\f\r\v]/g, (ch) => STRING_ESCAPES[ch])}"`;
}

/** Prints a number with at most 15 significant digits (`1`, `0.5`, `1e-7`, never `1.0000000000000002`). */
export function printNumber(v: number): string {
  if (Number.isNaN(v)) return '0';
  if (!Number.isFinite(v)) return v > 0 ? '1e308' : '-1e308';
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(15)));
}

// -------------------------------------------------------------------------------------------------
// Expressions
// -------------------------------------------------------------------------------------------------

/** Binding strength: higher binds tighter. */
function precedence(e: Expr): number {
  switch (e.kind) {
    case 'if':
      return 0;
    case 'range':
      return 1;
    case 'binary':
      switch (e.op) {
        case 'or': return 2;
        case 'and': return 3;
        case '<': case '<=': case '>': case '>=': case '==': case '<>': return 5;
        case '+': case '-': case '.+': case '.-': return 6;
        case '*': case '/': case '.*': case './': return 7;
        case '^': case '.^': return 9;
      }
      return 9;
    case 'unary':
      return e.op === 'not' ? 4 : 8;
    case 'number':
      return e.value < 0 ? 8 : 10;
    default:
      return 10;
  }
}

function isNegative(e: Expr): boolean {
  return (e.kind === 'unary' && e.op !== 'not') || (e.kind === 'number' && e.value < 0);
}

function paren(s: string, needed: boolean): string {
  return needed ? `(${s})` : s;
}

export function printExpr(e: Expr): string {
  switch (e.kind) {
    case 'number':
      return printNumber(e.value);
    case 'string':
      return printString(e.value);
    case 'boolean':
      return e.value ? 'true' : 'false';
    case 'end':
      return 'end';
    case 'ref':
      return (e.global ? '.' : '') + e.parts
        .map((p) => p.name + (p.subscripts && p.subscripts.length ? `[${p.subscripts.map(printExpr).join(',')}]` : ''))
        .join('.');
    case 'call': {
      const args = [...e.args.map(printExpr), ...e.namedArgs.map((a) => `${a.name}=${printExpr(a.value)}`)];
      return `${e.callee}(${args.join(', ')})`;
    }
    case 'array':
      return `{${e.elements.map(printExpr).join(',')}}`;
    case 'range': {
      const part = (x: Expr) => paren(printExpr(x), precedence(x) <= 1);
      return e.step ? `${part(e.start)}:${part(e.step)}:${part(e.end)}` : `${part(e.start)}:${part(e.end)}`;
    }
    case 'if': {
      const parts = e.branches.map((b, i) => `${i === 0 ? 'if' : 'elseif'} ${printExpr(b.cond)} then ${printExpr(b.value)}`);
      return `${parts.join(' ')} else ${printExpr(e.else)}`;
    }
    case 'unary': {
      if (e.op === 'not') return `not ${paren(printExpr(e.operand), precedence(e.operand) < 10)}`;
      const needed = precedence(e.operand) < 8 || isNegative(e.operand);
      return `${e.op}${paren(printExpr(e.operand), needed)}`;
    }
    case 'binary': {
      const p = precedence(e);
      const lp = precedence(e.left);
      const rp = precedence(e.right);
      const relational = p === 5;
      const power = p === 9;
      const leftParens = lp < p || (lp === p && (relational || power));
      const rightParens = rp <= p || isNegative(e.right);
      const left = paren(printExpr(e.left), leftParens);
      const right = paren(printExpr(e.right), rightParens);
      const spaced = p <= 6; // and/or, relational, additive get spaces; * / ^ do not
      return spaced ? `${left} ${e.op} ${right}` : `${left}${e.op}${right}`;
    }
  }
}

// -------------------------------------------------------------------------------------------------
// Modifications
// -------------------------------------------------------------------------------------------------

function modifierPrefix(m: Modifier): string {
  let s = '';
  if (m.redeclare) s += 'redeclare ';
  if (m.each) s += 'each ';
  if (m.final) s += 'final ';
  return s;
}

/** `each final name(mods) = value`, `redeclare Type name` — one argument of a modification list. */
export function printModifier(m: Modifier): string {
  if (m.redeclare) return `${modifierPrefix(m)}${m.redeclare.typeName} ${m.name}`;
  const { mods, value } = m.modification;
  let s = modifierPrefix(m) + m.name;
  if (mods.length) s += `(${mods.map(printModifier).join(', ')})`;
  if (value) s += mods.length ? ` = ${printExpr(value)}` : `=${printExpr(value)}`;
  return s;
}

/** Prints `(a=1, b(start=2))` including the parentheses; the `= value` part is printed as ` = value`. */
export function printModification(m: Modification): string {
  let s = '';
  if (m.mods.length) s += `(${m.mods.map(printModifier).join(', ')})`;
  if (m.value) s += ` = ${printExpr(m.value)}`;
  return s;
}

/** `annotation(Placement(...))` as a single line. */
function printInlineAnnotation(m: Modification): string {
  return `annotation(${m.mods.map(printModifier).join(', ')})`;
}

/**
 * Multi-line class annotation:
 * ```
 * annotation (
 *   Icon(coordinateSystem(...), graphics={
 *     Rectangle(...),
 *     Line(...)}),
 *   Documentation(info="..."));
 * ```
 */
function printClassAnnotation(ann: Modification, pad: string, indent: string): string[] {
  if (!ann.mods.length) return [`${pad}annotation ();`];
  const inner = pad + indent;
  const entries = ann.mods.map((m) => inner + printAnnotationEntry(m, inner, indent));
  entries[entries.length - 1] += ');';
  for (let i = 0; i < entries.length - 1; i++) entries[i] += ',';
  return [`${pad}annotation (`, ...entries];
}

function printAnnotationEntry(m: Modifier, pad: string, indent: string): string {
  const graphics = m.modification.mods.find((x) => x.name === 'graphics' && x.modification.value?.kind === 'array' && x.modification.value.elements.length > 0);
  if (m.redeclare || !graphics) return printModifier(m);
  const items = (graphics.modification.value as Extract<Expr, { kind: 'array' }>).elements;
  const parts = m.modification.mods.map((sub) => {
    if (sub !== graphics) return printModifier(sub);
    return `graphics={\n${items.map((item) => pad + indent + printExpr(item)).join(',\n')}}`;
  });
  let s = `${modifierPrefix(m)}${m.name}(${parts.join(', ')})`;
  if (m.modification.value) s += ` = ${printExpr(m.modification.value)}`;
  return s;
}

// -------------------------------------------------------------------------------------------------
// Classes
// -------------------------------------------------------------------------------------------------

const PREFIX_ORDER: (keyof ComponentDecl['prefixes'])[] = [
  'redeclare', 'final', 'inner', 'outer', 'replaceable', 'flow', 'stream', 'discrete', 'parameter', 'constant', 'input', 'output',
];

function componentPrefixes(c: ComponentDecl): string {
  return PREFIX_ORDER.filter((k) => c.prefixes[k]).map((k) => `${k} `).join('');
}

function withAnnotation(line: string, ann: Modification | undefined, pad: string, indent: string): string {
  if (!ann) return `${line};`;
  const text = printInlineAnnotation(ann);
  if (text.length <= SHORT_ANNOTATION) return `${line} ${text};`;
  return `${line}\n${pad}${indent}${text};`;
}

function printComponent(c: ComponentDecl, pad: string, indent: string): string {
  let line = pad + componentPrefixes(c) + c.typeName + ' ' + c.name;
  if (c.arrayDims && c.arrayDims.length) line += `[${c.arrayDims.map(printExpr).join(',')}]`;
  if (c.modification) line += printModification(c.modification);
  if (c.condition) line += ` if ${printExpr(c.condition)}`;
  if (c.description !== undefined) line += ` ${printString(c.description)}`;
  return withAnnotation(line, c.annotation, pad, indent);
}

function printEquation(eq: Equation, pad: string, indent: string, out: string[]): void {
  const inner = pad + indent;
  const tail = (description?: string, annotation?: Modification) =>
    (description !== undefined ? ` ${printString(description)}` : '') + (annotation ? ` ${printInlineAnnotation(annotation)}` : '') + ';';
  switch (eq.kind) {
    case 'equals':
      out.push(`${pad}${printExpr(eq.left)} = ${printExpr(eq.right)}${tail(eq.description, eq.annotation)}`);
      return;
    case 'connect':
      out.push(`${pad}connect(${printExpr(eq.a)}, ${printExpr(eq.b)})${tail(eq.description, eq.annotation)}`);
      return;
    case 'call':
      out.push(`${pad}${printExpr(eq.call)}${tail(eq.description, eq.annotation)}`);
      return;
    case 'if':
      eq.branches.forEach((b, i) => {
        out.push(`${pad}${i === 0 ? 'if' : 'elseif'} ${printExpr(b.cond)} then`);
        for (const e of b.equations) printEquation(e, inner, indent, out);
      });
      if (eq.else.length) {
        out.push(`${pad}else`);
        for (const e of eq.else) printEquation(e, inner, indent, out);
      }
      out.push(`${pad}end if;`);
      return;
    case 'for':
      out.push(`${pad}for ${eq.indices.map((i) => `${i.name} in ${printExpr(i.range)}`).join(', ')} loop`);
      for (const e of eq.equations) printEquation(e, inner, indent, out);
      out.push(`${pad}end for;`);
      return;
    case 'when':
      eq.branches.forEach((b, i) => {
        out.push(`${pad}${i === 0 ? 'when' : 'elsewhen'} ${printExpr(b.cond)} then`);
        for (const e of b.equations) printEquation(e, inner, indent, out);
      });
      out.push(`${pad}end when;`);
      return;
  }
}

function classHeader(cls: ClassDef): string {
  let s = '';
  if (cls.encapsulated) s += 'encapsulated ';
  if (cls.partial) s += 'partial ';
  if (cls.expandable && cls.restriction === 'connector') s += 'expandable ';
  s += `${cls.restriction} ${cls.name}`;
  return s;
}

function printShortClass(cls: ClassDef, pad: string): string {
  const sc = cls.shortClass!;
  let line = `${pad}${classHeader(cls)} = `;
  if (sc.typeName === 'enumeration') {
    const literals = (sc.modification?.mods ?? []).map((m) => {
      const v = m.modification.value;
      return v && v.kind === 'string' ? `${m.name} ${printString(v.value)}` : m.name;
    });
    line += `enumeration(${literals.join(', ')})`;
  } else {
    if (sc.input) line += 'input ';
    if (sc.output) line += 'output ';
    if (sc.flow) line += 'flow ';
    line += sc.typeName;
    if (sc.arrayDims && sc.arrayDims.length) line += `[${sc.arrayDims.map(printExpr).join(',')}]`;
    if (sc.modification) line += printModification(sc.modification);
  }
  if (cls.description !== undefined) line += ` ${printString(cls.description)}`;
  if (cls.annotation) line += ` ${printInlineAnnotation(cls.annotation)}`;
  return `${line};`;
}

function printClassLines(cls: ClassDef, pad: string, indent: string): string[] {
  if (cls.shortClass) return [printShortClass(cls, pad)];
  const out: string[] = [];
  const inner = pad + indent;
  out.push(pad + classHeader(cls) + (cls.description !== undefined ? ` ${printString(cls.description)}` : ''));

  let isProtected = false;
  const section = (wantProtected: boolean) => {
    if (wantProtected === isProtected) return;
    isProtected = wantProtected;
    out.push(`${pad}${wantProtected ? 'protected' : 'public'}`);
  };
  const blank = () => {
    if (out.length && out[out.length - 1] !== '') out.push('');
  };

  for (const imp of cls.imports) {
    let s = 'import ';
    if (imp.alias) s += `${imp.alias} = ${imp.path}`;
    else if (imp.wildcard) s += `${imp.path}.*`;
    else if (imp.names) s += `${imp.path}.{${imp.names.join(', ')}}`;
    else s += imp.path;
    out.push(`${inner}${s};`);
  }
  for (const ext of cls.extends) {
    section(ext.protected);
    const line = `${inner}extends ${ext.typeName}${ext.modification ? printModification(ext.modification) : ''}`;
    out.push(withAnnotation(line, ext.annotation, inner, indent));
  }
  if (cls.classes.length) {
    section(false);
    for (const nested of cls.classes) {
      blank();
      out.push(...printClassLines(nested, inner, indent));
    }
    if (cls.components.length) blank();
  }
  for (const c of cls.components) {
    section(c.prefixes.protected);
    out.push(printComponent(c, inner, indent));
  }
  if (cls.initialEquations.length) {
    out.push(`${pad}initial equation`);
    for (const eq of cls.initialEquations) printEquation(eq, inner, indent, out);
  }
  if (cls.equations.length) {
    out.push(`${pad}equation`);
    for (const eq of cls.equations) printEquation(eq, inner, indent, out);
  }
  for (const alg of cls.algorithms ?? []) {
    out.push(`${pad}${alg.initial ? 'initial algorithm' : 'algorithm'}`);
    for (const line of alg.text.split('\n')) out.push(line === '' ? '' : inner + line);
  }
  if (cls.annotation) out.push(...printClassAnnotation(cls.annotation, inner, indent));
  out.push(`${pad}end ${cls.name};`);
  return out;
}

export function printClass(cls: ClassDef, opts?: PrintOptions): string {
  return printClassLines(cls, '', opts?.indent ?? DEFAULT_INDENT).join('\n');
}

/** Canonical pretty-printer. `parse(print(parse(text)))` must equal `parse(text)` structurally. */
export function printStoredDefinition(def: StoredDefinition, opts?: PrintOptions): string {
  const indent = opts?.indent ?? DEFAULT_INDENT;
  const parts: string[] = [];
  if (def.within) parts.push(`within ${def.within};\n`);
  for (const cls of def.classes) parts.push(`${printClassLines(cls, '', indent).join('\n')}\n`);
  return parts.join('\n');
}
