/**
 * Pure SVG line chart in the Plotly-like style of Modelon Impact (docs/UI_SPEC.md §5.5 / §9):
 * white surface, 1px `--plot-frame` frame, `--plot-grid` gridlines, 11px `--plot-axis` tick
 * labels, 1.5px lines, dashed time-slider cursor, hover guide + tooltip, box zoom, wheel zoom,
 * shift-drag pan, double-click reset, legend-hover highlight.
 * No charting libraries; all numeric work lives in ./chartMath (unit-tested).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, JSX, PointerEvent as ReactPointerEvent } from 'react';
import { formatNumber } from '@impact/core';
import {
  decimate,
  extent,
  interpolateAt,
  isMonotonic,
  isNoiseSpan,
  linearTicks,
  log10,
  logTicks,
  makeScale,
  nearestIndex,
  nearestIndexUnsorted,
  padDomain,
  panDomain,
  pow10,
  wheelZoom,
} from './chartMath';
import type { Domain, Scale, Tick } from './chartMath';
import './plots.css';

export interface ChartSeries {
  id: string;
  label: string;
  color: string;
  x: number[];
  y: number[];
  hidden?: boolean;
  /** Unit of the y values (used for the axis label when every visible series shares one). */
  unit?: string;
}

export interface PlotChartProps {
  series: ChartSeries[];
  xLabel?: string;
  yLabel?: string;
  logY?: boolean;
  showGrid?: boolean;
  /** Time-slider position in x units (drawn as a dashed cursor when x is time). */
  cursorTime?: number;
  /** Called when the user clicks the chart (x value at the pointer). */
  onCursorChange?: (t: number) => void;
  /** Series id to emphasise (legend hover); the others are dimmed. */
  highlightId?: string;
  /**
   * Any change of this value drops the zoom/pan window (the domains are meaningless once the x
   * variable, the units or the plotted data change). Double-click / Reset do the same by hand.
   */
  resetKey?: string;
  /** Fixed size in px; omit to fill the parent (ResizeObserver). */
  height?: number;
  width?: number;
  className?: string;
  emptyText?: string;
}

interface ZoomState {
  x: Domain;
  /** In transformed (log10 when logY) space. */
  y: Domain;
}

interface DragState {
  mode: 'zoom' | 'pan';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  dom: ZoomState;
  kx: number;
  ky: number;
  moved: boolean;
}

interface Geometry {
  xs: Scale;
  ys: Scale;
  left: number;
  top: number;
  pw: number;
  ph: number;
}

const MARGIN_TOP = 10;
const MARGIN_RIGHT = 12;
const TICK_FONT = 11;

