import { describe, expect, it } from 'vitest';
import { DEFAULT_COORDINATE_SYSTEM } from '../graphics.js';
import { CIRCUITS, makeRegistry } from './fixtures.js';

const lineOf = (text: string, needle: string) => text.split('\n').findIndex((l) => l.includes(needle)) + 1;
import { buildDiagramView, resolveDiagram, resolveIcon } from './view.js';

describe('resolveIcon', () => {
  const registry = makeRegistry();

  it('merges inherited graphics with base classes first and uses the most derived coordinate system', () => {
    const icon = resolveIcon(registry, 'Mini.Electrical.Basic.Resistor')!;
    expect(icon.graphics.map((g) => g.kind)).toEqual(['Line', 'Line', 'Rectangle', 'Text', 'Text']);
    // Resistor spells out its own coordinate system (default grid), TwoPin's grid={1,1} does not leak through.
    expect(icon.coordinateSystem.preserveAspectRatio).toBe(true);
    expect(icon.coordinateSystem.grid).toEqual([2, 2]);
  });

  it('inherits the coordinate system of the closest base that defines one', () => {
    const icon = resolveIcon(registry, 'Mini.Electrical.Basic.Capacitor')!;
    expect(icon.graphics).toHaveLength(4);
    expect(icon.coordinateSystem.grid).toEqual([1, 1]);
    expect(icon.coordinateSystem.preserveAspectRatio).toBe(true);
  });

  it('gives short classes their own icon and lets short-class chains inherit the target icon', () => {
    const input = resolveIcon(registry, 'MiniBlocks.Interfaces.RealInput')!;
    expect(input.graphics).toHaveLength(1);
    expect(input.coordinateSystem.initialScale).toBe(0.2);
    const positive = resolveIcon(registry, 'Mini.Electrical.Interfaces.PositivePin')!;
    expect(positive.graphics).toHaveLength(1);
    expect(positive.graphics[0]).toMatchObject({ kind: 'Rectangle', fillColor: [0, 0, 255] });
    const negative = resolveIcon(registry, 'Mini.Electrical.Interfaces.NegativePin')!;
    expect(negative.graphics).toHaveLength(2);
    expect(negative.graphics[1]).toMatchObject({ kind: 'Rectangle', fillColor: [255, 255, 255] });
  });

  it('returns undefined for classes without any icon and the inherited package icon for packages', () => {
    expect(resolveIcon(registry, 'Mini.Thermal')).toBeUndefined();
    expect(resolveIcon(registry, 'Mini.Units.Voltage')).toBeUndefined();
    expect(resolveIcon(registry, 'Real')).toBeUndefined();
    expect(resolveIcon(registry, 'Does.Not.Exist')).toBeUndefined();
    expect(resolveIcon(registry, 'Mini.Electrical.Basic')!.graphics).toHaveLength(2);
  });

  it('resolves the diagram layer including inherited static graphics', () => {
    const diagram = resolveDiagram(registry, 'Circuits.RC')!;
    expect(diagram.graphics).toEqual([expect.objectContaining({ kind: 'Text', textString: 'RC circuit' })]);
    expect(resolveDiagram(registry, 'Circuits.ExtendedRC')!.graphics).toHaveLength(1);
    expect(resolveDiagram(registry, 'Mini.Electrical.Basic.Resistor')).toBeUndefined();
  });

  it('caches per registry content and refreshes after a file changes', () => {
    const reg = makeRegistry();
    const first = resolveIcon(reg, 'Mini.Electrical.Basic.Resistor');
    expect(resolveIcon(reg, 'Mini.Electrical.Basic.Resistor')).toBe(first);
    reg.addFile('Examples', 'Extra.mo', 'model Extra\n  annotation (Icon(graphics={Ellipse(extent={{-50,-50},{50,50}})}));\nend Extra;');
    expect(resolveIcon(reg, 'Extra')!.graphics).toHaveLength(1);
    expect(resolveIcon(reg, 'Mini.Electrical.Basic.Resistor')).not.toBe(first);
    reg.addFile('Examples', 'Extra.mo', 'model Extra\n  annotation (Icon(graphics={Ellipse(extent={{-50,-50},{50,50}}), Line(points={{0,0},{1,1}})}));\nend Extra;');
    expect(resolveIcon(reg, 'Extra')!.graphics).toHaveLength(2);
  });
});

