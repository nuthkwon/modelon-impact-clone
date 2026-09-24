/**
 * Diagram view model of a class: components with resolved icons, ports and parameters, the
 * model's own connectors, and connections with their `Line` annotations (or a default straight
 * line between the connected port centres).
 *
 * `buildDiagramView` throws only when `className` itself does not exist; every other problem
 * (unresolvable classes, dangling connections, ...) becomes a diagnostic in the result.
 */
import { ModelicaError, refToDotted, type Diagnostic, type Equation } from '../ast.js';
import type { ComponentView, ConnectionView, DiagramView, ParameterInfo, PortView } from '../diagram.js';
import type { ConnectionLine, Point } from '../graphics.js';
import { tryEvaluateConstant, type EvalEnv } from '../flatten/evaluate.js';
import { parseConnectionLine, parsePlacement } from '../graphics/annotations.js';
import { applyMatrix, extentCenter, multiply, placementMatrix } from '../graphics/transform.js';
import type { ClassRegistry, RegisteredClass } from '../registry.js';
import { cacheFor, type RegistryCache } from './cache.js';
import {
  causalityOf,
  collectComponents,
  connectorFacts,
  definingClassName,
  domainColor,
  emptyLayer,
  hiddenPlacement,
  resolveTypeName,
  shortName,
  type ComponentType,
  type InheritedComponent,
} from './classes.js';
import { placeholderIcon, resolveLayer } from './icons.js';
import { getParameters, lookupConstant, type ParameterOwner } from './parameters.js';

export { resolveDiagram, resolveIcon } from './icons.js';
export { domainColor, domainOfName, DOMAIN_COLORS } from './classes.js';

type ConnectEquation = Extract<Equation, { kind: 'connect' }>;