function buildPath(x: number[], y: number[], xs: Scale, ys: Scale): string {
  const n = Math.min(x.length, y.length);
  let d = '';
  let pen = false;
  for (let i = 0; i < n; i++) {
    const px = xs(x[i]);
    const py = ys(y[i]);
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${px.toFixed(2)} ${py.toFixed(2)}`;
    pen = true;
  }
  return d;
}

const crisp = (v: number) => Math.round(v) + 0.5;

export function PlotChart({
  series,
  xLabel,
  yLabel,
  logY = false,
  showGrid = true,
  cursorTime,
  onCursorChange,
  highlightId,
  resetKey,
  height,
  width,
  className,
  emptyText = 'No data',
}: PlotChartProps): JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [measured, setMeasured] = useState<{ w: number; h: number }>({ w: width ?? 0, h: height ?? 0 });
  const [zoom, setZoom] = useState<ZoomState | undefined>(undefined);
  const [hover, setHover] = useState<{ px: number; py: number } | null>(null);
  const [dragRect, setDragRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const geomRef = useRef<Geometry | null>(null);

  const w = width ?? measured.w;
  const h = height ?? measured.h;

  // Fill the container unless a fixed size is given.
  useLayoutEffect(() => {
    if (width !== undefined && height !== undefined) return;
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      const nw = Math.max(0, Math.floor(r.width));
      const nh = Math.max(0, Math.floor(r.height));
      setMeasured((prev) => (prev.w === nw && prev.h === nh ? prev : { w: nw, h: nh }));
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);

  // Reset zoom when the scale type changes (log/linear y domains are not comparable) or when the
  // caller says the plotted quantities changed (other x variable, units or data: see resetKey).
  useEffect(() => {
    setZoom(undefined);
  }, [logY, resetKey]);

  const visible = useMemo(() => series.filter((s) => !s.hidden && s.x.length > 0 && s.y.length > 0), [series]);

  // Transformed y (log10 when logY) per visible series.
  const prepared = useMemo(
    () =>
      visible.map((s) => {
        const n = Math.min(s.x.length, s.y.length);
        const x = s.x.length === n ? s.x : s.x.slice(0, n);
        const yRaw = s.y.length === n ? s.y : s.y.slice(0, n);
        const y = logY ? yRaw.map(log10) : yRaw;
        return { s, x, y, yRaw, monotonic: isMonotonic(x) };
      }),
    [visible, logY],
  );

  const autoDomain = useMemo<ZoomState>(() => {
    const xe = extent(prepared.map((p) => p.x));
    const ye = extent(prepared.map((p) => p.y));
    const x: Domain = xe ? (isNoiseSpan(xe[0], xe[1]) ? padDomain(xe) : xe) : [0, 1];
    const y: Domain = ye ? padDomain(ye, 0.05) : logY ? [-1, 1] : [0, 1];
    return { x, y };
  }, [prepared, logY]);

  const xDom = zoom?.x ?? autoDomain.x;
  const yDom = zoom?.y ?? autoDomain.y;

  const hasXLabel = Boolean(xLabel);
  const unitLabelY = useMemo(() => {
    if (yLabel) return yLabel;
    const units = new Set(visible.map((s) => s.unit).filter(Boolean));
    return units.size === 1 && visible.length === 1 ? `[${[...units][0]}]` : undefined;
  }, [visible, yLabel]);

  const marginBottom = 26 + (hasXLabel ? 16 : 0);
  const ph = Math.max(10, h - MARGIN_TOP - marginBottom);

  // y ticks first: the left margin depends on their label width.
  const yTicks = useMemo<Tick[]>(() => {
    const n = Math.max(2, Math.floor(ph / 40));
    if (logY) {
      const lo = pow10(yDom[0]);
      const hi = pow10(yDom[1]);
      return logTicks(lo, hi, n);
    }
    return linearTicks(yDom[0], yDom[1], n);
  }, [yDom, ph, logY]);

  const maxLabel = yTicks.reduce((m, t) => Math.max(m, t.label.length), 1);
  const left = Math.max(36, Math.ceil(maxLabel * 6.4) + 14) + (unitLabelY ? 14 : 0);
  const pw = Math.max(10, w - left - MARGIN_RIGHT);

  const xs = useMemo(() => makeScale(xDom, [left, left + pw]), [xDom, left, pw]);
  const ys = useMemo(() => makeScale(yDom, [MARGIN_TOP + ph, MARGIN_TOP]), [yDom, ph]);
  geomRef.current = { xs, ys, left, top: MARGIN_TOP, pw, ph };

  const xTicks = useMemo<Tick[]>(() => linearTicks(xDom[0], xDom[1], Math.max(2, Math.floor(pw / 80))), [xDom, pw]);

  // Series paths (decimated per pixel column over the visible x range).
  const paths = useMemo(
    () =>
      prepared.map((p) => {
        let x = p.x;
        let y = p.y;
        if (p.monotonic && x.length > pw * 2) {
          const d = decimate(x, y, Math.max(1, Math.floor(pw)), xDom[0], xDom[1]);
          x = d.x;
          y = d.y;
        }
        return { id: p.s.id, color: p.s.color, d: buildPath(x, y, xs, ys) };
      }),
    [prepared, pw, xDom, xs, ys],
  );

  const yLog = (v: number) => (logY ? pow10(v) : v);

  // Hover readout: snap to the nearest sample of the first monotonic series, interpolate the rest.
  const hoverInfo = useMemo(() => {
    if (!hover || !prepared.length) return null;
    const xv = xs.invert(hover.px);
    const ref = prepared.find((p) => p.monotonic);
    let xSnap = xv;
    if (ref) {
      const i = nearestIndex(ref.x, xv);
      if (i >= 0) xSnap = ref.x[i];
    }
    if (xSnap < xDom[0] || xSnap > xDom[1]) xSnap = Math.min(Math.max(xv, xDom[0]), xDom[1]);
    const rows = prepared
      .map((p) => {
        let v: number | undefined;
        if (p.monotonic) v = interpolateAt(p.x, p.yRaw, xSnap);
        else {
          const i = nearestIndexUnsorted(p.x, xSnap);
          v = i >= 0 ? p.yRaw[i] : undefined;
        }
        if (v === undefined || !Number.isFinite(v)) return null;
        const py = ys(logY ? log10(v) : v);
        return { id: p.s.id, label: p.s.label, color: p.s.color, value: v, py, unit: p.s.unit };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    return { x: xSnap, gx: xs(xSnap), rows };
  }, [hover, prepared, xs, ys, xDom, logY]);

  const inPlot = (px: number, py: number) => px >= left && px <= left + pw && py >= MARGIN_TOP && py <= MARGIN_TOP + ph;

  const toLocal = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current?.getBoundingClientRect();
    return r ? { px: e.clientX - r.left, py: e.clientY - r.top } : { px: 0, py: 0 };
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const { px, py } = toLocal(e);
    if (!inPlot(px, py)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      mode: e.shiftKey ? 'pan' : 'zoom',
      x0: px,
      y0: py,
      x1: px,
      y1: py,
      dom: { x: xDom, y: yDom },
      kx: (xDom[1] - xDom[0]) / pw,
      ky: (yDom[1] - yDom[0]) / ph,
      moved: false,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const { px, py } = toLocal(e);
    const d = dragRef.current;
    if (d) {
      d.x1 = px;
      d.y1 = py;
      if (Math.hypot(px - d.x0, py - d.y0) > 3) d.moved = true;
      if (d.mode === 'pan') {
        setZoom({ x: panDomain(d.dom.x, -(px - d.x0) * d.kx), y: panDomain(d.dom.y, (py - d.y0) * d.ky) });
        setHover(null);
        return;
      }
      if (d.moved) setDragRect({ x0: d.x0, y0: d.y0, x1: px, y1: py });
    }
    setHover(inPlot(px, py) ? { px, py } : null);
  };

  const finishDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragRect(null);
    if (!d) return;
    if (d.mode !== 'zoom') return;
    const dx = Math.abs(d.x1 - d.x0);
    const dy = Math.abs(d.y1 - d.y0);
    if (d.moved && dx > 4 && dy > 4) {
      const x0 = Math.max(left, Math.min(d.x0, d.x1));
      const x1 = Math.min(left + pw, Math.max(d.x0, d.x1));
      const y0 = Math.max(MARGIN_TOP, Math.min(d.y0, d.y1));
      const y1 = Math.min(MARGIN_TOP + ph, Math.max(d.y0, d.y1));
      setZoom({ x: [xs.invert(x0), xs.invert(x1)], y: [ys.invert(y1), ys.invert(y0)] });
    } else if (!d.moved) {
      onCursorChange?.(xs.invert(d.x0));
    }
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    finishDrag();
  };

  const onPointerLeave = () => {
    if (!dragRef.current) setHover(null);
  };

  // Wheel zoom around the cursor. React registers wheel listeners as passive, so attach natively
  // to be able to prevent the page/canvas from scrolling. The listener lives on the wrapper, which
  // is mounted from the first commit: without a fixed size the <svg> only appears after the
  // container has been measured, i.e. after this once-only effect has already run.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const g = geomRef.current;
      const svg = svgRef.current;
      if (!g || !svg) return;
      const r = svg.getBoundingClientRect();
      const next = wheelZoom(g.xs, g.ys, { left: g.left, top: g.top, width: g.pw, height: g.ph }, e.clientX - r.left, e.clientY - r.top, e.deltaY);
      if (!next) return;
      e.preventDefault();
      e.stopPropagation();
      setZoom(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const cursorX = cursorTime !== undefined && Number.isFinite(cursorTime) && cursorTime >= xDom[0] && cursorTime <= xDom[1] ? xs(cursorTime) : undefined;
  const zeroY = !logY && yDom[0] < 0 && yDom[1] > 0 ? ys(0) : undefined;
  const clipId = useMemo(() => `plot-clip-${Math.random().toString(36).slice(2, 9)}`, []);
  const empty = prepared.length === 0;

  const ariaLabel = `Line chart with ${visible.length} series${xLabel ? ` over ${xLabel}` : ''}`;

  // Tooltip placement: right of the guide unless it would overflow.
  let tipStyle: CSSProperties | undefined;
  if (hover && hoverInfo) {
    const flip = hoverInfo.gx > left + pw * 0.62;
    tipStyle = {
      left: flip ? undefined : hoverInfo.gx + 12,
      right: flip ? w - hoverInfo.gx + 12 : undefined,
      top: Math.min(Math.max(hover.py - 12, MARGIN_TOP), MARGIN_TOP + ph - 24 - 16 * (hoverInfo.rows.length + 1)),
    };
  }

  return (
    <div
      ref={wrapRef}
      className={`plot-chart${className ? ` ${className}` : ''}`}
      style={width !== undefined && height !== undefined ? { width, height } : undefined}
    >
      {w > 0 && h > 0 && (
        <svg
          ref={svgRef}
          className={`plot-chart-svg${dragRef.current?.mode === 'pan' ? ' panning' : ''}`}
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          role="img"
          aria-label={ariaLabel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerLeave}
          onDoubleClick={() => setZoom(undefined)}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={left} y={MARGIN_TOP} width={pw} height={ph} />
            </clipPath>
          </defs>
          <rect className="plot-chart-bg" x={0} y={0} width={w} height={h} />

          {/* gridlines */}
          {showGrid && (
            <g className="plot-grid" shapeRendering="crispEdges">
              {xTicks.map((t) => (
                <line key={`gx${t.value}`} x1={crisp(xs(t.value))} x2={crisp(xs(t.value))} y1={MARGIN_TOP} y2={MARGIN_TOP + ph} />
              ))}
              {yTicks.map((t) => {
                const py = ys(logY ? log10(t.value) : t.value);
                return <line key={`gy${t.value}`} className={t.minor ? 'minor' : undefined} x1={left} x2={left + pw} y1={crisp(py)} y2={crisp(py)} />;
              })}
            </g>
          )}
          {zeroY !== undefined && <line className="plot-zeroline" x1={left} x2={left + pw} y1={crisp(zeroY)} y2={crisp(zeroY)} shapeRendering="crispEdges" />}

          {/* frame around the plotting area */}
          <g className="plot-axis-lines" shapeRendering="crispEdges">
            <rect x={crisp(left)} y={crisp(MARGIN_TOP)} width={Math.max(0, Math.round(pw))} height={Math.max(0, Math.round(ph))} />
          </g>

          {/* tick labels */}
          <g className="plot-ticks" fontSize={TICK_FONT}>
            {xTicks.map((t) => (
              <text key={`tx${t.value}`} x={xs(t.value)} y={MARGIN_TOP + ph + 15} textAnchor="middle">
                {t.label}
              </text>
            ))}
            {yTicks.map((t) => {
              const py = ys(logY ? log10(t.value) : t.value);
              if (py < MARGIN_TOP - 1 || py > MARGIN_TOP + ph + 1) return null;
              return (
                <text key={`ty${t.value}`} className={t.minor ? 'minor' : undefined} x={left - 6} y={py} textAnchor="end" dominantBaseline="middle">
                  {t.label}
                </text>
              );
            })}
          </g>

          {/* axis titles */}
          {hasXLabel && (
            <text className="plot-axis-title" x={left + pw / 2} y={h - 5} textAnchor="middle" fontSize={TICK_FONT}>
              {xLabel}
            </text>
          )}
          {unitLabelY && (
            <text
              className="plot-axis-title"
              x={11}
              y={MARGIN_TOP + ph / 2}
              textAnchor="middle"
              fontSize={TICK_FONT}
              transform={`rotate(-90 11 ${MARGIN_TOP + ph / 2})`}
            >
              {unitLabelY}
            </text>
          )}

          {/* series */}
          <g clipPath={`url(#${clipId})`}>
            {paths.map((p) => (
              <path key={p.id} className={`plot-series${highlightId ? (p.id === highlightId ? ' hl' : ' dim') : ''}`} d={p.d} stroke={p.color} />
            ))}
            {cursorX !== undefined && <line className="plot-cursor" x1={cursorX} x2={cursorX} y1={MARGIN_TOP} y2={MARGIN_TOP + ph} />}
            {hoverInfo && (
              <g className="plot-hover">
                <line x1={hoverInfo.gx} x2={hoverInfo.gx} y1={MARGIN_TOP} y2={MARGIN_TOP + ph} />
                {hoverInfo.rows.map((r) => Number.isFinite(r.py) && <circle key={r.id} cx={hoverInfo.gx} cy={r.py} r={3.5} fill={r.color} />)}
              </g>
            )}
            {dragRect && (
              <rect
                className="plot-zoom-rect"
                x={Math.min(dragRect.x0, dragRect.x1)}
                y={Math.min(dragRect.y0, dragRect.y1)}
                width={Math.abs(dragRect.x1 - dragRect.x0)}
                height={Math.abs(dragRect.y1 - dragRect.y0)}
              />
            )}
          </g>

          {empty && (
            <text className="plot-empty" x={left + pw / 2} y={MARGIN_TOP + ph / 2} textAnchor="middle" dominantBaseline="middle" fontSize={12}>
              {emptyText}
            </text>
          )}
        </svg>
      )}

      {hoverInfo && tipStyle && hoverInfo.rows.length > 0 && (
        <div className="plot-tooltip" style={tipStyle} role="status">
          <div className="plot-tooltip-x">
            {xLabel ? `${xLabel} = ` : ''}
            {formatNumber(hoverInfo.x, 6)}
          </div>
          {hoverInfo.rows.map((r) => (
            <div key={r.id} className="plot-tooltip-row">
              <span className="plot-tooltip-key" style={{ background: r.color }} />
              <span className="plot-tooltip-value">
                {formatNumber(r.value, 6)}
                {r.unit ? ` ${r.unit}` : ''}
              </span>
              <span className="plot-tooltip-label">{r.label}</span>
            </div>
          ))}
        </div>
      )}

      {zoom && (
        <button type="button" className="plot-reset-zoom" onClick={() => setZoom(undefined)} title="Reset axes (double-click)">
          Reset
        </button>
      )}
    </div>
  );
}
