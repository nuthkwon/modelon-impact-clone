import type { Modifier } from '../ast.js';
import type { ConnectionLine, GraphicsLayer, Placement } from '../graphics.js';

/** `Placement(visible=..., transformation(origin={x,y}, extent={{..},{..}}, rotation=r))` as a Modifier. */
export function placementToModifier(_p: Placement): Modifier {
  throw new Error('placementToModifier: not implemented');
}

/** `Line(points={{..},{..}}, color={r,g,b}, ...)` as a Modifier. */
export function connectionLineToModifier(_l: ConnectionLine): Modifier {
  throw new Error('connectionLineToModifier: not implemented');
}

/** `Icon(coordinateSystem(...), graphics={...})` as a Modifier. */
export function graphicsLayerToModifier(_layer: GraphicsLayer, _kind: 'Icon' | 'Diagram'): Modifier {
  throw new Error('graphicsLayerToModifier: not implemented');
}
