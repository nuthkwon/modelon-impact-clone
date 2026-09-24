/** `useState` persisted in localStorage under `key` (JSON). Falls back silently when storage is unavailable. */
import { useCallback, useState } from 'react';

export function useLocalStorageState<T>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return { ...initial, ...(JSON.parse(raw) as T) };
    } catch {
      /* ignore */
    }
    return initial;
  });
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        try {
          localStorage.setItem(key, JSON.stringify(v));
        } catch {
          /* ignore */
        }
        return v;
      });
    },
    [key],
  );
  return [value, set];
}

export default useLocalStorageState;
