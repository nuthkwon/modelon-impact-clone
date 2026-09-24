/** Home page (§1): list of workspaces with create / rename / delete and the Apps menu. */
import { useCallback, useEffect, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Project, Workspace } from '@impact/protocol';
import { api } from '../api/client';
import { NavBar } from '../components/shell/NavBar';
import { useShellActions } from '../components/shell/shellActions';
import { Dialog } from '../components/common/Dialog';
import { Spinner } from '../components/common/Spinner';
import { Tooltip } from '../components/common/Tooltip';
import { useContextMenu } from '../components/common/ContextMenu';
import { AddIcon, CloseIcon, DeleteIcon, EditIcon, MoreVertIcon, OpenInNewIcon, StorageIcon } from '../components/icons';
import './home.css';

export function formatBytes(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function WorkspaceFormDialog({ title, submitLabel, initial, onSubmit, onClose }: { title: string; submitLabel: string; initial?: { name: string; description?: string }; onSubmit: (name: string, description: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const submit = async () => {
    if (!name.trim()) {
      setError('Enter a name.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit(name.trim(), description.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title={title}
      onClose={onClose}
      onSubmit={() => void submit()}
      width={460}
      actions={
        <>
          <button type="button" className="text-button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="contained-button" onClick={() => void submit()} disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : submitLabel}
          </button>
        </>
      }
    >
      <div className="form-row">
        <label htmlFor="ws-name">Name</label>
        <input id="ws-name" className="text-field" value={name} onChange={(e) => setName(e.target.value)} placeholder="My workspace" />
      </div>
      <div className="form-row">
        <label htmlFor="ws-description">Description</label>
        <textarea id="ws-description" className="text-field" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Optional description" />
      </div>
      {error && <div className="form-error">{error}</div>}
    </Dialog>
  );
}

export function HomePage({ navigate }: { navigate: (path: string) => void }) {
  const shell = useShellActions();
  const menu = useContextMenu();
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Workspace | null>(null);
  const [mgmtOpen, setMgmtOpen] = useState(false);
  const [projects, setProjects] = useState<Record<string, Project[] | 'loading' | 'error'>>({});

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const res = await api.listWorkspaces();
      setWorkspaces(res.data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setWorkspaces([]);
    }
  }, []);

  useEffect(() => {
    document.title = 'Impact – Workspaces';
    void load();
  }, [load]);

  useEffect(() => {
    if (!mgmtOpen || !workspaces) return;
    for (const ws of workspaces) {
      if (projects[ws.id]) continue;
      setProjects((p) => ({ ...p, [ws.id]: 'loading' }));
      api
        .listProjects(ws.id)
        .then((r) => setProjects((p) => ({ ...p, [ws.id]: r.data.items })))
        .catch(() => setProjects((p) => ({ ...p, [ws.id]: 'error' })));
    }
  }, [mgmtOpen, workspaces, projects]);

  const open = (ws: Workspace) => navigate(`/workspaces/${encodeURIComponent(ws.id)}`);

  const remove = async (ws: Workspace) => {
    const ok = await shell.confirm({
      title: 'Delete workspace?',
      message: `"${ws.definition.name}" and all of its projects, experiments and results will be deleted permanently.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteWorkspace(ws.id);
      setProjects((p) => {
        const next = { ...p };
        delete next[ws.id];
        return next;
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const rowMenu = (e: ReactMouseEvent<HTMLElement>, ws: Workspace) => {
    e.preventDefault();
    e.stopPropagation();
    const isRow = e.currentTarget.classList.contains('ws-row');
    const r = e.currentTarget.getBoundingClientRect();
    const x = isRow ? e.clientX : r.right - 200;
    const y = isRow ? e.clientY : r.bottom + 4;
    menu.openAt(x, y, [
      { label: 'Open', icon: <OpenInNewIcon />, onSelect: () => open(ws) },
      { label: 'Rename…', icon: <EditIcon />, onSelect: () => setRenaming(ws) },
      { separator: true },
      { label: 'Delete', icon: <DeleteIcon />, danger: true, onSelect: () => void remove(ws) },
    ]);
  };

  return (
    <div className="home-page">
      <NavBar navigate={navigate} home onWorkspaceManagement={() => setMgmtOpen((v) => !v)} />
      <main className="home-main">
        <div className="home-container">
          <div className="home-header">
            <h1>
              Workspaces {workspaces && <span className="home-count">{workspaces.length}</span>}
            </h1>
            <div className="home-toolbar">
              <Tooltip text="Not available in this clone">
                <button type="button" className="text-button" disabled>
                  Import workspace
                </button>
              </Tooltip>
              <button type="button" className="contained-button" onClick={() => setCreating(true)}>
                <AddIcon size={18} /> New workspace
              </button>
            </div>
          </div>

          {mgmtOpen && (
            <section className="home-mgmt" aria-label="Workspace Management">
              <h2>
                <StorageIcon /> Workspace Management
                <button type="button" className="icon-button" aria-label="Close" onClick={() => setMgmtOpen(false)}>
                  <CloseIcon />
                </button>
              </h2>
              {(workspaces ?? []).length === 0 && <div className="mgmt-meta">No workspaces.</div>}
              {(workspaces ?? []).map((ws) => {
                const p = projects[ws.id];
                return (
                  <div key={ws.id} className="home-mgmt-ws">
                    <div>
                      <strong>{ws.definition.name}</strong> <span className="mgmt-meta">({ws.id})</span>
                    </div>
                    {p === 'loading' || p === undefined ? (
                      <div className="mgmt-meta">Loading projects…</div>
                    ) : p === 'error' ? (
                      <div className="mgmt-meta">Projects could not be loaded.</div>
                    ) : (
                      <ul>
                        {p.map((proj) => (
                          <li key={proj.id}>
                            {proj.definition.name} <span className="mgmt-meta">— {proj.projectType.toLowerCase()}, {proj.definition.content.map((c) => c.name).join(', ') || 'no content'}</span>
                          </li>
                        ))}
                        {ws.definition.dependencies.length > 0 && (
                          <li className="mgmt-meta">
                            {ws.definition.dependencies.length} dependenc{ws.definition.dependencies.length === 1 ? 'y' : 'ies'} (read-only)
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                );
              })}
            </section>
          )}

          {error && (
            <div className="home-error">
              <span>{error}</span>
              <button type="button" className="text-button" onClick={() => void load()}>
                Retry
              </button>
            </div>
          )}
          {!workspaces && !error && (
            <div className="home-loading">
              <Spinner size="large" />
            </div>
          )}
          {workspaces && workspaces.length === 0 && !error && (
            <div className="home-empty">
              <span>No workspaces yet.</span>
              <button type="button" className="contained-button" onClick={() => setCreating(true)}>
                <AddIcon size={18} /> New workspace
              </button>
            </div>
          )}
          {workspaces && workspaces.length > 0 && (
            <div className="ws-list">
              {workspaces.map((ws) => (
                <div
                  key={ws.id}
                  role="button"
                  tabIndex={0}
                  className="ws-row"
                  onClick={() => open(ws)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      open(ws);
                    }
                  }}
                  onContextMenu={(e) => rowMenu(e, ws)}
                >
                  <span className="ws-icon">
                    <StorageIcon size={22} />
                  </span>
                  <span className="ws-main">
                    <div className="ws-name">{ws.definition.name}</div>
                    <div className="ws-desc">{ws.definition.description || 'No description'}</div>
                  </span>
                  <span className="ws-meta">
                    <span>Last modified {formatDate(ws.definition.updatedAt)}</span>
                    <span>{formatBytes(ws.sizeInfo?.total)}</span>
                  </span>
                  <button type="button" className="icon-button ws-menu" aria-label="Workspace actions" aria-haspopup="menu" onClick={(e) => rowMenu(e, ws)}>
                    <MoreVertIcon />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {creating && (
        <WorkspaceFormDialog
          title="New workspace"
          submitLabel="Create"
          onClose={() => setCreating(false)}
          onSubmit={async (name, description) => {
            const ws = await api.createWorkspace({ new: { name, description: description || undefined } });
            await load();
            open(ws);
          }}
        />
      )}
      {renaming && (
        <WorkspaceFormDialog
          title="Rename workspace"
          submitLabel="Save"
          initial={{ name: renaming.definition.name, description: renaming.definition.description }}
          onClose={() => setRenaming(null)}
          onSubmit={async (name, description) => {
            await api.renameWorkspace(renaming.id, name, description || undefined);
            await load();
          }}
        />
      )}
    </div>
  );
}

export default HomePage;
