/**
 * *Import library* explorer (Workspace Management → Libraries → Import): browses the server's
 * filesystem (folders and `.mo` files) so a library is imported by picking its `package.mo`
 * (or a single-file library `Name.mo`, or a package folder). "Upload from this computer"
 * sends a local folder or `.mo` file instead, for servers on another machine or with
 * filesystem access disabled.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { FileSystemEntry, FileSystemListing, ImportLibraryRequest, InstalledLibraryDto } from '@impact/protocol';
import { api, ApiClientError } from '../../api/client';
import { Dialog } from '../common/Dialog';
import { Spinner } from '../common/Spinner';
import { Tooltip } from '../common/Tooltip';
import { useContextMenu } from '../common/ContextMenu';
import { Icon } from '../icons';
import { formatBytes } from '../../pages/HomePage';

const LAST_DIR_KEY = 'impact-clone:import-library:last-dir';

function readLastDir(): string | undefined {
  try {
    return localStorage.getItem(LAST_DIR_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeLastDir(dir: string): void {
  try {
    localStorage.setItem(LAST_DIR_KEY, dir);
  } catch {
    /* storage unavailable */
  }
}

/** A file or package folder that can be imported as a library. */
const importable = (e: FileSystemEntry | undefined): boolean => !!e && (e.kind === 'file' || e.modelicaPackage === true);

function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export interface ImportLibraryDialogProps {
  /** Workspace the library is added to when "Add to workspace" stays checked. */
  workspace?: { id: string; name: string };
  onClose(): void;
  onImported(lib: InstalledLibraryDto, addedToWorkspace: boolean): void;
}

