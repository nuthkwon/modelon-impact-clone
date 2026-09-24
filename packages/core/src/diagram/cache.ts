/**
 * Per-registry memoisation for the diagram view-model layer.
 *
 * Resolving icons, classifying component types and collecting parameters are pure functions of
 * the registry content. A `RegistryCache` is attached to a `ClassRegistry` instance through a
 * `WeakMap` and is thrown away whenever the registry's *stamp* (derived from the registered
 * files and their versions) changes, so callers never observe stale results after `addFile` /
 * `removeFile`.
 *
 * Cached objects are shared between callers: consumers must treat them as read-only.
 */
import type { ClassRegistry } from '../registry.js';

export class RegistryCache {
  private readonly slots = new Map<string, Map<string, unknown>>();
  /** Keys of computations currently in progress (cycle guard for mutually recursive lookups). */
  readonly computing = new Set<string>();

  constructor(readonly stamp: string) {}

  /** Returns the cached value under `ns`/`key`, computing and storing it on the first request. */
  memo<T>(ns: string, key: string, compute: () => T): T {
    let slot = this.slots.get(ns);
    if (!slot) {
      slot = new Map();
      this.slots.set(ns, slot);
    }
    if (slot.has(key)) return slot.get(key) as T;
    const value = compute();
    slot.set(key, value);
    return value;
  }

  /** Number of cached entries in `ns` (for tests). */
  size(ns: string): number {
    return this.slots.get(ns)?.size ?? 0;
  }
}

const caches = new WeakMap<ClassRegistry, RegistryCache>();

function hashString(seed: number, s: string): number {
  let h = seed | 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * A cheap fingerprint of the registry content: number of files, sum of their versions and a hash
 * of their keys. Any `addFile`/`removeFile`/`removeLibrary` changes it.
 */
export function registryStamp(registry: ClassRegistry): string {
  const files = registry.listFiles();
  let versions = 0;
  let hash = 7;
  for (const f of files) {
    versions += f.version;
    hash = hashString(hash, `${f.libraryId}::${f.path}`);
  }
  return `${files.length}:${versions}:${hash}`;
}

/** The cache attached to `registry`, replaced when the registry content changed since the last call. */
export function cacheFor(registry: ClassRegistry): RegistryCache {
  const stamp = registryStamp(registry);
  let cache = caches.get(registry);
  if (!cache || cache.stamp !== stamp) {
    cache = new RegistryCache(stamp);
    caches.set(registry, cache);
  }
  return cache;
}
