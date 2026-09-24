/**
 * SVG renderer for Modelica graphical annotations (GraphicsLayer / GraphicItem).
 *
 * Conventions: items are emitted in Modelica class coordinates (y UP). `GraphicsItems` returns
 * a <g> that must be placed inside a parent that applies the y-flip (`scale(1,-1)`); text items
 * un-flip themselves locally so they read correctly. `IconSvg` is a standalone thumbnail that
 * does the flipping itself. Strokes use `vector-effect: non-scaling-stroke`, so lineThickness is
 * converted to screen pixels (0.25 → 1px, 0.5 → 2px, ...), matching Dymola/Impact hairline look.
 */
import { memo, useId } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Color, CoordinateSystem, EllipseItem, Extent, GraphicItem, GraphicsLayer, LineItem, LinePattern, Point, PolygonItem, RectangleItem, TextItem } from '@impact/core';
import { colorToCss, DEFAULT_COORDINATE_SYSTEM } from '@impact/core';

export interface TextSubstitutions {
  /** Component instance name for `%name`. */
  name?: string;
  /** Short class name for `%class`. */
  className?: string;
  /** Parameter values for `%R`, `%k`, ... (text as shown in the UI). */
  params?: Record<string, string>;
}

export function substituteText(text: string, subs?: TextSubstitutions): string {
  if (!text.includes('%')) return text;
  return text.replace(/%%|%name\b|%class\b|%\{([^}]+)\}|%([A-Za-z_][A-Za-z0-9_.]*)/g, (m, braced: string | undefined, plain: string | undefined) => {
    if (m === '%%') return '%';
    if (m === '%name') return subs?.name ?? '';
    if (m === '%class') return subs?.className ?? '';
    const key = braced ?? plain ?? '';
    if (subs?.params && key in subs.params) return subs.params[key];
    return key;
  });
}

export function strokePx(lineThickness: number): number {
  return Math.max(0.75, lineThickness * 4);
}

function dashArray(pattern: LinePattern, px: number): string | undefined {
  const u = Math.max(1, px);
  switch (pattern) {
    case 'Dash': return `${6 * u} ${4 * u}`;
    case 'Dot': return `${1.5 * u} ${3 * u}`;
    case 'DashDot': return `${6 * u} ${3 * u} ${1.5 * u} ${3 * u}`;
    case 'DashDotDot': return `${6 * u} ${3 * u} ${1.5 * u} ${3 * u} ${1.5 * u} ${3 * u}`;
    default: return undefined;
  }
}

