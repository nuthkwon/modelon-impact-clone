import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ModelicaError, parse, type FlatModel, type SimulationResult } from '@impact/core';
import type { CaseDto, ClassSourceDto, ExperimentDto, LibraryBundleDto, ModelExecutableDto, Project, Workspace } from '@impact/protocol';
import { createApp, type AppOptions } from './app.js';
import type { Engine } from './engine.js';

// ---------------------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------------------

const PARSER_OK = (() => {
  try {
    parse('model A\nend A;\n');
    return true;
  } catch {
    return false;
  }
})();

const TMP_ROOT = process.env.IMPACT_TEST_TMP ?? os.tmpdir();

function makeFixtureLibraries(): string {
  const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'impact-libs-'));
  fs.mkdirSync(path.join(dir, 'Modelica'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'Modelica', 'package.mo'),
    'within ;\npackage Modelica "Modelica Standard Library (test stub)"\n  package Icons\n    partial package Package\n    end Package;\n  end Icons;\nend Modelica;\n',
  );
  fs.mkdirSync(path.join(dir, 'Examples'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Examples', 'package.mo'), 'within ;\npackage Examples "Example models"\nend Examples;\n');
  fs.writeFileSync(
    path.join(dir, 'Examples', 'Simple.mo'),
    'within Examples;\nmodel Simple "A simple model"\n  parameter Real R = 100;\n  Real x(start = 1);\nequation\n  der(x) = -x / R;\nend Simple;\n',
  );
  fs.writeFileSync(path.join(dir, 'Examples', 'package.order'), 'Simple\n');
  return dir;
}

const flatStub = (className: string): FlatModel => ({
  className,
  variables: [],
  equations: [],
  initialEquations: [],
  whenClauses: [],
  experiment: { StopTime: 2 },
  diagnostics: [{ severity: 'warning', message: 'stub warning' }],
  stats: { components: 1, unknowns: 2, equations: 2, parameters: 1, constants: 0, states: 1, connections: 0 },
});

const fakeEngine: Partial<Engine> = {
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

interface TestServer {
  base: string;
  server: Server;
  dataDir: string;
  librariesDir: string;
}

async function startServer(options: Partial<AppOptions> = {}): Promise<TestServer> {
  const dataDir = fs.mkdtempSync(path.join(TMP_ROOT, 'impact-data-'));
  const librariesDir = makeFixtureLibraries();
  const app = createApp({ dataDir, librariesDir, quiet: true, webDist: false, ...options });
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, server, dataDir, librariesDir };
}

async function stopServer(t: TestServer): Promise<void> {
  await new Promise<void>((resolve) => t.server.close(() => resolve()));
  fs.rmSync(t.dataDir, { recursive: true, force: true });
  fs.rmSync(t.librariesDir, { recursive: true, force: true });
}

interface Reply<T = unknown> {
  status: number;
  body: T;
  text: string;
  headers: Headers;
}

async function api<T = unknown>(base: string, method: string, url: string, body?: unknown): Promise<Reply<T>> {
  const res = await fetch(base + url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  let json: unknown = undefined;
  if (res.headers.get('content-type')?.includes('application/json') && text) json = JSON.parse(text);
  return { status: res.status, body: json as T, text, headers: res.headers };
}

const items = <T>(r: Reply<{ data: { items: T[] } }>): T[] => r.body.data.items;

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timed out waiting for condition');
}

async function firstWorkspaceId(base: string): Promise<string> {
  return items(await api<{ data: { items: Workspace[] } }>(base, 'GET', '/api/workspaces'))[0].id;
}

// ---------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------

describe('system', () => {
  let t: TestServer;
  beforeAll(async () => {
    t = await startServer();
  });
  afterAll(() => stopServer(t));

  it('reports health and system info', async () => {
    const health = await api<{ status: string; version: string }>(t.base, 'GET', '/api/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');
    const info = await api<{ name: string; node: string }>(t.base, 'GET', '/api/system/info');
    expect(info.body.name).toBe('Modelon Impact Clone');
    expect(info.body.node).toBe(process.version);
  });

  it('returns the error envelope for unknown routes and invalid bodies', async () => {
    const missing = await api<{ error: { code: string; message: string } }>(t.base, 'GET', '/api/nope');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('not_found');
    expect(typeof missing.body.error.message).toBe('string');

    const invalid = await api<{ error: { code: string } }>(t.base, 'POST', '/api/workspaces', { new: { name: 42 } });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('validation_error');

    const badJson = await api<{ error: { code: string } }>(t.base, 'POST', '/api/workspaces', '{not json');
    expect(badJson.status).toBe(400);
    expect(badJson.body.error.code).toBe('invalid_json');

    const unknownWorkspace = await api<{ error: { code: string } }>(t.base, 'GET', '/api/workspaces/ws_missing');
    expect(unknownWorkspace.status).toBe(404);
    expect(unknownWorkspace.body.error.code).toBe('not_found');
  });
});

describe('workspaces, projects and libraries', () => {
  let t: TestServer;
  beforeAll(async () => {
    t = await startServer();
  });
  afterAll(() => stopServer(t));

  it('seeds a Default workspace with the Examples project and the Modelica dependency', async () => {
    const list = await api<{ data: { items: Workspace[] } }>(t.base, 'GET', '/api/workspaces');
    expect(list.status).toBe(200);
    const workspaces = items(list);
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].definition.name).toBe('Default');
    expect(workspaces[0].definition.dependencies[0].reference.id).toBe('modelica');
    expect(fs.existsSync(path.join(t.dataDir, 'workspaces', workspaces[0].id, 'workspace.json'))).toBe(true);

    const wid = workspaces[0].id;
    const projects = items(await api<{ data: { items: Project[] } }>(t.base, 'GET', `/api/workspaces/${wid}/projects`));
    expect(projects).toHaveLength(1);
    expect(projects[0].definition.name).toBe('Examples');
    expect(projects[0].projectType).toBe('LOCAL');
    expect(projects[0].definition.content[0]).toMatchObject({ relpath: 'Examples/', name: 'Examples', contentType: 'MODELICA' });
    expect(fs.existsSync(path.join(t.dataDir, 'workspaces', wid, 'projects', projects[0].id, 'Examples', 'Simple.mo'))).toBe(true);

    const deps = items(await api<{ data: { items: Project[] } }>(t.base, 'GET', `/api/workspaces/${wid}/dependencies`));
    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({ id: 'modelica', projectType: 'SYSTEM' });
    expect(deps[0].definition.content[0].readOnly).toBe(true);
  });

  it('lists library bundles with all file texts', async () => {
    const wid = await firstWorkspaceId(t.base);
    const libs = items(await api<{ data: { items: LibraryBundleDto[] } }>(t.base, 'GET', `/api/workspaces/${wid}/libraries`));
    expect(libs.map((l) => l.name).sort()).toEqual(['Examples', 'Modelica']);
    const modelica = libs.find((l) => l.libraryId === 'modelica')!;
    expect(modelica.readOnly).toBe(true);
    expect(modelica.files.map((f) => f.path)).toEqual(['Modelica/package.mo']);
    const examples = libs.find((l) => l.name === 'Examples')!;
    expect(examples.readOnly).toBe(false);
    expect(examples.files.map((f) => f.path)).toEqual(['Examples/package.mo', 'Examples/Simple.mo']);
    expect(examples.files[1].text).toContain('model Simple');

    const one = await api<LibraryBundleDto>(t.base, 'GET', `/api/workspaces/${wid}/libraries/${examples.libraryId}`);
    expect(one.status).toBe(200);
    expect(one.body.files).toHaveLength(2);
    expect((await api(t.base, 'GET', `/api/workspaces/${wid}/libraries/nope`)).status).toBe(404);
  });

  it('creates, reads, renames and deletes workspaces', async () => {
    const created = await api<Workspace>(t.base, 'POST', '/api/workspaces', { new: { name: 'Scratch', description: 'temp' } });
    expect(created.status).toBe(201);
    expect(created.body.id).toMatch(/^ws_[a-z0-9]{10}$/);
    expect(created.body.definition.name).toBe('Scratch');
    expect(created.body.definition.projects).toHaveLength(1);

    const wid = created.body.id;
    const fetched = await api<Workspace>(t.base, 'GET', `/api/workspaces/${wid}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.definition.description).toBe('temp');

    const renamed = await api<Workspace>(t.base, 'PUT', `/api/workspaces/${wid}`, { name: 'Renamed' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.definition.name).toBe('Renamed');

    expect(items(await api<{ data: { items: Workspace[] } }>(t.base, 'GET', '/api/workspaces'))).toHaveLength(2);
    expect((await api(t.base, 'DELETE', `/api/workspaces/${wid}`)).status).toBe(204);
    expect((await api(t.base, 'GET', `/api/workspaces/${wid}`)).status).toBe(404);
    expect((await api(t.base, 'DELETE', `/api/workspaces/${wid}`)).status).toBe(404);
  });

  it('serves the custom functions', async () => {
    const wid = await firstWorkspaceId(t.base);
    const fns = items(await api<{ data: { items: { name: string; parameters: { name: string; defaultValue?: unknown }[] }[] } }>(t.base, 'GET', `/api/workspaces/${wid}/custom-functions`));
    expect(fns.map((f) => f.name)).toEqual(['dynamic', 'steady state']);
    expect(fns[0].parameters.map((p) => p.name)).toEqual(['start_time', 'final_time']);
    expect(fns[0].parameters[1].defaultValue).toBe(1);
    expect(fns[1].parameters.map((p) => p.name)).toEqual(['start_time']);
  });
});

describe('class source', () => {
  let t: TestServer;
  let wid: string;
  beforeAll(async () => {
    t = await startServer();
    wid = await firstWorkspaceId(t.base);
  });
  afterAll(() => stopServer(t));

  it('returns the file holding a class with its version and read-only flag', async () => {
    const r = await api<ClassSourceDto>(t.base, 'GET', `/api/workspaces/${wid}/classes/${encodeURIComponent('Examples.Simple')}/source`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ className: 'Examples.Simple', file: 'Examples/Simple.mo', readOnly: false, version: 1 });
    expect(r.body.text).toContain('parameter Real R = 100;');

    const msl = await api<ClassSourceDto>(t.base, 'GET', `/api/workspaces/${wid}/classes/Modelica/source`);
    expect(msl.status).toBe(200);
    expect(msl.body).toMatchObject({ libraryId: 'modelica', file: 'Modelica/package.mo', readOnly: true });

    expect((await api(t.base, 'GET', `/api/workspaces/${wid}/classes/Nope.Missing/source`)).status).toBe(404);
  });

  it('rejects a stale version with 409 and read-only libraries with 403', async () => {
    const stale = await api<{ error: { code: string; details: { currentVersion: number } } }>(t.base, 'PUT', `/api/workspaces/${wid}/classes/Examples.Simple/source`, { text: 'model Simple end Simple;', version: 99 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('conflict');
    expect(stale.body.error.details.currentVersion).toBe(1);

    const ro = await api<{ error: { code: string } }>(t.base, 'PUT', `/api/workspaces/${wid}/classes/Modelica/source`, { text: 'package Modelica end Modelica;' });
    expect(ro.status).toBe(403);
    expect(ro.body.error.code).toBe('read_only');

    const invalid = await api<{ error: { code: string } }>(t.base, 'PUT', `/api/workspaces/${wid}/classes/Examples.Simple/source`, { version: 1 });
    expect(invalid.status).toBe(400);
  });

  it.skipIf(!PARSER_OK)('saves valid text, bumps the version and persists to disk', async () => {
    const text = 'within Examples;\nmodel Simple "Edited"\n  parameter Real R = 200;\n  Real x(start = 1);\nequation\n  der(x) = -x / R;\nend Simple;\n';
    const saved = await api<ClassSourceDto>(t.base, 'PUT', `/api/workspaces/${wid}/classes/Examples.Simple/source`, { text, version: 1 });
    expect(saved.status).toBe(200);
    expect(saved.body.version).toBe(2);
    expect(saved.body.text).toBe(text);

    const again = await api<ClassSourceDto>(t.base, 'GET', `/api/workspaces/${wid}/classes/Examples.Simple/source`);
    expect(again.body.version).toBe(2);
    expect(again.body.text).toContain('R = 200');

    const projects = items(await api<{ data: { items: Project[] } }>(t.base, 'GET', `/api/workspaces/${wid}/projects`));
    expect(fs.readFileSync(path.join(t.dataDir, 'workspaces', wid, 'projects', projects[0].id, 'Examples', 'Simple.mo'), 'utf8')).toBe(text);

    // Stale again with the old version.
    expect((await api(t.base, 'PUT', `/api/workspaces/${wid}/classes/Examples.Simple/source`, { text, version: 1 })).status).toBe(409);
  });

  it.skipIf(!PARSER_OK)('responds 422 with diagnostics on syntax errors and does not save', async () => {
    const before = await api<ClassSourceDto>(t.base, 'GET', `/api/workspaces/${wid}/classes/Examples.Simple/source`);
    const r = await api<{ error: { code: string; details: { diagnostics: unknown[] } } }>(t.base, 'PUT', `/api/workspaces/${wid}/classes/Examples.Simple/source`, { text: 'model Simple\n  Real x = ;\nend Simple;\n' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('modelica_error');
    expect(r.body.error.details.diagnostics.length).toBeGreaterThan(0);
    const after = await api<ClassSourceDto>(t.base, 'GET', `/api/workspaces/${wid}/classes/Examples.Simple/source`);
    expect(after.body.text).toBe(before.body.text);
    expect(after.body.version).toBe(before.body.version);
  });
});

describe('class creation and deletion', () => {
  let t: TestServer;
  let wid: string;
  beforeAll(async () => {
    t = await startServer();
    wid = await firstWorkspaceId(t.base);
  });
  afterAll(() => stopServer(t));

  it('creates a top-level class as a new file and registers it as project content', async () => {
    const r = await api<ClassSourceDto>(t.base, 'POST', `/api/workspaces/${wid}/classes`, { className: 'MyLib', restriction: 'package', description: 'My library' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ className: 'MyLib', file: 'MyLib.mo', readOnly: false, version: 1 });
    expect(r.body.text).toBe('package MyLib "My library"\nend MyLib;\n');

    const projects = items(await api<{ data: { items: Project[] } }>(t.base, 'GET', `/api/workspaces/${wid}/projects`));
    expect(projects[0].definition.content.map((c) => c.relpath).sort()).toEqual(['Examples/', 'MyLib.mo']);
    expect(projects[0].definition.content.find((c) => c.relpath === 'MyLib.mo')!.id).toBe(r.body.libraryId);
    const libs = items(await api<{ data: { items: LibraryBundleDto[] } }>(t.base, 'GET', `/api/workspaces/${wid}/libraries`));
    expect(libs.map((l) => l.name).sort()).toEqual(['Examples', 'Modelica', 'MyLib']);

    const dup = await api<{ error: { code: string } }>(t.base, 'POST', `/api/workspaces/${wid}/classes`, { className: 'MyLib', restriction: 'model' });
    expect(dup.status).toBe(409);
    expect((await api(t.base, 'POST', `/api/workspaces/${wid}/classes`, { className: 'Missing.Parent.X', restriction: 'model' })).status).toBe(404);
    expect((await api(t.base, 'POST', `/api/workspaces/${wid}/classes`, { className: '1bad', restriction: 'model' })).status).toBe(400);
  });

  it.skipIf(!PARSER_OK)('creates a class inside a directory package as a within-file', async () => {
    const r = await api<ClassSourceDto>(t.base, 'POST', `/api/workspaces/${wid}/classes`, { className: 'Examples.Circuit', restriction: 'model', extendsClass: 'Modelica.Icons.Package' });
    expect(r.status).toBe(201);
    expect(r.body.file).toBe('Examples/Circuit.mo');
    expect(r.body.text).toBe('within Examples;\n\nmodel Circuit\n  extends Modelica.Icons.Package;\nend Circuit;\n');
    const src = await api<ClassSourceDto>(t.base, 'GET', `/api/workspaces/${wid}/classes/Examples.Circuit/source`);
    expect(src.status).toBe(200);
    expect(src.body.file).toBe('Examples/Circuit.mo');
    const projects = items(await api<{ data: { items: Project[] } }>(t.base, 'GET', `/api/workspaces/${wid}/projects`));
    expect(fs.readFileSync(path.join(t.dataDir, 'workspaces', wid, 'projects', projects[0].id, 'Examples', 'package.order'), 'utf8')).toBe('Simple\nCircuit\n');
  });

  it.skipIf(!PARSER_OK)('creates a nested class inside a class file and deletes it again', async () => {
    const r = await api<ClassSourceDto>(t.base, 'POST', `/api/workspaces/${wid}/classes`, { className: 'Examples.Simple.Inner', restriction: 'record', description: 'Nested' });
    expect(r.status).toBe(201);
    expect(r.body.file).toBe('Examples/Simple.mo');
    // Nested classes belong to the declaration section, i.e. before `equation`.
    expect(r.body.text).toContain('  Real x(start = 1);\n  record Inner "Nested"\n  end Inner;\nequation\n');
    expect(r.body.version).toBe(2);
    expect((await api(t.base, 'GET', `/api/workspaces/${wid}/classes/Examples.Simple.Inner/source`)).status).toBe(200);

    const del = await api(t.base, 'DELETE', `/api/workspaces/${wid}/classes/Examples.Simple.Inner`);
    expect(del.status).toBe(204);
    const after = await api<ClassSourceDto>(t.base, 'GET', `/api/workspaces/${wid}/classes/Examples.Simple/source`);
    expect(after.body.text).not.toContain('Inner');
    expect(after.body.text).toContain('end Simple;');
    expect(after.body.version).toBe(3);
  });

  it('deletes a top-level library file and its content entry', async () => {
    expect((await api(t.base, 'DELETE', `/api/workspaces/${wid}/classes/MyLib`)).status).toBe(204);
    expect((await api(t.base, 'GET', `/api/workspaces/${wid}/classes/MyLib/source`)).status).toBe(404);
    const projects = items(await api<{ data: { items: Project[] } }>(t.base, 'GET', `/api/workspaces/${wid}/projects`));
    expect(projects[0].definition.content.map((c) => c.relpath)).toEqual(['Examples/']);
    expect((await api(t.base, 'DELETE', `/api/workspaces/${wid}/classes/Modelica`)).status).toBe(403);
  });
});

describe('experiments (fake engine)', () => {
  let t: TestServer;
  let wid: string;
  beforeAll(async () => {
    t = await startServer({ engine: fakeEngine });
    wid = await firstWorkspaceId(t.base);
  });
  afterAll(() => stopServer(t));

  const definition = (variables: Record<string, number | string | boolean>, extensions: unknown[] = []) => ({
    experiment: {
      version: 2,
      base: {
        model: { modelica: { className: 'Examples.Simple' } },
        modifiers: { variables },
        analysis: { type: 'dynamic', parameters: { start_time: 0, final_time: 1 }, simulationOptions: { ncp: 10 }, solverOptions: { solver: 'CVode', rtol: 1e-6 } },
      },
      extensions,
    },
  });

  let eid: string;

  it('creates an experiment and expands range() modifiers into cases', async () => {
    const r = await api<ExperimentDto & { experiment_id: string }>(t.base, 'POST', `/api/workspaces/${wid}/experiments`, {
      ...definition({ R: 1 }, [{ modifiers: { variables: { R: 'range(100, 300, 3)' } } }, { modifiers: { variables: { R: 50 } }, caseData: { label: 'Fixed' } }]),
      label: 'Sweep',
    });
    expect(r.status).toBe(201);
    eid = r.body.id;
    expect(r.body.experiment_id).toBe(eid);
    expect(eid).toMatch(/^exp_/);
    expect(r.body.className).toBe('Examples.Simple');
    expect(r.body.meta_data.label).toBe('Sweep');
    expect(r.body.run_info).toEqual({ status: 'not_started', failed: 0, successful: 0, cancelled: 0, not_started: 4 });

    const cases = items(await api<{ data: { items: CaseDto[] } }>(t.base, 'GET', `/api/workspaces/${wid}/experiments/${eid}/cases`));
    expect(cases.map((c) => c.id)).toEqual(['case_1', 'case_2', 'case_3', 'case_4']);
    expect(cases.map((c) => c.meta.label)).toEqual(['R=100', 'R=200', 'R=300', 'Fixed']);
    expect(cases.map((c) => c.input.parametrization.R)).toEqual([100, 200, 300, 50]);
    expect(cases[0].run_info.status).toBe('not_started');
    expect(fs.existsSync(path.join(t.dataDir, 'workspaces', wid, 'experiments', eid, 'cases', 'case_1.json'))).toBe(true);

    const plain = await api<ExperimentDto>(t.base, 'POST', `/api/workspaces/${wid}/experiments`, definition({}));
    expect(plain.status).toBe(201);
    expect(plain.body.meta_data.label.startsWith('Examples.Simple ')).toBe(true);
    const plainCases = items(await api<{ data: { items: CaseDto[] } }>(t.base, 'GET', `/api/workspaces/${wid}/experiments/${plain.body.id}/cases`));
    expect(plainCases.map((c) => c.meta.label)).toEqual(['Case 1']);

    const list = items(await api<{ data: { items: ExperimentDto[] } }>(t.base, 'GET', `/api/workspaces/${wid}/experiments`));
    expect(list.map((e) => e.id)).toEqual([plain.body.id, eid]);
    expect(items(await api<{ data: { items: ExperimentDto[] } }>(t.base, 'GET', `/api/workspaces/${wid}/experiments?className=Other`))).toEqual([]);

    const bad = await api<{ error: { code: string } }>(t.base, 'POST', `/api/workspaces/${wid}/experiments`, { experiment: { base: {} } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('validation_error');
  });

  it('executes all cases asynchronously and reports progress/status', async () => {
    const before = await api<{ status: string; progress: number }>(t.base, 'GET', `/api/workspaces/${wid}/experiments/${eid}/execution`);
    expect(before.body).toEqual({ status: 'pending', progress: 0 });

    const started = await api<{ status: string }>(t.base, 'POST', `/api/workspaces/${wid}/experiments/${eid}/execution`);
    expect(started.status).toBe(202);
    await waitFor(async () => (await api<{ status: string }>(t.base, 'GET', `/api/workspaces/${wid}/experiments/${eid}/execution`)).body.status === 'done');
    const status = await api<{ status: string; progress: number }>(t.base, 'GET', `/api/workspaces/${wid}/experiments/${eid}/execution`);
    expect(status.body).toEqual({ status: 'done', progress: 1 });

    const exp = await api<ExperimentDto>(t.base, 'GET', `/api/workspaces/${wid}/experiments/${eid}`);
    expect(exp.body.run_info).toEqual({ status: 'done', failed: 0, successful: 4, cancelled: 0, not_started: 0 });

    const c1 = await api<CaseDto>(t.base, 'GET', `/api/workspaces/${wid}/experiments/${eid}/cases/case_1`);
    expect(c1.body.run_info.status).toBe('successful');
    expect(c1.body.run_info.statistics).toMatchObject({ steps: 2, completed: true });
    expect(typeof c1.body.run_info.datetime_finished).toBe('string');

    const log = await api<{ log: string }>(t.base, 'GET', `/api/workspaces/${wid}/experiments/${eid}/cases/case_1/log`);
    expect(log.body.log).toContain('Simulating Examples.Simple from t=0 to t=1 with CVode');
    expect(log.body.log).toContain('Parameters: R=100');
    expect(log.body.log).toContain('Model statistics: 2 unknowns, 2 equations, 1 states, 1 parameters');
    expect(log.body.log).toContain('Warning: stub warning');
    expect(log.body.log).toContain('[INFO] hello from the fake solver');
    expect(log.body.log).toMatch(/Simulation finished in \d+\.\d+ s/);
  });

  it('serves variables and trajectories for the experiment and single cases', async () => {
    const vars = await api<{ variables: string[] }>(t.base, 'GET', `/api/workspaces/${wid}/experiments/${eid}/variables`);
    expect(vars.body.variables).toEqual(['time', 'R', 'x']);

    const traj = await api<number[][][]>(t.base, 'POST', `/api/workspaces/${wid}/experiments/${eid}/trajectories`, { variable_names: ['x', 'R', 'missing', 'time'] });
    expect(traj.status).toBe(200);
    expect(traj.body).toHaveLength(4);
    expect(traj.body[0]).toHaveLength(4);
    expect(traj.body[0][0]).toEqual([1, 0.5, 0.25]);
    expect(traj.body[1]).toEqual([
      [100, 100, 100],
      [200, 200, 200],
      [300, 300, 300],
      [50, 50, 50],
    ]);
    expect(traj.body[2]).toEqual([[], [], [], []]);
    expect(traj.body[3][0]).toEqual([0, 0.5, 1]);

    const caseTraj = await api<number[][]>(t.base, 'POST', `/api/workspaces/${wid}/experiments/${eid}/cases/case_2/trajectories`, { variable_names: ['time', 'R', 'x'] });
    expect(caseTraj.body).toEqual([
      [0, 0.5, 1],
      [200, 200, 200],
      [1, 0.5, 0.25],
    ]);
    expect((await api(t.base, 'POST', `/api/workspaces/${wid}/experiments/${eid}/trajectories`, { variable_names: 'x' })).status).toBe(400);
  });

  it('downloads results as CSV, raw JSON and metadata', async () => {
    const csv = await api(t.base, 'GET', `/api/workspaces/${wid}/experiments/${eid}/cases/case_3/result`);
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.headers.get('content-disposition')).toBe('attachment; filename="Examples.Simple_case_3.csv"');
    expect(csv.text.split('\n').slice(0, 4)).toEqual(['time,x,R', '0,1,300', '0.5,0.5,300', '1,0.25,300']);

    const json = await api<SimulationResult>(t.base, 'GET', `/api/workspaces/${wid}/experiments/${eid}/cases/case_3/result?format=json`);
    expect(json.body.className).toBe('Examples.Simple');
    expect(json.body.time).toEqual([0, 0.5, 1]);
    expect(json.body.trajectories.map((tr) => tr.name)).toEqual(['x', 'R']);
    expect(json.body.options.modifiers).toEqual({ R: 300 });

    const meta = await api<{ className: string; time: { start: number; stop: number; points: number }; variables: { name: string; kind: string; unit?: string }[] }>(t.base, 'GET', `/api/workspaces/${wid}/experiments/${eid}/cases/case_3/result/meta`);
    expect(meta.body.className).toBe('Examples.Simple');
    expect(meta.body.time).toEqual({ start: 0, stop: 1, points: 3 });
    expect(meta.body.variables).toEqual([
      { name: 'x', kind: 'continuous', unit: 'V' },
      { name: 'R', kind: 'parameter' },
    ]);
    expect(fs.existsSync(path.join(t.dataDir, 'workspaces', wid, 'experiments', eid, 'cases', 'case_3.result.json'))).toBe(true);
  });

  it('relabels and deletes experiments', async () => {
    const renamed = await api<ExperimentDto>(t.base, 'PUT', `/api/workspaces/${wid}/experiments/${eid}`, { label: 'Renamed sweep' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.meta_data.label).toBe('Renamed sweep');
    expect((await api(t.base, 'DELETE', `/api/workspaces/${wid}/experiments/${eid}`)).status).toBe(204);
    expect((await api(t.base, 'GET', `/api/workspaces/${wid}/experiments/${eid}`)).status).toBe(404);
    expect((await api(t.base, 'DELETE', `/api/workspaces/${wid}/experiments/${eid}/execution`)).status).toBe(404);
  });

  it('records failures when the engine throws a ModelicaError', async () => {
    const failing = await startServer({
      engine: {
        flatten: () => {
          throw new ModelicaError('The model is not balanced: 3 equations, 2 variables', [{ severity: 'error', message: 'The model is not balanced: 3 equations, 2 variables', path: 'Examples.Simple' }]);
        },
      },
    });
    try {
      const fwid = await firstWorkspaceId(failing.base);
      const created = await api<ExperimentDto>(failing.base, 'POST', `/api/workspaces/${fwid}/experiments`, definition({}));
      const feid = created.body.id;
      await api(failing.base, 'POST', `/api/workspaces/${fwid}/experiments/${feid}/execution`);
      await waitFor(async () => (await api<{ status: string }>(failing.base, 'GET', `/api/workspaces/${fwid}/experiments/${feid}/execution`)).body.status === 'done');
      const exp = await api<ExperimentDto>(failing.base, 'GET', `/api/workspaces/${fwid}/experiments/${feid}`);
      expect(exp.body.run_info).toMatchObject({ status: 'done', failed: 1, successful: 0 });
      const c = await api<CaseDto>(failing.base, 'GET', `/api/workspaces/${fwid}/experiments/${feid}/cases/case_1`);
      expect(c.body.run_info.status).toBe('failed');
      expect(c.body.run_info.failures?.[0]).toContain('not balanced');
      const log = await api<{ log: string }>(failing.base, 'GET', `/api/workspaces/${fwid}/experiments/${feid}/cases/case_1/log`);
      expect(log.body.log).toContain('Error: The model is not balanced');
      expect(log.body.log).toContain('Simulation failed');
      expect((await api(failing.base, 'GET', `/api/workspaces/${fwid}/experiments/${feid}/cases/case_1/result`)).status).toBe(404);
      expect((await api<{ variables: string[] }>(failing.base, 'GET', `/api/workspaces/${fwid}/experiments/${feid}/variables`)).body.variables).toEqual([]);
    } finally {
      await stopServer(failing);
    }
  });

  it('cancels a running execution between cases', async () => {
    const slow = await startServer({
      engine: {
        ...fakeEngine,
        simulate: (flat, options, hooks) => {
          const t0 = Date.now();
          while (Date.now() - t0 < 40) {
            /* busy: one case takes ~40 ms */
          }
          return fakeEngine.simulate!(flat, options, hooks);
        },
      },
    });
    try {
      const swid = await firstWorkspaceId(slow.base);
      const created = await api<ExperimentDto>(slow.base, 'POST', `/api/workspaces/${swid}/experiments`, definition({ R: 'range(1, 20, 20)' }));
      const seid = created.body.id;
      await api(slow.base, 'POST', `/api/workspaces/${swid}/experiments/${seid}/execution`);
      const cancel = await api(slow.base, 'DELETE', `/api/workspaces/${swid}/experiments/${seid}/execution`);
      expect(cancel.status).toBe(204);
      await waitFor(async () => {
        const s = (await api<{ status: string }>(slow.base, 'GET', `/api/workspaces/${swid}/experiments/${seid}/execution`)).body.status;
        return s === 'cancelled' || s === 'done';
      });
      const status = await api<{ status: string; progress: number }>(slow.base, 'GET', `/api/workspaces/${swid}/experiments/${seid}/execution`);
      expect(status.body.status).toBe('cancelled');
      const exp = await api<ExperimentDto>(slow.base, 'GET', `/api/workspaces/${swid}/experiments/${seid}`);
      expect(exp.body.run_info.status).toBe('cancelled');
      expect(exp.body.run_info.cancelled).toBeGreaterThan(0);
      expect(exp.body.run_info.cancelled + exp.body.run_info.successful).toBe(20);
    } finally {
      await stopServer(slow);
    }
  });
});

describe('static web app', () => {
  it('serves the built web app with an SPA fallback while keeping /api JSON errors', async () => {
    const webDist = fs.mkdtempSync(path.join(TMP_ROOT, 'impact-web-'));
    fs.writeFileSync(path.join(webDist, 'index.html'), '<!doctype html><title>Impact</title>');
    fs.mkdirSync(path.join(webDist, 'assets'));
    fs.writeFileSync(path.join(webDist, 'assets', 'app.js'), 'console.log(1)');
    const t = await startServer({ webDist });
    try {
      const index = await api(t.base, 'GET', '/');
      expect(index.status).toBe(200);
      expect(index.text).toContain('<title>Impact</title>');
      const asset = await api(t.base, 'GET', '/assets/app.js');
      expect(asset.status).toBe(200);
      expect(asset.headers.get('content-type')).toContain('javascript');
      const deep = await api(t.base, 'GET', '/workspaces/ws_x/model/Examples.Simple');
      expect(deep.status).toBe(200);
      expect(deep.text).toContain('<title>Impact</title>');
      const apiMiss = await api<{ error: { code: string } }>(t.base, 'GET', '/api/does-not-exist');
      expect(apiMiss.status).toBe(404);
      expect(apiMiss.body.error.code).toBe('not_found');
    } finally {
      await stopServer(t);
      fs.rmSync(webDist, { recursive: true, force: true });
    }
  });

  it('reports parse diagnostics per workspace', async () => {
    const t = await startServer();
    try {
      const wid = await firstWorkspaceId(t.base);
      const r = await api<{ data: { items: unknown[] } }>(t.base, 'GET', `/api/workspaces/${wid}/diagnostics`);
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.data.items)).toBe(true);
      if (PARSER_OK) expect(r.body.data.items).toEqual([]);
    } finally {
      await stopServer(t);
    }
  });
});

describe('model executables (fake engine)', () => {
  let t: TestServer;
  let wid: string;
  beforeAll(async () => {
    t = await startServer({ engine: fakeEngine });
    wid = await firstWorkspaceId(t.base);
  });
  afterAll(() => stopServer(t));

  it('creates, compiles and logs a model executable', async () => {
    const created = await api<ModelExecutableDto>(t.base, 'POST', `/api/workspaces/${wid}/model-executables`, { input: { className: 'Examples.Simple' } });
    expect(created.status).toBe(201);
    expect(created.body.id).toMatch(/^fmu_/);
    expect(created.body.run_info.status).toBe('not_started');
    const fid = created.body.id;

    expect((await api<{ status: string }>(t.base, 'GET', `/api/workspaces/${wid}/model-executables/${fid}/compilation`)).body.status).toBe('pending');
    const started = await api<{ status: string }>(t.base, 'POST', `/api/workspaces/${wid}/model-executables/${fid}/compilation`);
    expect(started.status).toBe(202);
    await waitFor(async () => (await api<{ status: string }>(t.base, 'GET', `/api/workspaces/${wid}/model-executables/${fid}/compilation`)).body.status === 'done');

    const exe = await api<ModelExecutableDto>(t.base, 'GET', `/api/workspaces/${wid}/model-executables/${fid}`);
    expect(exe.body.run_info.status).toBe('successful');
    expect(exe.body.run_info.warnings).toEqual(['stub warning']);
    expect(exe.body.statistics).toMatchObject({ unknowns: 2, equations: 2, states: 1, parameters: 1 });

    const log = await api(t.base, 'GET', `/api/workspaces/${wid}/model-executables/${fid}/compilation/log`);
    expect(log.headers.get('content-type')).toContain('text/plain');
    expect(log.text).toContain('Compiling model Examples.Simple');
    expect(log.text).toContain('Model statistics: 2 unknowns, 2 equations, 1 states, 1 parameters');
    expect(log.text).toMatch(/Compilation succeeded in \d+\.\d+ s/);

    const list = items(await api<{ data: { items: ModelExecutableDto[] } }>(t.base, 'GET', `/api/workspaces/${wid}/model-executables`));
    expect(list.map((e) => e.id)).toEqual([fid]);
    expect((await api(t.base, 'DELETE', `/api/workspaces/${wid}/model-executables/${fid}`)).status).toBe(204);
    expect((await api(t.base, 'GET', `/api/workspaces/${wid}/model-executables/${fid}`)).status).toBe(404);
    expect((await api(t.base, 'POST', `/api/workspaces/${wid}/model-executables`, { input: {} })).status).toBe(400);
  });
});
