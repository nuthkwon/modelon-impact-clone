/**
 * Recursive-descent parser for the Modelica subset described in docs/ARCHITECTURE.md.
 *
 * Representation notes (no AST changes were needed; these sentinels are documented here):
 * - Output tuples `(a, b) = f(x)` are represented as a `call` expression with an empty
 *   `callee` (`''`) whose `args` are the tuple elements. The printer prints them back as `(a, b)`.
 * - A bare `:` subscript (`Real x[:]`) is represented as a `ref` whose single part is named `':'`.
 * - Matrices `[1, 2; 3, 4]` are represented as nested `array` literals `{{1,2},{3,4}}`.
 * - Enumeration literals of `type E = enumeration(a "desc", b)` are Modifiers named `a`, `b` with an
 *   empty modification; a literal description is kept as a `string` expression in `modification.value`.
 * - `redeclare` element modifications keep only the type name and the element name.
 * - Algorithm sections are stored as opaque text (dedented, comments included); `external` bodies,
 *   `constrainedby` clauses and class prefixes without an AST field (`final`, `replaceable`, `inner`,
 *   `outer`, `pure`, `impure`) are parsed and dropped.
 */
import {
  ModelicaError,
  type BinaryOp,
  type ClassDef,
  type ClassRestriction,
  type ComponentDecl,
  type ComponentPrefixes,
  type Equation,
  type Expr,
  type ExtendsClause,
  type ForIterator,
  type ImportClause,
  type Modification,
  type Modifier,
  type NamedArg,
  type RefPart,
  type SourceLoc,
  type StoredDefinition,
} from '../ast.js';
import { tokenize, type Token } from './lexer.js';

const CLASS_START_KEYWORDS = new Set([
  'class', 'model', 'record', 'block', 'connector', 'type', 'package', 'function', 'operator', 'expandable',
  'encapsulated', 'partial', 'pure', 'impure',
]);
const TYPE_PREFIX_KEYWORDS = new Set(['flow', 'stream', 'discrete', 'parameter', 'constant', 'input', 'output']);
const RELATIONAL_OPS = new Set(['<', '<=', '>', '>=', '==', '<>']);
const ADDITIVE_OPS = new Set(['+', '-', '.+', '.-']);
const MULTIPLICATIVE_OPS = new Set(['*', '/', '.*', './']);
/** Keywords that terminate an equation section (besides `end` and `annotation`). */
const SECTION_KEYWORDS = new Set(['equation', 'algorithm', 'initial', 'public', 'protected', 'external']);

function span(start: SourceLoc, end: SourceLoc): SourceLoc {
  return { line: start.line, column: start.column, offset: start.offset, length: Math.max(0, end.offset + end.length - start.offset) };
}

function emptyPrefixes(): ComponentPrefixes {
  return {
    flow: false, stream: false, input: false, output: false, parameter: false, constant: false, discrete: false,
    final: false, inner: false, outer: false, replaceable: false, redeclare: false, protected: false,
  };
}