function extentBox(e: Extent): { x: number; y: number; w: number; h: number; cx: number; cy: number } {
  const x = Math.min(e[0][0], e[1][0]);
  const y = Math.min(e[0][1], e[1][1]);
  const w = Math.abs(e[1][0] - e[0][0]);
  const h = Math.abs(e[1][1] - e[0][1]);
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

function itemTransform(item: GraphicItem): string | undefined {
  const [ox, oy] = item.origin;
  const parts: string[] = [];
  if (ox || oy) parts.push(`translate(${ox} ${oy})`);
  if (item.rotation) parts.push(`rotate(${item.rotation})`);
  return parts.length ? parts.join(' ') : undefined;
}

/** Quadratic-smoothed path through points (Modelica Smooth.Bezier approximation). */
export function smoothPath(points: Point[], closed = false): string {
  if (points.length < 3) return polyPath(points, closed);
  const pts = closed ? [...points, points[0], points[1]] : points;
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  if (!closed) {
    const m0: Point = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
    d += ` L ${m0[0]} ${m0[1]}`;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const next = pts[i + 1];
    const mid: Point = [(p[0] + next[0]) / 2, (p[1] + next[1]) / 2];
    d += ` Q ${p[0]} ${p[1]} ${mid[0]} ${mid[1]}`;
  }
  if (!closed) {
    const last = pts[pts.length - 1];
    d += ` L ${last[0]} ${last[1]}`;
  } else d += ' Z';
  return d;
}

export function polyPath(points: Point[], closed = false): string {
  if (!points.length) return '';
  return `M ${points.map((p) => `${p[0]} ${p[1]}`).join(' L ')}${closed ? ' Z' : ''}`;
}

interface FillSpec {
  fill: string;
  defs?: ReactNode;
}

function useFill(item: RectangleItem | EllipseItem | PolygonItem | TextItem, uid: string, index: number): FillSpec {
  const id = `${uid}-f${index}`;
  const lc = colorToCss(item.lineColor);
  const fc = colorToCss(item.fillColor);
  switch (item.fillPattern) {
    case 'None':
      return { fill: 'none' };
    case 'Solid':
      return { fill: fc };
    case 'HorizontalCylinder':
      return {
        fill: `url(#${id})`,
        defs: (
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={lc} />
            <stop offset="0.5" stopColor={fc} />
            <stop offset="1" stopColor={lc} />
          </linearGradient>
        ),
      };
    case 'VerticalCylinder':
      return {
        fill: `url(#${id})`,
        defs: (
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={lc} />
            <stop offset="0.5" stopColor={fc} />
            <stop offset="1" stopColor={lc} />
          </linearGradient>
        ),
      };
    case 'Sphere':
      return {
        fill: `url(#${id})`,
        defs: (
          <radialGradient id={id} cx="0.5" cy="0.5" r="0.6">
            <stop offset="0" stopColor={fc} />
            <stop offset="1" stopColor={lc} />
          </radialGradient>
        ),
      };
    default: {
      // Hatch patterns: Horizontal, Vertical, Cross, Forward, Backward, CrossDiag
      const size = 6;
      const lines: ReactNode[] = [];
      const p = item.fillPattern;
      const stroke = lc;
      if (p === 'Horizontal' || p === 'Cross') lines.push(<line key="h" x1="0" y1={size / 2} x2={size} y2={size / 2} stroke={stroke} strokeWidth="0.8" />);
      if (p === 'Vertical' || p === 'Cross') lines.push(<line key="v" x1={size / 2} y1="0" x2={size / 2} y2={size} stroke={stroke} strokeWidth="0.8" />);
      if (p === 'Forward' || p === 'CrossDiag') lines.push(<line key="f" x1="0" y1={size} x2={size} y2="0" stroke={stroke} strokeWidth="0.8" />);
      if (p === 'Backward' || p === 'CrossDiag') lines.push(<line key="b" x1="0" y1="0" x2={size} y2={size} stroke={stroke} strokeWidth="0.8" />);
      return {
        fill: `url(#${id})`,
        defs: (
          <pattern id={id} width={size} height={size} patternUnits="userSpaceOnUse">
            <rect width={size} height={size} fill={fc} />
            {lines}
          </pattern>
        ),
      };
    }
  }
}

function arrowMarker(kind: 'Open' | 'Filled' | 'Half', color: string, id: string, size: number, end: boolean): ReactNode {
  const s = size;
  const orient = end ? 'auto' : 'auto-start-reverse';
  const path = kind === 'Half' ? `M0,0 L${s},${s / 2} L0,${s / 2} Z` : `M0,0 L${s},${s / 2} L0,${s} Z`;
  return (
    <marker id={id} markerWidth={s} markerHeight={s} refX={s} refY={s / 2} orient={orient} markerUnits="userSpaceOnUse">
      <path d={path} fill={kind === 'Open' ? 'none' : color} stroke={color} strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
    </marker>
  );
}

const Rect = ({ item, uid, index }: { item: RectangleItem; uid: string; index: number }) => {
  const { x, y, w, h } = extentBox(item.extent);
  const fill = useFill(item, uid, index);
  const px = strokePx(item.lineThickness);
  const stroke = item.pattern === 'None' ? 'none' : colorToCss(item.lineColor);
  const raised = item.borderPattern !== 'None';
  return (
    <>
      {fill.defs && <defs>{fill.defs}</defs>}
      <rect x={x} y={y} width={w} height={h} rx={item.radius} ry={item.radius} fill={fill.fill} stroke={stroke} strokeWidth={px} strokeDasharray={dashArray(item.pattern, px)} vectorEffect="non-scaling-stroke" transform={itemTransform(item)} />
      {raised && <rect x={x} y={y} width={w} height={h} rx={item.radius} ry={item.radius} fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth={px * 2} vectorEffect="non-scaling-stroke" transform={itemTransform(item)} />}
    </>
  );
};

const Ell = ({ item, uid, index }: { item: EllipseItem; uid: string; index: number }) => {
  const { cx, cy, w, h } = extentBox(item.extent);
  const rx = w / 2;
  const ry = h / 2;
  const fill = useFill(item, uid, index);
  const px = strokePx(item.lineThickness);
  const stroke = item.pattern === 'None' ? 'none' : colorToCss(item.lineColor);
  const full = Math.abs(((item.endAngle - item.startAngle) % 360 + 360) % 360) < 1e-9 && item.endAngle !== item.startAngle;
  let shape: ReactNode;
  if (full || (item.startAngle === 0 && item.endAngle === 360)) {
    shape = <ellipse cx={cx} cy={cy} rx={rx} ry={ry} />;
  } else {
    const a0 = (item.startAngle * Math.PI) / 180;
    const a1 = (item.endAngle * Math.PI) / 180;
    const p0: Point = [cx + rx * Math.cos(a0), cy + ry * Math.sin(a0)];
    const p1: Point = [cx + rx * Math.cos(a1), cy + ry * Math.sin(a1)];
    const sweep = item.endAngle - item.startAngle;
    const large = Math.abs(sweep) > 180 ? 1 : 0;
    const dir = sweep >= 0 ? 1 : 0;
    let d = `M ${p0[0]} ${p0[1]} A ${rx} ${ry} 0 ${large} ${dir} ${p1[0]} ${p1[1]}`;
    if (item.closure === 'Radial') d += ` L ${cx} ${cy} Z`;
    else if (item.closure === 'Chord') d += ' Z';
    shape = <path d={d} />;
  }
  return (
    <>
      {fill.defs && <defs>{fill.defs}</defs>}
      <g fill={fill.fill} stroke={stroke} strokeWidth={px} strokeDasharray={dashArray(item.pattern, px)} vectorEffect="non-scaling-stroke" transform={itemTransform(item)} style={{ vectorEffect: 'non-scaling-stroke' } as CSSProperties}>
        {shape}
      </g>
    </>
  );
};

const Poly = ({ item, uid, index }: { item: PolygonItem; uid: string; index: number }) => {
  const fill = useFill(item, uid, index);
  const px = strokePx(item.lineThickness);
  const stroke = item.pattern === 'None' ? 'none' : colorToCss(item.lineColor);
  const d = item.smooth === 'Bezier' ? smoothPath(item.points, true) : polyPath(item.points, true);
  return (
    <>
      {fill.defs && <defs>{fill.defs}</defs>}
      <path d={d} fill={fill.fill} stroke={stroke} strokeWidth={px} strokeDasharray={dashArray(item.pattern, px)} strokeLinejoin="round" vectorEffect="non-scaling-stroke" transform={itemTransform(item)} />
    </>
  );
};

const Ln = ({ item, uid, index }: { item: LineItem; uid: string; index: number }) => {
  if (item.pattern === 'None' || item.points.length < 2) return null;
  const px = strokePx(item.thickness);
  const color = colorToCss(item.color);
  const d = item.smooth === 'Bezier' ? smoothPath(item.points) : polyPath(item.points);
  const [a0, a1] = item.arrow;
  const startId = `${uid}-as${index}`;
  const endId = `${uid}-ae${index}`;
  return (
    <>
      {(a0 !== 'None' || a1 !== 'None') && (
        <defs>
          {a0 !== 'None' && arrowMarker(a0, color, startId, item.arrowSize, false)}
          {a1 !== 'None' && arrowMarker(a1, color, endId, item.arrowSize, true)}
        </defs>
      )}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={px}
        strokeDasharray={dashArray(item.pattern, px)}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        markerStart={a0 !== 'None' ? `url(#${startId})` : undefined}
        markerEnd={a1 !== 'None' ? `url(#${endId})` : undefined}
        transform={itemTransform(item)}
      />
    </>
  );
};

/** Estimates the rendered width of text in font units (average glyph advance ≈ 0.55em). */
function estimateTextWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) w += /[iljtfI.,:;'|!]/.test(ch) ? 0.3 : /[mwMW@]/.test(ch) ? 0.85 : /[A-Z0-9]/.test(ch) ? 0.66 : 0.55;
  return w * fontSize;
}

