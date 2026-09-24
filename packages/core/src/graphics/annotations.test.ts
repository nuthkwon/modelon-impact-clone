import { describe, expect, it } from 'vitest';
import { E, type Expr, type Modification, type Modifier } from '../ast.js';
import type { EllipseItem, LineItem, PolygonItem, RectangleItem, TextItem } from '../graphics.js';
import {
  evalNumber,
  parseConnectionLine,
  parseDocumentation,
  parseExperiment,
  parseGraphicItem,
  parseGraphicsLayer,
  parsePlacement,
  readColor,
  readEnum,
  FILL_PATTERNS,
} from './annotations.js';

// ---------------------------------------------------------------------------
// AST builders (the parser is written concurrently, so annotations are built by hand)
// ---------------------------------------------------------------------------

/** `name = value` */
const val = (name: string, value: Expr): Modifier => ({ name, modification: { mods: [], value } });
/** `name(mods...)` */
const rec = (name: string, ...mods: Modifier[]): Modifier => ({ name, modification: { mods } });
/** `annotation(mods...)` */
const ann = (...mods: Modifier[]): Modification => ({ mods });
const named = (name: string, value: Expr) => ({ name, value });
const color = (r: number, g: number, b: number) => E.array([E.num(r), E.num(g), E.num(b)]);
const extent = (x1: number, y1: number, x2: number, y2: number) => E.array([E.point(x1, y1), E.point(x2, y2)]);

/** The MSL 4.0 `Modelica.Electrical.Analog.Basic.Resistor` icon, as the parser would produce it. */
function resistorIcon(): Modification {
  return ann(
    rec(
      'Icon',
      rec('coordinateSystem', val('preserveAspectRatio', E.bool(true)), val('extent', extent(-100, -100, 100, 100))),
      val(
        'graphics',
        E.array([
          E.call('Rectangle', [], [
            named('extent', extent(-70, 30, 70, -30)),
            named('lineColor', color(0, 0, 255)),
            named('fillColor', color(255, 255, 255)),
            named('fillPattern', E.ref('FillPattern', 'Solid')),
          ]),
          E.call('Line', [], [named('points', E.points([[-90, 0], [-70, 0]])), named('color', color(0, 0, 255))]),
          E.call('Line', [], [named('points', E.points([[70, 0], [90, 0]])), named('color', color(0, 0, 255))]),
          E.call('Text', [], [named('extent', extent(-150, -40, 150, -80)), named('textString', E.str('R=%R'))]),
          E.call('Line', [], [
            named('visible', E.ref('useHeatPort')),
            named('points', E.points([[0, -100], [0, -30]])),
            named('color', color(127, 0, 0)),
            named('pattern', E.ref('LinePattern', 'Dot')),
          ]),
          E.call('Text', [], [
            named('extent', extent(-150, 90, 150, 50)),
            named('textString', E.str('%name')),
            named('textColor', color(0, 0, 255)),
          ]),
        ]),
      ),
    ),
    rec('Documentation', val('info', E.str('<html><p>The linear resistor</p></html>'))),
  );
}

// ---------------------------------------------------------------------------

