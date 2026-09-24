/**
 * SIMULATIONS tab (docs/UI_SPEC.md §6.5): results of the active model, newest first, with
 * status, timestamp, duration and case count; click selects the active result; the "…" menu
 * offers Rename / Delete / Download CSV / Show simulation log / Show compilation log.
 */
import { useEffect, useMemo, useState } from 'react';
import type { JSX, KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { api } from '../../api/client';
import { useStore } from '../../store';
import type { ResultEntry } from '../../store/types';
import { useContextMenu } from '../common/ContextMenu';
import { Tooltip } from '../common/Tooltip';
import { useShellActions } from '../shell/shellActions';
import { Icon } from '../icons';
import { forgetResultMeta } from './resultMeta';
import { formatDuration, formatTimestamp } from './variableTree';
import './results.css';

function CancelledGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8 0-1.85.63-3.55 1.69-4.9L16.9 18.31A7.9 7.9 0 0 1 12 20zm6.31-3.1L7.1 5.69A7.9 7.9 0 0 1 12 4c4.42 0 8 3.58 8 8 0 1.85-.63 3.55-1.69 4.9z"
      />
    </svg>
  );
}

function StatusIcon({ r }: { r: ResultEntry }): JSX.Element {
  const failed = r.cases.filter((c) => c.run_info.status === 'failed').length;
  switch (r.status) {
    case 'successful':
      return (
        <Tooltip text="Successful">
          <span className="sim-status ok">
            <Icon.Check />
          </span>
        </Tooltip>
      );
    case 'failed':
      return (
        <Tooltip text={failed > 1 ? `${failed} of ${r.cases.length} cases failed` : 'Failed'}>
          <span className="sim-status failed">
            <Icon.Error />
          </span>
        </Tooltip>
      );
    case 'partial':
      return (
        <Tooltip text={`${failed} of ${r.cases.length} cases failed`}>
          <span className="sim-status partial">
            <Icon.Warning />
          </span>
        </Tooltip>
      );
    case 'cancelled':
      return (
        <Tooltip text="Cancelled">
          <span className="sim-status cancelled">
            <CancelledGlyph />
          </span>
        </Tooltip>
      );
    case 'running':
    default:
      return (
        <Tooltip text="Running">
          <span className="sim-status running">
            <span className="results-spinner" />
          </span>
        </Tooltip>
      );
  }
}