export function ImportLibraryDialog({ workspace, onClose, onImported }: ImportLibraryDialogProps) {
  const [listing, setListing] = useState<FileSystemListing>();
  const [pathText, setPathText] = useState('');
  const [selected, setSelected] = useState<string>();
  const [loadingDir, setLoadingDir] = useState(false);
  const [browseError, setBrowseError] = useState<string>();
  const [browseDisabled, setBrowseDisabled] = useState(false);
  const [importing, setImporting] = useState<string>();
  const [importError, setImportError] = useState<string>();
  const [addToWorkspace, setAddToWorkspace] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const menu = useContextMenu();

  const browse = useCallback(async (dir?: string, select?: string) => {
    setLoadingDir(true);
    setBrowseError(undefined);
    try {
      const l = await api.browseFilesystem(dir);
      setListing(l);
      setPathText(l.path);
      setSelected(select);
      writeLastDir(l.path);
      listRef.current?.scrollTo({ top: 0 });
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 403) setBrowseDisabled(true);
      setBrowseError(e instanceof Error ? e.message : String(e));
      if (dir === undefined) return;
      // Fall back to the home directory when a remembered folder no longer exists.
      if (!listing && e instanceof ApiClientError && e.status === 404) void browse(undefined);
    } finally {
      setLoadingDir(false);
    }
  }, [listing]);

  useEffect(() => {
    void browse(readLastDir());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- first listing only
  }, []);

  // `webkitdirectory` is not in React's input attribute types.
  useEffect(() => {
    folderInput.current?.setAttribute('webkitdirectory', '');
  }, []);

  const entries = listing?.entries ?? [];
  const selectedEntry = useMemo(() => entries.find((e) => e.path === selected), [entries, selected]);
  const hasPackageMo = entries.some((e) => e.kind === 'file' && e.name === 'package.mo');

  const runImport = useCallback(
    async (req: ImportLibraryRequest, label: string) => {
      setImporting(label);
      setImportError(undefined);
      try {
        const add = addToWorkspace && !!workspace;
        const lib = await api.importLibrary({ ...req, ...(add ? { workspaceId: workspace!.id } : {}) });
        onImported(lib, add);
      } catch (e) {
        setImportError(e instanceof Error ? e.message : String(e));
      } finally {
        setImporting(undefined);
      }
    },
    [addToWorkspace, workspace, onImported],
  );

  const importEntry = useCallback(
    (entry: FileSystemEntry | undefined) => {
      if (!entry || !importable(entry) || importing) return;
      void runImport({ path: entry.path }, entry.name === 'package.mo' && listing ? listing.path : entry.path);
    },
    [importing, listing, runImport],
  );

  const open = useCallback(
    (entry: FileSystemEntry) => {
      if (entry.kind === 'directory') void browse(entry.path);
      else importEntry(entry);
    },
    [browse, importEntry],
  );

  const goUp = useCallback(() => {
    if (listing?.parent) void browse(listing.parent, listing.path);
  }, [browse, listing]);

  const onListKeyDown = (e: ReactKeyboardEvent) => {
    if (!entries.length) return;
    const idx = entries.findIndex((x) => x.path === selected);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? Math.min(entries.length - 1, idx + 1) : Math.max(0, idx < 0 ? 0 : idx - 1);
      setSelected(entries[next].path);
      listRef.current?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && selectedEntry) {
      e.preventDefault();
      e.stopPropagation();
      open(selectedEntry);
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      goUp();
    }
  };

  const readUpload = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const wanted = Array.from(files).filter((f) => f.name.toLowerCase().endsWith('.mo') || f.name === 'package.order');
    if (!wanted.length) {
      setImportError('The selection contains no Modelica (.mo) files');
      return;
    }
    const payload = await Promise.all(wanted.map(async (f) => ({ path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, text: await f.text() })));
    const root = payload[0].path.split('/')[0];
    await runImport({ files: payload }, payload.length === 1 ? payload[0].path : root);
  };

  const openUploadMenu = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    menu.openAt(r.left, r.bottom + 4, [
      { label: 'Library folder (with package.mo)…', icon: <Icon.Folder />, onSelect: () => folderInput.current?.click() },
      { label: 'Single file (.mo)…', icon: <Icon.File />, onSelect: () => fileInput.current?.click() },
    ]);
  };

  const busy = importing !== undefined;
  const hint = selectedEntry
    ? importable(selectedEntry)
      ? selectedEntry.kind === 'directory'
        ? `Import the package folder ${selectedEntry.name}`
        : selectedEntry.name === 'package.mo'
          ? `Import the library in ${listing?.path ?? ''}`
          : `Import ${selectedEntry.name}`
      : 'Open the folder and select its package.mo'
    : hasPackageMo
      ? 'This folder is a Modelica package: select package.mo to import it'
      : 'Select the package.mo of a library, or a single-file library (.mo)';

  return (
    <Dialog
      open
      title="Import library"
      onClose={busy ? () => {} : onClose}
      persistent={busy}
      width={760}
      zIndex={920}
      className="wm-import-dialog"
      bodyClassName="wm-import-body"
      actions={
        <>
          <button type="button" className="text-button wm-upload-button" onClick={openUploadMenu} disabled={busy}>
            <Icon.Upload size={18} /> Upload from this computer
          </button>
          <span className="wm-actions-spacer" />
          <button type="button" className="outlined-button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="contained-button" onClick={() => importEntry(selectedEntry)} disabled={busy || !importable(selectedEntry)}>
            Import
          </button>
        </>
      }
    >
      <input ref={folderInput} type="file" multiple hidden onChange={(e) => void readUpload(e.target.files).finally(() => (e.target.value = ''))} />
      <input ref={fileInput} type="file" accept=".mo" hidden onChange={(e) => void readUpload(e.target.files).finally(() => (e.target.value = ''))} />

      {browseDisabled ? (
        <div className="wm-import-disabled">
          <Icon.Info />
          <div>
            Browsing the server's files is disabled on this server. Use <strong>Upload from this computer</strong> to import a library folder (containing package.mo) or a single .mo file.
          </div>
        </div>
      ) : (
        <>
          <div className="wm-import-bar">
            <Tooltip text="Up one level">
              <button type="button" className="icon-button" aria-label="Up one level" onClick={goUp} disabled={!listing?.parent || busy}>
                <Icon.ArrowUpward />
              </button>
            </Tooltip>
            <Tooltip text="Home folder">
              <button type="button" className="icon-button" aria-label="Home folder" onClick={() => listing && void browse(listing.home)} disabled={!listing || busy}>
                <Icon.Home />
              </button>
            </Tooltip>
            {listing && listing.roots.length > 1 && (
              <select
                className="text-field wm-import-roots"
                aria-label="Drive"
                value={listing.roots.find((r) => listing.path.toUpperCase().startsWith(r.toUpperCase())) ?? ''}
                onChange={(e) => void browse(e.target.value)}
                disabled={busy}
              >
                {listing.roots.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            )}
            <input
              className="text-field wm-import-path"
              aria-label="Folder path"
              value={pathText}
              spellCheck={false}
              onChange={(e) => setPathText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  void browse(pathText);
                }
              }}
              disabled={busy}
            />
          </div>
          <div className="wm-import-list" role="listbox" aria-label="Files" tabIndex={0} ref={listRef} onKeyDown={onListKeyDown}>
            <div className="wm-import-head" aria-hidden>
              <span>Name</span>
              <span>Modified</span>
              <span>Size</span>
            </div>
            {loadingDir && !listing && (
              <div className="wm-import-empty">
                <Spinner size="small" /> Loading…
              </div>
            )}
            {listing && entries.length === 0 && <div className="wm-import-empty">No folders or Modelica files here</div>}
            {entries.map((entry, i) => (
              <div
                key={entry.path}
                data-index={i}
                role="option"
                aria-selected={entry.path === selected}
                className={`wm-import-row${entry.path === selected ? ' selected' : ''}${entry.name === 'package.mo' ? ' package-file' : ''}`}
                onClick={() => setSelected(entry.path)}
                onDoubleClick={() => open(entry)}
                title={entry.path}
              >
                <span className="wm-import-name">
                  {entry.kind === 'directory' ? entry.modelicaPackage ? <Icon.Package size={18} className="wm-icon-package" /> : <Icon.Folder size={18} className="wm-icon-folder" /> : <Icon.File size={18} className="wm-icon-file" />}
                  <span className="wm-import-label">{entry.name}</span>
                  {entry.modelicaPackage && <span className="wm-chip">Modelica package</span>}
                  {entry.name === 'package.mo' && <span className="wm-chip accent">Library root</span>}
                </span>
                <span className="wm-import-date">{formatDate(entry.modifiedAt)}</span>
                <span className="wm-import-size">{entry.kind === 'file' && entry.size !== undefined ? formatBytes(entry.size) : ''}</span>
              </div>
            ))}
          </div>
          {browseError && <div className="wm-error">{browseError}</div>}
        </>
      )}

      <div className="wm-import-footer">
        <div className={`wm-import-hint${importable(selectedEntry) ? ' ready' : ''}`}>{hint}</div>
        {workspace && (
          <label className="wm-check">
            <input type="checkbox" checked={addToWorkspace} onChange={(e) => setAddToWorkspace(e.target.checked)} disabled={busy} />
            Add to workspace <strong>{workspace.name}</strong>
          </label>
        )}
      </div>
      {busy && (
        <div className="wm-import-progress">
          <Spinner size="small" /> Importing {importing}…
        </div>
      )}
      {importError && <div className="wm-error">{importError}</div>}
    </Dialog>
  );
}

export default ImportLibraryDialog;
