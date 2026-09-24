/**
 * Model canvas (UI_SPEC §5): the diagram scene plus its overlays — floating plots, stickies,
 * error banners, execution/views FABs, log viewer, time slider, zoom readout and read-only chip.
 * Library drops create components; variable drops create plots.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, JSX } from 'react';
import { snapToGrid } from '@impact/core';
import { useStore } from '../../store';
import { PlotWindowView } from '../plots/PlotWindow';
import { useShellStore } from '../shell/shellActions';
import { clipboardSize } from './clipboard';
import { DiagramSvg } from './DiagramSvg';
import { ErrorBanners } from './ErrorBanners';
import { ExecutionFab } from './ExecutionFab';
import { LogViewer } from './LogViewer';
import { Stickies } from './Stickies';
import { TimeSlider } from './TimeSlider';
import { ViewsFab } from './ViewsFab';
import { screenToDiagram, SNAP_GRID } from './geometry';
import type { InteractionApi } from './useInteractions';
import { useViewport } from './useViewport';
import './canvas.css';

const CLASS_MIME = 'application/x-modelica-class';
const VARIABLE_MIME = 'application/x-impact-variable';
const LOG_DEFAULT_HEIGHT = 220;

function hasType(e: DragEvent, type: string): boolean {
  return Array.from(e.dataTransfer.types ?? []).includes(type);
}

function isEditableTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest('.cm-editor'));
}

/** True while a shell dialog / confirm is open or the key was pressed inside a dialog. */
function dialogOpen(t: EventTarget | null): boolean {
  const shell = useShellStore.getState();
  if (shell.dialog || shell.confirmRequest) return true;
  return t instanceof HTMLElement && !!t.closest('.dialog');
}

