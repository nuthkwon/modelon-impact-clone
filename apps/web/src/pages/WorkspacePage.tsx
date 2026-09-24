/** Workspace page (§2): NavBar + Workspace panel | centre (Canvas / Code view) | Details panel. */
import { useEffect } from 'react';
import type { JSX } from 'react';
import { useStore } from '../store';
import { NavBar } from '../components/shell/NavBar';
import { CodeView } from '../components/code/CodeView';
import { ResizablePanel } from '../components/common/Resizable';
import { Spinner } from '../components/common/Spinner';
import { Tooltip } from '../components/common/Tooltip';
import { ChevronLeftIcon, LibraryBooksIcon } from '../components/icons';
import { useGlobalShortcuts } from '../hooks/useGlobalShortcuts';
import { useUrlSync } from '../hooks/useUrlSync';
import { useLocalStorageState } from '../hooks/useLocalStorageState';
import { WorkspacePanel } from '../components/workspace-panel/WorkspacePanel';
import { Canvas } from '../components/canvas/Canvas';
import { DetailsPanel } from '../components/details/DetailsPanel';
import '../components/shell/shell.css';

interface Layout {
  workspacePanel: number;
  details: number;
}

const DEFAULT_LAYOUT: Layout = { workspacePanel: 300, details: 360 };
const PANEL_MIN = 200;

export function WorkspacePage({ workspaceId, navigate }: { workspaceId: string; navigate: (path: string) => void }) {
  const loadWorkspace = useStore((s) => s.loadWorkspace);
  const loading = useStore((s) => s.loading);
  const loadError = useStore((s) => s.loadError);
  const storeWid = useStore((s) => s.workspaceId);
  const workspaceName = useStore((s) => s.workspace?.definition.name);
  const view = useStore((s) => s.view);
  const workspacePanelOpen = useStore((s) => s.workspacePanelOpen);
  const setWorkspacePanelOpen = useStore((s) => s.setWorkspacePanelOpen);
  const detailsOpen = useStore((s) => s.detailsOpen);
  const setDetailsOpen = useStore((s) => s.setDetailsOpen);
  const [layout, setLayout] = useLocalStorageState<Layout>('impact-clone:layout', DEFAULT_LAYOUT);

  useEffect(() => {
    void loadWorkspace(workspaceId);
  }, [workspaceId, loadWorkspace]);

  useEffect(() => {
    document.title = workspaceName ? `${workspaceName} – Impact` : 'Impact';
  }, [workspaceName]);

  useUrlSync(workspaceId);
  useGlobalShortcuts();

  const ready = storeWid === workspaceId && !loading;

  let body: JSX.Element;
  if (!ready) {
    body = (
      <div className="workspace-loading" role="status">
        <Spinner size="large" />
        <span>Loading workspace…</span>
      </div>
    );
  } else if (loadError) {
    body = (
      <div className="workspace-loading" role="alert">
        <span className="state-title" style={{ color: 'var(--error)' }}>The workspace could not be loaded</span>
        <span>{loadError}</span>
        <div className="state-actions">
          <button type="button" className="text-button" onClick={() => navigate('/')}>
            Back to workspaces
          </button>
          <button type="button" className="contained-button" onClick={() => void loadWorkspace(workspaceId)}>
            Retry
          </button>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="workspace-body">
        {workspacePanelOpen ? (
          <ResizablePanel
            side="left"
            size={layout.workspacePanel}
            min={PANEL_MIN}
            onResize={(w) => setLayout((l) => ({ ...l, workspacePanel: w }))}
            onCollapse={() => setWorkspacePanelOpen(false)}
            className="workspace-panel-wrap"
          >
            <WorkspacePanel />
          </ResizablePanel>
        ) : (
          <div className="workspace-panel-collapsed">
            <Tooltip text="Libraries" placement="right">
              <button type="button" className="icon-button" aria-label="Open the Workspace panel" onClick={() => setWorkspacePanelOpen(true)}>
                <LibraryBooksIcon />
              </button>
            </Tooltip>
          </div>
        )}

        <main className="workspace-center">{view === 'code' ? <CodeView /> : <Canvas />}</main>

        {detailsOpen ? (
          <ResizablePanel side="right" size={layout.details} min={PANEL_MIN} onResize={(w) => setLayout((l) => ({ ...l, details: w }))} onCollapse={() => setDetailsOpen(false)} className="details-wrap">
            <DetailsPanel />
          </ResizablePanel>
        ) : (
          <Tooltip text="Open the Details panel" placement="left">
            <button type="button" className="details-collapsed" aria-label="Open the Details panel" onClick={() => setDetailsOpen(true)}>
              <ChevronLeftIcon />
            </button>
          </Tooltip>
        )}
      </div>
    );
  }

  return (
    <div className="workspace-page">
      <NavBar navigate={navigate} />
      {body}
    </div>
  );
}

export default WorkspacePage;
