/**
 * Keeps `?class=&mode=&view=` of the workspace URL in sync with the store (replaceState) and
 * applies the query once the workspace has finished loading.
 */
import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import type { Mode, View } from '../store/types';

const MODES: Mode[] = ['model', 'experiment', 'results'];
const VIEWS: View[] = ['diagram', 'code'];

export function readWorkspaceQuery(search = window.location.search): { className?: string; mode?: Mode; view?: View } {
  const q = new URLSearchParams(search);
  const cls = q.get('class') ?? undefined;
  const mode = q.get('mode') as Mode | null;
  const view = q.get('view') as View | null;
  return {
    className: cls || undefined,
    mode: mode && MODES.includes(mode) ? mode : undefined,
    view: view && VIEWS.includes(view) ? view : undefined,
  };
}

export function useUrlSync(workspaceId: string): void {
  const initial = useRef(readWorkspaceQuery());
  const applied = useRef<string | undefined>(undefined);
  const loading = useStore((s) => s.loading);
  const loadError = useStore((s) => s.loadError);
  const storeWid = useStore((s) => s.workspaceId);
  const registryVersion = useStore((s) => s.registryVersion);
  const activeClass = useStore((s) => s.activeClass);
  const mode = useStore((s) => s.mode);
  const view = useStore((s) => s.view);

  // Re-read the query when navigating to another workspace.
  useEffect(() => {
    initial.current = readWorkspaceQuery();
    applied.current = undefined;
  }, [workspaceId]);

  // Apply the initial query once the workspace is loaded.
  useEffect(() => {
    if (applied.current === workspaceId) return;
    if (loading || loadError || storeWid !== workspaceId || registryVersion === 0) return;
    const s = useStore.getState();
    const q = initial.current;
    if (q.className && s.registry.has(q.className)) s.openClass(q.className);
    if (q.mode) s.setMode(q.mode);
    if (q.view && (q.view === 'diagram' || s.activeClass)) s.setView(q.view);
    applied.current = workspaceId;
  }, [workspaceId, loading, loadError, storeWid, registryVersion]);

  // Mirror the store into the URL.
  useEffect(() => {
    if (applied.current !== workspaceId) return;
    const q = new URLSearchParams();
    if (activeClass) q.set('class', activeClass);
    if (mode !== 'model') q.set('mode', mode);
    if (view !== 'diagram') q.set('view', view);
    const search = q.toString();
    const url = `${window.location.pathname}${search ? `?${search}` : ''}`;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, '', url);
  }, [workspaceId, activeClass, mode, view]);
}

export default useUrlSync;