/** Builds the diagram view model of `className` (components with resolved icons/ports, connections). */
export function buildDiagramView(registry: ClassRegistry, className: string): DiagramView {
  const cls = registry.get(className);
  if (!cls || cls.builtin) {
    throw new ModelicaError(`Class '${className}' does not exist`, [{ severity: 'error', message: `Class '${className}' does not exist`, path: className }]);
  }
  const cache = cacheFor(registry);
  const diagnostics: Diagnostic[] = [];
  const chain = registry.inheritanceChain(className);
  for (const c of chain) {
    for (const b of registry.unresolvedBases(c.fullName)) {
      diagnostics.push({
        severity: 'error',
        message: `Cannot resolve base class ${b} of ${c.fullName}`,
        path: c.fullName,
        file: registry.fileOf(c.fullName)?.path,
        loc: c.def.extends.find((e) => e.typeName === b)?.loc,
        code: 'unresolved-base',
      });
    }
  }

  const ownParameters = safeParameters(registry, className);
  const paramEnv = environment(registry, cache, className, ownParameters);

  const components: ComponentView[] = [];
  const byName = new Map<string, ComponentView>();
  for (const ic of collectComponents(registry, cache, className)) {
    try {
      const view = buildComponent(registry, cache, className, ic, paramEnv, diagnostics);
      if (!view) continue;
      components.push(view);
      byName.set(view.name, view);
    } catch (e) {
      diagnostics.push({
        severity: 'error',
        message: `Could not build component ${ic.decl.name}: ${e instanceof Error ? e.message : String(e)}`,
        path: `${className}.${ic.decl.name}`,
        loc: ic.decl.loc,
        file: registry.fileOf(ic.declaringClass.fullName)?.path,
      });
    }
  }

  const connections: ConnectionView[] = [];
  const builder = new ConnectionBuilder(registry, cache, byName, connections, diagnostics);
  cls.def.equations.forEach((eq, index) => {
    if (eq.kind === 'connect') builder.add(eq, index, false, cls);
  });
  for (const base of chain) {
    if (base.fullName === className) continue;
    for (const eq of base.def.equations) if (eq.kind === 'connect') builder.add(eq, -1, true, base);
  }

  return {
    className,
    diagram: resolveLayer(registry, cache, className, 'Diagram') ?? emptyLayer(),
    icon: resolveLayer(registry, cache, className, 'Icon') ?? emptyLayer(),
    components,
    connections,
    diagnostics,
  };
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function safeParameters(registry: ClassRegistry, className: string, owner?: ParameterOwner): ParameterInfo[] {
  try {
    return getParameters(registry, className, owner);
  } catch {
    return [];
  }
}

/** Environment resolving the parameters of `className` (by evaluated value) and constants. */
function environment(registry: ClassRegistry, cache: RegistryCache, scope: string, parameters: ParameterInfo[]): EvalEnv {
  const values = new Map<string, ParameterInfo['evaluated']>();
  for (const p of parameters) values.set(p.name, p.evaluated);
  return {
    lookup: (name) => (values.has(name) ? values.get(name) : lookupConstant(registry, cache, name, scope)),
  };
}

function buildComponent(
  registry: ClassRegistry,
  cache: RegistryCache,
  className: string,
  ic: InheritedComponent,
  paramEnv: EvalEnv,
  diagnostics: Diagnostic[],
): ComponentView | undefined {
  const { decl, declaringClass } = ic;
  const t = resolveTypeName(registry, cache, decl.typeName, declaringClass.fullName);
  // Scalars (`parameter Real R`, `SI.Voltage v`) are variables, not components.
  if (t.kind === 'builtin' || t.kind === 'scalar') return undefined;
  const placement = parsePlacement(decl.annotation);
  // Record-typed parameters live in the PROPERTIES tab unless they were placed on the diagram.
  if ((decl.prefixes.parameter || decl.prefixes.constant) && !placement) return undefined;

  const view: ComponentView = {
    name: decl.name,
    className: t.fullName,
    shortClassName: shortName(t.fullName),
    restriction: 'model',
    placement: placement ?? hiddenPlacement(),
    icon: emptyLayer(),
    ports: [],
    parameters: [],
    isConnector: false,
  };
  if (decl.description !== undefined) view.description = decl.description;
  if (decl.loc) view.loc = decl.loc;
  if (decl.prefixes.protected) view.protected = true;
  if (ic.inherited) view.inherited = true;
  if (!placement) view.hasPlacement = false;
  if (decl.condition && tryEvaluateConstant(decl.condition, paramEnv) === false) view.disabled = true;

  if (t.kind === 'unresolved') {
    diagnostics.push({
      severity: 'error',
      message: `Cannot resolve class ${decl.typeName} of component ${decl.name}`,
      path: `${className}.${decl.name}`,
      loc: decl.loc,
      file: registry.fileOf(declaringClass.fullName)?.path,
      code: 'unresolved-class',
    });
    view.icon = placeholderIcon(decl.typeName);
    return view;
  }

  view.restriction = t.cls?.def.restriction ?? 'model';
  view.icon = resolveLayer(registry, cache, t.fullName, 'Icon') ?? emptyLayer();
  view.isConnector = t.kind === 'connector';
  view.parameters = safeParameters(registry, t.fullName, { ownerClassName: className, componentName: decl.name });
  if (!view.isConnector) view.ports = buildPorts(registry, cache, className, decl.name, t, view.parameters, diagnostics);
  return view;
}

/** Connector-typed components of the component's class (bases first) as ports. */
function buildPorts(
  registry: ClassRegistry,
  cache: RegistryCache,
  ownerClassName: string,
  componentName: string,
  t: ComponentType,
  parameters: ParameterInfo[],
  diagnostics: Diagnostic[],
): PortView[] {
  const defining = definingClassName(t);
  if (!defining) return [];
  const env = environment(registry, cache, defining, parameters);
  const ports: PortView[] = [];
  for (const ic of collectComponents(registry, cache, defining)) {
    const { decl, declaringClass } = ic;
    if (decl.prefixes.protected) continue;
    const pt = resolveTypeName(registry, cache, decl.typeName, declaringClass.fullName);
    if (pt.kind === 'unresolved') {
      // Only placed declarations were meant to be graphical; report them as missing ports.
      if (parsePlacement(decl.annotation)) {
        diagnostics.push({
          severity: 'warning',
          message: `Cannot resolve class ${decl.typeName} of port ${componentName}.${decl.name}`,
          path: `${ownerClassName}.${componentName}.${decl.name}`,
          loc: decl.loc,
          file: registry.fileOf(declaringClass.fullName)?.path,
          code: 'unresolved-class',
        });
      }
      continue;
    }
    if (pt.kind !== 'connector') continue;
    if (decl.condition && tryEvaluateConstant(decl.condition, env) === false) continue;
    const placement = parsePlacement(decl.annotation);
    const facts = connectorFacts(registry, cache, pt.fullName);
    const port: PortView = {
      name: decl.name,
      className: pt.fullName,
      placement: placement ?? hiddenPlacement(),
      icon: resolveLayer(registry, cache, pt.fullName, 'Icon') ?? emptyLayer(),
      causality: causalityOf(decl, pt),
      physical: facts.physical,
      domain: facts.domain,
    };
    if (decl.description !== undefined) port.description = decl.description;
    if (!placement) port.hasPlacement = false;
    ports.push(port);
  }
  return ports;
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

type Endpoint =
  | { kind: 'ok'; center: Point; domain: string }
  | { kind: 'unknown-component'; component: string }
  | { kind: 'unknown-port'; component: string; port: string };

class ConnectionBuilder {
  constructor(
    private readonly registry: ClassRegistry,
    private readonly cache: RegistryCache,
    private readonly components: Map<string, ComponentView>,
    private readonly out: ConnectionView[],
    private readonly diagnostics: Diagnostic[],
  ) {}

  add(eq: ConnectEquation, equationIndex: number, inherited: boolean, declaring: RegisteredClass): void {
    const file = this.registry.fileOf(declaring.fullName)?.path;
    const from = refToDotted(eq.a);
    const to = refToDotted(eq.b);
    if (!from || !to) {
      this.diagnostics.push({ severity: 'warning', message: 'connect() arguments must be connector references', path: declaring.fullName, loc: eq.loc, file });
      return;
    }
    const label = `connect(${from}, ${to})`;
    try {
      const a = this.endpoint(from);
      const b = this.endpoint(to);
      let line = parseConnectionLine(eq.annotation);
      for (const ep of [a, b]) {
        if (ep.kind === 'unknown-component') {
          this.diagnostics.push({ severity: 'error', message: `${label}: unknown component ${ep.component}`, path: declaring.fullName, loc: eq.loc, file, code: 'unknown-component' });
          return;
        }
      }
      let needsCenters = !line || line.points.length < 2;
      for (const ep of [a, b]) {
        if (ep.kind === 'unknown-port') {
          this.diagnostics.push({ severity: 'warning', message: `${label}: component ${ep.component} has no connector ${ep.port}`, path: declaring.fullName, loc: eq.loc, file, code: 'unknown-port' });
          if (needsCenters) return; // no annotation and no geometry to fall back on
          needsCenters = false;
        }
      }
      if (a.kind === 'ok' && b.kind === 'ok' && needsCenters) {
        const domain = a.domain !== 'other' ? a.domain : b.domain;
        line = { ...(line ?? defaultLine(domain)), points: [a.center, b.center] };
      }
      if (!line) return;
      const view: ConnectionView = { from, to, line, equationIndex };
      if (inherited) view.inherited = true;
      if (eq.loc) view.loc = eq.loc;
      this.out.push(view);
    } catch (e) {
      this.diagnostics.push({ severity: 'error', message: `${label}: ${e instanceof Error ? e.message : String(e)}`, path: declaring.fullName, loc: eq.loc, file });
    }
  }

  /** Locates `comp` / `comp.port` and computes the connector centre in diagram coordinates. */
  private endpoint(ref: string): Endpoint {
    const dot = ref.indexOf('.');
    const componentName = dot < 0 ? ref : ref.slice(0, dot);
    const comp = this.components.get(componentName);
    if (!comp) return { kind: 'unknown-component', component: componentName };
    const cm = placementMatrix(comp.placement, comp.icon.coordinateSystem);
    if (dot < 0) {
      // The model's own connector (drawn as a component on the diagram layer).
      const center = applyMatrix(cm, extentCenter(comp.icon.coordinateSystem.extent));
      return { kind: 'ok', center: roundPoint(center), domain: connectorFacts(this.registry, this.cache, comp.className).domain };
    }
    const rest = ref.slice(dot + 1);
    const portName = rest.includes('.') ? rest.slice(0, rest.indexOf('.')) : rest;
    const port = comp.ports.find((p) => p.name === portName);
    if (!port) return { kind: 'unknown-port', component: componentName, port: portName };
    const pm = multiply(cm, placementMatrix(port.placement, port.icon.coordinateSystem, true));
    const center = applyMatrix(pm, extentCenter(port.icon.coordinateSystem.extent));
    return { kind: 'ok', center: roundPoint(center), domain: port.domain };
  }
}

function defaultLine(domain: string): ConnectionLine {
  return { points: [], color: domainColor(domain), pattern: 'Solid', thickness: 0.25, smooth: 'None', arrow: ['None', 'None'] };
}

function roundPoint(p: Point): Point {
  return [roundCoord(p[0]), roundCoord(p[1])];
}

function roundCoord(v: number): number {
  const r = Math.round(v * 1e6) / 1e6;
  return r === 0 ? 0 : r;
}