/** Normalises raw algorithm text: trims blank lines at both ends, strips common indentation, right-trims lines. */
function normalizeAlgorithmText(raw: string): string {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
  while (lines.length && lines[0] === '') lines.shift();
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  let indent = Infinity;
  for (const l of lines) {
    if (l === '') continue;
    const m = /^\s*/.exec(l)!;
    indent = Math.min(indent, m[0].length);
  }
  if (!isFinite(indent) || indent === 0) return lines.join('\n');
  return lines.map((l) => (l === '' ? '' : l.slice(indent))).join('\n');
}

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[], private readonly text: string, private readonly file?: string) {}

  // ---------------------------------------------------------------------------------------------
  // Token helpers
  // ---------------------------------------------------------------------------------------------

  peek(k = 0): Token {
    return this.tokens[Math.min(this.pos + k, this.tokens.length - 1)];
  }

  next(): Token {
    const t = this.peek();
    if (t.kind !== 'eof') this.pos++;
    return t;
  }

  private last(): Token {
    return this.tokens[Math.max(0, this.pos - 1)];
  }

  isEof(): boolean {
    return this.peek().kind === 'eof';
  }

  isOp(value: string, k = 0): boolean {
    const t = this.peek(k);
    return t.kind === 'op' && t.value === value;
  }

  isKw(value: string, k = 0): boolean {
    const t = this.peek(k);
    return t.kind === 'keyword' && t.value === value;
  }

  isIdent(k = 0): boolean {
    return this.peek(k).kind === 'ident';
  }

  acceptOp(value: string): boolean {
    if (this.isOp(value)) {
      this.pos++;
      return true;
    }
    return false;
  }

  acceptKw(value: string): boolean {
    if (this.isKw(value)) {
      this.pos++;
      return true;
    }
    return false;
  }

  describe(t: Token): string {
    switch (t.kind) {
      case 'eof':
        return 'end of file';
      case 'string': {
        const v = t.value.length > 30 ? `${t.value.slice(0, 30)}...` : t.value;
        return `'"${v.replace(/\n/g, '\\n')}"'`;
      }
      default:
        return `'${t.value}'`;
    }
  }

  fail(message: string, tok: Token = this.peek()): never {
    const full = `${message} (line ${tok.loc.line}, column ${tok.loc.column})`;
    throw new ModelicaError(full, [{ severity: 'error', message: full, file: this.file, loc: tok.loc }]);
  }

  private expected(what: string, context?: string, tok: Token = this.peek()): never {
    return this.fail(`Expected ${what}${context ? ` ${context}` : ''} but found ${this.describe(tok)}`, tok);
  }

  expectOp(value: string, context?: string): Token {
    if (!this.isOp(value)) this.expected(`'${value}'`, context);
    return this.next();
  }

  expectKw(value: string, context?: string): Token {
    if (!this.isKw(value)) this.expected(`'${value}'`, context);
    return this.next();
  }

  expectIdent(context?: string): Token {
    if (!this.isIdent()) this.expected('identifier', context);
    return this.next();
  }

  expectEof(context: string): void {
    if (!this.isEof()) this.expected('end of input', context);
  }

  // ---------------------------------------------------------------------------------------------
  // Stored definition & classes
  // ---------------------------------------------------------------------------------------------

  parseStoredDefinition(): StoredDefinition {
    const def: StoredDefinition = { classes: [] };
    if (this.acceptKw('within')) {
      if (!this.isOp(';')) def.within = this.parseName('as package name after \'within\'');
      this.expectOp(';', "after 'within' clause");
    }
    while (!this.isEof()) {
      const start = this.peek();
      this.acceptKw('final');
      if (!this.isClassStart()) this.expected('class definition', undefined);
      const cls = this.parseClassDefinition(start);
      this.expectOp(';', `after class definition '${cls.name}'`);
      cls.loc = span(start.loc, this.last().loc);
      def.classes.push(cls);
    }
    if (this.file !== undefined) def.file = this.file;
    return def;
  }

  isClassStart(k = 0): boolean {
    const t = this.peek(k);
    return t.kind === 'keyword' && CLASS_START_KEYWORDS.has(t.value);
  }

  /** `[encapsulated] [partial] restriction class-specifier`. `start` is the first token of the element (for `loc`). */
  parseClassDefinition(start: Token): ClassDef {
    let encapsulated = false;
    let partial = false;
    let expandable = false;
    for (;;) {
      if (this.acceptKw('encapsulated')) encapsulated = true;
      else if (this.acceptKw('partial')) partial = true;
      else break;
    }
    let restriction: ClassRestriction;
    const t = this.peek();
    if (t.kind !== 'keyword') this.expected('class restriction (model, package, ...)');
    switch (t.value) {
      case 'class': case 'model': case 'record': case 'block': case 'connector': case 'type': case 'package': case 'function':
        this.next();
        restriction = t.value;
        break;
      case 'expandable':
        this.next();
        this.expectKw('connector', "after 'expandable'");
        restriction = 'connector';
        expandable = true;
        break;
      case 'pure': case 'impure':
        this.next();
        this.acceptKw('operator');
        this.expectKw('function', `after '${t.value}'`);
        restriction = 'function';
        break;
      case 'operator':
        this.next();
        if (this.acceptKw('record')) restriction = 'record';
        else if (this.acceptKw('function')) restriction = 'function';
        else restriction = 'operator';
        break;
      default:
        this.expected('class restriction (model, package, ...)');
    }
    const classExtends = this.acceptKw('extends');
    const nameTok = this.expectIdent('as class name');
    const cls: ClassDef = {
      kind: 'class',
      restriction,
      name: nameTok.value,
      partial,
      encapsulated,
      expandable,
      extends: [],
      imports: [],
      components: [],
      classes: [],
      equations: [],
      initialEquations: [],
    };
    if (classExtends) {
      cls.classExtends = {};
      if (this.isOp('(')) cls.classExtends.modification = this.parseClassModification();
    }
    if (!classExtends && this.acceptOp('=')) {
      this.parseShortClassSpecifier(cls);
    } else {
      const description = this.parseStringComment();
      if (description !== undefined) cls.description = description;
      this.parseComposition(cls);
      this.expectKw('end', `to close class '${cls.name}'`);
      const endName = this.peek();
      if (endName.kind !== 'ident') this.expected(`'end ${cls.name}'`, undefined, endName);
      if (endName.value !== cls.name) this.fail(`Expected 'end ${cls.name}' but found 'end ${endName.value}'`, endName);
      this.next();
    }
    cls.loc = span(start.loc, this.isOp(';') ? this.peek().loc : this.last().loc);
    cls.nameLoc = nameTok.loc;
    return cls;
  }

  /** After `Name =`: `enumeration(...)` or `[input|output|flow] TypeName[dims](mods)`, then comment. */
  private parseShortClassSpecifier(cls: ClassDef): void {
    if (this.isKw('enumeration')) {
      this.next();
      const open = this.expectOp('(', "after 'enumeration'");
      const mods: Modifier[] = [];
      if (!this.acceptOp(':')) {
        while (!this.isOp(')')) {
          const lit = this.expectIdent('as enumeration literal');
          const modifier: Modifier = { name: lit.value, modification: { mods: [] }, loc: lit.loc };
          const desc = this.parseStringComment();
          if (desc !== undefined) modifier.modification.value = { kind: 'string', value: desc, loc: this.last().loc };
          if (this.isKw('annotation')) this.parseAnnotation();
          mods.push(modifier);
          if (!this.acceptOp(',')) break;
        }
      }
      this.expectOp(')', 'to close enumeration literal list');
      cls.shortClass = { typeName: 'enumeration', modification: { mods, loc: span(open.loc, this.last().loc) } };
    } else {
      const sc: NonNullable<ClassDef['shortClass']> = { typeName: '' };
      for (;;) {
        if (this.acceptKw('input')) sc.input = true;
        else if (this.acceptKw('output')) sc.output = true;
        else if (this.acceptKw('flow')) sc.flow = true;
        else break;
      }
      sc.typeName = this.parseName(`as type name in short class definition of '${cls.name}'`);
      if (this.isOp('[')) sc.arrayDims = this.parseArraySubscripts();
      if (this.isOp('(')) sc.modification = this.parseModification();
      cls.shortClass = sc;
    }
    const description = this.parseStringComment();
    if (description !== undefined) cls.description = description;
    if (this.isKw('annotation')) cls.annotation = this.parseAnnotation();
  }

  /** Elements and sections up to (not including) the closing `end`. */
  private parseComposition(cls: ClassDef): void {
    let isProtected = false;
    for (;;) {
      const t = this.peek();
      if (t.kind === 'eof') this.fail(`Expected 'end ${cls.name}' but found end of file`, t);
      if (this.isKw('end')) return;
      if (this.acceptKw('public')) { isProtected = false; continue; }
      if (this.acceptKw('protected')) { isProtected = true; continue; }
      if (this.acceptKw('equation')) { this.parseEquationSection(cls.equations); continue; }
      if (this.isKw('initial') && this.isKw('equation', 1)) { this.next(); this.next(); this.parseEquationSection(cls.initialEquations); continue; }
      if (this.isKw('algorithm')) { this.parseAlgorithmSection(cls, false, this.next()); continue; }
      if (this.isKw('initial') && this.isKw('algorithm', 1)) { this.next(); this.parseAlgorithmSection(cls, true, this.next()); continue; }
      if (this.isKw('external')) { this.skipExternal(); continue; }
      if (this.isKw('annotation')) {
        const ann = this.parseAnnotation();
        cls.annotation = cls.annotation ? mergeModifications(cls.annotation, ann) : ann;
        this.expectOp(';', 'after class annotation');
        continue;
      }
      this.parseElement(cls, isProtected);
    }
  }

  private parseElement(cls: ClassDef, isProtected: boolean): void {
    const start = this.peek();
    if (this.isKw('import')) { cls.imports.push(this.parseImport()); return; }
    if (this.isKw('extends')) { cls.extends.push(this.parseExtends(isProtected)); return; }
    const prefixes = emptyPrefixes();
    prefixes.protected = isProtected;
    for (;;) {
      if (this.acceptKw('redeclare')) prefixes.redeclare = true;
      else if (this.acceptKw('final')) prefixes.final = true;
      else if (this.acceptKw('inner')) prefixes.inner = true;
      else if (this.acceptKw('outer')) prefixes.outer = true;
      else if (this.acceptKw('replaceable')) prefixes.replaceable = true;
      else break;
    }
    if (this.isClassStart()) {
      const nested = this.parseClassDefinition(start);
      if (this.acceptKw('constrainedby')) {
        // The comment after the constraining clause belongs to the element (Modelica §7.3.2).
        const cc = this.skipConstrainingClause();
        if (cc.description !== undefined && nested.description === undefined) nested.description = cc.description;
        if (cc.annotation) nested.annotation = nested.annotation ? mergeModifications(nested.annotation, cc.annotation) : cc.annotation;
      }
      this.expectOp(';', `after class definition '${nested.name}'`);
      nested.loc = span(start.loc, this.last().loc);
      cls.classes.push(nested);
      return;
    }
    this.parseComponentClause(cls, prefixes, start);
  }

  private parseComponentClause(cls: ClassDef, prefixes: ComponentPrefixes, start: Token): void {
    for (;;) {
      const t = this.peek();
      if (t.kind === 'keyword' && TYPE_PREFIX_KEYWORDS.has(t.value)) {
        this.next();
        (prefixes as unknown as Record<string, boolean>)[t.value] = true;
      } else break;
    }
    const t = this.peek();
    if (!(this.isIdent() || this.isOp('.'))) {
      if (t.kind === 'keyword' && SECTION_KEYWORDS.has(t.value)) this.expected('element declaration or section keyword');
      this.expected('type name', 'in component declaration');
    }
    const typeName = this.parseName('as type name in component declaration');
    const typeDims = this.isOp('[') ? this.parseArraySubscripts() : undefined;
    let first = true;
    for (;;) {
      const declStart = first ? start : this.peek();
      first = false;
      const nameTok = this.expectIdent('as component name');
      const decl: ComponentDecl = { kind: 'component', typeName, name: nameTok.value, prefixes: { ...prefixes } };
      const dims = this.isOp('[') ? this.parseArraySubscripts() : undefined;
      if (typeDims || dims) decl.arrayDims = [...(typeDims ?? []), ...(dims ?? [])];
      if (this.isOp('(') || this.isOp('=') || this.isOp(':=')) decl.modification = this.parseModification();
      if (this.acceptKw('if')) decl.condition = this.parseExpression();
      const description = this.parseStringComment();
      if (description !== undefined) decl.description = description;
      if (this.isKw('annotation')) decl.annotation = this.parseAnnotation();
      decl.loc = span(declStart.loc, this.last().loc);
      cls.components.push(decl);
      if (!this.acceptOp(',')) break;
    }
    if (this.acceptKw('constrainedby')) {
      // The comment after the constraining clause belongs to the element (Modelica §7.3.2).
      const cc = this.skipConstrainingClause();
      const decl = cls.components[cls.components.length - 1];
      if (cc.description !== undefined && decl.description === undefined) decl.description = cc.description;
      if (cc.annotation) decl.annotation = decl.annotation ? mergeModifications(decl.annotation, cc.annotation) : cc.annotation;
      decl.loc = span(decl.loc!, this.last().loc);
    }
    this.expectOp(';', 'after component declaration');
  }

  /** `constrainedby Type(mods) "comment" annotation(...)` — the type is dropped, the comment is returned. */
  private skipConstrainingClause(): { description?: string; annotation?: Modification } {
    this.parseName("as type name after 'constrainedby'");
    if (this.isOp('(')) this.parseClassModification();
    const out: { description?: string; annotation?: Modification } = {};
    const description = this.parseStringComment();
    if (description !== undefined) out.description = description;
    if (this.isKw('annotation')) out.annotation = this.parseAnnotation();
    return out;
  }

  /** `external [language] [call] [annotation] ;` — dropped. */
  private skipExternal(): void {
    this.expectKw('external');
    let depth = 0;
    while (!this.isEof()) {
      const t = this.peek();
      if (t.kind === 'op') {
        if (t.value === '(' || t.value === '[' || t.value === '{') depth++;
        else if (t.value === ')' || t.value === ']' || t.value === '}') depth--;
        else if (t.value === ';' && depth <= 0) break;
      }
      this.next();
    }
    this.expectOp(';', "after 'external' clause");
  }

  private parseImport(): ImportClause {
    const start = this.expectKw('import');
    const imp: ImportClause = { kind: 'import', path: '', wildcard: false };
    if (this.isIdent() && this.isOp('=', 1)) {
      imp.alias = this.next().value;
      this.next();
      imp.path = this.parseName("as imported name after '='");
    } else {
      const parts = [this.expectIdent("after 'import'").value];
      for (;;) {
        // `Modelica.Math.*` is lexed as `Modelica` `.` `Math` `.*`
        if (this.acceptOp('.*')) { imp.wildcard = true; break; }
        if (!this.acceptOp('.')) break;
        if (this.acceptOp('*')) { imp.wildcard = true; break; }
        if (this.acceptOp('{')) {
          const names: string[] = [];
          while (!this.isOp('}')) {
            names.push(this.expectIdent('in import list').value);
            if (!this.acceptOp(',')) break;
          }
          this.expectOp('}', 'to close import list');
          imp.names = names;
          break;
        }
        parts.push(this.expectIdent('in import path').value);
      }
      imp.path = parts.join('.');
    }
    this.parseStringComment();
    if (this.isKw('annotation')) this.parseAnnotation();
    this.expectOp(';', 'after import clause');
    imp.loc = span(start.loc, this.last().loc);
    return imp;
  }

  private parseExtends(isProtected: boolean): ExtendsClause {
    const start = this.expectKw('extends');
    const ext: ExtendsClause = { kind: 'extends', typeName: this.parseName("as base class name after 'extends'"), protected: isProtected };
    if (this.isOp('(')) ext.modification = this.parseClassModification();
    this.parseStringComment();
    if (this.isKw('annotation')) ext.annotation = this.parseAnnotation();
    this.expectOp(';', 'after extends clause');
    ext.loc = span(start.loc, this.last().loc);
    return ext;
  }

  /** `[.]IDENT{.IDENT}` */
  parseName(context: string): string {
    let name = this.acceptOp('.') ? '.' : '';
    name += this.expectIdent(context).value;
    while (this.isOp('.') && this.isIdent(1)) {
      this.next();
      name += `.${this.next().value}`;
    }
    return name;
  }

  /** `"a" + "b"` → "ab"; undefined when absent or empty. */
  parseStringComment(): string | undefined {
    if (this.peek().kind !== 'string') return undefined;
    let value = this.next().value;
    while (this.isOp('+') && this.peek(1).kind === 'string') {
      this.next();
      value += this.next().value;
    }
    return value === '' ? undefined : value;
  }

  parseAnnotation(): Modification {
    const start = this.expectKw('annotation');
    const m = this.parseClassModification();
    m.loc = span(start.loc, this.last().loc);
    return m;
  }

  // ---------------------------------------------------------------------------------------------
  // Algorithm sections (opaque)
  // ---------------------------------------------------------------------------------------------

  private parseAlgorithmSection(cls: ClassDef, initial: boolean, algorithmKw: Token): void {
    let depth = 0;
    let atStatementBoundary = true;
    for (;;) {
      const t = this.peek();
      if (t.kind === 'eof') break;
      if (t.kind === 'op') {
        if (t.value === '(' || t.value === '[' || t.value === '{') depth++;
        else if (t.value === ')' || t.value === ']' || t.value === '}') depth = Math.max(0, depth - 1);
      }
      if (depth === 0 && t.kind === 'keyword') {
        if (t.value === 'equation' || t.value === 'algorithm' || t.value === 'public' || t.value === 'protected' || t.value === 'external') break;
        if (t.value === 'initial' && (this.isKw('equation', 1) || this.isKw('algorithm', 1))) break;
        if (t.value === 'annotation' && atStatementBoundary) break;
        if (t.value === 'end' && this.isIdent(1)) break;
      }
      atStatementBoundary = t.kind === 'op' && t.value === ';';
      this.next();
    }
    const from = algorithmKw.loc.offset + algorithmKw.loc.length;
    const to = this.peek().loc.offset;
    const text = normalizeAlgorithmText(this.text.slice(from, to));
    (cls.algorithms ??= []).push({ initial, text });
  }

  // ---------------------------------------------------------------------------------------------
  // Modifications
  // ---------------------------------------------------------------------------------------------

  /** `class-modification [= expr] | = expr | := expr` */
  parseModification(): Modification {
    const start = this.peek();
    const m: Modification = { mods: [] };
    if (this.isOp('(')) m.mods = this.parseArgumentList();
    if (this.acceptOp('=') || this.acceptOp(':=')) m.value = this.parseExpression();
    m.loc = span(start.loc, this.last().loc);
    return m;
  }

  /** `( [argument {, argument}] )` */
  parseClassModification(): Modification {
    const start = this.peek();
    const m: Modification = { mods: this.parseArgumentList() };
    m.loc = span(start.loc, this.last().loc);
    return m;
  }

  private parseArgumentList(): Modifier[] {
    this.expectOp('(', 'to start modification');
    const mods: Modifier[] = [];
    if (this.acceptOp(')')) return mods;
    for (;;) {
      mods.push(this.parseArgument());
      if (this.acceptOp(',')) continue;
      this.expectOp(')', 'to close modification');
      break;
    }
    return mods;
  }

  parseArgument(): Modifier {
    const start = this.peek();
    let each = false;
    let final = false;
    for (;;) {
      if (this.acceptKw('each')) each = true;
      else if (this.acceptKw('final')) final = true;
      else break;
    }
    if (this.isKw('redeclare')) return this.parseRedeclare(start, each, final);
    if (this.isKw('replaceable')) this.fail("'replaceable' inside a modification is only supported after 'redeclare'");
    if (!this.isIdent()) this.expected('modifier name', 'in modification');
    let name = this.next().value;
    while (this.isOp('.') && this.isIdent(1)) {
      this.next();
      name += `.${this.next().value}`;
    }
    const modifier: Modifier = { name, modification: { mods: [] } };
    if (this.isOp('(') || this.isOp('=') || this.isOp(':=')) modifier.modification = this.parseModification();
    this.parseStringComment();
    if (each) modifier.each = true;
    if (final) modifier.final = true;
    modifier.loc = span(start.loc, this.last().loc);
    return modifier;
  }

  /** `redeclare [each] [final] [replaceable] (short-class-definition | component-clause1) [constrainedby ...]` */
  private parseRedeclare(start: Token, each: boolean, final: boolean): Modifier {
    this.expectKw('redeclare');
    for (;;) {
      if (this.acceptKw('each')) each = true;
      else if (this.acceptKw('final')) final = true;
      else if (this.acceptKw('replaceable')) { /* dropped */ }
      else break;
    }
    let name: string;
    let typeName: string;
    if (this.isClassStart()) {
      while (this.isClassStart()) this.next();
      name = this.expectIdent('as class name in redeclaration').value;
      this.expectOp('=', 'in short class redeclaration');
      while (this.acceptKw('input') || this.acceptKw('output')) { /* base prefixes dropped */ }
      typeName = this.parseName('as type name in redeclaration');
      if (this.isOp('[')) this.parseArraySubscripts();
      if (this.isOp('(')) this.parseClassModification();
    } else {
      while (this.peek().kind === 'keyword' && TYPE_PREFIX_KEYWORDS.has(this.peek().value)) this.next();
      typeName = this.parseName('as type name in redeclaration');
      if (this.isOp('[')) this.parseArraySubscripts();
      name = this.expectIdent('as component name in redeclaration').value;
      if (this.isOp('[')) this.parseArraySubscripts();
      if (this.isOp('(') || this.isOp('=') || this.isOp(':=')) this.parseModification();
      if (this.acceptKw('if')) this.parseExpression();
    }
    this.parseStringComment();
    if (this.isKw('annotation')) this.parseAnnotation();
    if (this.acceptKw('constrainedby')) this.skipConstrainingClause();
    const modifier: Modifier = { name, modification: { mods: [] }, redeclare: { typeName } };
    if (each) modifier.each = true;
    if (final) modifier.final = true;
    modifier.loc = span(start.loc, this.last().loc);
    return modifier;
  }

  // ---------------------------------------------------------------------------------------------
  // Equations
  // ---------------------------------------------------------------------------------------------

  private atEquationSectionEnd(): boolean {
    const t = this.peek();
    if (t.kind === 'eof') return true;
    if (t.kind !== 'keyword') return false;
    return t.value === 'end' || t.value === 'annotation' || SECTION_KEYWORDS.has(t.value);
  }

  private parseEquationSection(target: Equation[]): void {
    while (!this.atEquationSectionEnd()) target.push(this.parseEquation());
  }

  private parseEquationBlock(terminators: string[], context: string): Equation[] {
    const out: Equation[] = [];
    for (;;) {
      const t = this.peek();
      if (t.kind === 'eof') this.fail(`Expected 'end ${context}' but found end of file`, t);
      if (t.kind === 'keyword' && terminators.includes(t.value)) return out;
      if (t.kind === 'keyword' && (t.value === 'end' || SECTION_KEYWORDS.has(t.value) || t.value === 'annotation')) {
        this.expected(`'${terminators.map((x) => (x === 'end' ? `end ${context}` : x)).join("' or '")}'`, undefined, t);
      }
      out.push(this.parseEquation());
    }
  }

  parseEquation(): Equation {
    const start = this.peek();
    if (this.isKw('if')) return this.parseIfEquation();
    if (this.isKw('for')) return this.parseForEquation();
    if (this.isKw('when')) return this.parseWhenEquation();
    if (this.isKw('connect')) {
      this.next();
      this.expectOp('(', "after 'connect'");
      const a = this.parseExpression();
      if (a.kind !== 'ref') this.fail('Expected component reference as first connect argument', start);
      this.expectOp(',', 'between connect arguments');
      const b = this.parseExpression();
      if (b.kind !== 'ref') this.fail('Expected component reference as second connect argument', start);
      this.expectOp(')', 'to close connect');
      const eq: Equation = { kind: 'connect', a, b };
      this.finishEquation(eq, 'connect equation');
      eq.loc = span(start.loc, this.last().loc);
      return eq;
    }
    const left = this.parseExpression();
    if (this.acceptOp('=')) {
      const right = this.parseExpression();
      const eq: Equation = { kind: 'equals', left, right };
      this.finishEquation(eq, 'equation');
      eq.loc = span(start.loc, this.last().loc);
      return eq;
    }
    if (left.kind === 'call' && left.callee !== '') {
      const eq: Equation = { kind: 'call', call: left };
      this.finishEquation(eq, 'equation');
      eq.loc = span(start.loc, this.last().loc);
      return eq;
    }
    if (this.isOp(':=')) this.fail("Assignment ':=' is not allowed in an equation section (use an algorithm section)");
    return this.expected("'='", 'after expression in equation');
  }

  /** Parses `"description" annotation(...) ;` into `eq`. */
  private finishEquation(eq: Equation & { description?: string; annotation?: Modification }, what: string): void {
    const description = this.parseStringComment();
    if (description !== undefined) eq.description = description;
    if (this.isKw('annotation')) eq.annotation = this.parseAnnotation();
    this.expectOp(';', `after ${what}`);
  }

  /** `end if/for/when "comment" annotation(...) ;` */
  private finishBlockEquation(keyword: string): void {
    this.expectKw('end', `to close ${keyword}-equation`);
    this.expectKw(keyword, "after 'end'");
    this.parseStringComment();
    if (this.isKw('annotation')) this.parseAnnotation();
    this.expectOp(';', `after 'end ${keyword}'`);
  }

  private parseIfEquation(): Equation {
    const start = this.expectKw('if');
    const branches: { cond: Expr; equations: Equation[] }[] = [];
    let cond = this.parseExpression();
    this.expectKw('then', 'in if-equation');
    branches.push({ cond, equations: this.parseEquationBlock(['elseif', 'else', 'end'], 'if') });
    while (this.acceptKw('elseif')) {
      cond = this.parseExpression();
      this.expectKw('then', "after 'elseif' condition");
      branches.push({ cond, equations: this.parseEquationBlock(['elseif', 'else', 'end'], 'if') });
    }
    const elseEqs = this.acceptKw('else') ? this.parseEquationBlock(['end'], 'if') : [];
    this.finishBlockEquation('if');
    return { kind: 'if', branches, else: elseEqs, loc: span(start.loc, this.last().loc) };
  }

  private parseForEquation(): Equation {
    const start = this.expectKw('for');
    const indices: { name: string; range: Expr }[] = [];
    for (;;) {
      const name = this.expectIdent('as loop variable').value;
      if (!this.isKw('in')) this.fail(`Loop variable '${name}' must have an explicit range ('for ${name} in ...')`);
      this.next();
      indices.push({ name, range: this.parseExpression() });
      if (!this.acceptOp(',')) break;
    }
    this.expectKw('loop', 'in for-equation');
    const equations = this.parseEquationBlock(['end'], 'for');
    this.finishBlockEquation('for');
    return { kind: 'for', indices, equations, loc: span(start.loc, this.last().loc) };
  }

  private parseWhenEquation(): Equation {
    const start = this.expectKw('when');
    const branches: { cond: Expr; equations: Equation[] }[] = [];
    let cond = this.parseExpression();
    this.expectKw('then', 'in when-equation');
    branches.push({ cond, equations: this.parseEquationBlock(['elsewhen', 'end'], 'when') });
    while (this.acceptKw('elsewhen')) {
      cond = this.parseExpression();
      this.expectKw('then', "after 'elsewhen' condition");
      branches.push({ cond, equations: this.parseEquationBlock(['elsewhen', 'end'], 'when') });
    }
    this.finishBlockEquation('when');
    return { kind: 'when', branches, loc: span(start.loc, this.last().loc) };
  }

  // ---------------------------------------------------------------------------------------------
  // Expressions (Modelica §3.2 precedence; `^` right-associative, unary minus binds tighter than `*`)
  // ---------------------------------------------------------------------------------------------

  parseExpression(): Expr {
    if (this.isKw('if')) return this.parseIfExpression();
    return this.parseSimpleExpression();
  }

  private parseIfExpression(): Expr {
    const start = this.expectKw('if');
    const branches: { cond: Expr; value: Expr }[] = [];
    let cond = this.parseExpression();
    this.expectKw('then', 'in if-expression');
    branches.push({ cond, value: this.parseExpression() });
    while (this.acceptKw('elseif')) {
      cond = this.parseExpression();
      this.expectKw('then', "after 'elseif' condition");
      branches.push({ cond, value: this.parseExpression() });
    }
    this.expectKw('else', 'in if-expression');
    const elseValue = this.parseExpression();
    return { kind: 'if', branches, else: elseValue, loc: span(start.loc, this.last().loc) };
  }

  private parseSimpleExpression(): Expr {
    const start = this.peek();
    const first = this.parseLogicalExpression();
    if (!this.isOp(':')) return first;
    this.next();
    const second = this.parseLogicalExpression();
    if (this.acceptOp(':')) {
      const third = this.parseLogicalExpression();
      return { kind: 'range', start: first, step: second, end: third, loc: span(start.loc, this.last().loc) };
    }
    return { kind: 'range', start: first, end: second, loc: span(start.loc, this.last().loc) };
  }

  private binary(op: BinaryOp, left: Expr, right: Expr, start: Token): Expr {
    return { kind: 'binary', op, left, right, loc: span(start.loc, this.last().loc) };
  }

  private parseLogicalExpression(): Expr {
    const start = this.peek();
    let left = this.parseLogicalTerm();
    while (this.acceptKw('or')) left = this.binary('or', left, this.parseLogicalTerm(), start);
    return left;
  }

  private parseLogicalTerm(): Expr {
    const start = this.peek();
    let left = this.parseLogicalFactor();
    while (this.acceptKw('and')) left = this.binary('and', left, this.parseLogicalFactor(), start);
    return left;
  }

  private parseLogicalFactor(): Expr {
    const start = this.peek();
    if (this.acceptKw('not')) {
      const operand = this.parseLogicalFactor();
      return { kind: 'unary', op: 'not', operand, loc: span(start.loc, this.last().loc) };
    }
    return this.parseRelation();
  }

  private parseRelation(): Expr {
    const start = this.peek();
    const left = this.parseArithmetic();
    const t = this.peek();
    if (t.kind === 'op' && RELATIONAL_OPS.has(t.value)) {
      this.next();
      return this.binary(t.value as BinaryOp, left, this.parseArithmetic(), start);
    }
    return left;
  }

  private parseArithmetic(): Expr {
    const start = this.peek();
    let left = this.parseTerm();
    for (;;) {
      const t = this.peek();
      if (t.kind === 'op' && ADDITIVE_OPS.has(t.value)) {
        this.next();
        left = this.binary(t.value as BinaryOp, left, this.parseTerm(), start);
      } else return left;
    }
  }

  private parseTerm(): Expr {
    const start = this.peek();
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.kind === 'op' && MULTIPLICATIVE_OPS.has(t.value)) {
        this.next();
        left = this.binary(t.value as BinaryOp, left, this.parseUnary(), start);
      } else return left;
    }
  }

  private parseUnary(): Expr {
    const start = this.peek();
    if (this.isOp('-') || this.isOp('+')) {
      const op = this.next().value as '-' | '+';
      const operand = this.parseUnary();
      const loc = span(start.loc, this.last().loc);
      // Fold signs on number literals: `-100` is a negative number, not unary minus applied to 100.
      if (operand.kind === 'number') return { kind: 'number', value: op === '-' && operand.value !== 0 ? -operand.value : operand.value, loc };
      return { kind: 'unary', op, operand, loc };
    }
    return this.parseFactor();
  }

  private parseFactor(): Expr {
    const start = this.peek();
    const base = this.parsePrimary();
    if (this.isOp('^') || this.isOp('.^')) {
      const op = this.next().value as '^' | '.^';
      const exponent = this.parseUnary(); // right-associative; allows `2^-1`
      return this.binary(op, base, exponent, start);
    }
    return base;
  }

  private parsePrimary(): Expr {
    const t = this.peek();
    switch (t.kind) {
      case 'number':
        this.next();
        return { kind: 'number', value: Number(t.value), loc: t.loc };
      case 'string':
        this.next();
        return { kind: 'string', value: t.value, loc: t.loc };
      case 'ident':
        return this.parseReferenceOrCall();
      case 'keyword':
        switch (t.value) {
          case 'true': case 'false':
            this.next();
            return { kind: 'boolean', value: t.value === 'true', loc: t.loc };
          case 'end':
            this.next();
            return { kind: 'end', loc: t.loc };
          case 'der': case 'initial': case 'pure': case 'impure':
            if (this.isOp('(', 1)) {
              this.next();
              const { args, namedArgs } = this.parseCallArguments();
              return { kind: 'call', callee: t.value, args, namedArgs, loc: span(t.loc, this.last().loc) };
            }
            break;
          case 'function': {
            this.next();
            const callee = this.parseName("as function name after 'function'");
            const { args, namedArgs } = this.parseCallArguments();
            return { kind: 'call', callee, args, namedArgs, loc: span(t.loc, this.last().loc) };
          }
          case 'if':
            return this.parseIfExpression();
        }
        break;
      case 'op':
        switch (t.value) {
          case '(': {
            this.next();
            if (this.isOp(')')) this.expected('expression', 'inside parentheses');
            const first = this.parseExpression();
            if (this.isOp(',')) {
              const args = [first];
              while (this.acceptOp(',')) args.push(this.parseExpression());
              this.expectOp(')', 'to close output tuple');
              return { kind: 'call', callee: '', args, namedArgs: [], loc: span(t.loc, this.last().loc) };
            }
            this.expectOp(')', 'to close parenthesized expression');
            return first;
          }
          case '{': {
            this.next();
            const elements: Expr[] = [];
            if (!this.isOp('}')) {
              const first = this.parseExpression();
              if (this.isKw('for')) {
                elements.push(this.parseIteratorTail(first));
              } else {
                elements.push(first);
                while (this.acceptOp(',')) elements.push(this.parseExpression());
              }
            }
            this.expectOp('}', 'to close array literal');
            return { kind: 'array', elements, loc: span(t.loc, this.last().loc) };
          }
          case '[': {
            this.next();
            const rows: Expr[] = [];
            if (!this.isOp(']')) {
              for (;;) {
                const rowStart = this.peek();
                const row: Expr[] = [this.parseExpression()];
                while (this.acceptOp(',')) row.push(this.parseExpression());
                rows.push({ kind: 'array', elements: row, loc: span(rowStart.loc, this.last().loc) });
                if (!this.acceptOp(';')) break;
              }
            }
            this.expectOp(']', 'to close matrix literal');
            return { kind: 'array', elements: rows, loc: span(t.loc, this.last().loc) };
          }
          case '.':
            return this.parseReferenceOrCall();
        }
        break;
    }
    return this.expected('expression');
  }

  private parseReferenceOrCall(): Expr {
    const start = this.peek();
    const global = this.acceptOp('.');
    const parts: RefPart[] = [];
    for (;;) {
      const nameTok = this.expectIdent(global && parts.length === 0 ? "after '.'" : undefined);
      const part: RefPart = { name: nameTok.value };
      if (this.isOp('[')) part.subscripts = this.parseArraySubscripts();
      parts.push(part);
      if (this.isOp('.') && this.isIdent(1)) {
        this.next();
        continue;
      }
      break;
    }
    if (this.isOp('(')) {
      // The grammar allows `a[1].f(x)`, but the call node only keeps the callee name; rather
      // than silently dropping the subscripts (and re-printing a different expression) report it.
      if (parts.some((p) => p.subscripts && p.subscripts.length > 0)) {
        this.fail(`Function calls through subscripted component references (${parts.map((p) => (p.subscripts ? `${p.name}[...]` : p.name)).join('.')}(...)) are not supported`, start);
      }
      const callee = (global ? '.' : '') + parts.map((p) => p.name).join('.');
      const { args, namedArgs } = this.parseCallArguments();
      return { kind: 'call', callee, args, namedArgs, loc: span(start.loc, this.last().loc) };
    }
    const ref: Expr = { kind: 'ref', parts, loc: span(start.loc, this.last().loc) };
    if (global) ref.global = true;
    return ref;
  }

  private parseCallArguments(): { args: Expr[]; namedArgs: NamedArg[] } {
    this.expectOp('(', 'to start function arguments');
    const args: Expr[] = [];
    const namedArgs: NamedArg[] = [];
    if (this.acceptOp(')')) return { args, namedArgs };
    for (;;) {
      if (this.isIdent() && this.isOp('=', 1)) {
        const name = this.next().value;
        this.next();
        namedArgs.push({ name, value: this.parseExpression() });
      } else {
        const value = this.parseExpression();
        if (this.isKw('for')) {
          if (args.length || namedArgs.length) this.fail("An iterator argument (f(x for i in ...)) must be the only argument", this.peek());
          args.push(this.parseIteratorTail(value));
          this.expectOp(')', 'to close function arguments');
          break;
        }
        if (namedArgs.length) this.fail('Positional argument after named argument', this.last());
        args.push(value);
      }
      if (this.acceptOp(',')) continue;
      this.expectOp(')', 'to close function arguments');
      break;
    }
    return { args, namedArgs };
  }

  /** After the body expression: `for i in r {, j in s}` (the `in r` part is optional). */
  private parseIteratorTail(body: Expr): Expr {
    this.expectKw('for');
    const iterators: ForIterator[] = [];
    for (;;) {
      const it: ForIterator = { name: this.expectIdent('as iterator name').value };
      if (this.acceptKw('in')) it.range = this.parseExpression();
      iterators.push(it);
      if (!this.acceptOp(',')) break;
    }
    const loc = body.loc ? span(body.loc, this.last().loc) : undefined;
    return { kind: 'iterator', body, iterators, ...(loc ? { loc } : {}) };
  }

  /** `[ subscript {, subscript} ]` where a subscript is an expression or `:`. */
  parseArraySubscripts(): Expr[] {
    this.expectOp('[', 'to start array subscripts');
    const subs: Expr[] = [];
    for (;;) {
      if (this.isOp(':') && (this.isOp(']', 1) || this.isOp(',', 1))) {
        const colon = this.next();
        subs.push({ kind: 'ref', parts: [{ name: ':' }], loc: colon.loc });
      } else {
        subs.push(this.parseExpression());
      }
      if (this.acceptOp(',')) continue;
      this.expectOp(']', 'to close array subscripts');
      break;
    }
    return subs;
  }
}

