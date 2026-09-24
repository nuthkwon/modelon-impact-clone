import type { Engine } from './engine.js';
import type { JobRunner } from './jobs.js';
import type { RegistryCache } from './registry-cache.js';
import type { Storage } from './storage.js';

/** Everything the route handlers need. Built once per app in `createApp`. */
export interface AppContext {
  storage: Storage;
  registries: RegistryCache;
  jobs: JobRunner;
  engine: Engine;
  version: string;
  log: (line: string) => void;
}
