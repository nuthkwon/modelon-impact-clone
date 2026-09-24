/**
 * View model consumed by the diagram canvas and the library browser. Produced by
 * `diagram/` from the AST + class registry (resolving inheritance, placements, icons).
 * Coordinates are in Modelica class coordinates (y up) — the renderer flips them.
 */
import type { Causality } from './flat.js';
import type { ConnectionLine, GraphicsLayer, Placement, Point } from './graphics.js';
import type { ClassRestriction, Diagnostic, Expr, SourceLoc } from './ast.js';

export interface ParameterInfo {
  /** Dotted path relative to the component: `R`, `v.start` */
  name: string;
  /** Fully-qualified type. */
  typeName: string;
  baseType: 'Real' | 'Integer' | 'Boolean' | 'String' | 'enumeration';
  description?: string;
  unit?: string;
  displayUnit?: string;
  /** Default binding as Modelica text (from the class), e.g. `1` or `2*pi*f`. */
  defaultText?: string;
  /** Value currently set by a modifier on the component, as Modelica text. */
  valueText?: string;
  /** Evaluated numeric value if it could be evaluated statically. */
  evaluated?: number | boolean | string;
  /** `final` parameters are read-only. */
  final: boolean;
  /** Which `Dialog(group=..., tab=...)` annotation the parameter belongs to. */
  dialog?: { tab: string; group: string; enable?: boolean };
  /** Enumeration literals for enumeration types. */
  literals?: string[];
  /** true if the parameter is a `constant` (shown but not editable). */
  constant: boolean;
  /** true for parameters with `fixed=false` or evaluated structurally */
  structural?: boolean;
  min?: number;
  max?: number;
  loc?: SourceLoc;
}

export interface VariableInfo {
  /** Dotted path relative to the component. */
  name: string;
  typeName: string;
  description?: string;
  unit?: string;
  causality: Causality;
  variability: 'constant' | 'parameter' | 'discrete' | 'continuous';
  flow: boolean;
  /** true if this variable belongs to a connector component (e.g. `p.v`). */
  inConnector: boolean;
}

export interface PortView {
  /** Connector component name within the owner, e.g. `p` */
  name: string;
  className: string;
  /** Placement resolved on the owner's icon layer (uses iconTransformation when present). */
  placement: Placement;
  icon: GraphicsLayer;
  causality: Causality;
  /** True if the connector class has flow variables (acausal physical connector). */
  physical: boolean;
  /** Domain hint for coloring/snapping, derived from the connector class name. */
  domain: string;
  description?: string;
}

export interface ComponentView {
  name: string;
  /** Fully-qualified class name. */
  className: string;
  /** Short class name for labels. */
  shortClassName: string;
  restriction: ClassRestriction;
  description?: string;
  placement: Placement;
  /** Resolved icon layer including inherited graphics (base classes first). */
  icon: GraphicsLayer;
  ports: PortView[];
  /** Parameters with current values, used for tooltips and `%R` substitution in icon texts. */
  parameters: ParameterInfo[];
  /** True if the component is itself a connector (a port of the model being edited). */
  isConnector: boolean;
  /** Conditional component whose condition is false. */
  disabled?: boolean;
  loc?: SourceLoc;
}

export interface ConnectionView {
  /** Dotted connector references within the class: `resistor.p`, `ground.p`, or `u` for own ports. */
  from: string;
  to: string;
  line: ConnectionLine;
  /** Index of the connect equation in the class's equation list, for editing. */
  equationIndex: number;
  loc?: SourceLoc;
}

export interface DiagramView {
  className: string;
  /** Diagram layer of the class itself (coordinate system + static graphics), inherited graphics included. */
  diagram: GraphicsLayer;
  /** Icon layer of the class itself. */
  icon: GraphicsLayer;
  components: ComponentView[];
  connections: ConnectionView[];
  diagnostics: Diagnostic[];
}

/** One node of the library / class tree shown in the Libraries panel. */
export interface ClassTreeNode {
  /** Fully-qualified name. */
  name: string;
  shortName: string;
  restriction: ClassRestriction;
  description?: string;
  partial: boolean;
  /** Whether the class has nested classes (children can be requested). */
  hasChildren: boolean;
  /** Icon layer (own + inherited); undefined when the class has no icon. */
  icon?: GraphicsLayer;
  /** Library/project that owns the class. */
  libraryId: string;
  /** Read-only libraries cannot be edited. */
  readOnly: boolean;
  /** Whether the class can be dropped onto a canvas (model/block/connector; not package/partial/function). */
  droppable: boolean;
}

/** A single edit operation on a class, applied by `editor/` to the AST and re-printed as Modelica text. */
export type EditOperation =
  | { op: 'addComponent'; className: string; name?: string; position: Point; rotation?: number; size?: number }
  | { op: 'moveComponents'; names: string[]; delta: Point }
  | { op: 'setPlacement'; name: string; placement: Placement }
  | { op: 'rotateComponent'; name: string; deltaDegrees: number }
  | { op: 'flipComponent'; name: string; axis: 'horizontal' | 'vertical' }
  | { op: 'renameComponent'; name: string; newName: string }
  | { op: 'deleteComponents'; names: string[] }
  | { op: 'addConnection'; from: string; to: string; points?: Point[]; color?: [number, number, number] }
  | { op: 'setConnectionPoints'; equationIndex: number; points: Point[] }
  | { op: 'deleteConnection'; equationIndex: number }
  | { op: 'setParameter'; component?: string; name: string; valueText: string | null }
  | { op: 'setDescription'; component?: string; description: string }
  | { op: 'setExperiment'; experiment: { StartTime?: number; StopTime?: number; Interval?: number; Tolerance?: number } }
  | { op: 'replaceText'; text: string };

export interface EditResult {
  /** New Modelica source text of the whole file the class lives in. */
  text: string;
  diagnostics: Diagnostic[];
  /** Name of a component created by `addComponent`. */
  createdName?: string;
}

/** Helper for building a component reference expression list for connect(). */
export function splitConnectorRef(ref: string): { component?: string; connector: string } {
  const i = ref.indexOf('.');
  if (i < 0) return { connector: ref };
  return { component: ref.slice(0, i), connector: ref.slice(i + 1) };
}

export type { Expr };
