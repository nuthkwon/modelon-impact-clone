/**
 * Interpretation of graphical annotations (Modelica Specification 3.5, chapter 18).
 *
 * Annotations reach us as `Modification` ASTs: `annotation(Icon(coordinateSystem(...),
 * graphics={Rectangle(...), Line(...)}), Documentation(info="..."))` is a Modification whose
 * `mods` are Modifiers named `Icon`, `Documentation`, ... Record constructors used inside
 * annotations (`Rectangle(extent=..., lineColor=...)`, `coordinateSystem(...)`,
 * `transformation(...)`) may appear either as nested Modifiers (`transformation(origin=...)`)
 * or as `call` expressions (`graphics={Rectangle(...)}`); both forms are read the same way.
 *
 * Every reader is tolerant: unknown primitives are skipped, malformed or non-constant values
 * fall back to the specification defaults, and nothing in this module throws.
 */
import type { Expr, Modification, Modifier, NamedArg } from '../ast.js';
import type { ExperimentAnnotation } from '../flat.js';
import type {
  Arrow,
  BitmapItem,
  BorderPattern,
  Color,
  ConnectionLine,
  CoordinateSystem,
  EllipseClosure,
  EllipseItem,
  Extent,
  FillPattern,
  FilledShapeProps,
  GraphicItem,
  GraphicItemBase,
  GraphicsLayer,
  LineItem,
  LinePattern,
  Placement,
  Point,
  PolygonItem,
  RectangleItem,
  Smooth,
  TextAlignment,
  TextItem,
  TextStyle,
  Transformation,
} from '../graphics.js';
import { BLACK, DEFAULT_COORDINATE_SYSTEM } from '../graphics.js';

// ---------------------------------------------------------------------------
// Enumeration literal sets
// ---------------------------------------------------------------------------

export const LINE_PATTERNS: readonly LinePattern[] = ['None', 'Solid', 'Dash', 'Dot', 'DashDot', 'DashDotDot'];
export const FILL_PATTERNS: readonly FillPattern[] = [
  'None', 'Solid', 'Horizontal', 'Vertical', 'Cross', 'Forward', 'Backward', 'CrossDiag',
  'HorizontalCylinder', 'VerticalCylinder', 'Sphere',
];
export const BORDER_PATTERNS: readonly BorderPattern[] = ['None', 'Raised', 'Sunken', 'Engraved'];
export const SMOOTHS: readonly Smooth[] = ['None', 'Bezier'];
export const ARROWS: readonly Arrow[] = ['None', 'Open', 'Filled', 'Half'];
export const TEXT_STYLES: readonly TextStyle[] = ['Bold', 'Italic', 'UnderLine'];
export const TEXT_ALIGNMENTS: readonly TextAlignment[] = ['Left', 'Center', 'Right'];
export const ELLIPSE_CLOSURES: readonly EllipseClosure[] = ['None', 'Chord', 'Radial'];

/** Default `transformation(...)` of a `Placement`. */
export const DEFAULT_TRANSFORMATION: Transformation = {
  origin: [0, 0],
  extent: [[-10, -10], [10, 10]],
  rotation: 0,
};

// ---------------------------------------------------------------------------
// Generic record access: a Modification or a record-constructor call, seen as named fields
// ---------------------------------------------------------------------------

/**
 * Uniform read access to the attributes of an annotation record, whichever AST shape it has:
 * a Modifier with nested `mods` (`transformation(origin={0,0})`) or a `call` expression
 * (`Rectangle(extent=...)`). Positional call arguments are exposed through `positional`.
 */
interface Fields {
  /** Value expression of attribute `name`, if it has one. */
  get(name: string): Expr | undefined;
  /** Attribute `name` seen as a nested record, if it is one. */
  sub(name: string): Fields | undefined;
  /** Positional arguments (record constructor calls only). */
  positional: Expr[];
}

/** Expands dotted modifier names (`transformation.rotation = 90`) into nested modifiers. */
function expandDotted(mods: Modifier[]): Modifier[] {
  if (!mods.some((m) => m.name.includes('.'))) return mods;
  const out: Modifier[] = [];
  for (const m of mods) {
    const dot = m.name.indexOf('.');
    if (dot < 0) {
      out.push(m);
      continue;
    }
    const head = m.name.slice(0, dot);
    const rest: Modifier = { name: m.name.slice(dot + 1), modification: m.modification };
    const existing = out.find((o) => o.name === head);
    if (existing) {
      existing.modification = { ...existing.modification, mods: [...existing.modification.mods, rest] };
    } else {
      out.push({ name: head, modification: { mods: [rest] } });
    }
  }
  return out;
}

