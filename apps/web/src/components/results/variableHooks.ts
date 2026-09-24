/**
 * Store-facing hooks shared by the CALCULATED VALUES tab and the Variables list: active
 * result/case resolution, batched trajectory loading, per-row values at the slider time and
 * the row actions (plot / sticky / favorite).
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useStore } from '../../store';
import type { ResultEntry } from '../../store/types';
import { componentOf } from './variableTree';

export interface ActiveResultCase {
  result?: ResultEntry;
  caseId?: string;
  caseIndex: number;
}

/** Active result of a class and the case selected by the case slider/selector. */
export function useActiveResultCase(className?: string): ActiveResultCase {
  const results = useStore((s) => s.results);
  const activeId = useStore((s) => (className ? s.activeResult[className] : undefined));
  const caseIndex = useStore((s) => s.caseIndex);
  return useMemo(() => {
    const result = className ? (results.find((r) => r.id === activeId) ?? results.find((r) => r.className === className)) : undefined;
    const idx = result ? Math.min(caseIndex, Math.max(0, result.cases.length - 1)) : 0;
    return { result, caseId: result?.cases[idx]?.id, caseIndex: idx };
  }, [results, activeId, caseIndex, className]);
}

const CHUNK = 100;

/**
 * Fetches (in chunks) every trajectory of `variables` that is not cached yet, so rows never
 * fire one request each. Failed chunks are not retried until the result/case changes.
 */
export function useBatchTrajectories(resultId: string | undefined, caseId: string | undefined, variables: string[]): void {
  const trajectories = useStore((s) => s.trajectories);
  const fetchTrajectories = useStore((s) => s.fetchTrajectories);
  const inflight = useRef(new Set<string>());
  const failed = useRef(new Set<string>());

  useEffect(() => {
    inflight.current.clear();
    failed.current.clear();
  }, [resultId, caseId]);

  useEffect(() => {
    if (!resultId || !caseId) return;
    const missing: string[] = [];
    for (const v of variables) {
      const key = `${resultId}/${caseId}/${v}`;
      if (trajectories[key] || inflight.current.has(key) || failed.current.has(key)) continue;
      missing.push(v);
    }
    if (!missing.length) return;
    for (let i = 0; i < missing.length; i += CHUNK) {
      const chunk = missing.slice(i, i + CHUNK);
      const keys = chunk.map((v) => `${resultId}/${caseId}/${v}`);
      keys.forEach((k) => inflight.current.add(k));
      fetchTrajectories(resultId, caseId, chunk)
        .catch(() => keys.forEach((k) => failed.current.add(k)))
        .finally(() => keys.forEach((k) => inflight.current.delete(k)));
    }
  }, [resultId, caseId, variables, trajectories, fetchTrajectories]);
}

export interface VariableValue {
  /** Interpolated value at the slider time; undefined while loading / when unavailable. */
  value?: number;
  /** True once the trajectory is in the cache. */
  loaded: boolean;
  /** Number of samples (1 for parameters). */
  length?: number;
}

/**
 * Value of a variable at the slider time for a result/case. Does not fetch by itself (the
 * enclosing list batches requests via useBatchTrajectories).
 */
export function useVariableValue(variable: string, resultId?: string, caseId?: string): VariableValue {
  const key = resultId && caseId ? `${resultId}/${caseId}/${variable}` : undefined;
  const length = useStore((s) => (key ? s.trajectories[key]?.length : undefined));
  const value = useStore((s) => {
    if (!key || !resultId || !caseId) return undefined;
    const arr = s.trajectories[key];
    if (!arr) return undefined;
    if (arr.length === 1) return arr[0];
    if (!s.trajectories[`${resultId}/${caseId}/time`]) return undefined;
    return s.valueAt(variable, resultId, caseId);
  });
  return { value, loaded: length !== undefined, length };
}

export interface VariableActions {
  /** Adds the variable to the most recently created plot of the class, or creates a new plot. */
  addToPlot(variable: string): void;
  /** Adds a result sticky next to the variable's component. */
  addSticky(variable: string): void;
  toggleFavorite(variable: string): void;
}

export function useVariableActions(className: string | undefined): VariableActions {
  const addPlot = useStore((s) => s.addPlot);
  const addTrace = useStore((s) => s.addTrace);
  const addStickyAction = useStore((s) => s.addSticky);
  const toggleFavoriteAction = useStore((s) => s.toggleFavorite);

  const addToPlot = useCallback(
    (variable: string) => {
      if (!className) return;
      const plots = useStore.getState().plots[className] ?? [];
      const last = plots[plots.length - 1];
      if (last) addTrace(className, last.id, { variable });
      else addPlot(className, [{ variable }]);
    },
    [className, addPlot, addTrace],
  );

  const addSticky = useCallback(
    (variable: string) => {
      if (!className) return;
      addStickyAction(className, { component: componentOf(variable), variable, dx: 0, dy: -14, pinned: false, editable: false });
    },
    [className, addStickyAction],
  );

  const toggleFavorite = useCallback(
    (variable: string) => {
      if (className) toggleFavoriteAction(className, variable);
    },
    [className, toggleFavoriteAction],
  );

  return useMemo(() => ({ addToPlot, addSticky, toggleFavorite }), [addToPlot, addSticky, toggleFavorite]);
}

/** Favorite variables of a class (stable empty array when none). */
const EMPTY: string[] = [];
export function useFavorites(className: string | undefined): string[] {
  return useStore((s) => (className ? (s.favorites[className] ?? EMPTY) : EMPTY));
}
