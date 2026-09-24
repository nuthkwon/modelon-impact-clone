/**
 * Small hooks used by the Workspace panel: debouncing and a Set persisted in sessionStorage.
 */
import { useCallback, useEffect, useState } from 'react';

/** `value` delayed by `ms`; an empty string is applied immediately (clearing the filter feels instant). */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (value === '' || value === undefined) {
      setDebounced(value);
      return;
    }
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function loadSet(key: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(key);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveSet(key: string, set: Set<string>): void {
  try {
    sessionStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    /* ignore quota / private mode errors */
  }
}

export type SetUpdater = (prev: Set<string>) => Set<string>;

/**
 * A `Set<string>` persisted in sessionStorage under `key`. Changing `key` (another workspace)
 * reloads the set for that key. The updater may return the previous set to skip the update.
 */
export function useSessionSet(key: string): [Set<string>, (updater: SetUpdater) => void] {
  const [entry, setEntry] = useState(() => ({ key, set: loadSet(key) }));
  const current = entry.key === key ? entry.set : loadSet(key);
  useEffect(() => {
    if (entry.key !== key) setEntry({ key, set: loadSet(key) });
  }, [key, entry.key]);
  const update = useCallback(
    (updater: SetUpdater) => {
      setEntry((prev) => {
        const base = prev.key === key ? prev.set : loadSet(key);
        const next = updater(base);
        if (next === base) return prev.key === key ? prev : { key, set: base };
        saveSet(key, next);
        return { key, set: next };
      });
    },
    [key],
  );
  return [current, update];
}
