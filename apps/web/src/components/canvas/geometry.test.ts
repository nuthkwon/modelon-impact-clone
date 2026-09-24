import { describe, expect, it } from 'vitest';
import type { ComponentView, DiagramView, Point, PortView } from '@impact/core';
import { DEFAULT_COORDINATE_SYSTEM } from '@impact/core';
import {
  angleBetween,
  causalBase,
  classifyPort,
  collectPortAnchors,
  componentCenter,
  componentsInRect,
  dedupePoints,
  diagramToScreen,
  domainColor,
  domainOf,
  dragCorner,
  dragSegment,
  findPortAt,
  fitViewport,
  insertCorner,
  nearestCorner,
  nearestSegment,
  orthogonalRoute,
  panBy,
  rotatePoint,
  screenToDiagram,
  snapAngle,
  snapDelta,
  viewportMatrix,
  visibleExtent,
  zoomAt,
  type PortLike,
} from './geometry';

const port = (over: Partial<PortLike>): PortLike => ({ ref: 'a.p', className: 'X', causality: 'none', physical: true, domain: 'other', ...over });

describe('viewport transforms', () => {
  it('maps diagram to screen with a y flip and back', () => {
    const vp = { scale: 2, tx: 100, ty: 300 };
    expect(diagramToScreen(vp, [0, 0])).toEqual([100, 300]);
    expect(diagramToScreen(vp, [10, 20])).toEqual([120, 260]);
    const back = screenToDiagram(vp, [120, 260]);
    expect(back[0]).toBeCloseTo(10);
    expect(back[1]).toBeCloseTo(20);
    const m = viewportMatrix(vp);
    expect(m).toEqual({ a: 2, b: 0, c: 0, d: -2, e: 100, f: 300 });
  });

  it('fits an extent with padding and centres it', () => {
    const vp = fitViewport([[-100, -100], [100, 100]], 800, 600, 40);
    // limited by height: (600 - 80) / 200 = 2.6
    expect(vp.scale).toBeCloseTo(2.6);
    expect(diagramToScreen(vp, [0, 0])).toEqual([400, 300]);
    expect(diagramToScreen(vp, [0, 100])[1]).toBeCloseTo(40);
    expect(diagramToScreen(vp, [0, -100])[1]).toBeCloseTo(560);
  });

  it('clamps the fitted scale to the allowed range', () => {
    expect(fitViewport([[-1, -1], [1, 1]], 2000, 2000).scale).toBe(8);
    expect(fitViewport([[-1e5, -1e5], [1e5, 1e5]], 200, 200).scale).toBe(0.1);
  });

  it('zooms about the cursor keeping the point under it fixed', () => {
    const vp = { scale: 1, tx: 50, ty: 50 };
    const cursor: Point = [130, 70];
    const before = screenToDiagram(vp, cursor);
    const z = zoomAt(vp, cursor, 2);
    expect(z.scale).toBe(2);
    const after = screenToDiagram(z, cursor);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
  });

  it('does not zoom past the limits and pans additively', () => {
    const vp = { scale: 8, tx: 0, ty: 0 };
    expect(zoomAt(vp, [0, 0], 2)).toBe(vp);
    expect(zoomAt({ scale: 0.1, tx: 0, ty: 0 }, [0, 0], 0.5).scale).toBe(0.1);
    expect(panBy({ scale: 1, tx: 10, ty: 10 }, 5, -5)).toEqual({ scale: 1, tx: 15, ty: 5 });
  });

  it('computes the visible extent in diagram coordinates', () => {
    const vp = fitViewport([[-100, -100], [100, 100]], 400, 400, 0);
    const ext = visibleExtent(vp, 400, 400);
    expect(ext[0][0]).toBeCloseTo(-100);
    expect(ext[1][1]).toBeCloseTo(100);
  });
});