export function Canvas(): JSX.Element {
  const activeClass = useStore((s) => s.activeClass);
  const diagram = useStore((s) => s.diagram);
  const diagramError = useStore((s) => s.diagramError);
  const mode = useStore((s) => s.mode);
  const view = useStore((s) => s.view);
  const registryVersion = useStore((s) => s.registryVersion);
  const showGrid = useStore((s) => s.settings.showGrid);
  const logOpen = useStore((s) => s.logOpen);
  const plots = useStore((s) => (activeClass ? s.plots[activeClass] : undefined));
  const addPlot = useStore((s) => s.addPlot);

  const libraryReadOnly = useMemo(() => (activeClass ? useStore.getState().isReadOnly(activeClass) : true), [activeClass, registryVersion]);
  const readOnly = mode !== 'model' || libraryReadOnly;

  const containerRef = useRef<HTMLDivElement>(null);
  const extent = diagram?.diagram.coordinateSystem.extent;
  const viewport = useViewport(containerRef, activeClass, extent);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const interactionsRef = useRef<InteractionApi | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [logHeight, setLogHeight] = useState(LOG_DEFAULT_HEIGHT);

  // Keyboard shortcuts (§10). Undo/redo, modes and save are handled by the shell.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || view !== 'diagram' || isEditableTarget(e.target) || dialogOpen(e.target)) return;
      const api = interactionsRef.current;
      const vpApi = viewportRef.current;
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key;
      if (key === 'Escape') {
        api?.cancel();
        return;
      }
      if ((key === 'Delete' || key === 'Backspace') && !ctrl) {
        if (readOnly) return;
        e.preventDefault();
        api?.deleteSelection();
        return;
      }
      if (ctrl && !e.altKey && (key === 'c' || key === 'C')) {
        if (useStore.getState().selection.length) {
          e.preventDefault();
          api?.copySelection();
        }
        return;
      }
      if (ctrl && !e.altKey && (key === 'v' || key === 'V')) {
        if (readOnly || !clipboardSize()) return;
        e.preventDefault();
        void api?.paste();
        return;
      }
      if (ctrl && (key === '+' || key === '=' || key === 'Add')) {
        e.preventDefault();
        vpApi.zoomBy(1.25);
        return;
      }
      if (ctrl && (key === '-' || key === '_' || key === 'Subtract')) {
        e.preventDefault();
        vpApi.zoomBy(0.8);
        return;
      }
      if (ctrl && key === '0') {
        e.preventDefault();
        vpApi.fit();
        return;
      }
      if (!ctrl && !e.altKey && !e.shiftKey && (key === 'f' || key === 'F')) {
        vpApi.fit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, readOnly]);

  // ---------------------------------------------------------------- drag & drop
  const acceptsDrag = useCallback((e: DragEvent) => (hasType(e, CLASS_MIME) && !readOnly && !!activeClass) || (hasType(e, VARIABLE_MIME) && !!activeClass), [readOnly, activeClass]);

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!acceptsDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dropActive) setDropActive(true);
  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    const related = e.relatedTarget as Node | null;
    if (related && containerRef.current?.contains(related)) return;
    setDropActive(false);
  };
  const onDrop = async (e: DragEvent<HTMLDivElement>) => {
    setDropActive(false);
    if (!activeClass) return;
    const cls = e.dataTransfer.getData(CLASS_MIME);
    const screen = viewport.clientToScreen(e.clientX, e.clientY);
    if (cls) {
      e.preventDefault();
      if (readOnly) return;
      const store = useStore.getState();
      const position = snapToGrid(screenToDiagram(viewport.vp, screen), SNAP_GRID);
      const result = await store.applyEdit({ op: 'addComponent', className: cls, position, rotation: 0 });
      if (result?.createdName) useStore.getState().select([result.createdName]);
      return;
    }
    const raw = e.dataTransfer.getData(VARIABLE_MIME);
    if (raw) {
      e.preventDefault();
      try {
        const payload = JSON.parse(raw) as { resultId?: string; result?: string; variable: string };
        if (payload.variable) addPlot(activeClass, [{ variable: payload.variable, resultId: payload.resultId ?? payload.result }], [screen[0], screen[1]]);
      } catch {
        /* ignore malformed payloads */
      }
    }
  };

  const classes = ['canvas', readOnly ? 'read-only' : 'editable', dropActive ? 'drop-active' : '', logOpen ? 'log-open' : ''].filter(Boolean).join(' ');
  const style = { '--canvas-bottom-inset': logOpen ? `${logHeight}px` : '0px' } as CSSProperties;

  return (
    <div ref={containerRef} className={classes} style={style} onDragOver={onDragOver} onDragEnter={onDragOver} onDragLeave={onDragLeave} onDrop={(e) => void onDrop(e)}>
      <DiagramSvg diagram={diagram} viewport={viewport} readOnly={readOnly} showGrid={showGrid} interactionsRef={interactionsRef} />

      {!activeClass && <div className="canvas-message">Select a class in the Workspace panel to open its diagram.</div>}
      {activeClass && !diagram && diagramError && (
        <div className="canvas-message canvas-error-label" title={diagramError}>
          {diagramError}
        </div>
      )}

      {activeClass && (plots ?? []).map((p) => (
        <div key={p.id} data-canvas-scroll style={{ display: 'contents' }}>
          <PlotWindowView className={activeClass} plot={p} canvasRef={containerRef} />
        </div>
      ))}

      {activeClass && <Stickies vp={viewport.vp} readOnly={readOnly} />}

      <div className="canvas-top">
        <ErrorBanners />
        {readOnly && activeClass && <div className="chip read-only-chip">{libraryReadOnly ? 'Library class' : 'Read-only'}</div>}
      </div>

      <div className="canvas-fabs">
        <ExecutionFab />
        <ViewsFab />
      </div>

      <LogViewer height={logHeight} onHeightChange={setLogHeight} />
      <TimeSlider />

      <div className="zoom-readout">
        <div className="chip zoom-chip">
          <span className="zoom-value">{Math.round(viewport.vp.scale * 100)}%</span>
          <button className="zoom-fit" onClick={() => viewport.fit()} title="Fit to view (F)">
            Fit
          </button>
        </div>
      </div>
    </div>
  );
}

export default Canvas;