describe('buildDiagramView', () => {
  const registry = makeRegistry();
  const view = buildDiagramView(registry, 'Circuits.RC');
  const component = (name: string) => view.components.find((c) => c.name === name)!;

  it('throws only when the class itself does not exist', () => {
    expect(() => buildDiagramView(registry, 'Nope')).toThrow(/does not exist/);
    expect(() => buildDiagramView(registry, 'Real')).toThrow();
  });

  it('lists components (protected and unresolvable included) but not scalar variables', () => {
    expect(view.className).toBe('Circuits.RC');
    expect(view.components.map((c) => c.name)).toEqual(['resistor', 'capacitor', 'source', 'ground', 'pin', 'broken', 'internal']);
    const resistor = component('resistor');
    expect(resistor).toMatchObject({
      className: 'Mini.Electrical.Basic.Resistor',
      shortClassName: 'Resistor',
      restriction: 'model',
      description: 'The resistor',
      isConnector: false,
    });
    expect(resistor.placement.transformation.extent).toEqual([[-10, 30], [10, 50]]);
    expect(resistor.hasPlacement).toBeUndefined();
    expect(resistor.inherited).toBeUndefined();
    expect(resistor.protected).toBeUndefined();
    expect(resistor.icon.graphics.map((g) => g.kind)).toEqual(['Line', 'Line', 'Rectangle', 'Text', 'Text']);
    expect(resistor.loc?.line).toBe(lineOf(CIRCUITS, 'Mini.Electrical.Basic.Resistor resistor('));

    const internal = component('internal');
    expect(internal.protected).toBe(true);
    expect(internal.hasPlacement).toBe(false);
    expect(internal.placement.visible).toBe(false);
    expect(internal.placement.transformation.extent).toEqual([[-10, -10], [10, 10]]);
  });

  it('exposes ports with iconTransformation, causality, physical and domain', () => {
    const ports = component('resistor').ports;
    expect(ports.map((p) => p.name)).toEqual(['p', 'n']); // heatPort is conditional on useHeatPort=false
    const [p, n] = ports;
    expect(p).toMatchObject({ className: 'Mini.Electrical.Interfaces.PositivePin', causality: 'none', physical: true, domain: 'electrical', description: 'Positive pin' });
    expect(p.placement.transformation.extent).toEqual([[-110, -10], [-90, 10]]);
    expect(p.placement.iconTransformation).toBeUndefined();
    expect(p.icon.graphics).toHaveLength(1);
    expect(n.placement.transformation.extent).toEqual([[110, -10], [90, 10]]);
    expect(n.placement.iconTransformation?.extent).toEqual([[90, -10], [110, 10]]);
    expect(n.icon.graphics).toHaveLength(2);
    expect(component('ground').ports[0].placement.transformation).toEqual({ origin: [0, 100], extent: [[-10, -10], [10, 10]], rotation: 270 });
  });

  it('shows the model’s own connectors as components drawn at their transformation', () => {
    const pin = component('pin');
    expect(pin).toMatchObject({ isConnector: true, className: 'Mini.Electrical.Interfaces.Pin', restriction: 'connector', description: 'External pin' });
    expect(pin.ports).toEqual([]);
    expect(pin.placement.transformation.extent).toEqual([[90, -10], [110, 10]]);
    expect(pin.placement.iconTransformation?.extent).toEqual([[90, -10], [110, 10]]);
    expect(pin.icon.graphics).toHaveLength(1);
  });

  it('reports unresolvable classes with a diagnostic and a placeholder icon', () => {
    const broken = component('broken');
    expect(broken.className).toBe('Unknown.Thing');
    expect(broken.shortClassName).toBe('Thing');
    expect(broken.ports).toEqual([]);
    expect(broken.parameters).toEqual([]);
    expect(broken.icon.graphics[0]).toMatchObject({ kind: 'Rectangle', pattern: 'Dash', lineColor: [255, 0, 0] });
    expect(broken.icon.graphics[1]).toMatchObject({ kind: 'Text', textString: 'Unknown.Thing' });
    expect(view.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error', message: 'Cannot resolve class Unknown.Thing of component broken', path: 'Circuits.RC.broken', file: 'Circuits.mo' }),
    );
  });

  it('carries the component parameters with the owner modifiers applied', () => {
    const params = component('resistor').parameters;
    expect(params.map((p) => p.name)).toEqual(['useHeatPort', 'T', 'R', 'T_ref', 'alpha']);
    expect(params.find((p) => p.name === 'R')).toMatchObject({ valueText: 'Rval', evaluated: 100, unit: 'Ohm' });
    expect(params.find((p) => p.name === 'T_ref')).toMatchObject({ valueText: '310', defaultText: '300.15', evaluated: 310 });
    expect(component('capacitor').parameters.find((p) => p.name === 'C')).toMatchObject({ valueText: '0.001', evaluated: 0.001, unit: 'F', min: 0 });
  });

  it('numbers connections by their equation index, skipping non-connect equations and dangling references', () => {
    expect(view.connections.map((c) => c.equationIndex)).toEqual([1, 2, 3, 4, 5]);
    expect(view.connections.map((c) => [c.from, c.to])).toEqual([
      ['source.p', 'resistor.p'],
      ['resistor.n', 'capacitor.p'],
      ['capacitor.n', 'ground.p'],
      ['source.n', 'ground.p'],
      ['capacitor.p', 'pin'],
    ]);
    expect(view.connections.every((c) => c.inherited === undefined)).toBe(true);
    expect(view.connections[0].line.points).toEqual([[-40, 10], [-40, 40], [-10, 40]]);
    expect(view.connections[0].loc?.line).toBe(lineOf(CIRCUITS, 'connect(source.p, resistor.p)'));
    expect(view.diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', message: 'connect(nowhere.p, pin): unknown component nowhere', code: 'unknown-component' }));
    expect(view.diagnostics).toContainEqual(expect.objectContaining({ severity: 'warning', message: 'connect(resistor.heatPort, pin): component resistor has no connector heatPort' }));
  });

  it('computes a default straight line between port centres for connect() without annotation', () => {
    const rc = view.connections.find((c) => c.from === 'resistor.n')!;
    // resistor.n: icon centre (100,0) scaled 0.1 around (0,40); capacitor.p: (-100,0) scaled 0.1 and rotated 270° about (40,0).
    expect(rc.line).toEqual({ points: [[10, 40], [40, 10]], color: [0, 0, 255], pattern: 'Solid', thickness: 0.25, smooth: 'None', arrow: ['None', 'None'] });
    // source rotated by 90°, ground.p placed at origin {0,100} of a 20-unit ground.
    expect(view.connections.find((c) => c.from === 'source.n')!.line.points).toEqual([[-40, 10], [-40, -30]]);
    // Own connector: centre of its placement.
    expect(view.connections.find((c) => c.to === 'pin')!.line.points).toEqual([[40, 10], [100, 0]]);
  });

  it('includes the diagram and icon layers of the class', () => {
    expect(view.diagram.graphics).toEqual([expect.objectContaining({ kind: 'Text', textString: 'RC circuit' })]);
    expect(view.diagram.coordinateSystem.extent).toEqual([[-100, -100], [100, 100]]);
    expect(view.icon.graphics.map((g) => g.kind)).toEqual(['Ellipse', 'Polygon']);
    const plain = buildDiagramView(registry, 'Mini.Electrical.Basic.Ground');
    expect(plain.diagram).toEqual({ coordinateSystem: DEFAULT_COORDINATE_SYSTEM, graphics: [] });
  });

  it('flags inherited components and connections in derived classes', () => {
    const derived = buildDiagramView(registry, 'Circuits.ExtendedRC');
    expect(derived.components.map((c) => [c.name, c.inherited ?? false])).toEqual([
      ['resistor', true], ['capacitor', true], ['source', true], ['ground', true], ['pin', true], ['broken', true], ['internal', true], ['load', false],
    ]);
    expect(derived.components.find((c) => c.name === 'resistor')!.parameters.find((p) => p.name === 'R')).toMatchObject({ valueText: '5', evaluated: 5 });
    expect(derived.connections.map((c) => [c.equationIndex, c.inherited ?? false])).toEqual([[0, false], [-1, true], [-1, true], [-1, true], [-1, true], [-1, true]]);
    expect(derived.connections[0]).toMatchObject({ from: 'pin', to: 'load.p' });
    expect(derived.diagnostics.some((d) => d.severity === 'error' && d.path === 'Circuits.RC.broken')).toBe(true);
  });
});

describe('buildDiagramView with causal blocks', () => {
  const registry = makeRegistry();
  const view = buildDiagramView(registry, 'Loop');
  const component = (name: string) => view.components.find((c) => c.name === name)!;

  it('classifies signal ports and colours default lines by the source domain', () => {
    expect(view.components.map((c) => c.name)).toEqual(['const', 'integrator', 'firstOrder', 'placedData']);
    expect(component('const').ports[0]).toMatchObject({ name: 'y', causality: 'output', physical: false, domain: 'real' });
    expect(component('integrator').ports.map((p) => [p.name, p.causality])).toEqual([['u', 'input'], ['y', 'output']]);
    const fo = component('firstOrder').ports;
    expect(fo.map((p) => p.name)).toEqual(['u', 'y', 'trigger', 'reset']);
    expect(fo[2]).toMatchObject({ domain: 'boolean', causality: 'input', physical: false });
    expect(fo[3]).toMatchObject({ domain: 'boolean', causality: 'input', hasPlacement: false });
    expect(fo[3].placement.visible).toBe(false);
    expect(view.connections[0].line).toMatchObject({ points: [[-39, 0], [-2, 0]], color: [0, 0, 127] });
    expect(view.connections[1].line.points).toEqual([[21, 0], [38, 0]]);
    expect(view.diagnostics).toEqual([]);
  });

  it('shows placed record components but keeps unplaced record parameters in the properties only', () => {
    expect(component('placedData')).toMatchObject({ restriction: 'record', className: 'MiniBlocks.Records.Data', isConnector: false });
    expect(component('placedData').parameters.map((p) => [p.name, p.valueText ?? p.defaultText])).toEqual([['a', '3'], ['b', '2'], ['n', '3']]);
    expect(view.components.some((c) => c.name === 'data')).toBe(false);
    expect(component('integrator').parameters.find((p) => p.name === 'k')).toMatchObject({ valueText: 'const.k*2', evaluated: 4 });
  });

  it('disables conditional components whose condition evaluates to false', () => {
    const reg = makeRegistry();
    reg.addFile('Examples', 'Cond.mo', `model Cond
  parameter Boolean useLoad = false;
  parameter Boolean useSource = true;
  Mini.Electrical.Basic.Resistor load if useLoad annotation (Placement(transformation(extent={{0,0},{20,20}})));
  Mini.Electrical.Sources.ConstantVoltage source if useSource annotation (Placement(transformation(extent={{0,0},{20,20}})));
  Mini.Electrical.Basic.Ground ground if unknownFlag annotation (Placement(transformation(extent={{0,0},{20,20}})));
end Cond;`);
    const v = buildDiagramView(reg, 'Cond');
    expect(v.components.map((c) => [c.name, c.disabled ?? false])).toEqual([['load', true], ['source', false], ['ground', false]]);
  });
});

describe('buildDiagramView performance', () => {
  it('builds a 20-component model in under 50 ms after warm-up', () => {
    const registry = makeRegistry();
    const n = 20;
    const comps: string[] = [];
    const conns: string[] = [];
    for (let i = 0; i < n; i++) {
      comps.push(`  Mini.Electrical.Basic.Resistor r${i}(R=${i + 1}, T_ref=300 + ${i}) annotation (Placement(transformation(extent={{${i * 20 - 200},0},{${i * 20 - 180},20}})));`);
      if (i > 0) conns.push(`  connect(r${i - 1}.n, r${i}.p);`);
    }
    registry.addFile('Examples', 'Big.mo', `model Big\n${comps.join('\n')}\nequation\n${conns.join('\n')}\nend Big;`);
    const first = buildDiagramView(registry, 'Big');
    expect(first.components).toHaveLength(n);
    expect(first.connections).toHaveLength(n - 1);
    expect(first.diagnostics).toEqual([]);
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      buildDiagramView(registry, 'Big');
      times.push(performance.now() - t0);
    }
    expect(Math.min(...times)).toBeLessThan(50);
  });
});
