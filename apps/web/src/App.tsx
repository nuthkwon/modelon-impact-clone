/**
 * Root component: hash-free path routing between the Home page (`/`) and a workspace
 * (`/workspaces/:wid`). Implemented by the app-shell module; this file only wires routing.
 */
import { useEffect, useState } from 'react';
import { HomePage } from './pages/HomePage';
import { WorkspacePage } from './pages/WorkspacePage';

export function usePath(): [string, (path: string) => void] {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = (p: string) => {
    if (p === window.location.pathname) return;
    window.history.pushState(null, '', p);
    setPath(p);
  };
  return [path, navigate];
}

export function App() {
  const [path, navigate] = usePath();
  const m = /^\/workspaces\/([^/]+)/.exec(path);
  if (m) return <WorkspacePage workspaceId={decodeURIComponent(m[1])} navigate={navigate} />;
  return <HomePage navigate={navigate} />;
}
