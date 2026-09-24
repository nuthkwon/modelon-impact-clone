/**
 * Abstract syntax tree for the Modelica subset supported by this platform.
 *
 * Supported: stored definitions (`within`), class definitions (package, model, block,
 * connector, record, type, function-declaration only), short class definitions
 * (`type Voltage = Real(unit="V");`), extends clauses with modifications, imports,
 * component declarations with prefixes and modifications, equation / initial equation
 * sections (equality, connect, if, for, when, call), expressions (arithmetic, logical,
 * relational, if-expressions, function calls with positional + named args, array literals,
 * ranges, component references with subscripts), annotations (kept as modifications and
 * interpreted later by `graphics.ts`).
 *
 * Every node carries an optional `loc` for diagnostics and editor navigation.
 */

export interface SourceLoc {
  /** 1-based line of the first character. */
  line: number;
  /** 1-based column of the first character. */
  column: number;
  /** 0-based offset from the start of the file. */
  offset: number;
  /** Length in characters. */
  length: number;
}

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

export type BinaryOp =
  | '+' | '-' | '*' | '/' | '^'
  | '.+' | '.-' | '.*' | './' | '.^'
  | '==' | '<>' | '<' | '<=' | '>' | '>='
  | 'and' | 'or';

export type UnaryOp = '-' | '+' | 'not';

export interface RefPart {
  name: string;
  subscripts?: Expr[];
}

export type Expr =
  | { kind: 'number'; value: number; loc?: SourceLoc }
  | { kind: 'string'; value: string; loc?: SourceLoc }
  | { kind: 'boolean'; value: boolean; loc?: SourceLoc }
  /** Component / class reference, e.g. `resistor.p.v` or `Modelica.Constants.pi`. A leading `.` marks a global lookup. */
  | { kind: 'ref'; parts: RefPart[]; global?: boolean; loc?: SourceLoc }
  | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr; loc?: SourceLoc }
  | { kind: 'unary'; op: UnaryOp; operand: Expr; loc?: SourceLoc }
  /** Function call: `der(x)`, `sin(w*time)`, `Rectangle(extent=..., lineColor=...)`. */
  | { kind: 'call'; callee: string; args: Expr[]; namedArgs: NamedArg[]; loc?: SourceLoc }
  /** `if c1 then e1 elseif c2 then e2 else e3` */
  | { kind: 'if'; branches: { cond: Expr; value: Expr }[]; else: Expr; loc?: SourceLoc }
  /** `{a, b, c}` or `{{1,2},{3,4}}` */
  | { kind: 'array'; elements: Expr[]; loc?: SourceLoc }
  /** `1:n` or `1:2:n` */
  | { kind: 'range'; start: Expr; step?: Expr; end: Expr; loc?: SourceLoc }
  /** The `end` keyword inside a subscript. */
  | { kind: 'end'; loc?: SourceLoc }
  /**
   * `e for i in r, j in s` — the body of an array constructor (`{e for i in r}`, stored as the
   * only element of an `array`) or a reduction argument (`sum(e for i in r)`, the only positional
   * argument of a `call`). Parsed so libraries using it load; the flattener rejects it.
   */
  | { kind: 'iterator'; body: Expr; iterators: ForIterator[]; loc?: SourceLoc };

/** `i in 1:n`; the range may be omitted (`for i` — deduced from the body). */
export interface ForIterator {
  name: string;
  range?: Expr;
}

export interface NamedArg {
  name: string;
  value: Expr;
}

// ---------------------------------------------------------------------------
// Modifications & annotations
// ---------------------------------------------------------------------------

/**
 * `(a = 1, b(start = 2), c = {1,2})` and/or ` = expr`.
 * Annotations are represented as a Modification whose `mods` are the annotation entries
 * (e.g. `Icon`, `Diagram`, `Placement`, `Line`, `Documentation`, `experiment`).
 */
export interface Modification {
  /** The `= expr` binding, if present. */
  value?: Expr;
  /** Nested element modifications. */
  mods: Modifier[];
  loc?: SourceLoc;
}

export interface Modifier {
  /** Dotted path allowed: `R`, `v.start`. */
  name: string;
  modification: Modification;
  each?: boolean;
  final?: boolean;
  /** For `redeclare` element modifications we keep only the type name and drop the rest. */
  redeclare?: { typeName: string };
  loc?: SourceLoc;
}

// ---------------------------------------------------------------------------
// Class & component definitions
// ---------------------------------------------------------------------------

export type ClassRestriction =
  | 'package' | 'model' | 'block' | 'connector' | 'record' | 'type' | 'function' | 'operator' | 'class';

export interface ComponentPrefixes {
  flow: boolean;
  stream: boolean;
  input: boolean;
  output: boolean;
  parameter: boolean;
  constant: boolean;
  discrete: boolean;
  final: boolean;
  inner: boolean;
  outer: boolean;
  replaceable: boolean;
  redeclare: boolean;
  /** `protected` section membership. */
  protected: boolean;
}

