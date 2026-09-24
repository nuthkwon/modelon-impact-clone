import type { Modification } from '../ast.js';
import type { ExperimentAnnotation } from '../flat.js';
import type { ConnectionLine, GraphicsLayer, Placement } from '../graphics.js';

/** Reads `Icon(...)`/`Diagram(...)` out of a class annotation. Returns undefined when absent. */
export function parseGraphicsLayer(_annotation: Modification | undefined, _kind: 'Icon' | 'Diagram'): GraphicsLayer | undefined {
  throw new Error('parseGraphicsLayer: not implemented');
}

/** Reads `Placement(...)` out of a component annotation. */
export function parsePlacement(_annotation: Modification | undefined): Placement | undefined {
  throw new Error('parsePlacement: not implemented');
}

/** Reads `Line(...)` out of a connect-equation annotation. */
export function parseConnectionLine(_annotation: Modification | undefined): ConnectionLine | undefined {
  throw new Error('parseConnectionLine: not implemented');
}

/** Reads `experiment(StartTime=..., StopTime=..., Interval=..., Tolerance=...)`. */
export function parseExperiment(_annotation: Modification | undefined): ExperimentAnnotation | undefined {
  throw new Error('parseExperiment: not implemented');
}

/** Reads `Documentation(info="...")` HTML text. */
export function parseDocumentation(_annotation: Modification | undefined): { info?: string; revisions?: string } | undefined {
  throw new Error('parseDocumentation: not implemented');
}
