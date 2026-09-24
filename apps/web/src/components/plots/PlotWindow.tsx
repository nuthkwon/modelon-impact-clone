/**
 * Floating plot window (docs/UI_SPEC.md §5.5 / §9): 32px toolbar with drag handle, editable
 * 600-weight title, legend / settings / pin / close buttons, an SVG chart body with "Y axis" /
 * "X axis" drop zones for variable drags, a legend column at the right grouped by component
 * (hover highlights the trace, click hides it) and a resize handle. Rendered by the canvas
 * module inside its `position: relative` container.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, JSX, KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { unitLabel } from '@impact/core';
import { PLOT_PALETTE, useStore } from '../../store';
import type { PlotWindow } from '../../store/types';
import { useContextMenu } from '../common/ContextMenu';
import { Tooltip } from '../common/Tooltip';
import { Icon } from '../icons';
import { displayInfo, displayUnitOf, unitOf, useCaseMeta } from '../results/resultMeta';
import { PlotChart } from './PlotChart';
import type { ChartSeries } from './PlotChart';
import { legendGroups, shortClassName } from './legend';
import { zoomResetKey } from './seriesState';
import { usePlotSeries } from './usePlotSeries';
import { hasVariableDrag, readVariableDrag } from './dragTypes';
import './plots.css';

export { VARIABLE_DRAG_TYPE, hasVariableDrag, readVariableDrag, setVariableDrag } from './dragTypes';
export type { VariableDragPayload } from './dragTypes';
export { legendGroups } from './legend';
export type { LegendGroup, LegendItem } from './legend';

export const PLOT_MIN_WIDTH = 240;
export const PLOT_MIN_HEIGHT = 160;
const TOOLBAR_HEIGHT = 32;
const X_ZONE_HEIGHT = 24;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Closes a popup on outside pointerdown / Escape. */
function useDismiss(open: boolean, refs: RefObject<HTMLElement | null>[], onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (refs.some((r) => r.current && t && r.current.contains(t))) return;
      onClose();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose]);
}

function LegendGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <circle cx="4.5" cy="6" r="2" fill="currentColor" />
      <rect x="8" y="5" width="9" height="2" rx="1" fill="currentColor" />
      <circle cx="4.5" cy="14" r="2" fill="currentColor" />
      <rect x="8" y="13" width="9" height="2" rx="1" fill="currentColor" />
    </svg>
  );
}

export interface PlotWindowViewProps {
  className: string;
  plot: PlotWindow;
  canvasRef: RefObject<HTMLDivElement | null>;
}