describe('parseGraphicsLayer', () => {
  it('reads the MSL Resistor icon', () => {
    const layer = parseGraphicsLayer(resistorIcon(), 'Icon');
    expect(layer).toBeDefined();
    expect(layer!.coordinateSystem).toEqual({
      extent: [[-100, -100], [100, 100]],
      preserveAspectRatio: true,
      initialScale: 0.1,
      grid: [2, 2],
    });
    expect(layer!.graphics.map((g) => g.kind)).toEqual(['Rectangle', 'Line', 'Line', 'Text', 'Line', 'Text']);

    const rect = layer!.graphics[0] as RectangleItem;
    expect(rect).toEqual({
      kind: 'Rectangle',
      visible: true,
      origin: [0, 0],
      rotation: 0,
      lineColor: [0, 0, 255],
      fillColor: [255, 255, 255],
      pattern: 'Solid',
      fillPattern: 'Solid',
      lineThickness: 0.25,
      extent: [[-70, 30], [70, -30]],
      borderPattern: 'None',
      radius: 0,
    });

    const line = layer!.graphics[1] as LineItem;
    expect(line).toEqual({
      kind: 'Line',
      visible: true,
      origin: [0, 0],
      rotation: 0,
      points: [[-90, 0], [-70, 0]],
      color: [0, 0, 255],
      pattern: 'Solid',
      thickness: 0.25,
      arrow: ['None', 'None'],
      arrowSize: 3,
      smooth: 'None',
    });

    const text = layer!.graphics[3] as TextItem;
    expect(text.textString).toBe('R=%R');
    expect(text.extent).toEqual([[-150, -40], [150, -80]]);
    expect(text.textColor).toEqual([0, 0, 0]);
    expect(text.lineColor).toEqual([0, 0, 0]);
    expect(text.fontSize).toBe(0);
    expect(text.fontName).toBe('');
    expect(text.horizontalAlignment).toBe('Center');
    expect(text.textStyle).toEqual([]);

    // `visible=useHeatPort` is not a constant → default true; dotted pattern read.
    const heatLine = layer!.graphics[4] as LineItem;
    expect(heatLine.visible).toBe(true);
    expect(heatLine.pattern).toBe('Dot');
    expect(heatLine.color).toEqual([127, 0, 0]);

    const name = layer!.graphics[5] as TextItem;
    expect(name.textString).toBe('%name');
    expect(name.textColor).toEqual([0, 0, 255]);
    expect(name.lineColor).toEqual([0, 0, 0]);
  });

  it('returns undefined when the layer is absent and does not confuse Icon with Diagram', () => {
    expect(parseGraphicsLayer(resistorIcon(), 'Diagram')).toBeUndefined();
    expect(parseGraphicsLayer(undefined, 'Icon')).toBeUndefined();
    expect(parseGraphicsLayer(ann(), 'Icon')).toBeUndefined();
    expect(parseGraphicsLayer(ann(rec('Documentation')), 'Icon')).toBeUndefined();
  });

  it('uses spec defaults for an empty Diagram() and a coordinateSystem without attributes', () => {
    expect(parseGraphicsLayer(ann(rec('Diagram')), 'Diagram')).toEqual({
      coordinateSystem: { extent: [[-100, -100], [100, 100]], preserveAspectRatio: true, initialScale: 0.1, grid: [2, 2] },
      graphics: [],
    });
    const layer = parseGraphicsLayer(
      ann(rec('Diagram', rec('coordinateSystem', val('preserveAspectRatio', E.bool(false)), val('grid', E.point(1, 1)), val('initialScale', E.num(0.2))))),
      'Diagram',
    );
    expect(layer!.coordinateSystem).toEqual({ extent: [[-100, -100], [100, 100]], preserveAspectRatio: false, initialScale: 0.2, grid: [1, 1] });
  });

  it('reads a Polygon with smooth=Smooth.Bezier, origin and pattern=None (Modelica.Icons.Information)', () => {
    const layer = parseGraphicsLayer(
      ann(rec('Icon', val('graphics', E.array([
        E.call('Polygon', [], [
          named('origin', E.point(-4.167, -15)),
          named('fillColor', color(255, 255, 255)),
          named('pattern', E.ref('LinePattern', 'None')),
          named('fillPattern', E.ref('FillPattern', 'Solid')),
          named('points', E.points([[-15.833, 20], [-15.833, 30], [14.167, 40]])),
          named('smooth', E.ref('Smooth', 'Bezier')),
        ]),
      ])))),
      'Icon',
    );
    const poly = layer!.graphics[0] as PolygonItem;
    expect(poly).toEqual({
      kind: 'Polygon',
      visible: true,
      origin: [-4.167, -15],
      rotation: 0,
      lineColor: [0, 0, 0],
      fillColor: [255, 255, 255],
      pattern: 'None',
      fillPattern: 'Solid',
      lineThickness: 0.25,
      points: [[-15.833, 20], [-15.833, 30], [14.167, 40]],
      smooth: 'Bezier',
    });
  });

  it('reads an Ellipse arc with start/end angle and closure', () => {
    const item = parseGraphicItem(E.call('Ellipse', [], [
      named('extent', extent(-40, -40, 40, 40)),
      named('lineColor', color(64, 64, 64)),
      named('startAngle', E.num(30)),
      named('endAngle', E.num(210)),
      named('closure', E.ref('EllipseClosure', 'None')),
      named('lineThickness', E.num(0.5)),
    ])) as EllipseItem;
    expect(item).toEqual({
      kind: 'Ellipse',
      visible: true,
      origin: [0, 0],
      rotation: 0,
      lineColor: [64, 64, 64],
      fillColor: [0, 0, 0],
      pattern: 'Solid',
      fillPattern: 'None',
      lineThickness: 0.5,
      extent: [[-40, -40], [40, 40]],
      startAngle: 30,
      endAngle: 210,
      closure: 'None',
    });
    // Defaults: full ellipse, chord closure
    const plain = parseGraphicItem(E.call('Ellipse', [], [named('extent', extent(-1, -1, 1, 1))])) as EllipseItem;
    expect(plain.startAngle).toBe(0);
    expect(plain.endAngle).toBe(360);
    expect(plain.closure).toBe('Chord');
  });

  it('reads Text with textStyle, horizontalAlignment, fontSize and legacy lineColor as text colour', () => {
    const item = parseGraphicItem(E.call('Text', [], [
      named('extent', extent(-100, 20, 100, -20)),
      named('lineColor', color(0, 0, 127)),
      named('textString', E.str('%class')),
      named('fontSize', E.num(12)),
      named('fontName', E.str('Arial')),
      named('textStyle', E.array([E.ref('TextStyle', 'Bold')])),
      named('horizontalAlignment', E.ref('TextAlignment', 'Left')),
    ])) as TextItem;
    expect(item.textString).toBe('%class');
    expect(item.lineColor).toEqual([0, 0, 127]);
    expect(item.textColor).toEqual([0, 0, 127]);
    expect(item.fontSize).toBe(12);
    expect(item.fontName).toBe('Arial');
    expect(item.textStyle).toEqual(['Bold']);
    expect(item.horizontalAlignment).toBe('Left');

    const multi = parseGraphicItem(E.call('Text', [], [
      named('textString', E.str('x')),
      named('textStyle', E.array([E.ref('TextStyle', 'Bold'), E.ref('TextStyle', 'Italic'), E.ref('TextStyle', 'Nope')])),
    ])) as TextItem;
    expect(multi.textStyle).toEqual(['Bold', 'Italic']);
  });

  it('reads Bitmap, skips unknown / vendor primitives and non-call elements', () => {
    const layer = parseGraphicsLayer(
      ann(rec('Icon', val('graphics', E.array([
        E.call('Bitmap', [], [named('extent', extent(-100, -100, 100, 100)), named('fileName', E.str('modelica://Modelica/Resources/Images/x.png'))]),
        E.call('__Dymola_Widget', [], []),
        E.num(3),
        E.ref('something'),
        E.call('Modelica.Icons.Rectangle', [], [named('extent', extent(0, 0, 1, 1))]),
      ])))),
      'Icon',
    );
    expect(layer!.graphics.map((g) => g.kind)).toEqual(['Bitmap', 'Rectangle']);
    expect(layer!.graphics[0]).toEqual({
      kind: 'Bitmap',
      visible: true,
      origin: [0, 0],
      rotation: 0,
      extent: [[-100, -100], [100, 100]],
      fileName: 'modelica://Modelica/Resources/Images/x.png',
    });
  });

  it('accepts a single primitive as graphics value and DynamicSelect wrappers', () => {
    const layer = parseGraphicsLayer(
      ann(rec('Icon', val('graphics', E.call('Rectangle', [], [
        named('extent', E.call('DynamicSelect', [extent(-1, -1, 1, 1), extent(-2, -2, 2, 2)], [])),
        named('fillColor', E.call('DynamicSelect', [color(1, 2, 3), E.ref('c')], [])),
        named('visible', E.call('DynamicSelect', [E.bool(false), E.ref('v')], [])),
      ])))),
      'Icon',
    );
    const r = layer!.graphics[0] as RectangleItem;
    expect(r.extent).toEqual([[-1, -1], [1, 1]]);
    expect(r.fillColor).toEqual([1, 2, 3]);
    expect(r.visible).toBe(false);
  });

  it('evaluates simple arithmetic and falls back to defaults for non-constant expressions', () => {
    const r = parseGraphicItem(E.call('Rectangle', [], [
      named('extent', E.array([E.array([E.neg(E.num(10)), E.bin('*', E.neg(E.num(1)), E.num(30))]), E.array([E.bin('+', E.num(5), E.num(5)), E.bin('/', E.num(9), E.num(3))])])),
      named('rotation', E.bin('*', E.ref('k'), E.num(90))),
      named('lineThickness', E.bin('^', E.num(2), E.num(-1))),
      named('radius', E.bin('-', E.num(4), E.num(1))),
    ])) as RectangleItem;
    expect(r.extent).toEqual([[-10, -30], [10, 3]]);
    expect(r.rotation).toBe(0);
    expect(r.lineThickness).toBe(0.5);
    expect(r.radius).toBe(3);
  });

  it('is robust against malformed values (defaults, never throws)', () => {
    const r = parseGraphicItem(E.call('Rectangle', [], [
      named('extent', E.array([E.num(1), E.num(2)])),
      named('lineColor', E.array([E.num(300), E.num(-5), E.num(1.6)])),
      named('fillColor', E.str('red')),
      named('pattern', E.ref('LinePattern', 'Weird')),
      named('fillPattern', E.num(1)),
      named('borderPattern', E.ref('BorderPattern', 'Raised')),
      named('visible', E.num(1)),
      named('origin', E.array([E.num(1)])),
      named('lineThickness', E.bin('/', E.num(1), E.num(0))),
    ])) as RectangleItem;
    expect(r.extent).toEqual([[0, 0], [0, 0]]);
    expect(r.lineColor).toEqual([255, 0, 2]);
    expect(r.fillColor).toEqual([0, 0, 0]);
    expect(r.pattern).toBe('Solid');
    expect(r.fillPattern).toBe('None');
    expect(r.borderPattern).toBe('Raised');
    expect(r.visible).toBe(true);
    expect(r.origin).toEqual([0, 0]);
    expect(r.lineThickness).toBe(0.25);

    const l = parseGraphicItem(E.call('Line', [], [
      named('points', E.array([E.point(0, 0), E.num(4), E.array([E.num(1), E.ref('y')]), E.point(1, 1)])),
      named('arrow', E.num(5)),
      named('smooth', E.str('Bezier')),
    ])) as LineItem;
    expect(l.points).toEqual([[0, 0], [1, 1]]);
    expect(l.arrow).toEqual(['None', 'None']);
    expect(l.smooth).toBe('Bezier');

    // graphics that is not an array of primitives at all
    expect(parseGraphicsLayer(ann(rec('Icon', val('graphics', E.num(5)))), 'Icon')!.graphics).toEqual([]);
    expect(parseGraphicsLayer(ann(rec('Icon', val('graphics', E.str('x')))), 'Icon')!.graphics).toEqual([]);
    // coordinateSystem given as a value instead of a record
    expect(parseGraphicsLayer(ann(rec('Icon', val('coordinateSystem', E.num(1)))), 'Icon')!.coordinateSystem.extent).toEqual([[-100, -100], [100, 100]]);
    // a modification without a mods array
    expect(() => parseGraphicsLayer({ mods: undefined as unknown as Modifier[] }, 'Icon')).not.toThrow();
  });

  it('honours the positional GraphicItem prefix (visible, origin, rotation)', () => {
    const l = parseGraphicItem(E.call('Line', [E.bool(false), E.point(5, 6), E.num(45)], [named('points', E.points([[0, 0], [1, 1]]))])) as LineItem;
    expect(l.visible).toBe(false);
    expect(l.origin).toEqual([5, 6]);
    expect(l.rotation).toBe(45);
    // named arguments win over positional ones
    const l2 = parseGraphicItem(E.call('Line', [E.bool(false)], [named('visible', E.bool(true)), named('points', E.points([]))])) as LineItem;
    expect(l2.visible).toBe(true);
    // Rectangle({{..},{..}}) positional extent
    const r = parseGraphicItem(E.call('Rectangle', [extent(-1, -2, 3, 4)], [])) as RectangleItem;
    expect(r.extent).toEqual([[-1, -2], [3, 4]]);
  });
});

