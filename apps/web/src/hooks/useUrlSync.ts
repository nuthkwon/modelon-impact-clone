/**
 * Keeps `?class=&mode=&view=` of the workspace URL in sync with the store (replaceState) and
 * applies the query once the workspace has finished loading.
 */
import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import type { Mode, View } from '../store/types';

const MODES: Mode[] = ['model', 'experiment', 'results'];
const VIEWS: View[] = ['diagram', 'code'];

/**
 * Decodes one percent-encoded path segment (e.g. the workspace id of `/workspaces/:wid`). A malformed
 * sequence such as `%E0` or a truncated `%2` makes `decodeURIComponent` throw; the raw segment is used
 * instead so the page renders its "could not be loaded" state rather than an empty document.
 */
export function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

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
    if (q.view && (q.view === 'diagram' || useStore.getState().activeClass)) s.setView(q.view);
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