export interface ComponentDecl {
  kind: 'component';
  /** Type name as written (may be relative), e.g. `Modelica.Electrical.Analog.Basic.Resistor` or `Real`. */
  typeName: string;
  name: string;
  arrayDims?: Expr[];
  prefixes: ComponentPrefixes;
  /** Includes the `= value` binding as `modification.value`. */
  modification?: Modification;
  /** Conditional component: `Resistor r if useR;` */
  condition?: Expr;
  /** The string comment ("description"). */
  description?: string;
  /** Component annotation (e.g. `Placement`). */
  annotation?: Modification;
  loc?: SourceLoc;
}

export interface ExtendsClause {
  kind: 'extends';
  typeName: string;
  modification?: Modification;
  annotation?: Modification;
  protected: boolean;
  loc?: SourceLoc;
}

export interface ImportClause {
  kind: 'import';
  /** `import SI = Modelica.Units.SI;` -> alias 'SI', path 'Modelica.Units.SI' */
  alias?: string;
  path: string;
  /** `import Modelica.Math.*;` */
  wildcard: boolean;
  /** `import Modelica.Math.{sin, cos};` */
  names?: string[];
  loc?: SourceLoc;
}

export type Equation =
  | { kind: 'equals'; left: Expr; right: Expr; description?: string; annotation?: Modification; loc?: SourceLoc }
  | { kind: 'connect'; a: Expr; b: Expr; description?: string; annotation?: Modification; loc?: SourceLoc }
  | { kind: 'if'; branches: { cond: Expr; equations: Equation[] }[]; else: Equation[]; loc?: SourceLoc }
  | { kind: 'for'; indices: { name: string; range: Expr }[]; equations: Equation[]; loc?: SourceLoc }
  | { kind: 'when'; branches: { cond: Expr; equations: Equation[] }[]; loc?: SourceLoc }
  /** `assert(...)`, `reinit(x, v)`, `terminate(...)` */
  | { kind: 'call'; call: Expr; description?: string; annotation?: Modification; loc?: SourceLoc };

export interface ClassDef {
  kind: 'class';
  restriction: ClassRestriction;
  name: string;
  description?: string;
  partial: boolean;
  encapsulated: boolean;
  expandable: boolean;
  /**
   * Short class definition, e.g. `type Voltage = Real(unit="V");` or
   * `connector RealInput = input Real;`
   */
  /**
   * `redeclare record extends Name(mods) ... end Name;` — an extends class specifier: the class
   * extends the inherited class of the same name. Parsed so libraries using it load; the
   * flattener rejects it.
   */
  classExtends?: { modification?: Modification };
  shortClass?: {
    typeName: string;
    modification?: Modification;
    arrayDims?: Expr[];
    input?: boolean;
    output?: boolean;
    flow?: boolean;
  };
  extends: ExtendsClause[];
  imports: ImportClause[];
  components: ComponentDecl[];
  classes: ClassDef[];
  equations: Equation[];
  initialEquations: Equation[];
  /** Algorithm sections are parsed as opaque text so the pretty-printer can round-trip them. */
  algorithms?: { initial: boolean; text: string }[];
  /** Class annotation: Icon, Diagram, Documentation, experiment, ... */
  annotation?: Modification;
  loc?: SourceLoc;
  /** Location of the class name token, for editor navigation. */
  nameLoc?: SourceLoc;
}

export interface StoredDefinition {
  within?: string;
  classes: ClassDef[];
  /** File path or virtual id the definition was parsed from. */
  file?: string;
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  /** Class or component the diagnostic refers to, e.g. `MyModel.resistor` */
  path?: string;
  file?: string;
  loc?: SourceLoc;
  code?: string;
}

export class ModelicaError extends Error {
  diagnostics: Diagnostic[];
  constructor(message: string, diagnostics: Diagnostic[] = []) {
    super(message);
    this.name = 'ModelicaError';
    this.diagnostics = diagnostics.length ? diagnostics : [{ severity: 'error', message }];
  }
}

// ---------------------------------------------------------------------------
// Helpers for constructing expressions (used by parser, flattener and editors)
// ---------------------------------------------------------------------------

export const E = {
  num(value: number): Expr { return { kind: 'number', value }; },
  str(value: string): Expr { return { kind: 'string', value }; },
  bool(value: boolean): Expr { return { kind: 'boolean', value }; },
  ref(...names: string[]): Expr { return { kind: 'ref', parts: names.map((name) => ({ name })) }; },
  refPath(dotted: string): Expr { return { kind: 'ref', parts: dotted.split('.').map((name) => ({ name })) }; },
  bin(op: BinaryOp, left: Expr, right: Expr): Expr { return { kind: 'binary', op, left, right }; },
  neg(operand: Expr): Expr { return { kind: 'unary', op: '-', operand }; },
  call(callee: string, args: Expr[] = [], namedArgs: NamedArg[] = []): Expr { return { kind: 'call', callee, args, namedArgs }; },
  array(elements: Expr[]): Expr { return { kind: 'array', elements }; },
  point(x: number, y: number): Expr { return { kind: 'array', elements: [E.num(x), E.num(y)] }; },
  points(pts: [number, number][]): Expr { return { kind: 'array', elements: pts.map(([x, y]) => E.point(x, y)) }; },
};

/** Returns the dotted name of a `ref` expression without subscripts, or undefined. */
export function refToDotted(e: Expr): string | undefined {
  if (e.kind !== 'ref') return undefined;
  return e.parts.map((p) => p.name).join('.');
}