const Txt = ({ item, subs }: { item: TextItem; subs?: TextSubstitutions }) => {
  const text = substituteText(item.textString, subs);
  if (!text) return null;
  const { x, y, w, h, cx, cy } = extentBox(item.extent);
  const lines = text.split(/\\n|\n/);
  let fontSize = item.fontSize > 0 ? item.fontSize : h * 0.9 / Math.max(1, lines.length);
  if (item.fontSize <= 0 && w > 0) {
    const widest = Math.max(...lines.map((l) => estimateTextWidth(l, fontSize)));
    if (widest > w) fontSize *= w / widest;
  }
  const anchor = item.horizontalAlignment === 'Left' ? 'start' : item.horizontalAlignment === 'Right' ? 'end' : 'middle';
  const tx = item.horizontalAlignment === 'Left' ? x : item.horizontalAlignment === 'Right' ? x + w : cx;
  const color = colorToCss(item.textColor);
  const bold = item.textStyle.includes('Bold');
  const italic = item.textStyle.includes('Italic');
  const underline = item.textStyle.includes('UnderLine');
  const lineHeight = fontSize * 1.15;
  const totalH = lineHeight * lines.length;
  return (
    <g transform={itemTransform(item)}>
      <g transform={`translate(${tx} ${cy}) scale(1,-1)`}>
        <text
          x={0}
          y={-totalH / 2 + fontSize * 0.8}
          fontSize={fontSize}
          fontFamily={item.fontName || 'Arial, Helvetica, sans-serif'}
          fontWeight={bold ? 700 : 400}
          fontStyle={italic ? 'italic' : undefined}
          textDecoration={underline ? 'underline' : undefined}
          fill={color}
          textAnchor={anchor}
          style={{ userSelect: 'none', pointerEvents: 'none' }}
        >
          {lines.map((l, i) => (
            <tspan key={i} x={0} dy={i === 0 ? 0 : lineHeight}>
              {l}
            </tspan>
          ))}
        </text>
      </g>
      {/* keep y in scope for layout debugging */}
      {false && <rect x={x} y={y} width={w} height={h} />}
    </g>
  );
};

