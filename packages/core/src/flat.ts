/**
 * Flattened model: the output of instantiation (`flatten.ts`) and the input of the
 * numerical solver (`solver/`). All hierarchy has been removed; variable names are dotted
 * paths (`resistor.p.v`). Connect equations have been expanded into potential-equality
 * and flow-sum equations.
 */
import type { Diagnostic, Expr, SourceLoc } from './ast.js';

export type BaseType = 'Real' | 'Integer' | 'Boolean' | 'String';
export type Variability = 'constant' | 'parameter' | 'discrete' | 'continuous';
export type Causality = 'input' | 'output' | 'none';

export interface VariableAttributes {
  /** Start value / initial guess. Evaluated to a constant where possible. */
  start?: number | boolean | string;
  fixed?: boolean;
  min?: number;
  max?: number;
  nominal?: number;
  unit?: string;
  displayUnit?: string;
  quantity?: string;
  stateSelect?: 'never' | 'avoid' | 'default' | 'prefer' | 'always';
}

export interface FlatVariable {
  /** Flat dotted name, e.g. `resistor.v`. */
  name: string;
  type: BaseType;
  variability: Variability;
  causality: Causality;
  /** True for `flow` connector variables. */
  flow: boolean;
  /** Fully-qualified class name of the declared type, e.g. `Modelica.Units.SI.Voltage`. */
  typeName: string;
  attributes: VariableAttributes;
  description?: string;
  /** Binding expression (`= expr`) in the flat namespace, if any. */
  binding?: Expr;
  /**
   * Evaluated value of parameters/constants (after parameter evaluation). For
   * continuous variables this is undefined.
   */
  value?: number | boolean | string;
  /** True for parameters whose value the user may edit at the top level (declared in the model being simulated, or propagated). */
  protected: boolean;
  /** Component the variable belongs to, e.g. ['resistor'] for `resistor.v`, [] for top-level. */
  componentPath: string[];
  /** The class the variable was declared in. */
  declaredIn: string;
  loc?: SourceLoc;
  file?: string;
}

export type FlatEquationKind =
  | 'equation'
  | 'initial'
  | 'connect-potential'
  | 'connect-flow'
  | 'binding'
  | 'unconnected-flow';

export interface FlatEquation {
  kind: FlatEquationKind;
  /** Equation `left = right`. Flat refs use `{kind:'ref', parts:[{name:'resistor.v'}]}`. */
  left: Expr;
  right: Expr;
  /** Human-readable origin, e.g. `resistor (Modelica.Electrical.Analog.Basic.Resistor)`. */
  origin: string;
  loc?: SourceLoc;
  file?: string;
}

export interface FlatWhenClause {
  /** Boolean condition in flat namespace. */
  cond: Expr;
  /** `reinit(x, expr)` statements and discrete assignments `x = expr`. */
  equations: FlatEquation[];
  origin: string;
}

export interface ExperimentAnnotation {
  StartTime?: number;
  StopTime?: number;
  Interval?: number;
  Tolerance?: number;
}

export interface FlatModel {
  /** Fully-qualified class name that was flattened. */
  className: string;
  variables: FlatVariable[];
  equations: FlatEquation[];
  initialEquations: FlatEquation[];
  whenClauses: FlatWhenClause[];
  experiment?: ExperimentAnnotation;
  diagnostics: Diagnostic[];
  /** Statistics for the log: number of unknowns, equations, states etc. */
  stats: {
    components: number;
    unknowns: number;
    equations: number;
    parameters: number;
    constants: number;
    states: number;
    connections: number;
  };
}

/** Flat reference to a variable by dotted name. */
export function flatRef(name: string): Expr {
  return { kind: 'ref', parts: [{ name }] };
}

export function isFlatRef(e: Expr): e is { kind: 'ref'; parts: [{ name: string }] } {
  return e.kind === 'ref' && e.parts.length === 1 && !e.parts[0].subscripts;
}