describe('parsePlacement', () => {
  it('reads transformation and iconTransformation', () => {
    const p = parsePlacement(ann(rec(
      'Placement',
      rec('transformation', val('origin', E.point(-40, 20)), val('extent', extent(-10, -10, 10, 10)), val('rotation', E.num(90))),
      rec('iconTransformation', val('extent', extent(-110, -10, -90, 10))),
    )));
    expect(p).toEqual({
      visible: true,
      transformation: { origin: [-40, 20], extent: [[-10, -10], [10, 10]], rotation: 90 },
      iconTransformation: { origin: [0, 0], extent: [[-110, -10], [-90, 10]], rotation: 0 },
    });
  });

  it('omits iconTransformation when absent and reads visible=false', () => {
    const p = parsePlacement(ann(rec('Placement', val('visible', E.bool(false)), rec('transformation', val('extent', extent(-10, -10, 10, 10))))));
    expect(p).toEqual({ visible: false, transformation: { origin: [0, 0], extent: [[-10, -10], [10, 10]], rotation: 0 } });
    expect('iconTransformation' in p!).toBe(false);
  });

  it('returns undefined when there is no Placement and defaults for an empty one', () => {
    expect(parsePlacement(undefined)).toBeUndefined();
    expect(parsePlacement(ann())).toBeUndefined();
    expect(parsePlacement(ann(rec('Line')))).toBeUndefined();
    expect(parsePlacement(ann(rec('Placement')))).toEqual({
      visible: true,
      transformation: { origin: [0, 0], extent: [[-10, -10], [10, 10]], rotation: 0 },
    });
  });

  it('falls back to defaults for malformed attributes and evaluates unary minus', () => {
    const p = parsePlacement(ann(rec(
      'Placement',
      val('visible', E.ref('showIt')),
      rec('transformation', val('origin', E.num(4)), val('extent', E.array([E.point(1, 1)])), val('rotation', E.neg(E.num(90)))),
    )));
    expect(p).toEqual({ visible: true, transformation: { origin: [0, 0], extent: [[-10, -10], [10, 10]], rotation: -90 } });
  });

  it('also accepts record-constructor and dotted-modifier forms', () => {
    const asCall = parsePlacement(ann(rec('Placement', val('transformation', E.call('Transformation', [], [named('origin', E.point(1, 2)), named('extent', extent(-5, -5, 5, 5))])))));
    expect(asCall!.transformation).toEqual({ origin: [1, 2], extent: [[-5, -5], [5, 5]], rotation: 0 });
    const dotted = parsePlacement(ann(rec('Placement', val('transformation.rotation', E.num(180)), val('transformation.origin', E.point(3, 4)))));
    expect(dotted!.transformation).toEqual({ origin: [3, 4], extent: [[-10, -10], [10, 10]], rotation: 180 });
  });
});

