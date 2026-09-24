/**
 * Workspace Management (Modelon Impact's workspace configurator), opened from the
 * "Configure workspace" cogwheel next to PROJECTS or Apps → Workspace Management.
 *
 *  - WORKSPACE CONFIGURATION: the workspace's projects and dependencies. "Edit" shows the
 *    *Available libraries*; drag one onto the dependencies (or press +) to load it, press ×
 *    on a dependency to unload it. The Modelica Standard Library is always loaded.
 *  - LIBRARIES: the libraries installed on the server. "Import" opens the file explorer to
 *    pick a library's `package.mo`; the ⋮ menu adds/removes a library to/from this workspace
 *    or deletes it from the server.
 *
 * Changes apply immediately and the Workspace panel reloads its libraries (Impact asks for a
 * page reload instead).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { InstalledLibraryDto, Project } from '@impact/protocol';
import { api } from '../../api/client';
import { useStore } from '../../store';
import { Dialog } from '../common/Dialog';
import { Spinner } from '../common/Spinner';
import { Tooltip } from '../common/Tooltip';
import { useContextMenu } from '../common/ContextMenu';
import { Icon } from '../icons';
import { useShellActions } from '../shell/shellActions';
import { formatBytes } from '../../pages/HomePage';
import { ImportLibraryDialog } from './ImportLibraryDialog';
import './workspace-management.css';

export type WorkspaceManagementTab = 'configuration' | 'libraries';

const TABS: { id: WorkspaceManagementTab; label: string }[] = [
  { id: 'configuration', label: 'Workspace configuration' },
  { id: 'libraries', label: 'Libraries' },
];

const DRAG_TYPE = 'application/x-impact-library';
const MODELICA_ID = 'modelica';

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function LibraryBadge({ lib }: { lib: Pick<InstalledLibraryDto, 'projectType'> }) {
  return <span className="wm-badge">{lib.projectType === 'SYSTEM' ? 'System' : 'Released'}</span>;
}

export function WorkspaceManagementDialog({ initialTab = 'configuration', onClose }: { initialTab?: WorkspaceManagementTab; onClose(): void }) {
  const workspace = useStore((s) => s.workspace);
  const projects = useStore((s) => s.projects);
  const dependencies = useStore((s) => s.dependencies);
  const reloadLibraries = useStore((s) => s.reloadLibraries);
  const shell = useShellActions();
  const menu = useContextMenu();

  const [tab, setTab] = useState<WorkspaceManagementTab>(initialTab);
  const [installed, setInstalled] = useState<InstalledLibraryDto[]>();
  const [listError, setListError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [importOpen, setImportOpen] = useState(false);
  const [availableFilter, setAvailableFilter] = useState('');
  const [dropActive, setDropActive] = useState(false);

  const refreshInstalled = useCallback(async () => {
    try {
      setInstalled((await api.listInstalledLibraries()).data.items);
      setListError(undefined);
    } catch (e) {
      setListError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void refreshInstalled();
  }, [refreshInstalled]);

  const dependencyIds = useMemo(() => new Set(dependencies.map((d) => d.id)), [dependencies]);
  const available = useMemo(() => {
    const q = availableFilter.trim().toLowerCase();
    return (installed ?? []).filter((l) => !dependencyIds.has(l.id) && (!q || l.name.toLowerCase().includes(q) || (l.description ?? '').toLowerCase().includes(q)));
  }, [installed, dependencyIds, availableFilter]);
  const installedById = useMemo(() => new Map((installed ?? []).map((l) => [l.id, l])), [installed]);

  /** Runs a library change, then reloads the Workspace panel's libraries and the installed list. */
  const run = useCallback(
    async (label: string, action: () => Promise<unknown>, done?: string) => {
      setBusy(label);
      setError(undefined);
      setNotice(undefined);
      try {
        await action();
        await Promise.all([reloadLibraries(), refreshInstalled()]);
        if (done) setNotice(done);
      } catch (e) {
        setError(errorText(e));
        void refreshInstalled();
      } finally {
        setBusy(undefined);
      }
    },
    [reloadLibraries, refreshInstalled],
  );

  const addToWorkspace = useCallback(
    (lib: { id: string; name: string }) => {
      if (!workspace) return;
      void run(`Loading ${lib.name}…`, () => api.addDependency(workspace.id, lib.id), `${lib.name} was added to the workspace.`);
    },
    [run, workspace],
  );

  const removeFromWorkspace = useCallback(
    (lib: { id: string; name: string }) => {
      if (!workspace) return;
      void run(`Unloading ${lib.name}…`, () => api.removeDependency(workspace.id, lib.id), `${lib.name} was removed from the workspace.`);
    },
    [run, workspace],
  );

  const deleteLibrary = useCallback(
    async (lib: InstalledLibraryDto) => {
      const used = lib.usedIn.map((w) => w.name);
      const ok = await shell.confirm({
        title: `Delete ${lib.name}?`,
        message: `${lib.name}${lib.version ? ` ${lib.version}` : ''} will be permanently deleted from the server. ${
          used.length ? `It is used in ${used.length === 1 ? 'the workspace' : 'the workspaces'} ${used.join(', ')} and will be removed from ${used.length === 1 ? 'it' : 'them'}.` : 'It is not used in any workspace.'
        }`,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
      void run(`Deleting ${lib.name}…`, () => api.deleteInstalledLibrary(lib.id), `${lib.name} was deleted.`);
    },
    [run, shell],
  );

  const openLibraryMenu = (e: ReactMouseEvent<HTMLButtonElement>, lib: InstalledLibraryDto) => {
    const r = e.currentTarget.getBoundingClientRect();
    const inWorkspace = dependencyIds.has(lib.id);
    const system = lib.projectType === 'SYSTEM';
    menu.openAt(r.right - 200, r.bottom + 2, [
      inWorkspace
        ? { label: 'Remove from workspace', icon: <Icon.Close />, disabled: system || !workspace, onSelect: () => removeFromWorkspace(lib), title: system ? 'The Modelica Standard Library is always loaded' : undefined }
        : { label: 'Add to workspace', icon: <Icon.Add />, disabled: !workspace, onSelect: () => addToWorkspace(lib) },
      { separator: true },
      { label: 'Delete', icon: <Icon.Delete />, danger: true, disabled: system, onSelect: () => void deleteLibrary(lib) },
    ]);
  };

  const onImported = useCallback(
    (lib: InstalledLibraryDto, added: boolean) => {
      setImportOpen(false);
      void run(
        `Loading ${lib.name}…`,
        async () => {},
        `${lib.name}${lib.version ? ` ${lib.version}` : ''} was imported (${lib.fileCount} files)${added ? ' and added to the workspace' : ''}.`,
      );
    },
    [run],
  );

  const onDrop = (e: ReactDragEvent) => {
    setDropActive(false);
    const id = e.dataTransfer.getData(DRAG_TYPE);
    const lib = id ? installedById.get(id) : undefined;
    if (!lib) return;
    e.preventDefault();
    addToWorkspace(lib);
  };

  const renderDependency = (p: Project) => {
    const lib = installedById.get(p.id);
    const system = p.id === MODELICA_ID || p.projectType === 'SYSTEM';
    return (
      <li key={p.id} className="wm-item">
        <Icon.LibraryBooks size={18} className="wm-item-icon" />
        <div className="wm-item-main">
          <div className="wm-item-name">
            {p.definition.name}
            {lib?.version && <span className="wm-version">{lib.version}</span>}
            <LibraryBadge lib={{ projectType: p.projectType }} />
          </div>
          {lib?.description && <div className="wm-item-meta">{lib.description}</div>}
        </div>
        {system ? (
          <Tooltip text="The Modelica Standard Library is always loaded">
            <span className="wm-item-lock" aria-label="Always loaded">
              <Icon.Lock size={16} />
            </span>
          </Tooltip>
        ) : (
          editing && (
            <Tooltip text="Remove from workspace">
              <button type="button" className="icon-button wm-remove" aria-label={`Remove ${p.definition.name} from workspace`} disabled={!!busy} onClick={() => removeFromWorkspace({ id: p.id, name: p.definition.name })}>
                <Icon.Close />
              </button>
            </Tooltip>
          )
        )}
      </li>
    );
  };

  const configuration = (
    <div className={`wm-config${editing ? ' editing' : ''}`}>
      <div className="wm-config-main">
        <div className="wm-config-head">
          <div>
            <div className="wm-ws-name">{workspace?.definition.name ?? 'No workspace open'}</div>
            {workspace?.definition.description && <div className="wm-item-meta">{workspace.definition.description}</div>}
          </div>
          {workspace && (
            <button type="button" className={editing ? 'contained-button' : 'outlined-button'} onClick={() => setEditing((v) => !v)} disabled={!!busy}>
              {editing ? 'Done' : <><Icon.Edit size={16} /> Edit</>}
            </button>
          )}
        </div>
        <div className="section-title wm-section">Projects</div>
        <ul className="wm-list">
          {projects.length === 0 && <li className="wm-empty">No projects</li>}
          {projects.map((p) => (
            <li key={p.id} className="wm-item">
              <Icon.Folder size={18} className="wm-item-icon" />
              <div className="wm-item-main">
                <div className="wm-item-name">
                  {p.definition.name}
                  <span className="wm-badge">{p.projectType === 'LOCAL' ? 'Local' : p.projectType.toLowerCase()}</span>
                </div>
                <div className="wm-item-meta">{p.definition.content.map((c) => c.name).join(', ') || 'No content'}</div>
              </div>
            </li>
          ))}
        </ul>
        <div className="section-title wm-section">Dependencies</div>
        <ul
          className={`wm-list wm-deps${editing ? ' droppable' : ''}${dropActive ? ' drop-active' : ''}`}
          onDragOver={(e) => {
            if (!editing || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setDropActive(true);
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={onDrop}
        >
          {dependencies.map(renderDependency)}
          {editing && <li className="wm-dropzone">Drop libraries here to add them to the workspace</li>}
        </ul>
        {!editing && workspace && <div className="wm-note">Press Edit to add or remove libraries. Import new libraries on the Libraries tab.</div>}
      </div>
      {editing && (
        <aside className="wm-available" aria-label="Available libraries">
          <div className="section-title wm-section">Available libraries</div>
          <div className="wm-filter">
            <Icon.Search size={16} />
            <input className="text-field" placeholder="Filter" aria-label="Filter available libraries" value={availableFilter} onChange={(e) => setAvailableFilter(e.target.value)} />
          </div>
          <ul className="wm-list">
            {installed === undefined && !listError && (
              <li className="wm-empty">
                <Spinner size="small" />
              </li>
            )}
            {installed !== undefined && available.length === 0 && <li className="wm-empty">{availableFilter ? 'No matching libraries' : 'All installed libraries are loaded'}</li>}
            {available.map((lib) => (
              <li
                key={lib.id}
                className="wm-item draggable"
                draggable={!busy}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_TYPE, lib.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onDragEnd={() => setDropActive(false)}
              >
                <Icon.Drag size={16} className="wm-item-grip" />
                <div className="wm-item-main">
                  <div className="wm-item-name">
                    {lib.name}
                    {lib.version && <span className="wm-version">{lib.version}</span>}
                  </div>
                  {lib.description && <div className="wm-item-meta">{lib.description}</div>}
                </div>
                <Tooltip text="Add to workspace">
                  <button type="button" className="icon-button" aria-label={`Add ${lib.name} to workspace`} disabled={!!busy} onClick={() => addToWorkspace(lib)}>
                    <Icon.Add />
                  </button>
                </Tooltip>
              </li>
            ))}
          </ul>
          <button type="button" className="text-button wm-import-link" onClick={() => setImportOpen(true)} disabled={!!busy}>
            <Icon.Upload size={16} /> Import library…
          </button>
        </aside>
      )}
    </div>
  );

  const libraries = (
    <div className="wm-libraries">
      <div className="wm-libraries-head">
        <div className="wm-note">Libraries installed on this server. Imported libraries are read-only and can be used by any workspace.</div>
        <button type="button" className="contained-button" onClick={() => setImportOpen(true)} disabled={!!busy}>
          <Icon.Upload size={18} /> Import
        </button>
      </div>
      <ul className="wm-list">
        {installed === undefined && !listError && (
          <li className="wm-empty">
            <Spinner size="small" /> Loading…
          </li>
        )}
        {(installed ?? []).map((lib) => {
          const inWorkspace = dependencyIds.has(lib.id);
          return (
            <li key={lib.id} className="wm-item wm-library">
              <Icon.LibraryBooks size={20} className="wm-item-icon" />
              <div className="wm-item-main">
                <div className="wm-item-name">
                  {lib.name}
                  {lib.version && <span className="wm-version">{lib.version}</span>}
                  <LibraryBadge lib={lib} />
                  {inWorkspace && <span className="wm-chip accent">In this workspace</span>}
                </div>
                {lib.description && <div className="wm-item-meta">{lib.description}</div>}
                <div className="wm-item-meta">
                  {lib.fileCount} files · {formatBytes(lib.size)}
                  {lib.source && ` · ${lib.source === 'upload' ? 'uploaded' : lib.source}`}
                  {lib.importedAt && ` · imported ${new Date(lib.importedAt).toLocaleDateString()}`}
                </div>
                <div className="wm-item-meta">Used in: {lib.usedIn.length ? lib.usedIn.map((w) => w.name).join(', ') : 'no workspace'}</div>
              </div>
              <Tooltip text="More">
                <button type="button" className="icon-button" aria-label={`${lib.name} actions`} disabled={!!busy} onClick={(e) => openLibraryMenu(e, lib)}>
                  <Icon.MoreVert />
                </button>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <>
      <Dialog
        open
        title="Workspace Management"
        onClose={onClose}
        width={editing && tab === 'configuration' ? 920 : 720}
        className="wm-dialog"
        bodyClassName="wm-body"
        actions={
          <button type="button" className="contained-button" onClick={onClose}>
            Close
          </button>
        }
      >
        <div className="tabs wm-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" className={`tab${t.id === tab ? ' active' : ''}`} aria-selected={t.id === tab} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        {busy && (
          <div className="wm-status">
            <Spinner size="small" /> {busy}
          </div>
        )}
        {!busy && notice && (
          <div className="wm-status success">
            <Icon.Check size={16} /> {notice}
          </div>
        )}
        {error && <div className="wm-error">{error}</div>}
        {listError && <div className="wm-error">Installed libraries could not be loaded: {listError}</div>}
        <div className="wm-tab-body">{tab === 'configuration' ? configuration : libraries}</div>
      </Dialog>
      {importOpen && (
        <ImportLibraryDialog
          workspace={workspace ? { id: workspace.id, name: workspace.definition.name } : undefined}
          onClose={() => setImportOpen(false)}
          onImported={onImported}
        />
      )}
    </>
  );
}

export default WorkspaceManagementDialog;
