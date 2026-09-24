/**
 * Express application factory. `createApp(options)` wires storage, the per-workspace class
 * registries, the job runner and every `/api` route; `index.ts` listens on a port.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import express, { type Express } from 'express';
import cors from 'cors';
import type { AppContext } from './context.js';
import { createEngine, type Engine } from './engine.js';
import { errorMiddleware, notFoundHandler } from './errors.js';
import { isDirectory, readJson } from './fsutil.js';
import { JobRunner } from './jobs.js';
import { RegistryCache } from './registry-cache.js';
import { Storage } from './storage.js';
import { classRoutes } from './routes/classes.js';
import { customFunctionRoutes } from './routes/custom-functions.js';
import { experimentRoutes } from './routes/experiments.js';
import { modelExecutableRoutes } from './routes/model-executables.js';
import { systemRoutes } from './routes/system.js';
import { workspaceRoutes } from './routes/workspaces.js';

/** Repository root (`apps/server/src` -> three levels up). */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const DEFAULT_DATA_DIR = path.join(REPO_ROOT, 'apps', 'server', 'data');
export const DEFAULT_LIBRARIES_DIR = path.join(REPO_ROOT, 'libraries');
export const DEFAULT_WEB_DIST = path.join(REPO_ROOT, 'apps', 'web', 'dist');

export interface AppOptions {
  /** Store location; defaults to `DATA_DIR` env or `<repo>/apps/server/data`. */
  dataDir?: string;
  /** Where `Modelica/` and `Examples/` live; defaults to `LIBRARIES_DIR` env or `<repo>/libraries`. */
  librariesDir?: string;
  /** Replace compile/simulate (tests). Implies `inlineSimulation` — a fake cannot cross a thread boundary. */
  engine?: Partial<Engine>;
  /** Run cases on the main thread instead of a `worker_threads` Worker (default: false unless `engine` is given). */
  inlineSimulation?: boolean;
  /**
   * Origin(s) allowed by CORS, comma-separated. Defaults to the `CORS_ORIGIN` env variable;
   * unset means no CORS headers at all (same-origin only). The Vite dev server proxies `/api`
   * and production serves the SPA from this process, so neither needs CORS.
   */
  corsOrigin?: string | false;
  /** Seed the `Default` workspace when the store is empty (default true). */
  seed?: boolean;
  /** Serve this directory as the web app with SPA fallback; `false` disables. Defaults to `apps/web/dist` when it exists. */
  webDist?: string | false;
  /** Suppress request logging. */
  quiet?: boolean;
  /** Log sink (default stdout). */
  log?: (line: string) => void;
}

export interface ImpactApp extends Express {
  context: AppContext;
}

function readVersion(): string {
  try {
    return readJson<{ version?: string }>(fileURLToPath(new URL('../package.json', import.meta.url)))?.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function createApp(options: AppOptions = {}): ImpactApp {
  const log = options.quiet ? () => {} : options.log ?? ((line: string) => console.log(line));
  const storage = new Storage({
    dataDir: options.dataDir ?? process.env.DATA_DIR ?? DEFAULT_DATA_DIR,
    librariesDir: options.librariesDir ?? process.env.LIBRARIES_DIR ?? DEFAULT_LIBRARIES_DIR,
  });
  if (options.seed !== false) {
    const seeded = storage.seedIfEmpty();
    if (seeded) log(`seeded workspace '${seeded.definition.name}' (${seeded.id}) with project 'Examples'`);
  }
  const registries = new RegistryCache(storage);
  const engine = createEngine(options.engine);
  const inlineSimulation = options.inlineSimulation ?? options.engine !== undefined;
  const jobs = new JobRunner(storage, registries, engine, log, { inlineSimulation });
  // Jobs a previous process left running cannot be resumed; flag them instead of reporting them forever.
  jobs.recoverInterrupted();
  const context: AppContext = { storage, registries, jobs, engine, version: readVersion(), log };

  const app = express() as ImpactApp;
  app.context = context;
  app.disable('x-powered-by');
  app.set('etag', false);
  // Same-origin by default. This API has no authentication, so a wildcard `cors()` would let
  // any web page open in the same browser read, modify and delete the workspaces of a server
  // on localhost. Opt in per origin with CORS_ORIGIN=http://host:port[,http://other].
  const corsOrigin = options.corsOrigin === undefined ? process.env.CORS_ORIGIN : options.corsOrigin;
  const corsOrigins = corsOrigin ? corsOrigin.split(',').map((o) => o.trim()).filter(Boolean) : [];
  if (corsOrigins.length) app.use(cors({ origin: corsOrigins }));
  app.use(express.json({ limit: '20mb' }));

  app.use((req, res, next) => {
    const t0 = performance.now();
    res.on('finish', () => log(`${req.method} ${req.originalUrl} ${res.statusCode} ${(performance.now() - t0).toFixed(1)}ms`));
    next();
  });

  app.use('/api', systemRoutes(context));
  app.use('/api/workspaces', workspaceRoutes(context));
  app.use('/api/workspaces', classRoutes(context));
  app.use('/api/workspaces', customFunctionRoutes(context));
  app.use('/api/workspaces', modelExecutableRoutes(context));
  app.use('/api/workspaces', experimentRoutes(context));
  app.use('/api', notFoundHandler);

  const webDist = options.webDist === undefined ? DEFAULT_WEB_DIST : options.webDist ? path.resolve(options.webDist) : false;
  if (webDist && isDirectory(webDist)) {
    app.use(express.static(webDist, { index: 'index.html' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(webDist, 'index.html'), (err) => (err ? next(err) : undefined));
    });
    log(`serving web app from ${webDist}`);
  }

  app.use(notFoundHandler);
  app.use(errorMiddleware({ log }));
  return app;
}