describe('snapping', () => {
  it('snaps to the 2-unit grid when enabled and rounds to 0.01 otherwise', () => {
    expect(snapDelta([3.4, -0.9], true)).toEqual([4, 0]);
    expect(snapDelta([3.456, -0.904], false)).toEqual([3.46, -0.9]);
    expect(snapDelta([-0.001, 0.001], false)).toEqual([0, 0]);
  });

  it('snaps angles to steps', () => {
    expect(snapAngle(80, 90)).toBe(90);
    expect(snapAngle(-50, 90)).toBe(-90);
    expect(snapAngle(22, 15)).toBe(15);
    expect(snapAngle(0, 90)).toBe(0);
  });

  it('measures rotation angles counter-clockwise in y-up coordinates', () => {
    expect(angleBetween([0, 0], [10, 0], [0, 10])).toBeCloseTo(90);
    expect(angleBetween([0, 0], [10, 0], [0, -10])).toBeCloseTo(-90);
    expect(angleBetween([5, 5], [15, 5], [-5, 5])).toBeCloseTo(180);
  });

  it('rotates points about a centre', () => {
    const p = rotatePoint([10, 0], [0, 0], 90);
    expect(p[0]).toBeCloseTo(0);
    expect(p[1]).toBeCloseTo(10);
  });
});

describe('orthogonal routing', () => {
  it('draws a straight line when the points are aligned', () => {
    expect(orthogonalRoute([0, 0], [40, 0])).toEqual([[0, 0], [40, 0]]);
    expect(orthogonalRoute([0, 0], [0, -30])).toEqual([[0, 0], [0, -30]]);
  });

  it('uses a mid-x elbow when the horizontal distance dominates', () => {
    expect(orthogonalRoute([-40, 0], [0, 20])).toEqual([[-40, 0], [-20, 0], [-20, 20], [0, 20]]);
  });

  it('uses a mid-y elbow when the vertical distance dominates', () => {
    expect(orthogonalRoute([0, 0], [10, 40])).toEqual([[0, 0], [0, 20], [10, 20], [10, 40]]);
  });

  it('produces only axis-aligned segments', () => {
    const pts = orthogonalRoute([-33.3333, 12.7], [51.2, -80.1]);
    for (let i = 0; i < pts.length - 1; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      expect(a[0] === b[0] || a[1] === b[1]).toBe(true);
    }
    expect(pts[0]).toEqual([-33.33, 12.7]);
    expect(pts[pts.length - 1]).toEqual([51.2, -80.1]);
  });
});

describe('domains and colours', () => {
  it('maps connector classes to domains and spec colours', () => {
    expect(domainOf('Modelica.Electrical.Analog.Interfaces.PositivePin')).toBe('electrical');
    expect(domainColor('Modelica.Electrical.Analog.Interfaces.PositivePin')).toEqual([0, 0, 255]);
    expect(domainColor('Modelica.Mechanics.Rotational.Interfaces.Flange_a')).toEqual([95, 95, 95]);
    expect(domainColor('Modelica.Mechanics.Translational.Interfaces.Flange_b')).toEqual([0, 127, 0]);
    expect(domainColor('Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a')).toEqual([191, 0, 0]);
    expect(domainColor('Modelica.Blocks.Interfaces.RealInput')).toEqual([0, 0, 127]);
    expect(domainColor('Modelica.Blocks.Interfaces.BooleanOutput')).toEqual([255, 0, 255]);
    expect(domainColor('MyLib.WeirdConnector')).toEqual([0, 0, 0]);
  });

  it('strips causal suffixes for base comparison', () => {
    expect(causalBase('Modelica.Blocks.Interfaces.RealInput')).toBe('Real');
    expect(causalBase('Modelica.Blocks.Interfaces.RealOutput')).toBe('Real');
    expect(causalBase('X.Flange_a')).toBe('Flange_a');
  });
});