function mergeModifications(a: Modification, b: Modification): Modification {
  const merged: Modification = { mods: [...a.mods, ...b.mods] };
  const value = b.value ?? a.value;
  if (value) merged.value = value;
  if (a.loc && b.loc) merged.loc = span(a.loc, b.loc);
  return merged;
}

/** Parses a Modelica file. Throws `ModelicaError` with diagnostics on syntax errors. */
export function parse(text: string, file?: string): StoredDefinition {
  const parser = new Parser(tokenize(text, file), text, file);
  return parser.parseStoredDefinition();
}

/** Parses a single expression, e.g. a parameter value typed by the user. */
export function parseExpression(text: string): Expr {
  const parser = new Parser(tokenize(text), text);
  const e = parser.parseExpression();
  parser.expectEof('after expression');
  return e;
}

/**
 * Parses the inside of a modification list, e.g. `R=100, i(start=1)`. Also accepts a full
 * modification with parentheses and/or a binding: `(R=100) = 5`, `= 5`.
 */
export function parseModification(text: string): Modification {
  const parser = new Parser(tokenize(text), text);
  if (parser.isEof()) return { mods: [] };
  if (parser.isOp('(') || parser.isOp('=') || parser.isOp(':=')) {
    const m = parser.parseModification();
    parser.expectEof('after modification');
    return m;
  }
  const mods: Modifier[] = [];
  for (;;) {
    mods.push(parser.parseArgument());
    if (!parser.acceptOp(',')) break;
  }
  parser.expectEof('after modification');
  return { mods };
}
