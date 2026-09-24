import type { ParameterInfo, VariableInfo } from '../diagram.js';
import type { ClassRegistry } from '../registry.js';

/**
 * Parameters of `className` (declared + inherited). When `componentName` (inside `ownerClassName`)
 * is given, the component's modifiers are reflected in `valueText`/`evaluated`.
 */
export function getParameters(_registry: ClassRegistry, _className: string, _owner?: { ownerClassName: string; componentName: string }): ParameterInfo[] {
  throw new Error('getParameters: not implemented');
}

/** Non-parameter variables of a class (declared + inherited, including connector variables). */
export function getVariables(_registry: ClassRegistry, _className: string): VariableInfo[] {
  throw new Error('getVariables: not implemented');
}
