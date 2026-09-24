import { describe, expect, it } from 'vitest';
import { E, type Expr, type Modification, type Modifier } from '../ast.js';
import type {
  BitmapItem,
  ConnectionLine,
  EllipseItem,
  GraphicItem,
  GraphicsLayer,
  LineItem,
  Placement,
  PolygonItem,
  RectangleItem,
  TextItem,
} from '../graphics.js';
import { parseConnectionLine, parseGraphicItem, parseGraphicsLayer, parsePlacement } from './annotations.js';
import {
  connectionLineToModifier,
  graphicItemToExpr,
  graphicsLayerToModifier,
  placementToModifier,
  roundNumber,
} from './serialize.js';

const val = (name: string, value: Expr): Modifier => ({ name, modification: { mods: [], value } });
const rec = (name: string, ...mods: Modifier[]): Modifier => ({ name, modification: { mods } });
const ann = (...mods: Modifier[]): Modification => ({ mods });
const extent = (x1: number, y1: number, x2: number, y2: number) => E.array([E.point(x1, y1), E.point(x2, y2)]);
const color = (r: number, g: number, b: number) => E.array([E.num(r), E.num(g), E.num(b)]);

const argNames = (e: Expr): string[] => (e.kind === 'call' ? e.namedArgs.map((a) => a.name) : []);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const defaultPlacement: Placement = {
  visible: true,
  transformation: { origin: [0, 0], extent: [[-10, -10], [10, 10]], rotation: 0 },
};

const fullPlacement: Placement = {
  visible: false,
  transformation: { origin: [-40, 20.5], extent: [[-10, -10], [10, 10]], rotation: 90 },
  iconTransformation: { origin: [0, 0], extent: [[-110, -10], [-90, 10]], rotation: -90 },
};

const blueLine: ConnectionLine = {
  points: [[-40, 0], [-20, 0], [-20, 30], [0, 30]],
  color: [0, 0, 127],
  pattern: 'Solid',
  thickness: 0.25,
  smooth: 'Bezier',
  arrow: ['None', 'None'],
};

const fancyLine: ConnectionLine = {
  points: [[0, 0], [10, 0]],
  color: [0, 0, 0],
  pattern: 'Dash',
  thickness: 0.5,
  smooth: 'None',
  arrow: ['None', 'Filled'],
};

const rect: RectangleItem = {
  kind: 'Rectangle', visible: true, origin: [0, 0], rotation: 0,
  lineColor: [0, 0, 255], fillColor: [255, 255, 255], pattern: 'Solid', fillPattern: 'Solid', lineThickness: 0.25,
  extent: [[-70, 30], [70, -30]], borderPattern: 'None', radius: 0,
};
const rectFancy: RectangleItem = {
  kind: 'Rectangle', visible: false, origin: [5, -5], rotation: 45,
  lineColor: [0, 0, 0], fillColor: [0, 0, 0], pattern: 'Dash', fillPattern: 'HorizontalCylinder', lineThickness: 0.5,
  extent: [[-70, 30], [70, -30]], borderPattern: 'Raised', radius: 2.5,
};
const line: LineItem = {
  kind: 'Line', visible: true, origin: [0, 0], rotation: 0,
  points: [[-90, 0], [-70, 0]], color: [0, 0, 255], pattern: 'Solid', thickness: 0.25, arrow: ['None', 'None'], arrowSize: 3, smooth: 'None',
};
const lineFancy: LineItem = {
  kind: 'Line', visible: false, origin: [1, 2], rotation: 0,
  points: [[0, -100], [0, -30]], color: [127, 0, 0], pattern: 'Dot', thickness: 1, arrow: ['Open', 'Filled'], arrowSize: 5, smooth: 'Bezier',
};
const polygon: PolygonItem = {
  kind: 'Polygon', visible: true, origin: [-4.167, -15], rotation: 0,
  lineColor: [0, 0, 0], fillColor: [255, 255, 255], pattern: 'None', fillPattern: 'Solid', lineThickness: 0.25,
  points: [[-15.833, 20], [-15.833, 30], [14.167, 40]], smooth: 'Bezier',
};
const ellipse: EllipseItem = {
  kind: 'Ellipse', visible: true, origin: [0, 0], rotation: 0,
  lineColor: [64, 64, 64], fillColor: [0, 0, 0], pattern: 'Solid', fillPattern: 'None', lineThickness: 0.25,
  extent: [[-40, -40], [40, 40]], startAngle: 30, endAngle: 210, closure: 'None',
};
const textR: TextItem = {
  kind: 'Text', visible: true, origin: [0, 0], rotation: 0,
  lineColor: [0, 0, 0], fillColor: [0, 0, 0], pattern: 'Solid', fillPattern: 'None', lineThickness: 0.25,
  extent: [[-150, -40], [150, -80]], textString: 'R=%R', fontSize: 0, fontName: '', textColor: [0, 0, 0],
  horizontalAlignment: 'Center', textStyle: [],
};
const textName: TextItem = {
  ...textR, extent: [[-150, 90], [150, 50]], textString: '%name', textColor: [0, 0, 255],
};
const textFancy: TextItem = {
  ...textR, lineColor: [0, 0, 127], textColor: [0, 0, 127], textString: '%class', fontSize: 12, fontName: 'Arial',
  horizontalAlignment: 'Left', textStyle: ['Bold', 'Italic'],
};
const bitmap: BitmapItem = {
  kind: 'Bitmap', visible: true, origin: [0, 0], rotation: 0, extent: [[-100, -100], [100, 100]], fileName: 'modelica://X/y.png',
};
const bitmapInline: BitmapItem = {
  kind: 'Bitmap', visible: true, origin: [0, 0], rotation: 0, extent: [[-100, -100], [100, 100]], imageSource: 'iVBORw0KGgo=',
};

