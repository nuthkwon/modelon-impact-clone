/**
 * Regression tests for the review findings on the server: id validation, CORS, sweep cap,
 * edit-op validation, directory-library deletion, stale results, restart recovery and the
 * worker-thread simulation path (responsiveness + cancel).
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ModelicaError } from '@impact/core';
import type { CaseDto, ClassSourceDto, ClassTreeNodeDto, ExperimentDto, LibraryBundleDto, ModelExecutableDto, Project } from '@impact/protocol';
import type { Engine } from './engine.js';
import { isSafeRelative } from './fsutil.js';
import { PARSER_OK, api, fakeEngine, firstWorkspaceId, items, startServer, stopServer, waitFor, type TestServer } from './test-helpers.js';

type ErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } };

const definition = (variables: Record<string, number | string | boolean>, analysis: Record<string, unknown> = {}, className = 'Examples.Simple') => ({
  experiment: {
    version: 2,
    base: {
      model: { modelica: { className } },
      modifiers: { variables },
      analysis: { type: 'dynamic', parameters: { start_time: 0, final_time: 1 }, simulationOptions: { ncp: 10 }, solverOptions: { solver: 'CVode', rtol: 1e-6 }, ...analysis },
    },
    extensions: [],
  },
});

const execution = (wid: string, eid: string) => `/api/workspaces/${wid}/experiments/${eid}/execution`;
const status = async (base: string, wid: string, eid: string) => (await api<{ status: string; progress: number; message?: string }>(base, 'GET', execution(wid, eid))).body;

// ---------------------------------------------------------------------------------------
// (a) strict route ids
// ---------------------------------------------------------------------------------------

describe('route id validation', () => {
  let t: TestServer;
  let wid: string;
  beforeAll(async () => {
    t = await startServer({ engine: fakeEngine });
    wid = await firstWorkspaceId(t.base);
  });
  afterAll(() => stopServer(t));

  it('rejects aliases and traversal in wid/eid/cid/fid/lid with 400 and keeps 404 for well-formed unknown ids', async () => {
    const bad = [
      `/api/workspaces/${wid}%2F.`,
      `/api/workspaces/${wid}%2F.%2F./classes`,
      `/api/workspaces/${wid}%2F./experiments`,
      `/api/workspaces/..%2F..%2Fx/experiments`,
      `/api/workspaces/${wid}/experiments/..%2F..%2Fx`,
      `/api/workspaces/${wid}/experiments/exp_a.b/cases/case_1`,
      `/api/workspaces/${wid}/experiments/exp_x/cases/..%2Fcase_1/result`,
      `/api/workspaces/${wid}/model-executables/..%2Ffmu`,
      `/api/workspaces/${wid}/libraries/a.b`,
      `/api/workspaces/${'x'.repeat(65)}`,
    ];
    for (const url of bad) {
      const r = await api<ErrorBody>(t.base, 'GET', url);
      expect(r.status, url).toBe(400);
      expect(r.body.error.code, url).toBe('validation_error');
    }
    expect((await api(t.base, 'POST', `${execution(`${wid}%2F.`, 'exp_x')}`)).status).toBe(400);
    expect((await api(t.base, 'GET', `/api/workspaces/${wid}/experiments/exp_missing`)).status).toBe(404);
    expect((await api(t.base, 'GET', `/api/workspaces/ws_missing`)).status).toBe(404);
    expect((await api(t.base, 'GET', `/api/workspaces/${wid}/model-executables/fmu_missing`)).status).toBe(404);
    expect((await api(t.base, 'GET', `/api/workspaces/${wid}`)).status).toBe(200);
    expect((await api(t.base, 'GET', `/api/workspaces/${wid}/classes/Examples.Simple/source`)).status).toBe(200);
  });

  it('never resolves an alias at the storage layer either', () => {
    const { storage } = t.app.context;
    expect(storage.getWorkspace(`${wid}/.`)).toBeUndefined();
    expect(storage.getExperiment('../../x', 'exp_1')).toBeUndefined();
    expect(storage.getCase(wid, 'exp_1', '../case_1')).toBeUndefined();
    expect(storage.getExecutable(wid, 'fmu/../x')).toBeUndefined();
    expect(storage.readCaseLog(`${wid}/.`, 'exp_1', 'case_1')).toBe('');
  });
});

// ---------------------------------------------------------------------------------------
// (g) CORS off by default
// ---------------------------------------------------------------------------------------

describe('CORS', () => {
  it('sends no CORS headers unless an origin is configured', async () => {
    const t = await startServer({ engine: fakeEngine });
    try {
      const r = await api(t.base, 'GET', '/api/workspaces', undefined, { origin: 'https://evil.example' });
      expect(r.status).toBe(200);
      expect(r.headers.get('access-control-allow-origin')).toBeNull();
      const preflight = await api(t.base, 'OPTIONS', '/api/workspaces', undefined, { origin: 'https://evil.example', 'access-control-request-method': 'DELETE' });
      expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
      expect(preflight.headers.get('access-control-allow-methods')).toBeNull();
    } finally {
      await stopServer(t);
    }
  });

  it('allows exactly the configured origins (option or CORS_ORIGIN env)', async () => {
    const t = await startServer({ engine: fakeEngine, corsOrigin: 'http://localhost:5173, http://127.0.0.1:5173' });
    try {
      const ok = await api(t.base, 'GET', '/api/workspaces', undefined, { origin: 'http://localhost:5173' });
      expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
      const preflight = await api(t.base, 'OPTIONS', '/api/workspaces', undefined, { origin: 'http://127.0.0.1:5173', 'access-control-request-method': 'DELETE' });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5173');
      const other = await api(t.base, 'GET', '/api/workspaces', undefined, { origin: 'https://evil.example' });
      expect(other.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      await stopServer(t);
    }
    process.env.CORS_ORIGIN = 'http://example.test';
    let env: TestServer | undefined;
    try {
      env = await startServer({ engine: fakeEngine });
      const r = await api(env.base, 'GET', '/api/health', undefined, { origin: 'http://example.test' });
      expect(r.headers.get('access-control-allow-origin')).toBe('http://example.test');
    } finally {
      delete process.env.CORS_ORIGIN;
      if (env) await stopServer(env);
    }
  });
});

// ---------------------------------------------------------------------------------------
// (b) sweep expansion cap
// ---------------------------------------------------------------------------------------

describe('sweep expansion cap', () => {
  let t: TestServer;
  let wid: string;
  beforeAll(async () => {
    t = await startServer({ engine: fakeEngine });
    wid = await firstWorkspaceId(t.base);
  });
  afterAll(() => stopServer(t));

  it('rejects oversized range()/choices() products with 400 before writing anything', async () => {
    const huge = await api<ErrorBody>(t.base, 'POST', `/api/workspaces/${wid}/experiments`, definition({ R: 'range(0, 1, 1e9)' }));
    expect(huge.status).toBe(400);
    expect(huge.body.error.code).toBe('validation_error');
    expect(huge.body.error.message).toMatch(/range\(\) with count 1000000000 exceeds the maximum of 1000/);

    const choices = `choices(${Array.from({ length: 11 }, (_, i) => i + 1).join(', ')})`;
    const product = await api<ErrorBody>(t.base, 'POST', `/api/workspaces/${wid}/experiments`, definition({ a: choices, b: choices, c: choices }));
    expect(product.status).toBe(400);
    expect(product.body.error.message).toContain('1331 cases');
    expect(product.body.error.message).toContain('MAX_CASES');
    expect(product.body.error.details).toEqual({ cases: 1331, maxCases: 1000 });
    expect(items(await api<{ data: { items: ExperimentDto[] } }>(t.base, 'GET', `/api/workspaces/${wid}/experiments`))).toEqual([]);
    expect(fs.readdirSync(path.join(t.dataDir, 'workspaces', wid))).not.toContain('experiments');
  });

  it('honours MAX_CASES', async () => {
    process.env.MAX_CASES = '5';
    try {
      const tooMany = await api<ErrorBody>(t.base, 'POST', `/api/workspaces/${wid}/experiments`, definition({ R: 'range(1, 6, 6)' }));
      expect(tooMany.status).toBe(400);
      expect(tooMany.body.error.message).toContain('maximum of 5');
      const ok = await api<ExperimentDto>(t.base, 'POST', `/api/workspaces/${wid}/experiments`, definition({ R: 'range(1, 5, 5)' }));
      expect(ok.status).toBe(201);
      expect(ok.body.run_info.not_started).toBe(5);
    } finally {
      delete process.env.MAX_CASES;
    }
  });
});

// ---------------------------------------------------------------------------------------
// (d) edit op validation
// ---------------------------------------------------------------------------------------

describe('edit op validation', () => {
  let t: TestServer;
  let wid: string;
  const edit = (w: string, op: unknown) => api<ErrorBody & { version?: number; text?: string }>(t.base, 'POST', `/api/workspaces/${w}/classes/Examples.Simple/edit`, { op });
  beforeAll(async () => {
    t = await startServer({ engine: fakeEngine });
    wid = await firstWorkspaceId(t.base);
  });
  afterAll(() => stopServer(t));

  it('rejects unknown ops and malformed fields with 400 without touching the file', async () => {
    const before = await api<ClassSourceDto>(t.base, 'GET', `/api/workspaces/${wid}/classes/Examples.Simple/source`);
    const cases: [unknown, RegExp][] = [
      [{ op: 'bogusOp' }, /Unknown edit operation 'bogusOp'/],
      [{ op: 'addComponent' }, /op\.className/],
      [{ op: 'addComponent', className: 'Modelica.Icons.Package', position: [1] }, /op\.position/],
      [{ op: 'deleteComponents', names: 5 }, /op\.names/],
      [{ op: 'setPlacement', name: 'resistor', placement: null }, /op\.placement/],
      [{ op: 'setPlacement', name: 'resistor', placement: { transformation: { origin: [0, 0], extent: [[0, 0]], rotation: 0 } } }, /extent/],
      [{ op: 'moveComponents', names: ['a'], delta: 'x' }, /op\.delta/],
      [{ op: 'setConnectionPoints', equationIndex: -1, points: [] }, /op\.equationIndex/],
      [{ op: 'deleteConnection', equationIndex: '0' }, /op\.equationIndex/],
      [{ op: 'flipComponent', name: 'r', axis: 'diagonal' }, /op\.axis/],
      [{ op: 'setParameter', name: 'R', valueText: 5 }, /op\.valueText/],
      [{ op: 'setExperiment', experiment: { StopTime: 'later' } }, /op\.experiment\.StopTime/],
      [{ op: 'replaceText' }, /op\.text/],
      [{ op: 42 }, /op\.op/],
      ['setDescription', /op must be an object/],
    ];
    for (const [op, re] of cases) {
      const r = await edit(wid, op);
      expect(r.status, JSON.stringify(op)).toBe(400);
      expect(r.body.error.code, JSON.stringify(op)).toBe('validation_error');
      expect(r.body.error.message, JSON.stringify(op)).toMatch(re);
    }
    const after = await api<ClassSourceDto>(t.base, 'GET', `/api/workspaces/${wid}/classes/Examples.Simple/source`);
    expect(after.body.version).toBe(before.body.version);
    expect(after.body.text).toBe(before.body.text);
  });

  it.skipIf(!PARSER_OK)('still applies a well-formed op', async () => {
    const r = await edit(wid, { op: 'setDescription', description: 'Edited by test' });
    expect(r.status).toBe(200);
    expect(r.body.text).toContain('"Edited by test"');
    expect(r.body.version).toBe(2);
    const unknownComponent = await edit(wid, { op: 'setParameter', component: 'nope', name: 'R', valueText: '1' });
    expect([400, 422]).toContain(unknownComponent.status);
  });
});

// ---------------------------------------------------------------------------------------
// (h) directory libraries and sub-packages can be deleted
// ---------------------------------------------------------------------------------------

describe('directory package deletion', () => {
  it('isSafeRelative accepts the directory convention and still rejects escapes', () => {
    expect(isSafeRelative('Examples/')).toBe(true);
    expect(isSafeRelative('Examples/Sub/')).toBe(true);
    expect(isSafeRelative('Examples.mo')).toBe(true);
    expect(isSafeRelative('Examples//')).toBe(false);
    expect(isSafeRelative('a//b')).toBe(false);
    expect(isSafeRelative('../x')).toBe(false);
    expect(isSafeRelative('a/../b')).toBe(false);
    expect(isSafeRelative('/')).toBe(false);
    expect(isSafeRelative('')).toBe(false);
    expect(isSafeRelative('/abs')).toBe(false);
  });

  it.skipIf(!PARSER_OK)('deletes a sub-package directory and drops it from the parent package.order', async () => {
    const t = await startServer({ engine: fakeEngine }, (libs) => {
      fs.mkdirSync(path.join(libs, 'Examples', 'Sub'));
      fs.writeFileSync(path.join(libs, 'Examples', 'Sub', 'package.mo'), 'within Examples;\npackage Sub "A sub package"\nend Sub;\n');
      fs.writeFileSync(path.join(libs, 'Examples', 'Sub', 'Inner.mo'), 'within Examples.Sub;\nmodel Inner\nend Inner;\n');
      fs.writeFileSync(path.join(libs, 'Examples', 'Sub', 'package.order'), 'Inner\n');
      fs.writeFileSync(path.join(libs, 'Examples', 'package.order'), 'Simple\nSub\n');
    });
    try {
      const wid = await firstWorkspaceId(t.base);
      const projects = items(await api<{ data: { items: Project[] } }>(t.base, 'GET', `/api/workspaces/${wid}/projects`));
      const projectDir = path.join(t.dataDir, 'workspaces', wid, 'projects', projects[0].id);
      expect(fs.existsSync(path.join(projectDir, 'Examples', 'Sub', 'Inner.mo'))).toBe(true);
      const treeBefore = items(await api<{ data: { items: ClassTreeNodeDto[] } }>(t.base, 'GET', `/api/workspaces/${wid}/classes?parent=Examples`));
      expect(treeBefore.map((n) => n.name)).toEqual(['Examples.Simple', 'Examples.Sub']);

      const del = await api<ErrorBody>(t.base, 'DELETE', `/api/workspaces/${wid}/classes/Examples.Sub`);
      expect(del.status, del.text).toBe(204);
      expect(fs.existsSync(path.join(projectDir, 'Examples', 'Sub'))).toBe(false);
      expect(fs.readFileSync(path.join(projectDir, 'Examples', 'package.order'), 'utf8')).toBe('Simple\n');
      // (`/source` intentionally falls back to the nearest ancestor file; `/diagram` needs the class in the registry.)
      expect((await api(t.base, 'GET', `/api/workspaces/${wid}/classes/Examples.Sub/diagram`)).status).toBe(404);
      expect((await api(t.base, 'GET', `/api/workspaces/${wid}/classes/Examples.Sub.Inner/diagram`)).status).toBe(404);
      expect(t.app.context.registries.get(wid).registry.has('Examples.Sub')).toBe(false);
      const tree = items(await api<{ data: { items: ClassTreeNodeDto[] } }>(t.base, 'GET', `/api/workspaces/${wid}/classes?parent=Examples`));
      expect(tree.map((n) => n.name)).toEqual(['Examples.Simple']);
      const libs = items(await api<{ data: { items: LibraryBundleDto[] } }>(t.base, 'GET', `/api/workspaces/${wid}/libraries`));
      expect(libs.find((l) => l.name === 'Examples')!.files.map((f) => f.path)).toEqual(['Examples/package.mo', 'Examples/Simple.mo']);

      // Re-creating a class with the same short name must not produce a duplicate order entry.
      const recreated = await api<ClassSourceDto>(t.base, 'POST', `/api/workspaces/${wid}/classes`, { className: 'Examples.Sub', restriction: 'package' });
      expect(recreated.status).toBe(201);
      expect(fs.readFileSync(path.join(projectDir, 'Examples', 'package.order'), 'utf8')).toBe('Simple\nSub\n');
    } finally {
      await stopServer(t);
    }
  });

  it('deletes a whole directory-based library and its project content entry', async () => {
    const t = await startServer({ engine: fakeEngine });
    try {
      const wid = await firstWorkspaceId(t.base);
      const projects = items(await api<{ data: { items: Project[] } }>(t.base, 'GET', `/api/workspaces/${wid}/projects`));
      const examplesDir = path.join(t.dataDir, 'workspaces', wid, 'projects', projects[0].id, 'Examples');
      expect(fs.existsSync(path.join(examplesDir, 'package.mo'))).toBe(true);

      const del = await api<ErrorBody>(t.base, 'DELETE', `/api/workspaces/${wid}/classes/Examples`);
      expect(del.status, del.text).toBe(204);
      expect(fs.existsSync(examplesDir)).toBe(false);
      expect((await api(t.base, 'GET', `/api/workspaces/${wid}/classes/Examples/source`)).status).toBe(404);
      const libs = items(await api<{ data: { items: LibraryBundleDto[] } }>(t.base, 'GET', `/api/workspaces/${wid}/libraries`));
      expect(libs.map((l) => l.name)).toEqual(['Modelica']);
      const after = items(await api<{ data: { items: Project[] } }>(t.base, 'GET', `/api/workspaces/${wid}/projects`));
      expect(after[0].definition.content).toEqual([]);
    } finally {
      await stopServer(t);
    }
  });
});

// ---------------------------------------------------------------------------------------
// (e) results of a re-run whose case failed
// ---------------------------------------------------------------------------------------

describe('case results after a re-run', () => {
  let failNext = false;
  const toggling: Partial<Engine> = {
    ...fakeEngine,
    simulate: (flat, options, hooks) => {
      if (failNext) throw new ModelicaError('Variable z evaluated to +Infinity', [{ severity: 'error', message: 'Variable z evaluated to +Infinity', path: 'Examples.Simple' }]);
      return fakeEngine.simulate!(flat, options, hooks);
    },
  };
  let t: TestServer;
  let wid: string;
  beforeAll(async () => {
    t = await startServer({ engine: toggling });
    wid = await firstWorkspaceId(t.base);
  });
  afterAll(() => stopServer(t));

  it('serves 409 before a case ran, 200 after success and 404 (no stale data) after a failed re-run', async () => {
    const created = await api<ExperimentDto>(t.base, 'POST', `/api/workspaces/${wid}/experiments`, definition({}));
    const eid = created.body.id;
    const resultUrl = `/api/workspaces/${wid}/experiments/${eid}/cases/case_1/result`;
    const notRun = await api<ErrorBody>(t.base, 'GET', resultUrl);
    expect(notRun.status).toBe(409);
    expect(notRun.body.error.code).toBe('conflict');
    expect((await api(t.base, 'GET', `${resultUrl}/meta`)).status).toBe(409);

    await api(t.base, 'POST', execution(wid, eid));
    await waitFor(async () => (await status(t.base, wid, eid)).status === 'done');
    expect((await api(t.base, 'GET', resultUrl)).status).toBe(200);
    expect((await api(t.base, 'GET', `${resultUrl}/meta`)).status).toBe(200);
    const resultFile = path.join(t.dataDir, 'workspaces', wid, 'experiments', eid, 'cases', 'case_1.result.json');
    expect(fs.existsSync(resultFile)).toBe(true);

    failNext = true;
    await api(t.base, 'POST', execution(wid, eid));
    await waitFor(async () => (await status(t.base, wid, eid)).status === 'done');
    const c = await api<CaseDto>(t.base, 'GET', `/api/workspaces/${wid}/experiments/${eid}/cases/case_1`);
    expect(c.body.run_info.status).toBe('failed');
    const stale = await api<ErrorBody>(t.base, 'GET', resultUrl);
    expect(stale.status).toBe(404);
    expect(stale.body.error.message).toContain('failed');
    expect((await api(t.base, 'GET', `${resultUrl}?format=json`)).status).toBe(404);
    expect((await api(t.base, 'GET', `${resultUrl}/meta`)).status).toBe(404);
    expect(fs.existsSync(resultFile)).toBe(false);
    const traj = await api<number[][]>(t.base, 'POST', `/api/workspaces/${wid}/experiments/${eid}/cases/case_1/trajectories`, { variable_names: ['x'] });
    expect(traj.body).toEqual([[]]);
    const log = await api<{ log: string }>(t.base, 'GET', `/api/workspaces/${wid}/experiments/${eid}/cases/case_1/log`);
    expect(log.body.log).not.toContain('Simulation finished');
    expect(log.body.log).toContain('Simulation failed');
    failNext = false;
  });
});

// ---------------------------------------------------------------------------------------
// (f) jobs interrupted by a restart
// ---------------------------------------------------------------------------------------

describe('startup recovery', () => {
  it('marks executions and compilations left running by a previous process', async () => {
    const first = await startServer({ engine: fakeEngine });
    const wid = await firstWorkspaceId(first.base);
    const exp = await api<ExperimentDto>(first.base, 'POST', `/api/workspaces/${wid}/experiments`, definition({ R: 'range(1, 2, 2)' }));
    const eid = exp.body.id;
    const exe = await api<ModelExecutableDto>(first.base, 'POST', `/api/workspaces/${wid}/model-executables`, { input: { className: 'Examples.Simple' } });
    const fid = exe.body.id;
    await stopServer(first, /*keepDirs*/ true);

    // Simulate a crash mid-run: the persisted state says running/started.
    const expFile = path.join(first.dataDir, 'workspaces', wid, 'experiments', eid, 'experiment.json');
    const e = JSON.parse(fs.readFileSync(expFile, 'utf8')) as ExperimentDto;
    e.run_info.status = 'running';
    fs.writeFileSync(expFile, JSON.stringify(e));
    const caseFile = path.join(first.dataDir, 'workspaces', wid, 'experiments', eid, 'cases', 'case_1.json');
    const c1 = JSON.parse(fs.readFileSync(caseFile, 'utf8')) as CaseDto;
    c1.run_info = { status: 'started', datetime_started: new Date().toISOString() };
    fs.writeFileSync(caseFile, JSON.stringify(c1));
    const exeFile = path.join(first.dataDir, 'workspaces', wid, 'model-executables', `${fid}.json`);
    const x = JSON.parse(fs.readFileSync(exeFile, 'utf8')) as ModelExecutableDto;
    x.run_info = { status: 'running', datetime_started: new Date().toISOString() };
    fs.writeFileSync(exeFile, JSON.stringify(x));
    fs.writeFileSync(path.join(first.dataDir, 'workspaces', wid, 'model-executables', `${fid}.log`), 'Compiling model Examples.Simple\nFlattening Examples.Simple...\n');

    const second = await startServer({ engine: fakeEngine, dataDir: first.dataDir, librariesDir: first.librariesDir, seed: false });
    try {
      const recovered = await api<ExperimentDto>(second.base, 'GET', `/api/workspaces/${wid}/experiments/${eid}`);
      expect(recovered.body.run_info.status).toBe('cancelled');
      expect(recovered.body.run_info.message).toBe('Execution was interrupted by a server restart');
      expect(recovered.body.run_info.cancelled).toBe(2);
      const cases = items(await api<{ data: { items: CaseDto[] } }>(second.base, 'GET', `/api/workspaces/${wid}/experiments/${eid}/cases`));
      expect(cases.map((c) => c.run_info.status)).toEqual(['cancelled', 'cancelled']);
      expect(cases[0].run_info.failures).toEqual(['Execution was interrupted by a server restart']);
      const s = await status(second.base, wid, eid);
      expect(s).toEqual({ status: 'cancelled', progress: 1, message: 'Execution was interrupted by a server restart' });

      const compiled = await api<ModelExecutableDto>(second.base, 'GET', `/api/workspaces/${wid}/model-executables/${fid}`);
      expect(compiled.body.run_info.status).toBe('failed');
      expect(compiled.body.run_info.errors).toEqual(['Compilation was interrupted by a server restart']);
      const cs = await api<{ status: string; progress: number; message?: string }>(second.base, 'GET', `/api/workspaces/${wid}/model-executables/${fid}/compilation`);
      expect(cs.body.status).toBe('done');
      expect(cs.body.progress).toBe(1);
      const log = await api(second.base, 'GET', `/api/workspaces/${wid}/model-executables/${fid}/compilation/log`);
      expect(log.text).toContain('Flattening Examples.Simple...');
      expect(log.text).toContain('Error: Compilation was interrupted by a server restart');

      // A restarted server can compile the executable again.
      expect((await api(second.base, 'POST', `/api/workspaces/${wid}/model-executables/${fid}/compilation`)).status).toBe(202);
      await waitFor(async () => (await api<{ status: string }>(second.base, 'GET', `/api/workspaces/${wid}/model-executables/${fid}/compilation`)).body.status === 'done');
      expect((await api<ModelExecutableDto>(second.base, 'GET', `/api/workspaces/${wid}/model-executables/${fid}`)).body.run_info.status).toBe('successful');
    } finally {
      await stopServer(second);
    }
  });

  it('persists `running` while a compilation is in progress', async () => {
    const t = await startServer({ engine: { ...fakeEngine, flatten: (registry, className) => fakeEngine.flatten!(registry, className, {}) } });
    try {
      const wid = await firstWorkspaceId(t.base);
      const exe = await api<ModelExecutableDto>(t.base, 'POST', `/api/workspaces/${wid}/model-executables`, { input: { className: 'Examples.Simple' } });
      await api(t.base, 'POST', `/api/workspaces/${wid}/model-executables/${exe.body.id}/compilation`);
      // The compile job runs on the next macrotask; the file is already marked running.
      const onDisk = JSON.parse(fs.readFileSync(path.join(t.dataDir, 'workspaces', wid, 'model-executables', `${exe.body.id}.json`), 'utf8')) as ModelExecutableDto;
      expect(['running', 'successful']).toContain(onDisk.run_info.status);
      await waitFor(async () => (await api<{ status: string }>(t.base, 'GET', `/api/workspaces/${wid}/model-executables/${exe.body.id}/compilation`)).body.status === 'done');
      expect((await api<ModelExecutableDto>(t.base, 'GET', `/api/workspaces/${wid}/model-executables/${exe.body.id}`)).body.run_info.status).toBe('successful');
    } finally {
      await stopServer(t);
    }
  });
});