export interface GraphicsItemsProps {
  items: GraphicItem[];
  subs?: TextSubstitutions;
  /** Skip text items (used for tiny thumbnails where text becomes noise). */
  hideText?: boolean;
}

/** Renders graphic items in Modelica coordinates (y up). Place inside a y-flipped parent. */
export const GraphicsItems = memo(function GraphicsItems({ items, subs, hideText }: GraphicsItemsProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return (
    <g>
      {items.map((item, i) => {
        if (!item.visible) return null;
        switch (item.kind) {
          case 'Rectangle': return <Rect key={i} item={item} uid={uid} index={i} />;
          case 'Ellipse': return <Ell key={i} item={item} uid={uid} index={i} />;
          case 'Polygon': return <Poly key={i} item={item} uid={uid} index={i} />;
          case 'Line': return <Ln key={i} item={item} uid={uid} index={i} />;
          case 'Text': return hideText ? null : <Txt key={i} item={item} subs={subs} />;
          case 'Bitmap': {
            const { x, y, w, h } = extentBox(item.extent);
            return item.imageSource || item.fileName ? (
              <g key={i} transform={`translate(0 ${2 * y + h}) scale(1,-1)`}>
                <image x={x} y={y} width={w} height={h} href={item.imageSource ? `data:image/png;base64,${item.imageSource}` : item.fileName} preserveAspectRatio="xMidYMid meet" />
              </g>
            ) : (
              <rect key={i} x={x} y={y} width={w} height={h} fill="none" stroke="#bbb" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            );
          }
          default: return null;
        }
      })}
    </g>
  );
});

export interface IconSvgProps {
  icon?: GraphicsLayer;
  size?: number;
  width?: number;
  height?: number;
  subs?: TextSubstitutions;
  className?: string;
  title?: string;
  /** Padding in class units around the coordinate system extent. */
  padding?: number;
  hideText?: boolean;
  style?: CSSProperties;
  fallback?: ReactNode;
}

/** Standalone SVG rendering of an icon layer fitted into `size` px (aspect preserved). */
export function IconSvg({ icon, size = 20, width, height, subs, className, title, padding = 2, hideText, style, fallback }: IconSvgProps) {
  const w = width ?? size;
  const h = height ?? size;
  if (!icon || !icon.graphics.length) {
    return fallback ? <>{fallback}</> : <svg width={w} height={h} className={className} style={style} />;
  }
  const cs: CoordinateSystem = icon.coordinateSystem ?? DEFAULT_COORDINATE_SYSTEM;
  const ext = extentBox(cs.extent);
  const vb = `${ext.x - padding} ${-(ext.y + ext.h) - padding} ${ext.w + 2 * padding} ${ext.h + 2 * padding}`;
  return (
    <svg width={w} height={h} viewBox={vb} className={className} style={style} preserveAspectRatio="xMidYMid meet" overflow="visible">
      {title && <title>{title}</title>}
      <g transform="scale(1,-1)">
        <GraphicsItems items={icon.graphics} subs={subs} hideText={hideText} />
      </g>
    </svg>
  );
}

export function colorCss(c: Color): string {
  return colorToCss(c);
}