const resistorIcon: GraphicsLayer = {
  coordinateSystem: { extent: [[-100, -100], [100, 100]], preserveAspectRatio: true, initialScale: 0.1, grid: [2, 2] },
  graphics: [rect, line, { ...line, points: [[70, 0], [90, 0]] }, textR, textName],
};

// ---------------------------------------------------------------------------

describe('placementToModifier', () => {
  it('emits only the extent for a default placement', () => {
    expect(placementToModifier(defaultPlacement)).toEqual(
      rec('Placement', rec('transformation', val('extent', extent(-10, -10, 10, 10)))),
    );
  });

  it('emits rotation and origin when non-default, visible only when false, iconTransformation when present', () => {
    expect(placementToModifier(fullPlacement)).toEqual(
      rec(
        'Placement',
        val('visible', E.bool(false)),
        rec('transformation', val('origin', E.point(-40, 20.5)), val('extent', extent(-10, -10, 10, 10)), val('rotation', E.num(90))),
        rec('iconTransformation', val('extent', extent(-110, -10, -90, 10)), val('rotation', E.num(-90))),
      ),
    );
    const rotatedOnly: Placement = { visible: true, transformation: { origin: [0, 0], extent: [[-10, -10], [10, 10]], rotation: 90 } };
    expect(placementToModifier(rotatedOnly)).toEqual(
      rec('Placement', rec('transformation', val('extent', extent(-10, -10, 10, 10)), val('rotation', E.num(90)))),
    );
  });
});

describe('connectionLineToModifier', () => {
  it('emits points, color and smooth for a blue Bezier line', () => {
    expect(connectionLineToModifier(blueLine)).toEqual(
      rec('Line', val('points', E.points([[-40, 0], [-20, 0], [-20, 30], [0, 30]])), val('color', color(0, 0, 127)), val('smooth', E.ref('Smooth', 'Bezier'))),
    );
  });

  it('emits pattern, thickness and arrow as qualified enum literals; omits default black colour', () => {
    expect(connectionLineToModifier(fancyLine)).toEqual(
      rec(
        'Line',
        val('points', E.points([[0, 0], [10, 0]])),
        val('pattern', E.ref('LinePattern', 'Dash')),
        val('thickness', E.num(0.5)),
        val('arrow', E.array([E.ref('Arrow', 'None'), E.ref('Arrow', 'Filled')])),
      ),
    );
  });

  it('always emits points, even when empty', () => {
    expect(connectionLineToModifier({ ...fancyLine, points: [], pattern: 'Solid', thickness: 0.25, arrow: ['None', 'None'] })).toEqual(
      rec('Line', val('points', E.array([]))),
    );
  });
});