describe('parseConnectionLine', () => {
  it('reads a blue Bezier connection', () => {
    const l = parseConnectionLine(ann(rec(
      'Line',
      val('points', E.points([[-40, 0], [-20, 0], [-20, 30], [0, 30]])),
      val('color', color(0, 0, 127)),
      val('smooth', E.ref('Smooth', 'Bezier')),
    )));
    expect(l).toEqual({
      points: [[-40, 0], [-20, 0], [-20, 30], [0, 30]],
      color: [0, 0, 127],
      pattern: 'Solid',
      thickness: 0.25,
      smooth: 'Bezier',
      arrow: ['None', 'None'],
    });
  });

  it('reads pattern, thickness and arrows; defaults otherwise', () => {
    const l = parseConnectionLine(ann(rec(
      'Line',
      val('points', E.points([[0, 0], [10, 0]])),
      val('pattern', E.ref('LinePattern', 'Dash')),
      val('thickness', E.num(0.5)),
      val('arrow', E.array([E.ref('Arrow', 'None'), E.ref('Arrow', 'Filled')])),
    )));
    expect(l!.pattern).toBe('Dash');
    expect(l!.thickness).toBe(0.5);
    expect(l!.arrow).toEqual(['None', 'Filled']);
    expect(parseConnectionLine(ann(rec('Line')))).toEqual({
      points: [],
      color: [0, 0, 0],
      pattern: 'Solid',
      thickness: 0.25,
      smooth: 'None',
      arrow: ['None', 'None'],
    });
  });

  it('returns undefined without a Line annotation', () => {
    expect(parseConnectionLine(undefined)).toBeUndefined();
    expect(parseConnectionLine(ann(rec('Placement')))).toBeUndefined();
  });
});

