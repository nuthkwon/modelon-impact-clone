/**
 * Internal data structures of the flattener: the instance tree built by `instantiate.ts`,
 * scoped expressions/modifications, and the shared flattening context.
 */
import { ModelicaError, type ComponentDecl, type Diagnostic, type DiagnosticSeverity, type Equation, type Expr, type SourceLoc } from '../ast.js';
import type { BaseType, Causality, FlatEquation, FlatVariable, Variability } from '../flat.js';
import type { ClassRegistry, RegisteredClass } from '../registry.js';
import type { ConstValue } from './evaluate.js';
import type { FlattenOptions } from './index.js';

/**
 * Where an expression is resolved: `cls` is the class whose source text contains the
 * expression (nested classes, imports and enclosing packages are looked up from there) and
 * `inst` the instance providing the component namespace. `inst` is undefined for a package
 * scope (class-level constants, type attribute modifications).
 */
export interface Scope {
  cls: RegisteredClass;
  inst?: ClassInstance;
}

export interface ScopedExpr {
  expr: Expr;
  scope: Scope;
  final?: boolean;
  loc?: SourceLoc;
}

/** Merged modification of one element: an optional binding and nested element modifications. */
export interface ModEntry {
  value?: ScopedExpr;
  sub: Map<string, ModEntry>;
  final?: boolean;
}

export interface VariableInstance {
  kind: 'variable';
  name: string;
  /** Flat dotted name. */
  path: string;
  parent: ClassInstance;
  decl: ComponentDecl;
  /** Class in which the declaration appears. */
  declaredIn: RegisteredClass;
  type: BaseType;
  /** Fully-qualified name of the declared type. */
  typeName: string;
  enumerationLiterals?: string[];
  variability: Variability;
  causality: Causality;
  flow: boolean;
  protected: boolean;
  binding?: ScopedExpr;
  /** Attribute modifications (`start`, `fixed`, ...), already merged. */
  attributeMods: Map<string, ScopedExpr>;
  /** Flattened binding (phase B; created lazily when a parameter is needed early). */
  flatBinding?: Expr;
  bindingFlattened?: boolean;
  /** Flattened attribute expressions. */
  flatAttributes?: Map<string, Expr>;
  /** Evaluated parameter/constant value. */
  value?: ConstValue;
  /** True when this variable received an `options.modifiers` override. */
  overridden?: boolean;
  flat?: FlatVariable;
}

export interface ScopedEquation {
  eq: Equation;
  scope: Scope;
}

export interface ConnectStatement {
  a: Expr;
  b: Expr;
  scope: Scope;
  loc?: SourceLoc;
}

export interface ClassInstance {
  kind: 'class';
  name: string;
  /** Flat dotted path, '' for the root. */
  path: string;
  parent?: ClassInstance;
  /** The resolved (non short-class) class. */
  cls: RegisteredClass;
  /** Fully-qualified name of the declared type. */
  typeName: string;
  decl?: ComponentDecl;
  declaredIn?: RegisteredClass;
  isConnector: boolean;
  protected: boolean;
  /** `parameter`/`constant` prefix of this component (or an enclosing one): applies to all leaf variables. */
  forcedVariability?: 'parameter' | 'constant';
  components: Map<string, Instance>;
  /** Component names in declaration order (bases first). */
  order: string[];
  /** Names of conditional components that evaluated to false. */
  disabled: Set<string>;
  equations: ScopedEquation[];
  initialEquations: ScopedEquation[];
  /** connect statements written in this instance's class (and bases), collected during equation flattening. */
  connects: ConnectStatement[];
}

export type Instance = VariableInstance | ClassInstance;

export interface Ctx {
  registry: ClassRegistry;
  options: FlattenOptions;
  className: string;
  diagnostics: Diagnostic[];
  /** All variables by flat path. */
  varsByPath: Map<string, VariableInstance>;
  /** Cache of evaluated class-level constants by fully-qualified name. */
  constCache: Map<string, ConstValue>;
  constVisiting: Set<string>;
  /** Parameters currently being evaluated (cycle detection). */
  paramVisiting: Set<string>;
  /** `options.modifiers` names that matched a variable. */
  usedModifiers: Set<string>;
  /** Equations produced from when-clauses assign these variables (they become discrete). */
  whenTargets: Set<string>;
}

export interface DiagOptions {
  path?: string;
  loc?: SourceLoc;
  file?: string;
  code?: string;
}

export function diag(ctx: Ctx, severity: DiagnosticSeverity, message: string, opts: DiagOptions = {}): void {
  ctx.diagnostics.push({ severity, message, ...opts });
}

/** Creates a ModelicaError carrying one error diagnostic with location information. */
export function error(message: string, opts: DiagOptions = {}): ModelicaError {
  return new ModelicaError(message, [{ severity: 'error', message, ...opts }]);
}

/** The file path a class was declared in (for diagnostics). */
export function fileOf(ctx: Ctx, cls: RegisteredClass | undefined): string | undefined {
  if (!cls || cls.builtin) return undefined;
  return ctx.registry.fileOf(cls.fullName)?.path;
}

/** Human-readable origin of an equation declared in `scope`. */
export function originOf(scope: Scope): string {
  const path = scope.inst?.path;
  return path ? `${path} (${scope.cls.fullName})` : scope.cls.fullName;
}

/** Diagnostic path for something inside `scope`: the instance path or the class name. */
export function pathOf(scope: Scope): string {
  return scope.inst?.path || scope.cls.fullName;
}

export function isParamLike(v: { variability: Variability }): boolean {
  return v.variability === 'parameter' || v.variability === 'constant';
}
