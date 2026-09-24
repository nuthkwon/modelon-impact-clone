/**
 * Root component: hash-free path routing between the Home page (`/`) and a workspace
 * (`/workspaces/:wid`), plus the global hosts of the app shell (context menu, shell dialogs).
 */
import { useEffect, useState } from 'react';
import { HomePage } from './pages/HomePage';
import { WorkspacePage } from './pages/WorkspacePage';
import { ContextMenuHost } from './components/common/ContextMenu';
import { ShellDialogs } from './components/shell/ShellDialogs';
import { decodePathSegment } from './hooks/useUrlSync';
import { currentPath, currentUrl, onNavigate, pushUrl } from './routing';

export function usePath(): [string, (path: string) => void] {
  const [path, setPath] = useState(currentPath());
  useEffect(() => onNavigate(() => setPath(currentPath())), []);
  const navigate = (p: string) => {
    const [pathname] = p.split('?');
    if (p === currentUrl()) return;
    pushUrl(p);
    setPath(pathname);
  };
  return [path, navigate];
}

export function App() {
  const [path, navigate] = usePath();
  const m = /^\/workspaces\/([^/]+)/.exec(path);
  return (
    <>
      {m ? <WorkspacePage key={m[1]} workspaceId={decodePathSegment(m[1])} navigate={navigate} /> : <HomePage navigate={navigate} />}
      <ShellDialogs />
      <ContextMenuHost />
    </>
  );
}