describe('port compatibility', () => {
  const pin = 'Modelica.Electrical.Analog.Interfaces.PositivePin';
  const npin = 'Modelica.Electrical.Analog.Interfaces.NegativePin';
  const flange = 'Modelica.Mechanics.Rotational.Interfaces.Flange_a';
  const realIn = 'Modelica.Blocks.Interfaces.RealInput';
  const realOut = 'Modelica.Blocks.Interfaces.RealOutput';
  const boolOut = 'Modelica.Blocks.Interfaces.BooleanOutput';

  it('accepts the same connector class', () => {
    expect(classifyPort(port({ ref: 'r.p', className: pin, domain: 'electrical' }), port({ ref: 'g.p', className: pin, domain: 'electrical' }))).toBe('compatible');
  });

  it('never connects a port to itself', () => {
    expect(classifyPort(port({ ref: 'r.p', className: pin }), port({ ref: 'r.p', className: pin }))).toBe('incompatible');
  });

  it('accepts physical connectors of the same domain and rejects other domains', () => {
    expect(classifyPort(port({ ref: 'r.p', className: pin, domain: 'electrical' }), port({ ref: 'c.n', className: npin, domain: 'electrical' }))).toBe('compatible');
    expect(classifyPort(port({ ref: 'r.p', className: pin, domain: 'electrical' }), port({ ref: 'i.flange', className: flange, domain: 'rotational' }))).toBe('incompatible');
  });

  it('does not treat two unknown-domain physical connectors of different classes as compatible', () => {
    expect(classifyPort(port({ ref: 'a.x', className: 'Lib.A', domain: 'other' }), port({ ref: 'b.y', className: 'Lib.B', domain: 'other' }))).toBe('incompatible');
  });

  it('accepts input↔output of the same base type only', () => {
    const inp = port({ ref: 'gain.u', className: realIn, causality: 'input', physical: false, domain: 'real' });
    const out = port({ ref: 'step.y', className: realOut, causality: 'output', physical: false, domain: 'real' });
    const inp2 = port({ ref: 'sum.u', className: realIn, causality: 'input', physical: false, domain: 'real' });
    const bout = port({ ref: 'b.y', className: boolOut, causality: 'output', physical: false, domain: 'boolean' });
    expect(classifyPort(inp, out)).toBe('compatible');
    expect(classifyPort(out, inp)).toBe('compatible');
    expect(classifyPort(inp, bout)).toBe('incompatible');
    // same class → compatible (model's own RealInput connector feeding a block input)
    expect(classifyPort(inp, inp2)).toBe('compatible');
    // causal vs physical
    expect(classifyPort(inp, port({ ref: 'r.p', className: pin, domain: 'electrical' }))).toBe('incompatible');
  });
});