describe('graphicsLayerToModifier', () => {
  it('produces the MSL-style Resistor icon annotation', () => {
    const m = graphicsLayerToModifier(resistorIcon, 'Icon');
    expect(m.name).toBe('Icon');
    expect(m.modification.mods.map((x) => x.name)).toEqual(['coordinateSystem', 'graphics']);
    expect(m.modification.mods[0]).toEqual(rec('coordinateSystem', val('extent', extent(-100, -100, 100, 100))));
    const graphics = m.modification.mods[1].modification.value!;
    expect(graphics.kind).toBe('array');
    const items = (graphics as { kind: 'array'; elements: Expr[] }).elements;
    expect(items.map((i) => (i as { callee: string }).callee)).toEqual(['Rectangle', 'Line', 'Line', 'Text', 'Text']);
    expect(items[0]).toEqual(E.call('Rectangle', [], [
      { name: 'extent', value: extent(-70, 30, 70, -30) },
      { name: 'lineColor', value: color(0, 0, 255) },
      { name: 'fillColor', value: color(255, 255, 255) },
      { name: 'fillPattern', value: E.ref('FillPattern', 'Solid') },
    ]));
    expect(items[1]).toEqual(E.call('Line', [], [
      { name: 'points', value: E.points([[-90, 0], [-70, 0]]) },
      { name: 'color', value: color(0, 0, 255) },
    ]));
    expect(items[3]).toEqual(E.call('Text', [], [
      { name: 'extent', value: extent(-150, -40, 150, -80) },
      { name: 'textString', value: E.str('R=%R') },
    ]));
    expect(items[4]).toEqual(E.call('Text', [], [
      { name: 'extent', value: extent(-150, 90, 150, 50) },
      { name: 'textString', value: E.str('%name') },
      { name: 'textColor', value: color(0, 0, 255) },
    ]));
  });

  it('omits graphics when empty and writes non-default coordinate system attributes', () => {
    const m = graphicsLayerToModifier(
      { coordinateSystem: { extent: [[-200, -100], [200, 100]], preserveAspectRatio: false, initialScale: 0.2, grid: [1, 1] }, graphics: [] },
      'Diagram',
    );
    expect(m).toEqual(rec('Diagram', rec(
      'coordinateSystem',
      val('extent', extent(-200, -100, 200, 100)),
      val('preserveAspectRatio', E.bool(false)),
      val('initialScale', E.num(0.2)),
      val('grid', E.point(1, 1)),
    )));
  });

  it('writes enums qualified and textStyle as an array of TextStyle literals', () => {
    expect(argNames(graphicItemToExpr(rectFancy))).toEqual(['visible', 'origin', 'rotation', 'extent', 'pattern', 'fillPattern', 'lineThickness', 'borderPattern', 'radius']);
    const t = graphicItemToExpr(textFancy) as Extract<Expr, { kind: 'call' }>;
    expect(argNames(t)).toEqual(['extent', 'textString', 'lineColor', 'fontSize', 'fontName', 'horizontalAlignment', 'textStyle']);
    expect(t.namedArgs.find((a) => a.name === 'textStyle')!.value).toEqual(E.array([E.ref('TextStyle', 'Bold'), E.ref('TextStyle', 'Italic')]));
    expect(t.namedArgs.find((a) => a.name === 'horizontalAlignment')!.value).toEqual(E.ref('TextAlignment', 'Left'));
    const e = graphicItemToExpr(ellipse) as Extract<Expr, { kind: 'call' }>;
    expect(e.namedArgs.find((a) => a.name === 'closure')!.value).toEqual(E.ref('EllipseClosure', 'None'));
    const p = graphicItemToExpr(polygon) as Extract<Expr, { kind: 'call' }>;
    expect(argNames(p)).toEqual(['origin', 'points', 'fillColor', 'pattern', 'fillPattern', 'smooth']);
    expect(p.namedArgs.find((a) => a.name === 'smooth')!.value).toEqual(E.ref('Smooth', 'Bezier'));
    const l = graphicItemToExpr(lineFancy) as Extract<Expr, { kind: 'call' }>;
    expect(argNames(l)).toEqual(['visible', 'origin', 'points', 'color', 'pattern', 'thickness', 'arrow', 'arrowSize', 'smooth']);
  });

  it('rounds numbers to at most six decimals and never emits -0', () => {
    expect(roundNumber(1 / 3)).toBe(0.333333);
    expect(roundNumber(90.0000001)).toBe(90);
    expect(roundNumber(-0)).toBe(0);
    expect(Object.is(roundNumber(-1e-9), -0)).toBe(false);
    expect(roundNumber(-12.5)).toBe(-12.5);
    expect(roundNumber(NaN)).toBe(0);
    const m = placementToModifier({ visible: true, transformation: { origin: [1 / 3, -0], extent: [[-10, -10], [10, 10]], rotation: 90.0000001 } });
    expect(m).toEqual(rec('Placement', rec('transformation', val('origin', E.point(0.333333, 0)), val('extent', extent(-10, -10, 10, 10)), val('rotation', E.num(90)))));
  });
});

describe('round trip parse(serialize(x)) === x', () => {
  it('Placement', () => {
    for (const p of [defaultPlacement, fullPlacement]) {
      expect(parsePlacement(ann(placementToModifier(p)))).toEqual(p);
    }
  });

  it('ConnectionLine', () => {
    for (const l of [blueLine, fancyLine]) {
      expect(parseConnectionLine(ann(connectionLineToModifier(l)))).toEqual(l);
    }
  });

  it('every graphic primitive', () => {
    const items: GraphicItem[] = [rect, rectFancy, line, lineFancy, polygon, ellipse, textR, textName, textFancy, bitmap, bitmapInline];
    for (const item of items) {
      expect(parseGraphicItem(graphicItemToExpr(item))).toEqual(item);
    }
  });

  it('GraphicsLayer (Icon and Diagram)', () => {
    expect(parseGraphicsLayer(ann(graphicsLayerToModifier(resistorIcon, 'Icon')), 'Icon')).toEqual(resistorIcon);
    const diagram: GraphicsLayer = {
      coordinateSystem: { extent: [[-200, -100], [200, 100]], preserveAspectRatio: false, initialScale: 0.05, grid: [1, 1] },
      graphics: [rectFancy, lineFancy, polygon, ellipse, textFancy, bitmap],
    };
    expect(parseGraphicsLayer(ann(graphicsLayerToModifier(diagram, 'Diagram')), 'Diagram')).toEqual(diagram);
    const empty: GraphicsLayer = { coordinateSystem: { ...resistorIcon.coordinateSystem }, graphics: [] };
    expect(parseGraphicsLayer(ann(graphicsLayerToModifier(empty, 'Icon')), 'Icon')).toEqual(empty);
  });
});
