/**
 * Graphical annotation model (Modelica Specification chapter 18) as interpreted from
 * `annotation(Icon(...))`, `annotation(Diagram(...))`, `annotation(Placement(...))` and
 * connection `annotation(Line(...))`.
 *
 * Coordinates follow Modelica conventions: y grows upwards, class coordinate systems
 * default to extent {{-100,-100},{100,100}}. Renderers must flip the y axis.
 */

export type Point = [number, number];
export type Extent = [Point, Point];
export type Color = [number, number, number];

export type LinePattern = 'None' | 'Solid' | 'Dash' | 'Dot' | 'DashDot' | 'DashDotDot';
export type FillPattern =
  | 'None' | 'Solid' | 'Horizontal' | 'Vertical' | 'Cross' | 'Forward' | 'Backward' | 'CrossDiag'
  | 'HorizontalCylinder' | 'VerticalCylinder' | 'Sphere';
export type BorderPattern = 'None' | 'Raised' | 'Sunken' | 'Engraved';
export type Smooth = 'None' | 'Bezier';
export type Arrow = 'None' | 'Open' | 'Filled' | 'Half';
export type TextStyle = 'Bold' | 'Italic' | 'UnderLine';
export type TextAlignment = 'Left' | 'Center' | 'Right';
export type EllipseClosure = 'None' | 'Chord' | 'Radial';

export interface GraphicItemBase {
  visible: boolean;
  origin: Point;
  rotation: number;
}

export interface FilledShapeProps {
  lineColor: Color;
  fillColor: Color;
  pattern: LinePattern;
  fillPattern: FillPattern;
  lineThickness: number;
}

export interface LineItem extends GraphicItemBase {
  kind: 'Line';
  points: Point[];
  color: Color;
  pattern: LinePattern;
  thickness: number;
  arrow: [Arrow, Arrow];
  arrowSize: number;
  smooth: Smooth;
}

export interface PolygonItem extends GraphicItemBase, FilledShapeProps {
  kind: 'Polygon';
  points: Point[];
  smooth: Smooth;
}

export interface RectangleItem extends GraphicItemBase, FilledShapeProps {
  kind: 'Rectangle';
  extent: Extent;
  borderPattern: BorderPattern;
  radius: number;
}

export interface EllipseItem extends GraphicItemBase, FilledShapeProps {
  kind: 'Ellipse';
  extent: Extent;
  startAngle: number;
  endAngle: number;
  closure: EllipseClosure;
}

export interface TextItem extends GraphicItemBase, FilledShapeProps {
  kind: 'Text';
  extent: Extent;
  /** Raw text; may contain `%name`, `%R`, `%class` placeholders that renderers substitute. */
  textString: string;
  fontSize: number;
  fontName: string;
  textColor: Color;
  horizontalAlignment: TextAlignment;
  textStyle: TextStyle[];
}

export interface BitmapItem extends GraphicItemBase {
  kind: 'Bitmap';
  extent: Extent;
  fileName?: string;
  imageSource?: string;
}

export type GraphicItem = LineItem | PolygonItem | RectangleItem | EllipseItem | TextItem | BitmapItem;

export interface CoordinateSystem {
  extent: Extent;
  preserveAspectRatio: boolean;
  initialScale: number;
  grid: Point;
}

/** An `Icon(...)` or `Diagram(...)` annotation. */
export interface GraphicsLayer {
  coordinateSystem: CoordinateSystem;
  graphics: GraphicItem[];
}

export interface Transformation {
  origin: Point;
  extent: Extent;
  rotation: number;
}

/** A component `Placement(...)` annotation. */
export interface Placement {
  visible: boolean;
  transformation: Transformation;
  /** Used for connectors when shown on the icon layer of the enclosing class. */
  iconTransformation?: Transformation;
}

/** A connection `Line(...)` annotation. */
export interface ConnectionLine {
  points: Point[];
  color: Color;
  pattern: LinePattern;
  thickness: number;
  smooth: Smooth;
  arrow: [Arrow, Arrow];
}

export const DEFAULT_COORDINATE_SYSTEM: CoordinateSystem = {
  extent: [[-100, -100], [100, 100]],
  preserveAspectRatio: true,
  initialScale: 0.1,
  grid: [2, 2],
};

export const BLACK: Color = [0, 0, 0];
export const WHITE: Color = [255, 255, 255];
export const MODELICA_BLUE: Color = [0, 0, 255];

export function colorToCss(c: Color): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