describe('parseExperiment', () => {
  it('reads numeric settings and ignores vendor attributes', () => {
    const e = parseExperiment(ann(rec(
      'experiment',
      val('StopTime', E.num(10)),
      val('Tolerance', E.num(1e-6)),
      val('__Dymola_Algorithm', E.str('Dassl')),
    )));
    expect(e).toEqual({ StopTime: 10, Tolerance: 1e-6 });
  });

  it('reads all four attributes, evaluates arithmetic and drops non-constant values', () => {
    const e = parseExperiment(ann(rec(
      'experiment',
      val('StartTime', E.neg(E.num(1))),
      val('StopTime', E.bin('*', E.num(2), E.num(5))),
      val('Interval', E.ref('dt')),
      val('Tolerance', E.str('1e-4')),
    )));
    expect(e).toEqual({ StartTime: -1, StopTime: 10 });
  });

  it('returns undefined when absent and {} for an empty experiment()', () => {
    expect(parseExperiment(undefined)).toBeUndefined();
    expect(parseExperiment(resistorIcon())).toBeUndefined();
    expect(parseExperiment(ann(rec('experiment')))).toEqual({});
  });
});

describe('parseDocumentation', () => {
  it('reads info and revisions', () => {
    const d = parseDocumentation(ann(rec('Documentation', val('info', E.str('<html><p>Hi</p></html>')), val('revisions', E.str('<html>rev</html>')))));
    expect(d).toEqual({ info: '<html><p>Hi</p></html>', revisions: '<html>rev</html>' });
  });

  it('reads info only from the Resistor annotation, concatenates string literals and ignores non-strings', () => {
    expect(parseDocumentation(resistorIcon())).toEqual({ info: '<html><p>The linear resistor</p></html>' });
    expect(parseDocumentation(ann(rec('Documentation', val('info', E.bin('+', E.str('<html>'), E.str('</html>'))), val('revisions', E.num(3)))))).toEqual({ info: '<html></html>' });
    expect(parseDocumentation(ann(rec('Documentation')))).toEqual({});
    expect(parseDocumentation(undefined)).toBeUndefined();
    expect(parseDocumentation(ann(rec('Icon')))).toBeUndefined();
  });
});