describe('port anchors', () => {
  const pinIcon = { coordinateSystem: DEFAULT_COORDINATE_SYSTEM, graphics: [] };
  const portView = (name: string, x: number): PortView => ({
    name,
    className: 'Modelica.Electrical.Analog.Interfaces.PositivePin',
    placement: { visible: true, transformation: { origin: [0, 0], extent: [[x - 10, -10], [x + 10, 10]], rotation: 0 } },
    icon: pinIcon,
    causality: 'none',
    physical: true,
    domain: 'electrical',
  });
  const comp = (name: string, origin: Point, ports: PortView[], isConnector = false): ComponentView => ({
    name,
    className: isConnector ? 'Modelica.Blocks.Interfaces.RealInput' : 'Modelica.Electrical.Analog.Basic.Resistor',
    shortClassName: isConnector ? 'RealInput' : 'Resistor',
    restriction: isConnector ? 'connector' : 'model',
    placement: { visible: true, transformation: { origin, extent: [[-10, -10], [10, 10]], rotation: 0 } },
    icon: { coordinateSystem: DEFAULT_COORDINATE_SYSTEM, graphics: [] },
    ports,
    parameters: [],
    isConnector,
  });
  const diagram: DiagramView = {
    className: 'T',
    diagram: { coordinateSystem: DEFAULT_COORDINATE_SYSTEM, graphics: [] },
    icon: { coordinateSystem: DEFAULT_COORDINATE_SYSTEM, graphics: [] },
    components: [comp('resistor', [20, 30], [portView('p', -100), portView('n', 100)]), comp('u', [-80, 0], [], true)],
    connections: [],
    diagnostics: [],
  };
  const anchors = collectPortAnchors(diagram, () => ({ causality: 'input', physical: false }));

  it('places component ports in diagram coordinates through the component transform', () => {
    const p = anchors.find((a) => a.ref === 'resistor.p')!;
    const n = anchors.find((a) => a.ref === 'resistor.n')!;
    // component scale 0.1: port at icon x=-100 → diagram x = 20 - 10 = 10
    expect(p.center[0]).toBeCloseTo(10);
    expect(p.center[1]).toBeCloseTo(30);
    expect(n.center[0]).toBeCloseTo(30);
    expect(p.bounds[0][0]).toBeCloseTo(9);
    expect(p.bounds[1][0]).toBeCloseTo(11);
    expect(p.domain).toBe('electrical');
  });

  it('includes the model\'s own connectors with registry-provided causality', () => {
    const u = anchors.find((a) => a.ref === 'u')!;
    expect(u.port).toBeUndefined();
    expect(u.causality).toBe('input');
    expect(u.center).toEqual([-80, 0]);
    expect(u.bounds).toEqual([[-90, -10], [-70, 10]]);
  });

  it('finds the anchor under a point within tolerance', () => {
    expect(findPortAt(anchors, [10.5, 30.2], 1)?.ref).toBe('resistor.p');
    expect(findPortAt(anchors, [11.8, 30], 1)?.ref).toBe('resistor.p');
    expect(findPortAt(anchors, [12.5, 30], 1)).toBeUndefined();
    expect(findPortAt(anchors, [20, 30], 1)).toBeUndefined();
    expect(findPortAt(anchors, [-85, 5], 0)?.ref).toBe('u');
  });

  it('selects components intersecting a rubber-band rectangle', () => {
    expect(componentsInRect(diagram.components, [[0, 0], [15, 25]])).toEqual(['resistor']);
    expect(componentsInRect(diagram.components, [[-100, -20], [40, 40]]).sort()).toEqual(['resistor', 'u']);
    expect(componentsInRect(diagram.components, [[50, 50], [60, 60]])).toEqual([]);
  });

  it('ignores undrawn components (no Placement / visible=false) for rubber bands and connection targets', () => {
    // `hiddenPlacement()`: visible=false with the default {{-10,-10},{10,10}} extent at the origin.
    const hidden: ComponentView = { ...comp('g2', [0, 0], [portView('p', 0)]), placement: { visible: false, transformation: { origin: [0, 0], extent: [[-10, -10], [10, 10]], rotation: 0 } }, hasPlacement: false };
    const capacitor = comp('capacitor', [0, 0], [portView('p', 0)]);
    const withHidden: DiagramView = { ...diagram, components: [capacitor, hidden] };
    expect(componentsInRect(withHidden.components, [[-12, -12], [12, 12]])).toEqual(['capacitor']);
    const found = collectPortAnchors(withHidden, () => ({ causality: 'none', physical: true }));
    expect(found.map((a) => a.ref)).toEqual(['capacitor.p']);
    expect(findPortAt(found, [0, 0], 1)?.ref).toBe('capacitor.p');
  });
});

describe('component centre (rotation pivot)', () => {
  const icon = { coordinateSystem: DEFAULT_COORDINATE_SYSTEM, graphics: [] };
  const view = (placement: ComponentView['placement']): ComponentView => ({
    name: 'resistor',
    className: 'Modelica.Electrical.Analog.Basic.Resistor',
    shortClassName: 'Resistor',
    restriction: 'model',
    placement,
    icon,
    ports: [],
    parameters: [],
    isConnector: false,
  });

  it('is the extent centre for the canonical unrotated form (origin {0,0}, absolute extent)', () => {
    // Examples.RCCircuit `resistor`: Placement(transformation(extent={{-30,30},{-10,50}}))
    const c = view({ visible: true, transformation: { origin: [0, 0], extent: [[-30, 30], [-10, 50]], rotation: 0 } });
    expect(componentCenter(c)).toEqual([-20, 40]);
  });

  it('is origin + R(rotation)·centre(extent) for rotated and flipped placements', () => {
    const rotated = view({ visible: true, transformation: { origin: [10, 10], extent: [[-10, -10], [10, 10]], rotation: 90 } });
    expect(componentCenter(rotated)).toEqual([10, 10]);
    const offCentre = view({ visible: true, transformation: { origin: [10, 10], extent: [[0, 0], [20, 20]], rotation: 90 } });
    const [cx, cy] = componentCenter(offCentre);
    expect(cx).toBeCloseTo(0); // (10,10) + R90·(10,10) = (10,10) + (-10,10)
    expect(cy).toBeCloseTo(20);
    const flipped = view({ visible: true, transformation: { origin: [0, 0], extent: [[-10, 50], [-30, 30]], rotation: 0 } });
    expect(componentCenter(flipped)).toEqual([-20, 40]);
  });

  it('makes a quarter-turn drag of the rotation handle measure 90° about the component, not the diagram origin', () => {
    const c = view({ visible: true, transformation: { origin: [0, 0], extent: [[-30, 30], [-10, 50]], rotation: 0 } });
    const from: Point = [-10, 50]; // top-right corner (handle)
    const to: Point = [-30, 50]; // dragged a quarter turn around the icon
    expect(snapAngle(angleBetween(componentCenter(c), from, to), 90)).toBe(90);
    // Regression: the transformation origin is the diagram origin here and gives a useless 19.65°.
    expect(snapAngle(angleBetween(c.placement.transformation.origin, from, to), 90)).toBe(0);
  });
});

