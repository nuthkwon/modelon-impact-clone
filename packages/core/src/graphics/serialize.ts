/**
 * Serialization of graphical annotation objects back into annotation ASTs (`Modifier`s) that
 * `graphics/annotations.ts` reads back identically and that the canonical printer turns into
 * Modelica text such as
 *
 *     Placement(transformation(extent={{-10,-10},{10,10}}, rotation=90))
 *     Line(points={{-40,0},{0,0}}, color={0,0,127}, smooth=Smooth.Bezier)
 *     Icon(coordinateSystem(extent={{-100,-100},{100,100}}), graphics={Rectangle(...)})
 *
 * Attributes equal to their specification defaults are omitted, except `extent` of a
 * transformation, `points` of a line/polygon and `extent` of a coordinate system, which are
 * always written. Numbers are rounded to at most 6 decimals.
 */
import type { Expr, Modifier, NamedArg } from '../ast.js';
import { E } from '../ast.js';
import type {
  Arrow,
  BitmapItem,
  Color,
  ConnectionLine,
  CoordinateSystem,
  EllipseItem,
  Extent,
  FilledShapeProps,
  GraphicItem,
  GraphicItemBase,
  GraphicsLayer,
  LineItem,
  Placement,
  Point,
  PolygonItem,
  RectangleItem,
  TextItem,
  Transformation,
} from '../graphics.js';
import { BLACK, DEFAULT_COORDINATE_SYSTEM } from '../graphics.js';
import { DEFAULT_TRANSFORMATION } from './annotations.js';

// ---------------------------------------------------------------------------
// Expression builders
// ---------------------------------------------------------------------------

/** Rounds to at most 6 decimals (integers stay integers); never emits -0 or NaN. */
export function roundNumber(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const r = Math.round(v * 1e6) / 1e6;
  return r === 0 ? 0 : r;
}

export function numberExpr(v: number): Expr {
  return E.num(roundNumber(v));
}

export function pointExpr(p: Point): Expr {
  return E.array([numberExpr(p[0]), numberExpr(p[1])]);
}

export function pointsExpr(points: Point[]): Expr {
  return E.array(points.map(pointExpr));
}

export function extentExpr(e: Extent): Expr {
  return E.array([pointExpr(e[0]), pointExpr(e[1])]);
}

export function colorExpr(c: Color): Expr {
  return E.array(c.map((ch) => E.num(Math.min(255, Math.max(0, Math.round(ch))))));
}

/** `FillPattern.Solid`, `Smooth.Bezier`, ... */
export function enumExpr(typeName: string, literal: string): Expr {
  return E.ref(typeName, literal);
}

/** A `name = value` element modification. */
export function valueModifier(name: string, value: Expr): Modifier {
  return { name, modification: { mods: [], value } };
}

/** A nested record modification `name(mods...)`. */
export function nestedModifier(name: string, mods: Modifier[]): Modifier {
  return { name, modification: { mods } };
}