function fieldsOfModification(mod: Modification): Fields {
  const mods = expandDotted(mod.mods ?? []);
  const find = (name: string): Modifier | undefined => mods.find((m) => m.name === name);
  return {
    positional: [],
    get(name) {
      const m = find(name);
      if (!m) return undefined;
      if (m.modification.value) return m.modification.value;
      return undefined;
    },
    sub(name) {
      const m = find(name);
      if (!m) return undefined;
      if (m.modification.mods && m.modification.mods.length > 0) return fieldsOfModification(m.modification);
      const v = m.modification.value ? unwrapDynamicSelect(m.modification.value) : undefined;
      if (v && v.kind === 'call') return fieldsOfCall(v);
      // A modifier without value and without nested mods (`transformation()`): empty record.
      if (!m.modification.value) return fieldsOfModification({ mods: [] });
      return undefined;
    },
  };
}

function fieldsOfCall(call: Extract<Expr, { kind: 'call' }>): Fields {
  const named: NamedArg[] = call.namedArgs ?? [];
  const find = (name: string): Expr | undefined => named.find((a) => a.name === name)?.value;
  return {
    positional: call.args ?? [],
    get: find,
    sub(name) {
      const v = find(name);
      if (!v) return undefined;
      const u = unwrapDynamicSelect(v);
      return u.kind === 'call' ? fieldsOfCall(u) : undefined;
    },
  };
}

/** Finds the top-level annotation entry `name` (e.g. `Icon`, `Placement`) as fields. */
function annotationEntry(annotation: Modification | undefined, name: string): Fields | undefined {
  if (!annotation || !Array.isArray(annotation.mods)) return undefined;
  return fieldsOfModification(annotation).sub(name);
}

/** True if the annotation has an entry named `name` (even an empty one). */
export function hasAnnotation(annotation: Modification | undefined, name: string): boolean {
  if (!annotation || !Array.isArray(annotation.mods)) return false;
  return expandDotted(annotation.mods).some((m) => m.name === name);
}

/** Returns the `Modifier` of the annotation entry `name`, if present. */
export function findAnnotation(annotation: Modification | undefined, name: string): Modifier | undefined {
  if (!annotation || !Array.isArray(annotation.mods)) return undefined;
  return expandDotted(annotation.mods).find((m) => m.name === name);
}

// ---------------------------------------------------------------------------
// Value readers (all return undefined for malformed / non-constant input)
// ---------------------------------------------------------------------------

/** `DynamicSelect(static, dynamic)` → `static`. Applied recursively. */
export function unwrapDynamicSelect(e: Expr): Expr {
  let cur = e;
  for (let guard = 0; guard < 8; guard++) {
    if (cur.kind === 'call' && cur.callee === 'DynamicSelect' && cur.args.length > 0) {
      cur = cur.args[0];
    } else {
      return cur;
    }
  }
  return cur;
}

/**
 * Evaluates a constant numeric expression: literals, unary +/-, binary `+ - * / ^`,
 * `DynamicSelect`, a few well-known constants. Returns undefined when the expression is not
 * a constant (a reference to a parameter, a function call, ...).
 */
