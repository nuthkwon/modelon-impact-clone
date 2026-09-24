import type { DiagramView } from '../diagram.js';
import type { GraphicsLayer } from '../graphics.js';
import type { ClassRegistry } from '../registry.js';

/** Builds the diagram view model of `className` (components with resolved icons/ports, connections). */
export function buildDiagramView(_registry: ClassRegistry, _className: string): DiagramView {
  throw new Error('buildDiagramView: not implemented');
}

/** Icon layer of a class including inherited graphics (base classes drawn first). */
export function resolveIcon(_registry: ClassRegistry, _className: string): GraphicsLayer | undefined {
  throw new Error('resolveIcon: not implemented');
}
