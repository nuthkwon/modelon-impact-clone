/**
 * Shared fixtures for the HTTP tests (`*.test.ts`): a stub `Modelica` library, an editable
 * `Examples` library with one simulatable model, a fake engine, and a tiny fetch wrapper.
 * Not imported by production code.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { parse, type FlatModel, type SimulationResult } from '@impact/core';
import type { Workspace } from '@impact/protocol';
import { createApp, type AppOptions, type ImpactApp } from './app.js';
import type { Engine } from './engine.js';

export const PARSER_OK = (() => {
  try {
    parse('model A\nend A;\n');
    return true;
  } catch {
    return false;
  }
})();

export const TMP_ROOT = process.env.IMPACT_TEST_TMP ?? os.tmpdir();

export const SIMPLE_MO = 'within Examples;\nmodel Simple "A simple model"\n  parameter Real R = 100;\n  Real x(start = 1);\nequation\n  der(x) = -x / R;\nend Simple;\n';

export function makeFixtureLibraries(): string {
  const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'impact-libs-'));
  fs.mkdirSync(path.join(dir, 'Modelica'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'Modelica', 'package.mo'),
    'within ;\npackage Modelica "Modelica Standard Library (test stub)"\n  package Icons\n    partial package Package\n    end Package;\n  end Icons;\nend Modelica;\n',
  );
  fs.mkdirSync(path.join(dir, 'Examples'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Examples', 'package.mo'), 'within ;\npackage Examples "Example models"\nend Examples;\n');
  fs.writeFileSync(path.join(dir, 'Examples', 'Simple.mo'), SIMPLE_MO);
  fs.writeFileSync(path.join(dir, 'Examples', 'package.order'), 'Simple\n');
  return dir;
}

export const flatStub = (className: string): FlatModel => ({
  className,
  variables: [],
  equations: [],
  initialEquations: [],
  whenClauses: [],
  experiment: { StopTime: 2 },
  diagnostics: [{ severity: 'warning', message: 'stub warning' }],
  stats: { components: 1, unknowns: 2, equations: 2, parameters: 1, constants: 0, states: 1, connections: 0 },
});

export const fakeEngine: Partial<Engine> = {
  flatten: (_registry, className) => flatStub(className),
  simulate: (flat, options, hooks): SimulationResult => {
    hooks?.onProgress?.(0.5, 0.5);
    hooks?.onLog?.('info', 'hello from the fake solver');
    const R = Number(options.modifiers?.R ?? 100);
    return {
      className: flat.className,
      options,
      time: [0, 0.5, 1],
      trajectories: [
        { name: 'x', values: [1, 0.5, 0.25], kind: 'continuous', unit: 'V' },
        { name: 'R', values: [R], kind: 'parameter' },
      ],
      stats: { steps: 2, rejectedSteps: 0, newtonIterations: 4, jacobianEvaluations: 1, events: 0, cpuTimeMs: 1, completed: true },
      log: [{ level: 'info', message: 'hello from the fake solver', source: 'simulation' }],
    };
  },
};

export interface TestServer {
  base: string;
  server: Server;
  app: ImpactApp;
  dataDir: string;
  librariesDir: string;
}

/**
 * Starts an app on a random port with fresh temp directories (unless `dataDir`/`librariesDir`
 * are given). `prepareLibraries` may add files to the fixture libraries before seeding.
 */
export async function startServer(options: Partial<AppOptions> = {}, prepareLibraries?: (librariesDir: string) => void): Promise<TestServer> {
  const dataDir = options.dataDir ?? fs.mkdtempSync(path.join(TMP_ROOT, 'impact-data-'));
  const librariesDir = options.librariesDir ?? makeFixtureLibraries();
  prepareLibraries?.(librariesDir);
  const app = createApp({ quiet: true, webDist: false, ...options, dataDir, librariesDir });
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, server, app, dataDir, librariesDir };
}

/** Closes the server (terminating any simulation worker) and removes its directories unless `keepDirs`. */
export async function stopServer(t: TestServer, keepDirs = false): Promise<void> {
  t.app.context.jobs.shutdown();
  await new Promise<void>((resolve) => t.server.close(() => resolve()));
  if (keepDirs) return;
  fs.rmSync(t.dataDir, { recursive: true, force: true });
  fs.rmSync(t.librariesDir, { recursive: true, force: true });
}

export interface Reply<T = unknown> {
  status: number;
  body: T;
  text: string;
  headers: Headers;
}

export async function api<T = unknown>(base: string, method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply<T>> {
  const res = await fetch(base + url, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  let json: unknown = undefined;
  if (res.headers.get('content-type')?.includes('application/json') && text) json = JSON.parse(text);
  return { status: res.status, body: json as T, text, headers: res.headers };
}

export const items = <T>(r: Reply<{ data: { items: T[] } }>): T[] => r.body.data.items;

export async function waitFor(check: () => Promise<boolean>, timeoutMs = 5000, intervalMs = 10): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('timed out waiting for condition');
}

export async function firstWorkspaceId(base: string): Promise<string> {
  return items(await api<{ data: { items: Workspace[] } }>(base, 'GET', '/api/workspaces'))[0].id;
}