function sameColor(a: Color, b: Color): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function samePoint(a: Point, b: Point): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function sameExtent(a: Extent, b: Extent): boolean {
  return samePoint(a[0], b[0]) && samePoint(a[1], b[1]);
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

/** `transformation(origin={x,y}, extent={{..},{..}}, rotation=r)` — origin/rotation only when non-default. */
export function transformationToModifier(t: Transformation, name: 'transformation' | 'iconTransformation' = 'transformation'): Modifier {
  const mods: Modifier[] = [];
  if (!samePoint(t.origin, DEFAULT_TRANSFORMATION.origin)) mods.push(valueModifier('origin', pointExpr(t.origin)));
  mods.push(valueModifier('extent', extentExpr(t.extent)));
  if (roundNumber(t.rotation) !== DEFAULT_TRANSFORMATION.rotation) mods.push(valueModifier('rotation', numberExpr(t.rotation)));
  return nestedModifier(name, mods);
}

/** `Placement(visible=..., transformation(origin={x,y}, extent={{..},{..}}, rotation=r))` as a Modifier. */
export function placementToModifier(p: Placement): Modifier {
  const mods: Modifier[] = [];
  if (p.visible === false) mods.push(valueModifier('visible', E.bool(false)));
  mods.push(transformationToModifier(p.transformation, 'transformation'));
  if (p.iconTransformation) mods.push(transformationToModifier(p.iconTransformation, 'iconTransformation'));
  return nestedModifier('Placement', mods);
}

// ---------------------------------------------------------------------------
// Connection Line
// ---------------------------------------------------------------------------

function arrowExpr(arrow: [Arrow, Arrow]): Expr {
  return E.array([enumExpr('Arrow', arrow[0]), enumExpr('Arrow', arrow[1])]);
}

/** `Line(points={{..},{..}}, color={r,g,b}, ...)` as a Modifier. */
export function connectionLineToModifier(l: ConnectionLine): Modifier {
  const mods: Modifier[] = [valueModifier('points', pointsExpr(l.points))];
  if (!sameColor(l.color, BLACK)) mods.push(valueModifier('color', colorExpr(l.color)));
  if (l.pattern !== 'Solid') mods.push(valueModifier('pattern', enumExpr('LinePattern', l.pattern)));
  if (roundNumber(l.thickness) !== 0.25) mods.push(valueModifier('thickness', numberExpr(l.thickness)));
  if (l.arrow[0] !== 'None' || l.arrow[1] !== 'None') mods.push(valueModifier('arrow', arrowExpr(l.arrow)));
  if (l.smooth !== 'None') mods.push(valueModifier('smooth', enumExpr('Smooth', l.smooth)));
  return nestedModifier('Line', mods);
}

// ---------------------------------------------------------------------------
// Graphic primitives
// ---------------------------------------------------------------------------

function named(name: string, value: Expr): NamedArg {
  return { name, value };
}

function baseArgs(item: GraphicItemBase): NamedArg[] {
  const args: NamedArg[] = [];
  if (item.visible === false) args.push(named('visible', E.bool(false)));
  if (!samePoint(item.origin, [0, 0])) args.push(named('origin', pointExpr(item.origin)));
  if (roundNumber(item.rotation) !== 0) args.push(named('rotation', numberExpr(item.rotation)));
  return args;
}

function filledShapeArgs(item: FilledShapeProps): NamedArg[] {
  const args: NamedArg[] = [];
  if (!sameColor(item.lineColor, BLACK)) args.push(named('lineColor', colorExpr(item.lineColor)));
  if (!sameColor(item.fillColor, BLACK)) args.push(named('fillColor', colorExpr(item.fillColor)));
  if (item.pattern !== 'Solid') args.push(named('pattern', enumExpr('LinePattern', item.pattern)));
  if (item.fillPattern !== 'None') args.push(named('fillPattern', enumExpr('FillPattern', item.fillPattern)));
  if (roundNumber(item.lineThickness) !== 0.25) args.push(named('lineThickness', numberExpr(item.lineThickness)));
  return args;
}

function lineArgs(item: LineItem): NamedArg[] {
  const args: NamedArg[] = [named('points', pointsExpr(item.points))];
  if (!sameColor(item.color, BLACK)) args.push(named('color', colorExpr(item.color)));
  if (item.pattern !== 'Solid') args.push(named('pattern', enumExpr('LinePattern', item.pattern)));
  if (roundNumber(item.thickness) !== 0.25) args.push(named('thickness', numberExpr(item.thickness)));
  if (item.arrow[0] !== 'None' || item.arrow[1] !== 'None') args.push(named('arrow', arrowExpr(item.arrow)));
  if (roundNumber(item.arrowSize) !== 3) args.push(named('arrowSize', numberExpr(item.arrowSize)));
  if (item.smooth !== 'None') args.push(named('smooth', enumExpr('Smooth', item.smooth)));
  return args;
}

function polygonArgs(item: PolygonItem): NamedArg[] {
  const args: NamedArg[] = [named('points', pointsExpr(item.points)), ...filledShapeArgs(item)];
  if (item.smooth !== 'None') args.push(named('smooth', enumExpr('Smooth', item.smooth)));
  return args;
}

function rectangleArgs(item: RectangleItem): NamedArg[] {
  const args: NamedArg[] = [named('extent', extentExpr(item.extent)), ...filledShapeArgs(item)];
  if (item.borderPattern !== 'None') args.push(named('borderPattern', enumExpr('BorderPattern', item.borderPattern)));
  if (roundNumber(item.radius) !== 0) args.push(named('radius', numberExpr(item.radius)));
  return args;
}

function ellipseArgs(item: EllipseItem): NamedArg[] {
  const args: NamedArg[] = [named('extent', extentExpr(item.extent)), ...filledShapeArgs(item)];
  if (roundNumber(item.startAngle) !== 0) args.push(named('startAngle', numberExpr(item.startAngle)));
  if (roundNumber(item.endAngle) !== 360) args.push(named('endAngle', numberExpr(item.endAngle)));
  if (item.closure !== 'Chord') args.push(named('closure', enumExpr('EllipseClosure', item.closure)));
  return args;
}

function textArgs(item: TextItem): NamedArg[] {
  const args: NamedArg[] = [
    named('extent', extentExpr(item.extent)),
    named('textString', E.str(item.textString)),
    ...filledShapeArgs(item),
  ];
  // The parser defaults textColor to lineColor, so only a differing textColor needs writing.
  if (!sameColor(item.textColor, item.lineColor)) args.push(named('textColor', colorExpr(item.textColor)));
  if (roundNumber(item.fontSize) !== 0) args.push(named('fontSize', numberExpr(item.fontSize)));
  if (item.fontName !== '') args.push(named('fontName', E.str(item.fontName)));
  if (item.horizontalAlignment !== 'Center') args.push(named('horizontalAlignment', enumExpr('TextAlignment', item.horizontalAlignment)));
  if (item.textStyle.length > 0) args.push(named('textStyle', E.array(item.textStyle.map((s) => enumExpr('TextStyle', s)))));
  return args;
}

function bitmapArgs(item: BitmapItem): NamedArg[] {
  const args: NamedArg[] = [named('extent', extentExpr(item.extent))];
  if (item.fileName !== undefined) args.push(named('fileName', E.str(item.fileName)));
  if (item.imageSource !== undefined) args.push(named('imageSource', E.str(item.imageSource)));
  return args;
}

/** One graphic primitive as a record-constructor call expression, e.g. `Rectangle(extent=..., ...)`. */
export function graphicItemToExpr(item: GraphicItem): Expr {
  let args: NamedArg[];
  switch (item.kind) {
    case 'Line': args = lineArgs(item); break;
    case 'Polygon': args = polygonArgs(item); break;
    case 'Rectangle': args = rectangleArgs(item); break;
    case 'Ellipse': args = ellipseArgs(item); break;
    case 'Text': args = textArgs(item); break;
    case 'Bitmap': args = bitmapArgs(item); break;
  }
  return E.call(item.kind, [], [...baseArgs(item), ...args]);
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

/** `coordinateSystem(extent=..., preserveAspectRatio=..., initialScale=..., grid=...)` — extent always, rest when non-default. */
export function coordinateSystemToModifier(cs: CoordinateSystem): Modifier {
  const d = DEFAULT_COORDINATE_SYSTEM;
  const mods: Modifier[] = [valueModifier('extent', extentExpr(cs.extent))];
  if (cs.preserveAspectRatio !== d.preserveAspectRatio) mods.push(valueModifier('preserveAspectRatio', E.bool(cs.preserveAspectRatio)));
  if (roundNumber(cs.initialScale) !== d.initialScale) mods.push(valueModifier('initialScale', numberExpr(cs.initialScale)));
  if (!samePoint(cs.grid, d.grid)) mods.push(valueModifier('grid', pointExpr(cs.grid)));
  return nestedModifier('coordinateSystem', mods);
}

/** `Icon(coordinateSystem(...), graphics={...})` as a Modifier (`graphics` omitted when empty). */
export function graphicsLayerToModifier(layer: GraphicsLayer, kind: 'Icon' | 'Diagram'): Modifier {
  const mods: Modifier[] = [coordinateSystemToModifier(layer.coordinateSystem)];
  if (layer.graphics.length > 0) {
    mods.push(valueModifier('graphics', E.array(layer.graphics.map(graphicItemToExpr))));
  }
  return nestedModifier(kind, mods);
}

export { sameColor as colorsEqual, sameExtent as extentsEqual, samePoint as pointsEqual };
