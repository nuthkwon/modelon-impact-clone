/**
 * REST API (packages/protocol): class tree & source endpoints, syntax-error handling on PUT,
 * and the experiment create → execute → trajectories flow for `Examples.VanDerPol`. Request
 * context only, no browser.
 */
import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import type { CaseDto, ExperimentDto, ItemsResponse } from '@impact/protocol';
import { API_URL, classTree, defaultWorkspace, deleteExperiment, getClassSource } from './helpers';

const base = (wid: string) => `${API_URL}/api/workspaces/${wid}`;
const json = async <T>(res: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> => (await res.json()) as T;

test.describe('REST API', () => {
  let wid: string;

  test.beforeAll(async ({ request }) => {
    wid = (await defaultWorkspace(request)).id;
  });

  test('health and workspace listing', async ({ request }) => {
    const health = await request.get(`${API_URL}/api/health`);
    expect(health.ok()).toBeTruthy();
    expect(await json<{ status: string }>(health)).toMatchObject({ status: 'ok' });

    const ws = await json<{ id: string; definition: { name: string; projects: unknown[]; dependencies: unknown[] } }>(await request.get(base(wid)));
    expect(ws.id).toBe(wid);
    expect(ws.definition.name).toBe('Default');
    expect(ws.definition.projects).toHaveLength(1);
    expect(ws.definition.dependencies).toHaveLength(1);

    const missing = await request.get(`${API_URL}/api/workspaces/ws_doesnotexist`);
    expect(missing.status()).toBe(404);
    expect(await json<{ error: { code: string } }>(missing)).toMatchObject({ error: { code: 'not_found' } });
  });

  test('class tree endpoints', async ({ request }) => {
    const top = await classTree(request, wid);
    const examples = top.find((n) => n.name === 'Examples');
    const modelica = top.find((n) => n.name === 'Modelica');
    expect(examples).toMatchObject({ shortName: 'Examples', restriction: 'package', hasChildren: true, readOnly: false, partial: false });
    expect(modelica).toMatchObject({ shortName: 'Modelica', restriction: 'package', hasChildren: true, readOnly: true });

    const children = await classTree(request, wid, 'Examples');
    const names = children.map((n) => n.name);
    expect(names).toEqual(expect.arrayContaining(['Examples.RCCircuit', 'Examples.HeatedRoom', 'Examples.BouncingBall', 'Examples.VanDerPol']));
    const rc = children.find((n) => n.name === 'Examples.RCCircuit')!;
    expect(rc).toMatchObject({ shortName: 'RCCircuit', restriction: 'model', droppable: true, partial: false, readOnly: false, hasChildren: false, libraryId: examples!.libraryId });
    expect(rc.description).toContain('RC low-pass');

    const basic = await classTree(request, wid, 'Modelica.Electrical.Analog.Basic');
    const resistor = basic.find((n) => n.name === 'Modelica.Electrical.Analog.Basic.Resistor');
    expect(resistor).toMatchObject({ restriction: 'model', readOnly: true, droppable: true });
    expect(resistor!.icon).toBeTruthy();
    const onePort = (await classTree(request, wid, 'Modelica.Electrical.Analog.Interfaces')).find((n) => n.shortName === 'OnePort');
    expect(onePort).toMatchObject({ partial: true, droppable: false });

    const hits = await classTree(request, wid, undefined, 'VanDer');
    expect(hits.map((n) => n.name)).toContain('Examples.VanDerPol');

    const src = await getClassSource(request, wid, 'Examples.RCCircuit');
    expect(src.className).toBe('Examples.RCCircuit');
    expect(src.readOnly).toBe(false);
    expect(src.text).toContain('model RCCircuit');
    expect(src.file).toMatch(/Examples/);
    expect(typeof src.version).toBe('number');

    const lib = await getClassSource(request, wid, 'Modelica.Electrical.Analog.Basic.Resistor');
    expect(lib.readOnly).toBe(true);
    expect(lib.text).toContain('model Resistor');

    // (A nested name inside an existing library deliberately falls back to the enclosing file, so
    // that files with syntax errors stay reachable; only an unknown library is a 404.)
    const unknown = await request.get(`${base(wid)}/classes/${encodeURIComponent('NoSuchLibrary.Foo')}/source`);
    expect(unknown.status()).toBe(404);
    expect(await json<{ error: { code: string } }>(unknown)).toMatchObject({ error: { code: 'not_found' } });
  });

  test('PUT class source with a syntax error → 422 with diagnostics; stale version → 409; library → 403', async ({ request }) => {
    const className = 'Examples.VanDerPol';
    const url = `${base(wid)}/classes/${encodeURIComponent(className)}/source`;
    const before = await getClassSource(request, wid, className);
    expect(before.text).toContain('end VanDerPol;');

    const broken = before.text.replace('end VanDerPol;', 'end VanDerPol');
    const res = await request.put(url, { data: { text: broken, version: before.version } });
    expect(res.status()).toBe(422);
    const body = await json<{ error: { code: string; message: string; details: { diagnostics: { severity: string; message: string; loc?: { line: number; column: number } }[] } } }>(res);
    expect(body.error.code).toBe('modelica_error');
    expect(body.error.message).toMatch(/Syntax error/);
    expect(Array.isArray(body.error.details.diagnostics)).toBe(true);
    expect(body.error.details.diagnostics.length).toBeGreaterThan(0);
    const first = body.error.details.diagnostics[0];
    expect(first.severity).toBe('error');
    expect(first.message.length).toBeGreaterThan(0);
    expect(first.loc?.line).toBeGreaterThan(0);

    // Nothing was written.
    const after = await getClassSource(request, wid, className);
    expect(after.text).toBe(before.text);
    expect(after.version).toBe(before.version);

    const stale = await request.put(url, { data: { text: before.text, version: before.version + 1000 } });
    expect(stale.status()).toBe(409);
    expect(await json<{ error: { code: string } }>(stale)).toMatchObject({ error: { code: 'conflict' } });

    const readOnly = await request.put(`${base(wid)}/classes/${encodeURIComponent('Modelica.Electrical.Analog.Basic.Resistor')}/source`, { data: { text: 'model Resistor end Resistor;' } });
    expect(readOnly.status()).toBe(403);
    expect(await json<{ error: { code: string } }>(readOnly)).toMatchObject({ error: { code: 'read_only' } });
  });

  test('experiment create + execute + trajectories for Examples.VanDerPol', async ({ request }) => {
    const definition = {
      version: 2,
      base: {
        model: { modelica: { className: 'Examples.VanDerPol' } },
        modifiers: { variables: { mu: 2 } },
        analysis: {
          type: 'dynamic',
          parameters: { start_time: 0, final_time: 10 },
          simulationOptions: { ncp: 100 },
          solverOptions: { solver: 'CVode', rtol: 1e-6 },
        },
      },
      extensions: [],
    };
    const created = await request.post(`${base(wid)}/experiments`, { data: { experiment: definition, label: 'E2E VanDerPol' } });
    expect(created.status(), await created.text()).toBe(201);
    const exp = await json<ExperimentDto & { experiment_id: string }>(created);
    expect(exp.experiment_id).toMatch(/^exp_/);
    expect(exp.id).toBe(exp.experiment_id);
    expect(exp.className).toBe('Examples.VanDerPol');
    expect(exp.meta_data.label).toBe('E2E VanDerPol');
    expect(exp.run_info).toMatchObject({ status: 'not_started', not_started: 1, successful: 0, failed: 0 });
    const eid = exp.experiment_id;
    const E = `${base(wid)}/experiments/${eid}`;

    try {
      const start = await request.post(`${E}/execution`);
      expect(start.status()).toBe(202);
      expect(await json<{ status: string }>(start)).toMatchObject({ status: 'pending' });

      await expect
        .poll(async () => (await json<{ status: string }>(await request.get(`${E}/execution`))).status, { timeout: 60_000, message: 'execution finishes' })
        .toBe('done');
      const status = await json<{ status: string; progress: number }>(await request.get(`${E}/execution`));
      expect(status.progress).toBe(1);

      const after = await json<ExperimentDto>(await request.get(E));
      expect(after.run_info).toMatchObject({ status: 'done', successful: 1, failed: 0, cancelled: 0, not_started: 0 });

      const cases = (await json<ItemsResponse<CaseDto>>(await request.get(`${E}/cases`))).data.items;
      expect(cases).toHaveLength(1);
      expect(cases[0].id).toBe('case_1');
      expect(cases[0].run_info.status).toBe('successful');
      expect(cases[0].input.parametrization).toMatchObject({ mu: 2 });
      expect(cases[0].run_info.statistics).toBeTruthy();

      const vars = await json<{ variables: string[] }>(await request.get(`${E}/variables`));
      expect(vars.variables[0]).toBe('time');
      expect(vars.variables).toEqual(expect.arrayContaining(['x', 'y', 'mu']));

      // Trajectories: one array per variable, one per case, N samples.
      const traj = await json<number[][][]>(await request.post(`${E}/trajectories`, { data: { variable_names: ['time', 'x', 'y', 'mu'] } }));
      expect(traj).toHaveLength(4);
      for (const perVariable of traj) expect(perVariable).toHaveLength(1);
      const time = traj[0][0];
      const x = traj[1][0];
      const y = traj[2][0];
      const mu = traj[3][0];
      expect(time.length).toBeGreaterThanOrEqual(101);
      expect(x).toHaveLength(time.length);
      expect(y).toHaveLength(time.length);
      expect(mu).toHaveLength(time.length);
      expect(time[0]).toBe(0);
      expect(time[time.length - 1]).toBeCloseTo(10, 6);
      for (let i = 1; i < time.length; i++) expect(time[i]).toBeGreaterThanOrEqual(time[i - 1]);
      expect(x[0]).toBeCloseTo(2, 6);
      expect(y[0]).toBeCloseTo(0, 6);
      expect(mu.every((v) => v === 2)).toBe(true);
      expect(x.every((v) => Number.isFinite(v))).toBe(true);
      // the Van der Pol limit cycle keeps |x| bounded but oscillating
      expect(Math.max(...x.map(Math.abs))).toBeLessThan(3);
      expect(Math.min(...x)).toBeLessThan(0);

      const caseTraj = await json<number[][]>(await request.post(`${E}/cases/case_1/trajectories`, { data: { variable_names: ['x', 'nope'] } }));
      expect(caseTraj).toHaveLength(2);
      expect(caseTraj[0]).toEqual(x);
      expect(caseTraj[1]).toEqual([]);

      const meta = await json<{ className: string; time: { start: number; stop: number; points: number }; variables: { name: string; kind: string }[] }>(await request.get(`${E}/cases/case_1/result/meta`));
      expect(meta.className).toBe('Examples.VanDerPol');
      expect(meta.time).toMatchObject({ start: 0, points: time.length });
      expect(meta.time.stop).toBeCloseTo(10, 6);
      expect(meta.variables.find((v) => v.name === 'x')).toMatchObject({ kind: 'continuous' });
      expect(meta.variables.find((v) => v.name === 'mu')).toMatchObject({ kind: 'parameter' });

      const csv = await request.get(`${E}/cases/case_1/result`);
      expect(csv.status()).toBe(200);
      expect(csv.headers()['content-type']).toContain('text/csv');
      const header = (await csv.text()).split('\n')[0].split(',');
      expect(header[0]).toBe('time');
      expect(header).toContain('x');

      const log = await json<{ log: string }>(await request.get(`${E}/cases/case_1/log`));
      expect(log.log).toContain('Simulating Examples.VanDerPol');
      expect(log.log).toContain('mu=2');
    } finally {
      await deleteExperiment(request, wid, eid);
      expect((await request.get(E)).status()).toBe(404);
    }
  });

  test('invalid experiment definitions are rejected with 400', async ({ request }) => {
    const res = await request.post(`${base(wid)}/experiments`, { data: { experiment: { version: 2, base: { model: {} } } } });
    expect(res.status()).toBe(400);
    expect(await json<{ error: { code: string } }>(res)).toMatchObject({ error: { code: 'validation_error' } });
    const bad = await request.post(`${base(wid)}/experiments`, { data: '{not json', headers: { 'content-type': 'application/json' } });
    expect(bad.status()).toBe(400);
  });
});
