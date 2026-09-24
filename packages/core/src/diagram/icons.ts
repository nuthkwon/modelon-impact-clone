/**
 * Icon / Diagram layer resolution along the inheritance chain (Modelica Specification §18.6:
 * the graphics of base classes are drawn first, derived classes draw on top; the coordinate
 * system is the most-derived one that defines it).
 *
 * Short classes (`connector RealInput = input Real annotation(Icon(...))`) use their own class
 * annotation; a short class without a layer of its own inherits the layer of its target
 * (`type MyPin = Pin`). Results are memoised per registry content (see `cache.ts`).
 */
import type { CoordinateSystem, GraphicItem, GraphicsLayer, RectangleItem, TextItem } from '../graphics.js';
import { parseGraphicsLayer } from '../graphics/annotations.js';
import type { ClassRegistry, RegisteredClass } from '../registry.js';
import { cacheFor, type RegistryCache } from './cache.js';
import { emptyLayer, hasOwnCoordinateSystem } from './classes.js';

export type LayerKind = 'Icon' | 'Diagram';

interface ResolvedLayer {
  layer: GraphicsLayer;
  /** True when some class of the chain spelled out the coordinate system (as opposed to the default). */
  csGiven: boolean;
}

/** Icon layer of a class including inherited graphics (base classes drawn first). Undefined when no class of the chain has an `Icon`. */
export function resolveIcon(registry: ClassRegistry, className: string): GraphicsLayer | undefined {
  return resolveLayer(registry, cacheFor(registry), className, 'Icon');
}

/** Diagram layer of a class including inherited static graphics. Undefined when no class of the chain has a `Diagram`. */
export function resolveDiagram(registry: ClassRegistry, className: string): GraphicsLayer | undefined {
  return resolveLayer(registry, cacheFor(registry), className, 'Diagram');
}

/** Same as `resolveIcon` / `resolveDiagram` with an explicit cache (for callers that already hold one). */
export function resolveLayer(registry: ClassRegistry, cache: RegistryCache, className: string, kind: LayerKind): GraphicsLayer | undefined {
  return resolve(registry, cache, className, kind, new Set())?.layer;
}

function resolve(registry: ClassRegistry, cache: RegistryCache, className: string, kind: LayerKind, visiting: Set<string>): ResolvedLayer | undefined {
  if (visiting.has(className)) return undefined;
  return cache.memo(`layer:${kind}`, className, () => {
    visiting.add(className);
    try {
      return compute(registry, cache, className, kind, visiting);
    } finally {
      visiting.delete(className);
    }
  });
}

function compute(registry: ClassRegistry, cache: RegistryCache, className: string, kind: LayerKind, visiting: Set<string>): ResolvedLayer | undefined {
  const cls = registry.get(className);
  if (!cls || cls.builtin) return undefined;
  const graphics: GraphicItem[] = [];
  let coordinateSystem: CoordinateSystem | undefined;
  let found = false;
  for (const c of registry.inheritanceChain(className)) {
    let layer = parseGraphicsLayer(c.def.annotation, kind);
    let csGiven = !!layer && hasOwnCoordinateSystem(c.def.annotation, kind);
    if (!layer && c.def.shortClass) {
      const target = shortClassTarget(registry, c);
      const inherited = target ? resolve(registry, cache, target.fullName, kind, visiting) : undefined;
      if (inherited) {
        layer = inherited.layer;
        csGiven = inherited.csGiven;
      }
    }
    if (!layer) continue;
    found = true;
    for (const item of layer.graphics) graphics.push(item);
    // Bases come first, so the last class that defines a coordinate system is the most derived one.
    if (csGiven) coordinateSystem = layer.coordinateSystem;
  }
  if (!found) return undefined;
  return { layer: { coordinateSystem: coordinateSystem ?? emptyLayer().coordinateSystem, graphics }, csGiven: !!coordinateSystem };
}

/** Target class of a short class definition (`type X = Y` → Y), skipping builtins and enumerations. */
function shortClassTarget(registry: ClassRegistry, cls: RegisteredClass): RegisteredClass | undefined {
  const sc = cls.def.shortClass;
  if (!sc || sc.typeName === 'enumeration') return undefined;
  const target = registry.lookup(sc.typeName, cls.parentName);
  if (!target || target.builtin || target.fullName === cls.fullName) return undefined;
  return target;
}

/** Icon shown for components whose class cannot be resolved: a red dashed box with the type name. */
export function placeholderIcon(typeName: string): GraphicsLayer {
  const layer = emptyLayer();
  const box: RectangleItem = {
    kind: 'Rectangle',
    visible: true,
    origin: [0, 0],
    rotation: 0,
    lineColor: [255, 0, 0],
    fillColor: [255, 255, 255],
    pattern: 'Dash',
    fillPattern: 'Solid',
    lineThickness: 0.5,
    extent: [[-100, -100], [100, 100]],
    borderPattern: 'None',
    radius: 0,
  };
  const text: TextItem = {
    kind: 'Text',
    visible: true,
    origin: [0, 0],
    rotation: 0,
    lineColor: [255, 0, 0],
    fillColor: [255, 255, 255],
    pattern: 'Solid',
    fillPattern: 'None',
    lineThickness: 0.25,
    extent: [[-96, -40], [96, 40]],
    textString: typeName,
    fontSize: 0,
    fontName: '',
    textColor: [255, 0, 0],
    horizontalAlignment: 'Center',
    textStyle: [],
  };
  const name: TextItem = { ...text, extent: [[-150, -150], [150, -110]], textString: '%name', textColor: [0, 0, 255], lineColor: [0, 0, 255] };
  layer.graphics.push(box, text, name);
  return layer;
}