export function evalNumber(e: Expr | undefined): number | undefined {
  if (!e) return undefined;
  const x = unwrapDynamicSelect(e);
  switch (x.kind) {
    case 'number':
      return Number.isFinite(x.value) ? x.value : undefined;
    case 'boolean':
      return undefined;
    case 'unary': {
      const v = evalNumber(x.operand);
      if (v === undefined) return undefined;
      if (x.op === '-') return -v;
      if (x.op === '+') return v;
      return undefined;
    }
    case 'binary': {
      const l = evalNumber(x.left);
      const r = evalNumber(x.right);
      if (l === undefined || r === undefined) return undefined;
      let v: number;
      switch (x.op) {
        case '+': case '.+': v = l + r; break;
        case '-': case '.-': v = l - r; break;
        case '*': case '.*': v = l * r; break;
        case '/': case './': v = r === 0 ? NaN : l / r; break;
        case '^': case '.^': v = Math.pow(l, r); break;
        default: return undefined;
      }
      return Number.isFinite(v) ? v : undefined;
    }
    case 'if': {
      // Only constant conditions can be folded.
      for (const br of x.branches) {
        const c = evalBoolean(br.cond);
        if (c === undefined) return undefined;
        if (c) return evalNumber(br.value);
      }
      return evalNumber(x.else);
    }
    case 'ref': {
      const dotted = x.parts.map((p) => p.name).join('.');
      if (dotted === 'Modelica.Constants.pi' || dotted === 'Constants.pi' || dotted === 'pi') return Math.PI;
      if (dotted === 'Modelica.Constants.e' || dotted === 'Constants.e') return Math.E;
      return undefined;
    }
    case 'call': {
      const args = x.args.map(evalNumber);
      if (args.some((a) => a === undefined)) return undefined;
      const a = args as number[];
      switch (x.callee) {
        case 'abs': return a.length === 1 ? Math.abs(a[0]) : undefined;
        case 'sqrt': return a.length === 1 && a[0] >= 0 ? Math.sqrt(a[0]) : undefined;
        case 'min': return a.length >= 1 ? Math.min(...a) : undefined;
        case 'max': return a.length >= 1 ? Math.max(...a) : undefined;
        case 'integer': case 'floor': return a.length === 1 ? Math.floor(a[0]) : undefined;
        case 'ceil': return a.length === 1 ? Math.ceil(a[0]) : undefined;
        default: return undefined;
      }
    }
    default:
      return undefined;
  }
}

/** Boolean literal (or `not`/`DynamicSelect` of one); undefined otherwise. */
export function evalBoolean(e: Expr | undefined): boolean | undefined {
  if (!e) return undefined;
  const x = unwrapDynamicSelect(e);
  if (x.kind === 'boolean') return x.value;
  if (x.kind === 'unary' && x.op === 'not') {
    const v = evalBoolean(x.operand);
    return v === undefined ? undefined : !v;
  }
  if (x.kind === 'binary' && (x.op === 'and' || x.op === 'or')) {
    const l = evalBoolean(x.left);
    const r = evalBoolean(x.right);
    if (l === undefined || r === undefined) return undefined;
    return x.op === 'and' ? l && r : l || r;
  }
  return undefined;
}

/** String literal, `+` concatenation of literals or `DynamicSelect` of one; undefined otherwise. */
export function evalString(e: Expr | undefined): string | undefined {
  if (!e) return undefined;
  const x = unwrapDynamicSelect(e);
  if (x.kind === 'string') return x.value;
  if (x.kind === 'binary' && x.op === '+') {
    const l = evalString(x.left);
    const r = evalString(x.right);
    if (l === undefined || r === undefined) return undefined;
    return l + r;
  }
  return undefined;
}

/** `{x, y}` → Point. */
export function readPoint(e: Expr | undefined): Point | undefined {
  if (!e) return undefined;
  const x = unwrapDynamicSelect(e);
  if (x.kind !== 'array' || x.elements.length !== 2) return undefined;
  const px = evalNumber(x.elements[0]);
  const py = evalNumber(x.elements[1]);
  if (px === undefined || py === undefined) return undefined;
  return [px, py];
}

/** `{{x1,y1},{x2,y2},...}` → Point[]; malformed points are skipped. Undefined if not an array. */
export function readPoints(e: Expr | undefined): Point[] | undefined {
  if (!e) return undefined;
  const x = unwrapDynamicSelect(e);
  if (x.kind !== 'array') return undefined;
  const pts: Point[] = [];
  for (const el of x.elements) {
    const p = readPoint(el);
    if (p) pts.push(p);
  }
  return pts;
}

/** `{{x1,y1},{x2,y2}}` → Extent. */
export function readExtent(e: Expr | undefined): Extent | undefined {
  if (!e) return undefined;
  const x = unwrapDynamicSelect(e);
  if (x.kind !== 'array' || x.elements.length !== 2) return undefined;
  const p1 = readPoint(x.elements[0]);
  const p2 = readPoint(x.elements[1]);
  if (!p1 || !p2) return undefined;
  return [p1, p2];
}

function clampChannel(v: number): number {
  return Math.min(255, Math.max(0, Math.round(v)));
}

