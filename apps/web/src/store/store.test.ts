/**
 * Store behaviour against a fake REST server (mocked `fetch`): workspace switching, versioned and
 * serialised source writes, undo/redo failure handling, de-duplicated trajectory loading, result
 * labels, sweep case counting and URL decoding.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassRegistry } from '@impact/core';
import { modifierCaseCount, pendingTrajectories, splitSweepArgs, useStore } from './index';
import { decodePathSegment } from '../hooks/useUrlSync';

const FIXTURE = `package Lib
  model A "A"
    parameter Real R = 1;
    Real x;
  equation
    der(x) = -R * x;
    annotation (Diagram(coordinateSystem(extent = {{-100, -100}, {100, 100}})));
  end A;
end Lib;
`;
const FILE = 'Lib/package.mo';

interface FakeFile {
  text: string;
  version: number;
}
interface FakeExperiment {
  id: string;
  label: string;
  className: string;
  createdAt: string;
  cases: { id: string; status: string }[];
  trajectories: Record<string, number[]>;
}
interface FakeWorkspace {
  id: string;
  libraryId: string;
  files: Record<string, FakeFile>;
  experiments: FakeExperiment[];
}
interface LogEntry {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

class FakeServer {
  workspaces = new Map<string, FakeWorkspace>();
  log: LogEntry[] = [];
  private gates: { method: string; re: RegExp; used: boolean; released: Promise<void>; hit: () => void }[] = [];
  private failures: { method: string; re: RegExp; status: number; message: string }[] = [];
  private seq = 0;

  addWorkspace(id: string, experiments: { label: string; trajectories?: Record<string, number[]> }[] = []): FakeWorkspace {
    const ws: FakeWorkspace = { id, libraryId: `lib_${id}`, files: { [FILE]: { text: FIXTURE, version: 1 } }, experiments: [] };
    for (const e of experiments) this.addExperiment(ws, e.label, 'Lib.A', e.trajectories);
    this.workspaces.set(id, ws);
    return ws;
  }

  addExperiment(ws: FakeWorkspace, label: string, className: string, trajectories: Record<string, number[]> = { time: [0, 1], x: [1, 0.5] }): FakeExperiment {
    const n = ++this.seq;
    const exp: FakeExperiment = { id: `exp_${n}`, label, className, createdAt: new Date(2026, 0, 1, 0, 0, n).toISOString(), cases: [{ id: 'case_1', status: 'successful' }], trajectories };
    ws.experiments.push(exp);
    return exp;
  }

  file(wid: string): FakeFile {
    return this.workspaces.get(wid)!.files[FILE];
  }

  /** Simulates another client saving the file. */
  changeElsewhere(wid: string, text: string): void {
    const f = this.file(wid);
    f.text = text;
    f.version++;
  }

  deleteFile(wid: string): void {
    delete this.workspaces.get(wid)!.files[FILE];
  }

  /** Holds the next matching request until `release()`; `hit` resolves once it arrived. */
  gate(method: string, re: RegExp): { hit: Promise<void>; release: () => void } {
    let release!: () => void;
    let hit!: () => void;
    const released = new Promise<void>((r) => (release = r));
    const hitP = new Promise<void>((r) => (hit = r));
    this.gates.push({ method, re, used: false, released, hit });
    return { hit: hitP, release };
  }

  /** Fails the next matching request with `status`. */
  failNext(method: string, re: RegExp, status: number, message = 'boom'): void {
    this.failures.push({ method, re, status, message });
  }

  puts(): LogEntry[] {
    return this.log.filter((l) => l.method === 'PUT');
  }
  count(method: string, re: RegExp): number {
    return this.log.filter((l) => l.method === method && re.test(l.path)).length;
  }

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input instanceof Request ? input.url : input), 'http://fake');
    const method = init?.method ?? 'GET';
    const path = url.pathname;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    this.log.push({ method, path, body });
    for (const g of this.gates) {
      if (!g.used && g.method === method && g.re.test(path)) {
        g.used = true;
        g.hit();
        await g.released;
      }
    }
    const fi = this.failures.findIndex((f) => f.method === method && f.re.test(path));
    if (fi >= 0) {
      const f = this.failures.splice(fi, 1)[0];
      return json(f.status, { error: { code: 'failed', message: f.message } });
    }
    return this.handle(method, path, url.searchParams, body);
  };

  private handle(method: string, path: string, query: URLSearchParams, body?: Record<string, unknown>): Response {
    const m = /^\/api\/workspaces\/([^/]+)(?:\/(.*))?$/.exec(path);
    if (!m) return json(404, { error: { code: 'not_found', message: `no route ${path}` } });
    const ws = this.workspaces.get(m[1]);
    if (!ws) return json(404, { error: { code: 'not_found', message: `Workspace '${m[1]}' not found` } });
    const rest = m[2] ?? '';
    const bundle = () => ({ libraryId: ws.libraryId, name: 'Lib', readOnly: false, files: Object.entries(ws.files).map(([p, f]) => ({ path: p, text: f.text })), version: 1 });
    const expDto = (e: FakeExperiment) => ({
      id: e.id,
      className: e.className,
      meta_data: { label: e.label, created_at: e.createdAt },
      run_info: { status: 'done' },
      experiment: { version: 2, base: { model: { modelica: { className: e.className } }, modifiers: { variables: {} }, analysis: { type: 'dynamic', parameters: { start_time: 0, final_time: 1 } } }, extensions: [] },
    });
    const sourceDto = (className: string, f: FakeFile) => ({ className, libraryId: ws.libraryId, file: FILE, text: f.text, readOnly: false, version: f.version });
    let r: RegExpExecArray | null;

    if (rest === '') return json(200, { id: ws.id, definition: { name: ws.id } });
    if (rest === 'projects' || rest === 'dependencies') return json(200, { data: { items: [] } });
    if (rest === 'libraries') return json(200, { data: { items: [bundle()] } });
    if (rest === `libraries/${ws.libraryId}`) return json(200, bundle());
    if ((r = /^classes\/([^/]+)\/source$/.exec(rest))) {
      const className = decodeURIComponent(r[1]);
      const f = className.startsWith('Lib') ? ws.files[FILE] : undefined;
      if (!f) return json(404, { error: { code: 'not_found', message: `Class '${className}' not found` } });
      if (method === 'GET') return json(200, sourceDto(className, f));
      if (method === 'PUT') {
        const version = body?.version as number | undefined;
        if (version !== undefined && version !== f.version) return json(409, { error: { code: 'conflict', message: `Stale version ${version}: at ${f.version}`, details: { currentVersion: f.version } } });
        f.text = String(body?.text);
        f.version++;
        return json(200, sourceDto(className, f));
      }
    }
    if (rest === 'experiments') {
      if (method === 'GET') {
        const cls = query.get('className');
        return json(200, { data: { items: ws.experiments.filter((e) => !cls || e.className === cls).map(expDto) } });
      }
      if (method === 'POST') {
        const def = body as { label: string; experiment: { base: { model: { modelica: { className: string } } } } };
        const exp = this.addExperiment(ws, def.label, def.experiment.base.model.modelica.className);
        return json(201, { experiment_id: exp.id });
      }
    }
    if ((r = /^experiments\/([^/]+)\/cases$/.exec(rest))) {
      const exp = ws.experiments.find((e) => e.id === r![1]);
      if (!exp) return json(404, { error: { code: 'not_found', message: 'no experiment' } });
      return json(200, { data: { items: exp.cases.map((c) => ({ id: c.id, run_info: { status: c.status, datetime_finished: exp.createdAt } })) } });
    }
    if ((r = /^experiments\/([^/]+)\/cases\/([^/]+)\/trajectories$/.exec(rest))) {
      const exp = ws.experiments.find((e) => e.id === r![1]);
      if (!exp) return json(404, { error: { code: 'not_found', message: 'no experiment' } });
      const names = body?.variable_names as string[];
      return json(200, names.map((n) => exp.trajectories[n] ?? []));
    }
    if (/^experiments\/([^/]+)\/cases\/([^/]+)\/log$/.test(rest)) return json(200, { log: 'ok' });
    if (/^experiments\/([^/]+)\/execution$/.test(rest)) return json(200, { status: 'done', progress: 1 });
    if (rest === 'model-executables') return json(201, { id: 'fmu_1', run_info: { status: 'pending' } });
    if (/^model-executables\/[^/]+\/compilation$/.test(rest)) return json(200, { status: 'done', progress: 1 });
    if (/^model-executables\/[^/]+\/compilation\/log$/.test(rest)) return new Response('compiled', { status: 200, headers: { 'content-type': 'text/plain' } });
    if (/^model-executables\/[^/]+$/.test(rest)) return json(200, { id: 'fmu_1', run_info: { status: 'successful' } });
    return json(404, { error: { code: 'not_found', message: `no route ${method} ${path}` } });
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

const initialState = useStore.getState();
let server: FakeServer;

async function load(wid: string): Promise<void> {
  await useStore.getState().loadWorkspace(wid);
  expect(useStore.getState().loadError).toBeUndefined();
  expect(useStore.getState().workspaceId).toBe(wid);
}

const text = (): string => useStore.getState().registry.fileOf('Lib.A')?.text ?? '';
const fk = (wid: string): string => ClassRegistry.fileKey(`lib_${wid}`, FILE);

beforeEach(() => {
  server = new FakeServer();
  vi.stubGlobal('fetch', server.fetch);
  useStore.setState({ ...initialState, registry: new ClassRegistry(), workspaceId: undefined }, true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------------------------

describe('workspace switching', () => {
  it('drops editor, history, run and result state of the previous workspace and never replays its edits', async () => {
    server.addWorkspace('A', [{ label: 'Result1' }]);
    server.addWorkspace('B');
    await load('A');
    const s = useStore.getState();
    s.openClass('Lib.A');
    s.setMode('results');
    s.setView('code');
    expect(await s.applyEdit({ op: 'setParameter', name: 'R', valueText: '2' })).toBeDefined();
    expect(server.file('A').text).toContain('R = 2');
    useStore.setState({ running: { className: 'Lib.A', experimentId: 'x', phase: 'compiling', progress: 0, startedAt: 0 }, codeDraft: 'draft', compilationLog: 'log' });
    s.pushBanner({ severity: 'info', message: 'hello' });
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(useStore.getState().results).toHaveLength(1);

    await load('B');
    const b = useStore.getState();
    expect(b.activeClass).toBeUndefined();
    expect(b.diagram).toBeUndefined();
    expect(b.selection).toEqual([]);
    expect(b.undoStack).toEqual([]);
    expect(b.redoStack).toEqual([]);
    expect(b.codeDraft).toBeUndefined();
    expect(b.running).toBeUndefined();
    expect(b.banners).toEqual([]);
    expect(b.compilationLog).toBe('');
    expect(b.results).toEqual([]);
    expect(b.trajectories).toEqual({});
    expect(b.mode).toBe('model');
    expect(b.view).toBe('diagram');
    expect(b.fileVersions).toEqual({});

    const puts = server.puts().length;
    await b.undo();
    await b.redo();
    expect(server.puts()).toHaveLength(puts);
    expect(server.file('B').text).toBe(FIXTURE);
  });

  it('ignores a results load of the previous workspace that finishes after the switch', async () => {
    server.addWorkspace('A', [{ label: 'A-result' }]);
    server.addWorkspace('B', [{ label: 'B-result' }]);
    const gate = server.gate('GET', /\/workspaces\/A\/experiments$/);
    const loadA = useStore.getState().loadWorkspace('A');
    await gate.hit;
    await load('B');
    gate.release();
    await loadA;
    const s = useStore.getState();
    expect(s.workspaceId).toBe('B');
    expect(s.results.map((r) => r.name)).toEqual(['B-result']);
    expect(s.registry.fileOf('Lib.A')?.libraryId).toBe('lib_B');
    expect(s.loading).toBe(false);
  });

  it('a history entry whose file disappeared is skipped instead of resurrecting the class', async () => {
    server.addWorkspace('A');
    await load('A');
    const s = useStore.getState();
    s.openClass('Lib.A');
    await s.applyEdit({ op: 'setParameter', name: 'R', valueText: '2' });
    useStore.getState().registry.removeFile('lib_A', FILE);
    const puts = server.puts().length;
    await useStore.getState().undo();
    expect(server.puts()).toHaveLength(puts);
    expect(useStore.getState().undoStack).toEqual([]);
    expect(useStore.getState().registry.has('Lib.A')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------

describe('versioned source writes', () => {
  it('sends the server file version with every PUT (validating against the server before the first one)', async () => {
    server.addWorkspace('A');
    await load('A');
    const s = useStore.getState();
    s.openClass('Lib.A');
    await s.applyEdit({ op: 'setParameter', name: 'R', valueText: '2' });
    expect(server.count('GET', /\/classes\/Lib\.A\/source$/)).toBe(1);
    expect(server.puts().map((p) => p.body?.version)).toEqual([1]);
    expect(useStore.getState().fileVersions[fk('A')]).toBe(2);

    await useStore.getState().applyEdit({ op: 'setDescription', description: 'B' });
    expect(server.count('GET', /\/classes\/Lib\.A\/source$/)).toBe(1);
    expect(server.puts().map((p) => p.body?.version)).toEqual([1, 2]);
    expect(server.file('A').version).toBe(3);
    expect(server.file('A').text).toContain('"B"');
    expect(server.file('A').text).toContain('R = 2');

    const res = await useStore.getState().saveClassSource('Lib.A', FIXTURE);
    expect(res.ok).toBe(true);
    expect(server.puts().map((p) => p.body?.version)).toEqual([1, 2, 3]);
    expect(text()).toBe(FIXTURE);
  });

  it('on 409 reloads the server text, drops the file history and shows a banner instead of overwriting', async () => {
    server.addWorkspace('A');
    await load('A');
    const s = useStore.getState();
    s.openClass('Lib.A');
    await s.applyEdit({ op: 'setParameter', name: 'R', valueText: '2' });
    const other = FIXTURE.replace('R = 1', 'R = 100');
    server.changeElsewhere('A', other);

    const result = await useStore.getState().applyEdit({ op: 'setDescription', description: 'mine' });
    expect(result).toBeUndefined();
    const st = useStore.getState();
    expect(server.file('A').text).toBe(other);
    expect(text()).toBe(other);
    expect(st.undoStack).toEqual([]);
    expect(st.redoStack).toEqual([]);
    expect(st.fileVersions[fk('A')]).toBe(server.file('A').version);
    expect(st.banners.map((b) => b.message)).toEqual([expect.stringMatching(/^The file was changed elsewhere; reloaded/)]);
    expect(st.diagram?.className).toBe('Lib.A');
  });

  it('detects a change made before the first write of a file (no version known yet) and does not PUT', async () => {
    server.addWorkspace('A');
    await load('A');
    const other = FIXTURE.replace('R = 1', 'R = 7');
    server.changeElsewhere('A', other);
    useStore.getState().openClass('Lib.A');
    await useStore.getState().applyEdit({ op: 'setParameter', name: 'R', valueText: '2' });
    expect(server.puts()).toHaveLength(0);
    expect(text()).toBe(other);
    expect(useStore.getState().banners[0]?.message).toMatch(/changed elsewhere; reloaded/);

    const res = await useStore.getState().saveClassSource('Lib.A', FIXTURE);
    expect(res.ok).toBe(true);
    expect(server.file('A').text).toBe(FIXTURE);
  });

  it('serialises concurrent writes of one file and chains their versions', async () => {
    server.addWorkspace('A');
    await load('A');
    useStore.getState().openClass('Lib.A');
    const gate = server.gate('PUT', /\/source$/);
    const e1 = useStore.getState().applyEdit({ op: 'setParameter', name: 'R', valueText: '2' });
    const e2 = useStore.getState().applyEdit({ op: 'setDescription', description: 'B' });
    await gate.hit;
    await settle();
    expect(server.puts()).toHaveLength(1);
    gate.release();
    await Promise.all([e1, e2]);
    expect(server.puts().map((p) => p.body?.version)).toEqual([1, 2]);
    expect(server.file('A').text).toContain('R = 2');
    expect(server.file('A').text).toContain('"B"');
    expect(server.file('A').text).toBe(text());
    expect(useStore.getState().undoStack).toHaveLength(2);
  });

  it('a failed write reverts the edit and the unsent edits queued behind it, keeping client and server equal', async () => {
    server.addWorkspace('A');
    await load('A');
    useStore.getState().openClass('Lib.A');
    server.failNext('PUT', /\/source$/, 500, 'disk full');
    const e1 = useStore.getState().applyEdit({ op: 'setParameter', name: 'R', valueText: '2' });
    const e2 = useStore.getState().applyEdit({ op: 'setDescription', description: 'B' });
    expect(text()).toContain('"B"');
    expect(await e1).toBeUndefined();
    expect(await e2).toBeUndefined();
    expect(server.puts()).toHaveLength(1);
    expect(server.file('A').text).toBe(FIXTURE);
    expect(text()).toBe(FIXTURE);
    expect(useStore.getState().undoStack).toEqual([]);
    expect(useStore.getState().banners.map((b) => b.message)).toEqual([expect.stringMatching(/disk full.*reverted/)]);

    // The file is writable again afterwards.
    expect(await useStore.getState().applyEdit({ op: 'setParameter', name: 'R', valueText: '3' })).toBeDefined();
    expect(server.file('A').text).toContain('R = 3');
  });

  it('a failed write restores the redo history it had cleared', async () => {
    server.addWorkspace('A');
    await load('A');
    useStore.getState().openClass('Lib.A');
    await useStore.getState().applyEdit({ op: 'setParameter', name: 'R', valueText: '2' });
    await useStore.getState().undo();
    expect(useStore.getState().redoStack).toHaveLength(1);
    server.failNext('PUT', /\/source$/, 500);
    await useStore.getState().applyEdit({ op: 'setDescription', description: 'B' });
    expect(useStore.getState().redoStack).toHaveLength(1);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(text()).toBe(FIXTURE);
  });
});

// ---------------------------------------------------------------------------------------------

describe('undo / redo', () => {
  it('reverts the local change and shows a banner when the server rejects the write', async () => {
    server.addWorkspace('A');
    await load('A');
    useStore.getState().openClass('Lib.A');
    await useStore.getState().applyEdit({ op: 'setParameter', name: 'R', valueText: '2' });
    const after = text();

    server.failNext('PUT', /\/source$/, 500, 'server down');
    await useStore.getState().undo();
    let st = useStore.getState();
    expect(text()).toBe(after);
    expect(server.file('A').text).toBe(after);
    expect(st.undoStack).toHaveLength(1);
    expect(st.redoStack).toHaveLength(0);
    expect(st.banners.map((b) => b.message)).toEqual([expect.stringMatching(/Could not undo.*server down/)]);

    await useStore.getState().undo();
    expect(text()).toBe(FIXTURE);
    expect(server.file('A').text).toBe(FIXTURE);
    expect(useStore.getState().redoStack).toHaveLength(1);

    server.failNext('PUT', /\/source$/, 500, 'still down');
    await useStore.getState().redo();
    st = useStore.getState();
    expect(text()).toBe(FIXTURE);
    expect(st.redoStack).toHaveLength(1);
    expect(st.undoStack).toHaveLength(0);
    expect(st.banners.at(-1)?.message).toMatch(/Could not redo.*still down/);
  });

  it('a 404 (class deleted on the server) removes the phantom file and its history', async () => {
    server.addWorkspace('A');
    await load('A');
    useStore.getState().openClass('Lib.A');
    await useStore.getState().applyEdit({ op: 'setParameter', name: 'R', valueText: '2' });
    server.deleteFile('A');
    await useStore.getState().undo();
    const st = useStore.getState();
    expect(st.registry.has('Lib.A')).toBe(false);
    expect(st.undoStack).toEqual([]);
    expect(st.redoStack).toEqual([]);
    expect(st.activeClass).toBeUndefined();
    expect(st.banners.at(-1)?.message).toMatch(/no longer exists/);
  });

  it('a 409 on undo reloads the server text', async () => {
    server.addWorkspace('A');
    await load('A');
    useStore.getState().openClass('Lib.A');
    await useStore.getState().applyEdit({ op: 'setParameter', name: 'R', valueText: '2' });
    const other = FIXTURE.replace('R = 1', 'R = 42');
    server.changeElsewhere('A', other);
    await useStore.getState().undo();
    expect(text()).toBe(other);
    expect(server.file('A').text).toBe(other);
    expect(useStore.getState().undoStack).toEqual([]);
    expect(useStore.getState().banners.at(-1)?.message).toMatch(/changed elsewhere; reloaded/);
  });
});

// ---------------------------------------------------------------------------------------------

describe('trajectories', () => {
  const vars = Array.from({ length: 30 }, (_, i) => `v${i}`);
  const trajectories = (): Record<string, number[]> => {
    const t: Record<string, number[]> = { time: [0, 1], x: [1, 0.5], a: [1, 1], b: [2, 2], c: [3, 3] };
    vars.forEach((v, i) => (t[v] = [i, i + 1]));
    return t;
  };

  it('valueAt() from render paths costs one request per render pass, not one per call', async () => {
    server.addWorkspace('A', [{ label: 'Result1', trajectories: trajectories() }]);
    await load('A');
    const s = useStore.getState();
    s.openClass('Lib.A');
    expect(s.getActiveResult()?.id).toBe('exp_1');
    for (let pass = 0; pass < 5; pass++) for (const v of vars) expect(useStore.getState().valueAt(v)).toBeUndefined();
    expect(pendingTrajectories.size).toBe(31);
    await Promise.all([...pendingTrajectories.values()]);
    await settle();
    const posts = server.log.filter((l) => l.method === 'POST' && /\/trajectories$/.test(l.path));
    expect(posts).toHaveLength(1);
    expect((posts[0].body?.variable_names as string[]).length).toBe(31);
    expect(pendingTrajectories.size).toBe(0);

    useStore.getState().setSliderTime(0.5);
    expect(useStore.getState().valueAt('v3')).toBe(3.5);
    // Re-rendering with everything cached issues nothing.
    for (const v of vars) useStore.getState().valueAt(v);
    await settle();
    expect(server.log.filter((l) => l.method === 'POST' && /\/trajectories$/.test(l.path))).toHaveLength(1);
  });

  it('valueAt(..., { fetch: false }) is a pure read', async () => {
    server.addWorkspace('A', [{ label: 'Result1', trajectories: trajectories() }]);
    await load('A');
    useStore.getState().openClass('Lib.A');
    expect(useStore.getState().valueAt('x', undefined, undefined, { fetch: false })).toBeUndefined();
    await settle();
    expect(server.count('POST', /\/trajectories$/)).toBe(0);
    expect(pendingTrajectories.size).toBe(0);
  });

  it('ensureTrajectories / fetchTrajectories share in-flight requests and resolve to the values', async () => {
    server.addWorkspace('A', [{ label: 'Result1', trajectories: trajectories() }]);
    await load('A');
    const s = useStore.getState();
    const p1 = s.ensureTrajectories('exp_1', 'case_1', ['a', 'b']);
    const p2 = s.fetchTrajectories('exp_1', 'case_1', ['b', 'c']);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(server.count('POST', /\/trajectories$/)).toBe(1);
    expect(r1).toEqual({ a: [1, 1], b: [2, 2] });
    expect(r2).toEqual({ b: [2, 2], c: [3, 3] });
    expect(useStore.getState().trajectories['exp_1/case_1/time']).toEqual([0, 1]);

    // A batch already flushed is not joined; a new variable gets its own (single) request.
    const p3 = s.ensureTrajectories('exp_1', 'case_1', ['x']);
    const p4 = s.ensureTrajectories('exp_1', 'case_1', ['x', 'a']);
    await Promise.all([p3, p4]);
    expect(server.count('POST', /\/trajectories$/)).toBe(2);
  });

  it('implicit fetches do not hammer a failing endpoint; explicit fetches retry', async () => {
    server.addWorkspace('A', [{ label: 'Result1', trajectories: trajectories() }]);
    await load('A');
    useStore.getState().openClass('Lib.A');
    server.failNext('POST', /\/trajectories$/, 500);
    useStore.getState().valueAt('x');
    await settle();
    expect(server.count('POST', /\/trajectories$/)).toBe(1);
    for (let i = 0; i < 3; i++) useStore.getState().valueAt('x');
    await settle();
    expect(server.count('POST', /\/trajectories$/)).toBe(1);
    await expect(useStore.getState().fetchTrajectories('exp_1', 'case_1', ['x'])).resolves.toEqual({ x: [1, 0.5] });
    expect(server.count('POST', /\/trajectories$/)).toBe(2);
    expect(useStore.getState().valueAt('x')).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------

describe('result labels', () => {
  it('numbers results above every existing ResultN of the workspace, so deletions never produce duplicates', async () => {
    const ws = server.addWorkspace('A', [{ label: 'Result1' }, { label: 'Result3' }, { label: 'My run' }]);
    await load('A');
    useStore.getState().openClass('Lib.A');
    await useStore.getState().simulate();
    const created = server.log.filter((l) => l.method === 'POST' && /\/experiments$/.test(l.path));
    expect(created.map((c) => c.body?.label)).toEqual(['Result4']);
    expect(useStore.getState().results.map((r) => r.name)).toContain('Result4');
    expect(useStore.getState().running).toBeUndefined();

    ws.experiments = ws.experiments.filter((e) => e.label !== 'Result4');
    await useStore.getState().loadResults();
    await useStore.getState().simulate();
    expect(server.log.filter((l) => l.method === 'POST' && /\/experiments$/.test(l.path)).map((c) => c.body?.label)).toEqual(['Result4', 'Result5']);
  });

  it('starts at Result1 in a fresh workspace', async () => {
    server.addWorkspace('A');
    await load('A');
    useStore.getState().openClass('Lib.A');
    await useStore.getState().simulate();
    expect(server.log.filter((l) => l.method === 'POST' && /\/experiments$/.test(l.path)).map((c) => c.body?.label)).toEqual(['Result1']);
    expect(useStore.getState().getActiveResult()?.name).toBe('Result1');
  });
});

// ---------------------------------------------------------------------------------------------

describe('modifierCaseCount mirrors the server sweep grammar', () => {
  it.each([
    ['range(1, 10, 5)', 5],
    ['range(0,1,5.0)', 5],
    ['RANGE( 0 , 1 , 3 )', 3],
    ['range(0, 1, 1)', 1],
    ['range(0, 1, 0)', 1],
    ['range(0, 1, 2.5)', 1],
    ['range(0, 1)', 1],
    ['range(a, b, 3)', 1],
    ['choices(1, 2, 3)', 3],
    ['choices("a,b", "c")', 2],
    ['choices(f(1,2), 3)', 2],
    ['choices({1,2}, [3,4], 5)', 3],
    ['choices(1)', 1],
    ['choices()', 1],
    ['100', 1],
    ['true', 1],
  ])('%s -> %i cases', (input, expected) => {
    expect(modifierCaseCount(input)).toBe(expected);
  });

  it('splitSweepArgs splits only on top-level commas', () => {
    expect(splitSweepArgs('"a,b", c, (d, e), \'f,g\'')).toEqual(['"a,b"', 'c', '(d, e)', "'f,g'"]);
    expect(splitSweepArgs('')).toEqual([]);
  });
});

describe('decodePathSegment', () => {
  it('decodes valid segments and falls back to the raw text for malformed ones', () => {
    expect(decodePathSegment('ws%201')).toBe('ws 1');
    expect(decodePathSegment('%E0')).toBe('%E0');
    expect(decodePathSegment('abc%2')).toBe('abc%2');
  });
});