export function PlotWindowView({ className, plot, canvasRef }: PlotWindowViewProps): JSX.Element {
  const updatePlot = useStore((s) => s.updatePlot);
  const removePlot = useStore((s) => s.removePlot);
  const addTrace = useStore((s) => s.addTrace);
  const removeTrace = useStore((s) => s.removeTrace);
  const setSliderTime = useStore((s) => s.setSliderTime);
  const sliderTime = useStore((s) => s.sliderTime);
  const caseIndex = useStore((s) => s.caseIndex);
  const fetchResultVariables = useStore((s) => s.fetchResultVariables);
  const menu = useContextMenu();

  const { series: resolved, loading, error, activeResult } = usePlotSeries(plot, className);
  const activeCaseId = activeResult?.cases[Math.min(caseIndex, Math.max(0, (activeResult?.cases.length ?? 1) - 1))]?.id;
  const meta = useCaseMeta(activeResult?.id, activeCaseId);
  const variableList = useStore((s) => (activeResult ? s.resultVariables[activeResult.id] : undefined));

  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const gearRef = useRef<HTMLButtonElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const colorRef = useRef<HTMLDivElement>(null);

  // Transient geometry while moving / resizing (committed to the store on pointer up).
  const [live, setLive] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const geom = live ?? { x: plot.x, y: plot.y, width: plot.width, height: plot.height };

  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(plot.title);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [xDraft, setXDraft] = useState(plot.xVariable);
  const [dragZone, setDragZone] = useState<'x' | 'y' | null>(null);
  const dragDepth = useRef(0);
  const [colorMenu, setColorMenu] = useState<{ traceIndex: number; left: number; top: number } | null>(null);
  const [hoverId, setHoverId] = useState<string | undefined>(undefined);

  useEffect(() => setXDraft(plot.xVariable), [plot.xVariable]);
  useEffect(() => {
    if (settingsOpen && activeResult) void fetchResultVariables(activeResult.id).catch(() => undefined);
  }, [settingsOpen, activeResult, fetchResultVariables]);

  useDismiss(settingsOpen, [settingsRef, gearRef], () => setSettingsOpen(false));
  useDismiss(colorMenu !== null, [colorRef], () => setColorMenu(null));

  const patch = (p: Partial<PlotWindow>) => updatePlot(className, plot.id, p);

  // ------------------------------------------------------------------ move / resize
  const startMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('.plot-toolbar-buttons, input, .plot-title-input')) return;
    e.preventDefault();
    const bounds = canvasRef.current?.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    const { x: ox, y: oy, width, height } = plot;
    let last = { x: ox, y: oy };
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      let nx = ox + ev.clientX - sx;
      let ny = oy + ev.clientY - sy;
      if (bounds) {
        nx = clamp(nx, 0, bounds.width - width);
        ny = clamp(ny, 0, bounds.height - height);
      }
      nx = Math.round(nx);
      ny = Math.round(ny);
      if (nx !== ox || ny !== oy) moved = true;
      last = { x: nx, y: ny };
      setLive({ x: nx, y: ny, width, height });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setLive(null);
      if (moved) patch(last);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const startResize = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const bounds = canvasRef.current?.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    const { x, y, width: ow, height: oh } = plot;
    let last = { width: ow, height: oh };
    let changed = false;
    const onMove = (ev: PointerEvent) => {
      let nw = ow + ev.clientX - sx;
      let nh = oh + ev.clientY - sy;
      nw = Math.max(PLOT_MIN_WIDTH, nw);
      nh = Math.max(PLOT_MIN_HEIGHT, nh);
      if (bounds) {
        nw = Math.min(nw, Math.max(PLOT_MIN_WIDTH, bounds.width - x));
        nh = Math.min(nh, Math.max(PLOT_MIN_HEIGHT, bounds.height - y));
      }
      nw = Math.round(nw);
      nh = Math.round(nh);
      if (nw !== ow || nh !== oh) changed = true;
      last = { width: nw, height: nh };
      setLive({ x, y, width: nw, height: nh });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setLive(null);
      if (changed) patch(last);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // ------------------------------------------------------------------ title editing
  const startEdit = () => {
    setTitleDraft(plot.title);
    setEditing(true);
  };
  const commitTitle = () => {
    const t = titleDraft.trim();
    if (t && t !== plot.title) patch({ title: t });
    setEditing(false);
  };
  const onTitleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commitTitle();
    else if (e.key === 'Escape') setEditing(false);
  };

  // ------------------------------------------------------------------ variable drop
  const zoneAt = (e: DragEvent): 'x' | 'y' => {
    const r = bodyRef.current?.getBoundingClientRect();
    if (!r) return 'y';
    return e.clientY >= r.bottom - X_ZONE_HEIGHT && e.clientY <= r.bottom + 4 ? 'x' : 'y';
  };
  const onDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (!hasVariableDrag(e.dataTransfer)) return;
    e.preventDefault();
    dragDepth.current++;
    setDragZone(zoneAt(e));
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!hasVariableDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const z = zoneAt(e);
    if (z !== dragZone) setDragZone(z);
  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!hasVariableDrag(e.dataTransfer)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragZone(null);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const payload = readVariableDrag(e.dataTransfer);
    dragDepth.current = 0;
    setDragZone(null);
    if (!payload) return;
    e.preventDefault();
    e.stopPropagation();
    if (zoneAt(e) === 'x') {
      patch({ xVariable: payload.variable });
    } else {
      // Traces from the active result follow it (undefined resultId); other results are pinned.
      const resultId = payload.resultId && payload.resultId !== activeResult?.id ? payload.resultId : undefined;
      addTrace(className, plot.id, { variable: payload.variable, resultId });
    }
  };

  // ------------------------------------------------------------------ legend actions
  const toggleTrace = (traceIndex: number) => {
    const t = plot.traces[traceIndex];
    if (!t) return;
    patch({ traces: plot.traces.map((tr, i) => (i === traceIndex ? { ...tr, hidden: !tr.hidden } : tr)) });
  };
  const removeTraceAt = (traceIndex: number) => {
    const t = plot.traces[traceIndex];
    if (t) removeTrace(className, plot.id, t.variable, t.resultId);
  };
  const setTraceColor = (traceIndex: number, color: string) => {
    patch({ traces: plot.traces.map((tr, i) => (i === traceIndex ? { ...tr, color } : tr)) });
    setColorMenu(null);
  };
  const openColorMenu = (traceIndex: number, e: ReactMouseEvent) => {
    const r = rootRef.current?.getBoundingClientRect();
    if (!r) return;
    setColorMenu({ traceIndex, left: clamp(e.clientX - r.left - 60, 4, r.width - 128), top: clamp(e.clientY - r.top - 70, TOOLBAR_HEIGHT + 4, r.height - 70) });
  };
  const onLegendContext = (traceIndex: number, e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const t = plot.traces[traceIndex];
    if (!t) return;
    menu.open(e, [
      { label: t.hidden ? 'Show trace' : 'Hide trace', onSelect: () => toggleTrace(traceIndex) },
      { label: 'Change colour…', onSelect: () => openColorMenu(traceIndex, e) },
      { label: '', separator: true },
      { label: 'Remove trace', danger: true, onSelect: () => removeTraceAt(traceIndex) },
    ]);
  };

  // ------------------------------------------------------------------ chart inputs
  const isTime = plot.xVariable === 'time';
  const showDisplayUnits = useStore((s) => s.settings.showDisplayUnits);
  const xDisp = displayInfo(isTime ? 's' : unitOf(meta, plot.xVariable), isTime ? undefined : displayUnitOf(meta, plot.xVariable), showDisplayUnits);
  const xUnit = xDisp.unit;
  const xName = isTime ? 'Time' : plot.xVariable;
  const xAxisLabel = xUnit ? `${xName} [${unitLabel(xUnit)}]` : xName;
  const series = useMemo<ChartSeries[]>(
    () =>
      resolved.map((s) => {
        const disp = displayInfo(unitOf(meta, s.variable), displayUnitOf(meta, s.variable), showDisplayUnits);
        const needsY = showDisplayUnits && disp.unit !== unitOf(meta, s.variable);
        const needsX = showDisplayUnits && !isTime && xDisp.unit !== unitOf(meta, plot.xVariable);
        return {
          id: s.id,
          label: s.label,
          color: s.color,
          x: needsX ? s.x.map(xDisp.convert) : s.x,
          y: needsY ? s.y.map(disp.convert) : s.y,
          hidden: s.hidden,
          unit: disp.unit ? unitLabel(disp.unit) : undefined,
        };
      }),
    [resolved, meta, showDisplayUnits, isTime, plot.xVariable, xDisp],
  );
  const emptyText = plot.traces.length === 0 ? 'Drag a variable here' : loading ? 'Loading…' : error ? 'Failed to load data' : 'No data';
  // A zoom window only makes sense for the quantities it was made for: drop it when the x variable,
  // the unit mode or the set of plotted (result, case, variable) changes.
  const resetKey = zoomResetKey(plot.xVariable, resolved, showDisplayUnits);
  const groups = useMemo(() => legendGroups(resolved, className), [resolved, className]);
  const modelName = shortClassName(className);
  const datalistId = `plot-xvars-${plot.id}`;

  return (
    <div
      ref={rootRef}
      className={`plot-window${plot.pinned ? ' pinned' : ''}${live ? ' live' : ''}${dragZone ? ' drag-over' : ''}`}
      style={{ left: geom.x, top: geom.y, width: geom.width, height: geom.height }}
      data-plot-id={plot.id}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="plot-toolbar" onPointerDown={startMove}>
        <span className="plot-drag-handle" aria-hidden="true">
          <Icon.Drag />
        </span>
        {editing ? (
          <input
            className="plot-title-input"
            value={titleDraft}
            autoFocus
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={onTitleKey}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Plot title"
          />
        ) : (
          <span className="plot-title" onDoubleClick={startEdit} title="Double-click to rename">
            {plot.title}
          </span>
        )}
        <span className="plot-toolbar-status">
          {loading && <span className="plot-spinner" aria-label="Loading" />}
          {!loading && error && (
            <Tooltip text={error}>
              <span className="plot-error-badge">
                <Icon.Warning />
              </span>
            </Tooltip>
          )}
        </span>
        <div className="plot-toolbar-buttons">
          <Tooltip text={plot.showLegend ? 'Hide legend' : 'Show legend'}>
            <button type="button" className={`plot-tool${plot.showLegend ? ' active' : ''}`} onClick={() => patch({ showLegend: !plot.showLegend })} aria-pressed={plot.showLegend}>
              <LegendGlyph />
            </button>
          </Tooltip>
          <Tooltip text="Plot settings">
            <button ref={gearRef} type="button" className={`plot-tool${settingsOpen ? ' active' : ''}`} onClick={() => setSettingsOpen((v) => !v)} aria-expanded={settingsOpen}>
              <Icon.Settings />
            </button>
          </Tooltip>
          <Tooltip text={plot.pinned ? 'Unpin' : 'Pin'}>
            <button type="button" className={`plot-tool plot-pin${plot.pinned ? ' pinned' : ''}`} onClick={() => patch({ pinned: !plot.pinned })} aria-pressed={plot.pinned}>
              <Icon.Pin />
            </button>
          </Tooltip>
          <Tooltip text="Close">
            <button type="button" className="plot-tool" onClick={() => removePlot(className, plot.id)}>
              <Icon.Close />
            </button>
          </Tooltip>
        </div>
      </div>

      <div ref={bodyRef} className="plot-body">
        <div className="plot-chart-wrap">
          <PlotChart
            series={series}
            xLabel={xAxisLabel}
            logY={plot.logY}
            showGrid={plot.showGrid}
            cursorTime={isTime ? sliderTime : undefined}
            onCursorChange={isTime ? setSliderTime : undefined}
            highlightId={hoverId}
            resetKey={resetKey}
            emptyText={emptyText}
          />
          {dragZone && (
            <>
              <div className={`plot-dropzone y${dragZone === 'y' ? ' active' : ''}`}>
                <span>Y axis</span>
              </div>
              <div className={`plot-dropzone x${dragZone === 'x' ? ' active' : ''}`} style={{ height: X_ZONE_HEIGHT }}>
                <span>X axis</span>
              </div>
            </>
          )}
        </div>

        {plot.showLegend && resolved.length > 0 && (
          <div className="plot-legend" role="list" aria-label="Legend" onMouseLeave={() => setHoverId(undefined)}>
            <div className="plot-legend-model" title={className}>
              {modelName}
            </div>
            {groups.map((g) => (
              <div key={g.name} className="plot-legend-section">
                {g.name !== modelName && (
                  <div className="plot-legend-group" title={g.name}>
                    {g.name}
                  </div>
                )}
                {g.items.map(({ series: s, name }) => (
                  <div
                    key={s.id}
                    role="listitem"
                    className={`plot-legend-item${s.hidden ? ' hidden' : ''}${s.status !== 'ready' ? ` ${s.status}` : ''}`}
                    onClick={() => toggleTrace(s.traceIndex)}
                    onContextMenu={(e) => onLegendContext(s.traceIndex, e)}
                    onMouseEnter={() => setHoverId(s.id)}
                    onMouseLeave={() => setHoverId((cur) => (cur === s.id ? undefined : cur))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleTrace(s.traceIndex);
                      } else if (e.key === 'Delete') removeTraceAt(s.traceIndex);
                    }}
                    tabIndex={0}
                    title={`${s.label}\n${s.hidden ? 'Click to show' : 'Click to hide'}`}
                  >
                    <button
                      type="button"
                      className="plot-legend-dot"
                      style={{ background: s.color }}
                      aria-label={`Change colour of ${s.label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        openColorMenu(s.traceIndex, e);
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                    />
                    <span className="plot-legend-label">{name}</span>
                    {s.status === 'loading' && <span className="plot-legend-status">…</span>}
                    <button
                      type="button"
                      className="plot-legend-remove"
                      aria-label={`Remove ${s.label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeTraceAt(s.traceIndex);
                      }}
                    >
                      <Icon.Close />
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {settingsOpen && (
        <div ref={settingsRef} className="plot-settings" role="dialog" aria-label="Plot settings">
          <label className="plot-settings-field">
            <span>Title</span>
            <input className="text-field" value={plot.title} onChange={(e) => patch({ title: e.target.value })} />
          </label>
          <label className="plot-settings-field">
            <span>X variable</span>
            <input
              className="text-field"
              list={datalistId}
              value={xDraft}
              onChange={(e) => setXDraft(e.target.value)}
              onBlur={() => {
                const v = xDraft.trim();
                if (v && v !== plot.xVariable) patch({ xVariable: v });
                else setXDraft(plot.xVariable);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              placeholder="time"
            />
            <datalist id={datalistId}>
              <option value="time" />
              {(variableList ?? []).slice(0, 2000).map((v) => v !== 'time' && <option key={v} value={v} />)}
            </datalist>
          </label>
          <label className="plot-settings-check">
            <input type="checkbox" checked={plot.logY} onChange={(e) => patch({ logY: e.target.checked })} />
            <span>Log Y</span>
          </label>
          <label className="plot-settings-check">
            <input type="checkbox" checked={plot.showGrid} onChange={(e) => patch({ showGrid: e.target.checked })} />
            <span>Grid</span>
          </label>
        </div>
      )}

      {colorMenu && (
        <div ref={colorRef} className="plot-color-menu" style={{ left: colorMenu.left, top: colorMenu.top }} role="menu" aria-label="Trace colour">
          {PLOT_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              role="menuitem"
              className={`plot-swatch${plot.traces[colorMenu.traceIndex]?.color === c ? ' selected' : ''}`}
              style={{ background: c }}
              title={c}
              aria-label={c}
              onClick={() => setTraceColor(colorMenu.traceIndex, c)}
            />
          ))}
        </div>
      )}

      <div className="plot-resize" onPointerDown={startResize} aria-hidden="true" />
    </div>
  );
}