/** `{r,g,b}` → Color with channels rounded and clamped to 0..255. */
export function readColor(e: Expr | undefined): Color | undefined {
  if (!e) return undefined;
  const x = unwrapDynamicSelect(e);
  if (x.kind !== 'array' || x.elements.length !== 3) return undefined;
  const r = evalNumber(x.elements[0]);
  const g = evalNumber(x.elements[1]);
  const b = evalNumber(x.elements[2]);
  if (r === undefined || g === undefined || b === undefined) return undefined;
  return [clampChannel(r), clampChannel(g), clampChannel(b)];
}

/**
 * Enumeration literal: `FillPattern.Solid`, bare `Solid`, or the string `"Solid"`. Only literals
 * from `allowed` are accepted (case-sensitive first, then case-insensitive).
 */
export function readEnum<T extends string>(e: Expr | undefined, allowed: readonly T[]): T | undefined {
  if (!e) return undefined;
  const x = unwrapDynamicSelect(e);
  let literal: string | undefined;
  if (x.kind === 'ref' && x.parts.length > 0) literal = x.parts[x.parts.length - 1].name;
  else if (x.kind === 'string') literal = x.value.includes('.') ? x.value.slice(x.value.lastIndexOf('.') + 1) : x.value;
  if (literal === undefined) return undefined;
  const exact = allowed.find((a) => a === literal);
  if (exact) return exact;
  const lower = literal.toLowerCase();
  return allowed.find((a) => a.toLowerCase() === lower);
}

