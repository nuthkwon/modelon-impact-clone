/**
 * Root component: hash-free path routing between the Home page (`/`) and a workspace
 * (`/workspaces/:wid`), plus the global hosts of the app shell (context menu, shell dialogs).
 */
import { useEffect, useState } from 'react';
import { HomePage } from './pages/HomePage';
import { WorkspacePage } from './pages/WorkspacePage';
import { ContextMenuHost } from './components/common/ContextMenu';
import { ShellDialogs } from './components/shell/ShellDialogs';

export function usePath(): [string, (path: string) => void] {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = (p: string) => {
    const [pathname] = p.split('?');
    if (p === `${window.location.pathname}${window.location.search}`) return;
    window.history.pushState(null, '', p);
    setPath(pathname);
  };
  return [path, navigate];
}

export function App() {
  const [path, navigate] = usePath();
  const m = /^\/workspaces\/([^/]+)/.exec(path);
  return (
    <>
      {m ? <WorkspacePage key={m[1]} workspaceId={decodeURIComponent(m[1])} navigate={navigate} /> : <HomePage navigate={navigate} />}
      <ShellDialogs />
      <ContextMenuHost />
    </>
  );
}