function downloadUrl(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function SimulationsTab(): JSX.Element {
  const className = useStore((s) => s.activeClass);
  const wid = useStore((s) => s.workspaceId);
  const results = useStore((s) => s.results);
  const activeId = useStore((s) => (className ? s.activeResult[className] : undefined));
  const caseIndex = useStore((s) => s.caseIndex);
  const setActiveResult = useStore((s) => s.setActiveResult);
  const renameResult = useStore((s) => s.renameResult);
  const deleteResult = useStore((s) => s.deleteResult);
  const loadCaseLogs = useStore((s) => s.loadCaseLogs);
  const showLog = useStore((s) => s.showLog);
  const menu = useContextMenu();
  const shell = useShellActions();

  const list = useMemo(
    () => results.filter((r) => r.className === className).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [results, className],
  );
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  const [error, setError] = useState<string | undefined>();

  // Tick once a second while something is running so its duration counts up.
  const anyRunning = list.some((r) => r.status === 'running');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!anyRunning) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [anyRunning]);

  const caseIdFor = (r: ResultEntry): string | undefined => {
    const idx = r.id === activeId ? Math.min(caseIndex, Math.max(0, r.cases.length - 1)) : 0;
    return r.cases[idx]?.id;
  };

  const durationOf = (r: ResultEntry): string => {
    const start = Date.parse(r.createdAt);
    if (Number.isNaN(start)) return '';
    if (r.finishedAt) return formatDuration(Date.parse(r.finishedAt) - start);
    if (r.status === 'running') return `${formatDuration(now - start)}…`;
    return '';
  };

  const commitRename = async () => {
    if (!renaming) return;
    const { id, draft } = renaming;
    setRenaming(null);
    const name = draft.trim();
    const r = results.find((x) => x.id === id);
    if (!r || !name || name === r.name) return;
    try {
      await renameResult(id, name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (r: ResultEntry) => {
    const ok = await shell.confirm({
      title: 'Delete result',
      message: `Delete "${r.name}"? Its trajectories and logs cannot be recovered.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteResult(r.id);
      forgetResultMeta(r.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const openMenu = (e: ReactMouseEvent, r: ResultEntry) => {
    e.preventDefault();
    e.stopPropagation();
    const cid = caseIdFor(r);
    menu.open(e, [
      { label: 'Rename', onSelect: () => setRenaming({ id: r.id, draft: r.name }) },
      { label: 'Delete', danger: true, onSelect: () => void remove(r) },
      { label: '', separator: true },
      {
        label: 'Download result (CSV)',
        disabled: !wid || !cid,
        onSelect: () => {
          if (wid && cid) downloadUrl(api.caseResultCsvUrl(wid, r.id, cid), `${r.name}${r.cases.length > 1 ? `_${r.cases.find((c) => c.id === cid)?.meta?.label ?? cid}` : ''}.csv`);
        },
      },
      { label: '', separator: true },
      {
        label: 'Show simulation log',
        disabled: !cid,
        onSelect: () => {
          void loadCaseLogs(r.id, cid).finally(() => showLog('simulation', true));
        },
      },
      { label: 'Show compilation log', onSelect: () => showLog('compilation', true) },
    ]);
  };

  if (!className) return <div className="results-empty">Open a model to see its simulations.</div>;
  if (!list.length) return <div className="results-empty">No results yet. Press the Play button to simulate.</div>;

  return (
    <div className="sim-list" role="listbox" aria-label="Simulation results">
      {error && (
        <div className="results-empty results-error" role="alert">
          {error}
        </div>
      )}
      {list.map((r) => {
        const active = r.id === activeId;
        const failed = r.cases.filter((c) => c.run_info.status === 'failed').length;
        const isRenaming = renaming?.id === r.id;
        return (
          <div
            key={r.id}
            className={`sim-row${active ? ' active' : ''}`}
            role="option"
            aria-selected={active}
            tabIndex={0}
            onClick={() => {
              if (!active) setActiveResult(className, r.id);
            }}
            onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
              if (isRenaming) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setActiveResult(className, r.id);
              } else if (e.key === 'F2') {
                e.preventDefault();
                setRenaming({ id: r.id, draft: r.name });
              } else if (e.key === 'Delete') {
                e.preventDefault();
                void remove(r);
              }
            }}
            onContextMenu={(e) => openMenu(e, r)}
            onDoubleClick={() => setRenaming({ id: r.id, draft: r.name })}
          >
            <StatusIcon r={r} />
            <div className="sim-main">
              {isRenaming ? (
                <input
                  className="text-field sim-rename"
                  value={renaming.draft}
                  autoFocus
                  aria-label="Result name"
                  onChange={(e) => setRenaming({ id: r.id, draft: e.target.value })}
                  onBlur={() => void commitRename()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void commitRename();
                    else if (e.key === 'Escape') setRenaming(null);
                    e.stopPropagation();
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                />
              ) : (
                <div className="sim-name">
                  <span>{r.name}</span>
                  {r.cases.length > 1 && (
                    <Tooltip text={failed ? `${failed} of ${r.cases.length} cases failed` : `${r.cases.length} cases`}>
                      <span className={`chip sim-cases${failed ? ' failed' : ''}`}>
                        {r.cases.length} cases{failed ? ' !' : ''}
                      </span>
                    </Tooltip>
                  )}
                </div>
              )}
              <div className="sim-meta">
                <span>{formatTimestamp(r.createdAt)}</span>
                {durationOf(r) && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{durationOf(r)}</span>
                  </>
                )}
              </div>
            </div>
            <button type="button" className="icon-button sim-menu" aria-label={`Actions for ${r.name}`} onClick={(e) => openMenu(e, r)}>
              <Icon.MoreVert />
            </button>
          </div>
        );
      })}
    </div>
  );
}