describe('value readers', () => {
  it('evalNumber handles literals, unary and binary arithmetic, constants and rejects the rest', () => {
    expect(evalNumber(E.num(2))).toBe(2);
    expect(evalNumber(E.neg(E.num(2)))).toBe(-2);
    expect(evalNumber({ kind: 'unary', op: '+', operand: E.num(2) })).toBe(2);
    expect(evalNumber(E.bin('*', E.neg(E.num(1)), E.num(30)))).toBe(-30);
    expect(evalNumber(E.bin('^', E.num(2), E.num(3)))).toBe(8);
    expect(evalNumber(E.bin('*', E.bin('+', E.num(1), E.num(2)), E.num(3)))).toBe(9);
    expect(evalNumber(E.bin('/', E.num(1), E.num(0)))).toBeUndefined();
    expect(evalNumber(E.ref('R'))).toBeUndefined();
    expect(evalNumber(E.refPath('Modelica.Constants.pi'))).toBeCloseTo(Math.PI);
    expect(evalNumber(E.call('sin', [E.num(0)]))).toBeUndefined();
    expect(evalNumber(E.call('abs', [E.neg(E.num(3))]))).toBe(3);
    expect(evalNumber(E.str('3'))).toBeUndefined();
    expect(evalNumber(E.bool(true))).toBeUndefined();
    expect(evalNumber(undefined)).toBeUndefined();
    expect(evalNumber({ kind: 'if', branches: [{ cond: E.bool(false), value: E.num(1) }], else: E.num(2) })).toBe(2);
    expect(evalNumber({ kind: 'if', branches: [{ cond: E.ref('c'), value: E.num(1) }], else: E.num(2) })).toBeUndefined();
  });

  it('readEnum accepts qualified, bare and string literals', () => {
    expect(readEnum(E.ref('FillPattern', 'Solid'), FILL_PATTERNS)).toBe('Solid');
    expect(readEnum(E.ref('Solid'), FILL_PATTERNS)).toBe('Solid');
    expect(readEnum(E.str('Solid'), FILL_PATTERNS)).toBe('Solid');
    expect(readEnum(E.refPath('Modelica.Graphics.FillPattern.HorizontalCylinder'), FILL_PATTERNS)).toBe('HorizontalCylinder');
    expect(readEnum(E.ref('FillPattern', 'solid'), FILL_PATTERNS)).toBe('Solid');
    expect(readEnum(E.ref('FillPattern', 'Plaid'), FILL_PATTERNS)).toBeUndefined();
    expect(readEnum(E.num(1), FILL_PATTERNS)).toBeUndefined();
  });

  it('readColor rounds and clamps channels', () => {
    expect(readColor(color(0, 0, 255))).toEqual([0, 0, 255]);
    expect(readColor(color(255.4, 300, -1))).toEqual([255, 255, 0]);
    expect(readColor(E.array([E.num(1), E.num(2)]))).toBeUndefined();
    expect(readColor(E.array([E.num(1), E.num(2), E.ref('b')]))).toBeUndefined();
  });
});