describe('connection editing math', () => {
  const line: Point[] = [[0, 0], [20, 0], [20, 40], [60, 40]];

  it('finds the nearest segment and its projection', () => {
    const hit = nearestSegment(line, [21, 20])!;
    expect(hit.index).toBe(1);
    expect(hit.projection).toEqual([20, 20]);
    expect(hit.distance).toBeCloseTo(1);
    expect(nearestSegment(line, [40, 41])!.index).toBe(2);
  });

  it('finds interior corners only', () => {
    expect(nearestCorner(line, [20.5, 0.5], 1)).toBe(1);
    expect(nearestCorner(line, [0.2, 0.2], 1)).toBe(-1);
    expect(nearestCorner(line, [60, 40], 1)).toBe(-1);
    expect(nearestCorner(line, [30, 30], 1)).toBe(-1);
  });

  it('moves a vertical segment horizontally only', () => {
    const moved = dragSegment(line, 1, [5, 7]);
    expect(moved).toEqual([[0, 0], [25, 0], [25, 40], [60, 40]]);
  });

  it('moves a horizontal segment vertically only', () => {
    const moved = dragSegment(line, 2, [5, -3]);
    // last segment: a duplicate of the end point is inserted so the line stays on the port
    expect(moved).toEqual([[0, 0], [20, 0], [20, 37], [60, 37], [60, 40]]);
  });

  it('keeps the start point attached when the first segment is dragged', () => {
    const moved = dragSegment(line, 0, [0, 10]);
    expect(moved).toEqual([[0, 0], [0, 10], [20, 10], [20, 40], [60, 40]]);
  });

  it('handles a straight two-point line by inserting both ends', () => {
    const moved = dragSegment([[0, 0], [40, 0]], 0, [3, 8]);
    expect(moved).toEqual([[0, 0], [0, 8], [40, 8], [40, 0]]);
  });

  it('moves a diagonal segment freely', () => {
    const moved = dragSegment([[0, 0], [10, 0], [20, 10], [30, 10], [40, 10]], 1, [2, 3]);
    expect(moved[1]).toEqual([12, 3]);
    expect(moved[2]).toEqual([22, 13]);
    expect(moved).toHaveLength(5);
  });

  it('moves a degenerate zero-length segment freely', () => {
    const moved = dragSegment([[0, 0], [10, 0], [10, 0], [20, 0], [30, 0]], 1, [1, 2]);
    expect(moved[1]).toEqual([11, 2]);
    expect(moved[2]).toEqual([11, 2]);
  });

  it('moves interior corners and ignores endpoints', () => {
    expect(dragCorner(line, 1, [1, 2])).toEqual([[0, 0], [21, 2], [20, 40], [60, 40]]);
    expect(dragCorner(line, 0, [1, 2])).toEqual(line);
    expect(dragCorner(line, 3, [1, 2])).toEqual(line);
  });

  it('inserts a corner on a segment and removes duplicates', () => {
    expect(insertCorner(line, 2, [40, 40])).toEqual([[0, 0], [20, 0], [20, 40], [40, 40], [60, 40]]);
    expect(dedupePoints([[0, 0], [0, 0], [1, 1], [1, 1], [2, 2]])).toEqual([[0, 0], [1, 1], [2, 2]]);
  });
});
