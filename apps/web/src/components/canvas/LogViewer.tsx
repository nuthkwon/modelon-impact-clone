/**
 * Log Viewer (UI_SPEC §5.3): a toggle button at the bottom-left of the canvas (red badge when
 * the last run produced errors) and a resizable bottom panel with the compilation and
 * simulation logs, a level filter and a Download button.
 */
import { useMemo, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from '../../store';
import { Icon } from '../icons';

export type LogLevel = 'error' | 'warning' | 'info';
export type LogFilter = 'all' | 'warnings' | 'errors';

export const LOG_MIN_HEIGHT = 100;
const LOG_MAX_HEIGHT = 900;

export function logLineLevel(line: string): LogLevel {
  if (/\bError\b|error:/.test(line) || /\bERROR\b/.test(line)) return 'error';
  if (/\bWarning\b|warning:/.test(line) || /\bWARNING\b/.test(line)) return 'warning';
  return 'info';
}

export function filterLogLines(lines: string[], filter: LogFilter): string[] {
  if (filter === 'all') return lines;
  return lines.filter((l) => {
    const level = logLineLevel(l);
    return filter === 'errors' ? level === 'error' : level !== 'info';
  });
}

export interface LogViewerProps {
  height: number;
  onHeightChange(height: number): void;
}

export function LogViewer({ height, onHeightChange }: LogViewerProps) {
  const logOpen = useStore((s) => s.logOpen);
  const logTab = useStore((s) => s.logTab);
  const compilationLog = useStore((s) => s.compilationLog);
  const simulationLog = useStore((s) => s.simulationLog);
  const logHasErrors = useStore((s) => s.logHasErrors);
  const showLog = useStore((s) => s.showLog);
  const setLogOpen = useStore((s) => s.setLogOpen);
  const [filter, setFilter] = useState<LogFilter>('all');

  const text = logTab === 'compilation' ? compilationLog : simulationLog;
  const lines = useMemo(() => (text ? text.replace(/\r\n/g, '\n').split('\n') : []), [text]);
  const shown = useMemo(() => filterLogLines(lines, filter), [lines, filter]);

  const download = () => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${logTab}-log.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const onResizeStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    const startY = e.clientY;
    const startH = height;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const h = Math.max(LOG_MIN_HEIGHT, Math.min(LOG_MAX_HEIGHT, startH + (startY - ev.clientY)));
      onHeightChange(h);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  return (
    <>
      <button className={`icon-button log-toggle${logHasErrors ? ' has-errors' : ''}${logOpen ? ' active' : ''}`} title="Log viewer" aria-label="Log viewer" onClick={() => setLogOpen(!logOpen)}>
        <Icon.Terminal />
        {logHasErrors && <span className="log-badge" aria-label="Errors in the last run" />}
      </button>
      {logOpen && (
        <div className="log-panel" style={{ height }} data-canvas-scroll>
          <div className="log-resizer" onPointerDown={onResizeStart} title="Drag to resize" />
          <div className="log-header">
            <div className="tabs log-tabs">
              <button className={`tab${logTab === 'compilation' ? ' active' : ''}`} onClick={() => showLog('compilation', true)}>
                Compilation log
              </button>
              <button className={`tab${logTab === 'simulation' ? ' active' : ''}`} onClick={() => showLog('simulation', true)}>
                Simulation log
              </button>
            </div>
            <select className="log-filter" value={filter} onChange={(e) => setFilter(e.target.value as LogFilter)} title="Level filter" aria-label="Level filter">
              <option value="all">All</option>
              <option value="warnings">Warnings</option>
              <option value="errors">Errors</option>
            </select>
            <button className="text-button log-download" onClick={download} disabled={!text} title="Download log">
              <Icon.Download />
              Download
            </button>
            <button className="icon-button" title="Close" aria-label="Close log viewer" onClick={() => setLogOpen(false)}>
              <Icon.Close />
            </button>
          </div>
          <pre className="log-body">
            {shown.length === 0 && <div className="log-line info log-empty">{text ? 'No lines match the filter.' : 'Log is empty.'}</div>}
            {shown.map((l, i) => (
              <div key={i} className={`log-line ${logLineLevel(l)}`}>
                {l || ' '}
              </div>
            ))}
          </pre>
        </div>
      )}
    </>
  );
}
