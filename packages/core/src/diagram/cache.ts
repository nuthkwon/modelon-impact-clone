/**
 * Per-registry memoisation for the diagram view-model layer.
 *
 * Resolving icons, classifying component types and collecting parameters are pure functions of
 * the registry content. A `RegistryCache` is attached to a `ClassRegistry` instance through a
 * `WeakMap` and is thrown away whenever the registry's *stamp* (derived from the identity of the
 * registered files) changes, so callers never observe stale results after `addFile` /
 * `removeFile` / `removeLibrary`.
 *
 * Cached objects are shared between callers: consumers must treat them as read-only.
 */
import type { ClassRegistry, RegisteredFile } from '../registry.js';

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

/**
 * Process-wide identity of every `RegisteredFile` object seen so far. `ClassRegistry.addFile`
 * stores a fresh object on every (re-)registration, so a file's identity changes exactly when
 * its content may have changed; the ids are never reused.
 */
const fileIds = new WeakMap<RegisteredFile, number>();
let nextFileId = 1;

function fileId(file: RegisteredFile): number {
  let id = fileIds.get(file);
  if (id === undefined) {
    id = nextFileId++;
    fileIds.set(file, id);
  }
  return id;
}

/**
 * A fingerprint of the registry content: the identities (and versions) of the registered files
 * in registration order. Any `addFile`/`removeFile`/`removeLibrary` changes it — including a
 * remove followed by a re-add of the same paths, which restarts the per-file version counter
 * at 1 and therefore cannot be told apart by counting versions.
 */
export function registryStamp(registry: ClassRegistry): string {
  const files = registry.listFiles();
  const parts: string[] = new Array(files.length);
  for (let i = 0; i < files.length; i++) parts[i] = `${fileId(files[i])}.${files[i].version}`;
  return `${files.length}:${parts.join(',')}`;
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