// ---------------------------------------------------------------------------------------
// (c) worker-thread simulation with the real engine
// ---------------------------------------------------------------------------------------

describe.skipIf(!PARSER_OK)('worker-thread simulation (real engine)', () => {
  let t: TestServer;
  let wid: string;
  beforeAll(async () => {
    t = await startServer();
    wid = await firstWorkspaceId(t.base);
  });
  afterAll(() => stopServer(t));

  it('uses the worker path without an injected engine and the inline path with one', async () => {
    expect(t.app.context.jobs.inlineSimulation).toBe(false);
    const inline = await startServer({ engine: fakeEngine });
    try {
      expect(inline.app.context.jobs.inlineSimulation).toBe(true);
    } finally {
      await stopServer(inline);
    }
    const forced = await startServer({ inlineSimulation: true });
    try {
      expect(forced.app.context.jobs.inlineSimulation).toBe(true);
    } finally {
      await stopServer(forced);
    }
  });

  it('runs a sweep in a worker and produces the same logs and results as the inline path', async () => {
    const created = await api<ExperimentDto>(t.base, 'POST', `/api/workspaces/${wid}/experiments`, definition({ R: 'range(50, 150, 3)' }));
    expect(created.status).toBe(201);
    const eid = created.body.id;
    const started = await api(t.base, 'POST', execution(wid, eid));
    expect(started.status).toBe(202);
    await waitFor(async () => (await status(t.base, wid, eid)).status === 'done', 30_000, 25);
    const exp = await api<ExperimentDto>(t.base, 'GET', `/api/workspaces/${wid}/experiments/${eid}`);
    expect(exp.body.run_info).toEqual({ status: 'done', failed: 0, successful: 3, cancelled: 0, not_started: 0 });

    const log = await api<{ log: string }>(t.base, 'GET', `/api/workspaces/${wid}/experiments/${eid}/cases/case_1/log`);
    expect(log.body.log).toContain('Simulating Examples.Simple from t=0 to t=1 with CVode (rtol=0.000001, ncp=10)');
    expect(log.body.log).toContain('Parameters: R=50');
    expect(log.body.log).toMatch(/Model statistics: \d+ unknowns, \d+ equations, 1 states, 1 parameters/);
    expect(log.body.log).toMatch(/Number of steps: \d+/);
    expect(log.body.log).toMatch(/Result: 11 time points, \d+ variables/);
    expect(log.body.log).toMatch(/Simulation finished in \d+\.\d+ s \(solver \d+ ms\)/);

    const traj = await api<number[][][]>(t.base, 'POST', `/api/workspaces/${wid}/experiments/${eid}/trajectories`, { variable_names: ['time', 'x', 'R'] });
    expect(traj.body[0][0]).toHaveLength(11);
    expect(traj.body[0][0][10]).toBeCloseTo(1, 6);
    // x(t) = exp(-t/R): 0.9802 for R=50, 0.99 for R=100, 0.9934 for R=150.
    expect(traj.body[1][0][10]).toBeCloseTo(Math.exp(-1 / 50), 4);
    expect(traj.body[1][1][10]).toBeCloseTo(Math.exp(-1 / 100), 4);
    expect(traj.body[1][2][10]).toBeCloseTo(Math.exp(-1 / 150), 4);
    expect(traj.body[2].map((r) => r[0])).toEqual([50, 100, 150]);
    const c1 = await api<CaseDto>(t.base, 'GET', `/api/workspaces/${wid}/experiments/${eid}/cases/case_1`);
    expect(c1.body.run_info.statistics).toMatchObject({ completed: true });
    expect((await api(t.base, 'GET', `/api/workspaces/${wid}/experiments/${eid}/cases/case_1/result`)).status).toBe(200);
  }, 40_000);

  it('keeps serving requests during a long case and cancels it within 2 s by terminating the worker', async () => {
    // Explicit Euler with a 1e-9 s step over 1000 s never finishes on its own.
    const created = await api<ExperimentDto>(t.base, 'POST', `/api/workspaces/${wid}/experiments`, definition({}, { parameters: { start_time: 0, final_time: 1000 }, solverOptions: { solver: 'ExplicitEuler', step_size: 1e-9 } }));
    const eid = created.body.id;
    expect((await api(t.base, 'POST', execution(wid, eid))).status).toBe(202);
    const caseLog = async () => (await api<{ log: string }>(t.base, 'GET', `/api/workspaces/${wid}/experiments/${eid}/cases/case_1/log`)).body.log;
    // The header is persisted once the worker has flattened, i.e. the solver is now running.
    await waitFor(async () => (await caseLog()).includes('Simulating Examples.Simple from t=0 to t=1000'), 30_000, 25);
    expect((await api<CaseDto>(t.base, 'GET', `/api/workspaces/${wid}/experiments/${eid}/cases/case_1`)).body.run_info.status).toBe('started');
    // Give the worker time to be deep inside simulate(), then prove the event loop is free.
    await new Promise((r) => setTimeout(r, 300));
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      const health = await api<{ status: string }>(t.base, 'GET', '/api/health');
      expect(health.body.status).toBe('ok');
      expect(Date.now() - t0).toBeLessThan(500);
    }
    expect((await status(t.base, wid, eid)).status).toBe('running');

    const tCancel = Date.now();
    expect((await api(t.base, 'DELETE', execution(wid, eid))).status).toBe(204);
    await waitFor(async () => (await status(t.base, wid, eid)).status === 'cancelled', 2000, 20);
    expect(Date.now() - tCancel).toBeLessThan(2000);
    const exp = await api<ExperimentDto>(t.base, 'GET', `/api/workspaces/${wid}/experiments/${eid}`);
    expect(exp.body.run_info).toMatchObject({ status: 'cancelled', cancelled: 1, successful: 0 });
    const c1 = await api<CaseDto>(t.base, 'GET', `/api/workspaces/${wid}/experiments/${eid}/cases/case_1`);
    expect(c1.body.run_info.status).toBe('cancelled');
    const log = await api<{ log: string }>(t.base, 'GET', `/api/workspaces/${wid}/experiments/${eid}/cases/case_1/log`);
    expect(log.body.log).toContain('Simulating Examples.Simple from t=0 to t=1000 with Explicit Euler');
    expect(log.body.log).toMatch(/Simulation cancelled in \d+\.\d+ s/);
    expect((await api(t.base, 'GET', `/api/workspaces/${wid}/experiments/${eid}/cases/case_1/result`)).status).toBe(404);
    // The experiment can be run again afterwards (a fresh worker is spawned).
    expect((await api(t.base, 'DELETE', execution(wid, eid))).status).toBe(404);
  }, 40_000);
});