/** `{A.x, A.y}` → array of enum literals (malformed entries dropped). */
function readEnumArray<T extends string>(e: Expr | undefined, allowed: readonly T[]): T[] | undefined {
  if (!e) return undefined;
  const x = unwrapDynamicSelect(e);
  if (x.kind !== 'array') {
    const single = readEnum(x, allowed);
    return single ? [single] : undefined;
  }
  const out: T[] = [];
  for (const el of x.elements) {
    const v = readEnum(el, allowed);
    if (v) out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Field-level helpers with defaults
// ---------------------------------------------------------------------------

const num = (f: Fields, name: string, dflt: number): number => evalNumber(f.get(name)) ?? dflt;
const bool = (f: Fields, name: string, dflt: boolean): boolean => evalBoolean(f.get(name)) ?? dflt;
const str = (f: Fields, name: string, dflt: string): string => evalString(f.get(name)) ?? dflt;
const color = (f: Fields, name: string, dflt: Color): Color => readColor(f.get(name)) ?? copyColor(dflt);
const point = (f: Fields, name: string, dflt: Point): Point => readPoint(f.get(name)) ?? [dflt[0], dflt[1]];
const extent = (f: Fields, name: string, dflt: Extent): Extent => readExtent(f.get(name)) ?? copyExtent(dflt);
const en = <T extends string>(f: Fields, name: string, allowed: readonly T[], dflt: T): T =>
  readEnum(f.get(name), allowed) ?? dflt;

function copyColor(c: Color): Color {
  return [c[0], c[1], c[2]];
}
function copyExtent(e: Extent): Extent {
  return [[e[0][0], e[0][1]], [e[1][0], e[1][1]]];
}

// ---------------------------------------------------------------------------
// Graphic primitives
// ---------------------------------------------------------------------------

/**
 * GraphicItem base attributes. Named arguments win; the positional prefix of a record
 * constructor (`visible, origin, rotation`) is honoured when its values are simple.
 */
function readGraphicItemBase(f: Fields): GraphicItemBase {
  const pos = f.positional;
  const visible = evalBoolean(f.get('visible')) ?? evalBoolean(pos[0]) ?? true;
  const origin = readPoint(f.get('origin')) ?? readPoint(pos[1]) ?? [0, 0];
  const rotation = evalNumber(f.get('rotation')) ?? evalNumber(pos[2]) ?? 0;
  return { visible, origin, rotation };
}

function readFilledShape(f: Fields): FilledShapeProps {
  return {
    lineColor: color(f, 'lineColor', BLACK),
    fillColor: color(f, 'fillColor', BLACK),
    pattern: en(f, 'pattern', LINE_PATTERNS, 'Solid'),
    fillPattern: en(f, 'fillPattern', FILL_PATTERNS, 'None'),
    lineThickness: num(f, 'lineThickness', 0.25),
  };
}

function readArrowPair(f: Fields): [Arrow, Arrow] {
  const arr = readEnumArray(f.get('arrow'), ARROWS);
  if (!arr || arr.length === 0) return ['None', 'None'];
  if (arr.length === 1) return [arr[0], arr[0]];
  return [arr[0], arr[1]];
}

const DEFAULT_ITEM_EXTENT: Extent = [[0, 0], [0, 0]];

/** Reads one graphic primitive (`Rectangle(...)`, `Line(...)`, ...). Unknown primitives → undefined. */
export function parseGraphicItem(e: Expr): GraphicItem | undefined {
  const x = unwrapDynamicSelect(e);
  if (x.kind !== 'call') return undefined;
  const f = fieldsOfCall(x);
  const callee = x.callee.includes('.') ? x.callee.slice(x.callee.lastIndexOf('.') + 1) : x.callee;
  switch (callee) {
    case 'Line': {
      const item: LineItem = {
        kind: 'Line',
        ...readGraphicItemBase(f),
        points: readPoints(f.get('points')) ?? [],
        color: color(f, 'color', BLACK),
        pattern: en(f, 'pattern', LINE_PATTERNS, 'Solid'),
        thickness: num(f, 'thickness', 0.25),
        arrow: readArrowPair(f),
        arrowSize: num(f, 'arrowSize', 3),
        smooth: en(f, 'smooth', SMOOTHS, 'None'),
      };
      return item;
    }
    case 'Polygon': {
      const item: PolygonItem = {
        kind: 'Polygon',
        ...readGraphicItemBase(f),
        ...readFilledShape(f),
        points: readPoints(f.get('points')) ?? [],
        smooth: en(f, 'smooth', SMOOTHS, 'None'),
      };
      return item;
    }
    case 'Rectangle': {
      const item: RectangleItem = {
        kind: 'Rectangle',
        ...readGraphicItemBase(f),
        ...readFilledShape(f),
        extent: readExtent(f.get('extent')) ?? readExtent(f.positional[0]) ?? copyExtent(DEFAULT_ITEM_EXTENT),
        borderPattern: en(f, 'borderPattern', BORDER_PATTERNS, 'None'),
        radius: num(f, 'radius', 0),
      };
      return item;
    }
    case 'Ellipse': {
      const item: EllipseItem = {
        kind: 'Ellipse',
        ...readGraphicItemBase(f),
        ...readFilledShape(f),
        extent: extent(f, 'extent', DEFAULT_ITEM_EXTENT),
        startAngle: num(f, 'startAngle', 0),
        endAngle: num(f, 'endAngle', 360),
        closure: en(f, 'closure', ELLIPSE_CLOSURES, 'Chord'),
      };
      return item;
    }
    case 'Text': {
      const filled = readFilledShape(f);
      // MSL 3.x wrote `lineColor` for text colour; 4.x writes `textColor`. `textColor` wins.
      const textColor = readColor(f.get('textColor')) ?? copyColor(filled.lineColor);
      const item: TextItem = {
        kind: 'Text',
        ...readGraphicItemBase(f),
        ...filled,
        extent: extent(f, 'extent', DEFAULT_ITEM_EXTENT),
        textString: str(f, 'textString', str(f, 'string', '')),
        fontSize: num(f, 'fontSize', 0),
        fontName: str(f, 'fontName', ''),
        textColor,
        horizontalAlignment: en(f, 'horizontalAlignment', TEXT_ALIGNMENTS, 'Center'),
        textStyle: readEnumArray(f.get('textStyle'), TEXT_STYLES) ?? [],
      };
      return item;
    }
    case 'Bitmap': {
      const item: BitmapItem = {
        kind: 'Bitmap',
        ...readGraphicItemBase(f),
        extent: extent(f, 'extent', DEFAULT_ITEM_EXTENT),
      };
      const fileName = evalString(f.get('fileName'));
      const imageSource = evalString(f.get('imageSource'));
      if (fileName !== undefined) item.fileName = fileName;
      if (imageSource !== undefined) item.imageSource = imageSource;
      return item;
    }
    default:
      return undefined;
  }
}

/** Reads a `graphics={...}` value: an array of primitives (or a single primitive). */
export function parseGraphicItems(e: Expr | undefined): GraphicItem[] {
  if (!e) return [];
  const x = unwrapDynamicSelect(e);
  const elements = x.kind === 'array' ? x.elements : [x];
  const items: GraphicItem[] = [];
  for (const el of elements) {
    const item = parseGraphicItem(el);
    if (item) items.push(item);
  }
  return items;
}

// ---------------------------------------------------------------------------
// Coordinate system, layers
// ---------------------------------------------------------------------------

function readCoordinateSystem(f: Fields | undefined): CoordinateSystem {
  const d = DEFAULT_COORDINATE_SYSTEM;
  if (!f) {
    return { extent: copyExtent(d.extent), preserveAspectRatio: d.preserveAspectRatio, initialScale: d.initialScale, grid: [d.grid[0], d.grid[1]] };
  }
  return {
    extent: extent(f, 'extent', d.extent),
    preserveAspectRatio: bool(f, 'preserveAspectRatio', d.preserveAspectRatio),
    initialScale: num(f, 'initialScale', d.initialScale),
    grid: point(f, 'grid', d.grid),
  };
}

/** Reads `Icon(...)`/`Diagram(...)` out of a class annotation. Returns undefined when absent. */
export function parseGraphicsLayer(annotation: Modification | undefined, kind: 'Icon' | 'Diagram'): GraphicsLayer | undefined {
  const layer = annotationEntry(annotation, kind);
  if (!layer) return undefined;
  return {
    coordinateSystem: readCoordinateSystem(layer.sub('coordinateSystem')),
    graphics: parseGraphicItems(layer.get('graphics')),
  };
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

function readTransformation(f: Fields | undefined): Transformation {
  const d = DEFAULT_TRANSFORMATION;
  if (!f) return { origin: [d.origin[0], d.origin[1]], extent: copyExtent(d.extent), rotation: d.rotation };
  return {
    origin: point(f, 'origin', d.origin),
    extent: extent(f, 'extent', d.extent),
    rotation: num(f, 'rotation', d.rotation),
  };
}

/** Reads `Placement(...)` out of a component annotation. Returns undefined when absent. */
export function parsePlacement(annotation: Modification | undefined): Placement | undefined {
  const f = annotationEntry(annotation, 'Placement');
  if (!f) return undefined;
  const placement: Placement = {
    visible: bool(f, 'visible', true),
    transformation: readTransformation(f.sub('transformation')),
  };
  const icon = f.sub('iconTransformation');
  if (icon) placement.iconTransformation = readTransformation(icon);
  return placement;
}

// ---------------------------------------------------------------------------
// Connection Line
// ---------------------------------------------------------------------------

/** Reads `Line(...)` out of a connect-equation annotation. Returns undefined when absent. */
export function parseConnectionLine(annotation: Modification | undefined): ConnectionLine | undefined {
  const f = annotationEntry(annotation, 'Line');
  if (!f) return undefined;
  return {
    points: readPoints(f.get('points')) ?? [],
    color: color(f, 'color', BLACK),
    pattern: en(f, 'pattern', LINE_PATTERNS, 'Solid'),
    thickness: num(f, 'thickness', 0.25),
    smooth: en(f, 'smooth', SMOOTHS, 'None'),
    arrow: readArrowPair(f),
  };
}

// ---------------------------------------------------------------------------
// experiment, Documentation
// ---------------------------------------------------------------------------

/** Reads `experiment(StartTime=..., StopTime=..., Interval=..., Tolerance=...)`. Returns undefined when absent. */
export function parseExperiment(annotation: Modification | undefined): ExperimentAnnotation | undefined {
  const f = annotationEntry(annotation, 'experiment');
  if (!f) return undefined;
  const out: ExperimentAnnotation = {};
  const keys: (keyof ExperimentAnnotation)[] = ['StartTime', 'StopTime', 'Interval', 'Tolerance'];
  for (const k of keys) {
    const v = evalNumber(f.get(k));
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Reads `Documentation(info="...", revisions="...")`. Returns undefined when absent. */
export function parseDocumentation(annotation: Modification | undefined): { info?: string; revisions?: string } | undefined {
  const f = annotationEntry(annotation, 'Documentation');
  if (!f) return undefined;
  const out: { info?: string; revisions?: string } = {};
  const info = evalString(f.get('info'));
  const revisions = evalString(f.get('revisions'));
  if (info !== undefined) out.info = info;
  if (revisions !== undefined) out.revisions = revisions;
  return out;
}

export * from './transform.js';
