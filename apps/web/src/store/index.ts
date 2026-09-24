/**
 * Zustand store implementing the slices declared in ./types.ts.
 */
import { create } from 'zustand';
import {
  ClassRegistry,
  ModelicaError,
  applyEdit as coreApplyEdit,
  buildDiagramView,
  flatRef,
} from '@impact/core';
import type { Diagnostic, DiagramView, EditOperation, EditResult, Point } from '@impact/core';
import type { CaseDto, ClassSourceDto, CreateExperimentRequest, ExperimentDto } from '@impact/protocol';
import { api, ApiClientError } from '../api/client';
import type {
  AnalysisSettings,
  AppSettings,
  AppState,
  Experiment,
  ExecutionSettings,
  HistoryEntry,
  Mode,
  PlotTrace,
  PlotWindow,
  ResultEntry,
  ResultStatus,
  SavedView,
  Sticky,
  Viewport,
} from './types';

void flatRef;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

let idCounter = 0;
export const uid = (prefix = 'id'): string => `${prefix}_${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export const PLOT_PALETTE = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'];

export const DEFAULT_EXECUTION_SETTINGS: ExecutionSettings = {
  compiler: { c_compiler: 'gcc', generate_html_diagnostics: false, include_protected_variables: false, filter_warnings: false },
  runtime: { log_level: 3 },
  simulation: { ncp: 500, dynamic_diagnostics: false, store_event_points: true },
  solver: { rtol: 1e-6, atol: 1e-6 },
};

export const DEFAULT_ANALYSIS: AnalysisSettings = {
  type: 'dynamic',
  startTime: 0,
  stopTime: 1,
  interval: 0.002,
  useInterval: false,
  solver: 'CVode',
  tolerance: 1e-6,
  stepSize: 0.01,
  advanced: DEFAULT_EXECUTION_SETTINGS,
};

export const DEFAULT_SETTINGS: AppSettings = {
  showGrid: false,
  snapping: false,
  darkMode: false,
  excludeCanvasFromDark: true,
  autoPropagate: true,
  csvDecimalSeparator: '.',
  showDisplayUnits: true,
};

export function pointsOf(a: AnalysisSettings): number {
  const span = a.stopTime - a.startTime;
  return a.interval > 0 ? Math.max(1, Math.round(span / a.interval)) : 500;
}

// The sweep grammar below mirrors the server's expansion (apps/server/src/cases.ts: parseSweep /
// splitArgs) so the "N cases" chips agree with the number of cases a run actually creates.
const RANGE_RE = /^\s*range\s*\((.*)\)\s*$/is;
const CHOICES_RE = /^\s*choices\s*\((.*)\)\s*$/is;

/** Splits on commas that are not inside quotes or brackets (same rules as the server). */
export function splitSweepArgs(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let cur = '';
  for (const ch of text) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      cur += ch;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      cur += ch;
    } else if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim() !== '' || out.length) out.push(cur);
  return out.map((t) => t.trim()).filter((t) => t !== '');
}

/**
 * Number of cases a modifier text expands to: `range(start, end, n)` -> n (any finite
 * integer-valued number >= 1), `choices(v1, v2, …)` -> number of values. Anything else — including
 * malformed sweeps, which the server rejects with 400 — counts as a single case.
 */
export function modifierCaseCount(text: string): number {
  const range = RANGE_RE.exec(text);
  if (range) {
    const args = splitSweepArgs(range[1]);
    if (args.length !== 3) return 1;
    const [a, b, n] = args.map((t) => Number(t));
    if (![a, b, n].every(Number.isFinite) || !Number.isInteger(n) || n < 1) return 1;
    return n;
  }
  const choices = CHOICES_RE.exec(text);
  if (choices) return Math.max(1, splitSweepArgs(choices[1]).length);
  return 1;
}

function persistKey(wid: string): string {
  return `impact-clone:${wid}`;
}

interface Persisted {
  experiments: Experiment[];
  activeExperiment: Record<string, string>;
  plots: Record<string, PlotWindow[]>;
  stickies: Record<string, Sticky[]>;
  views: Record<string, SavedView[]>;
  viewports: Record<string, Viewport>;
  favorites: Record<string, string[]>;
  plotCounter: number;
  resultNames: Record<string, string>;
  resultCounter?: number;
}

function loadPersisted(wid: string): Partial<Persisted> {
  try {
    const raw = localStorage.getItem(persistKey(wid));
    return raw ? (JSON.parse(raw) as Partial<Persisted>) : {};
  } catch {
    return {};
  }
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem('impact-clone:settings');
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function applyTheme(s: AppSettings): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = s.darkMode ? 'dark' : 'light';
  document.documentElement.dataset.darkCanvas = s.darkMode && !s.excludeCanvasFromDark ? 'true' : 'false';
}

function resultStatus(exp: ExperimentDto, cases: CaseDto[]): ResultStatus {
  const st = exp.run_info.status;
  if (st === 'running' || st === 'pending') return 'running';
  if (st === 'cancelled') return 'cancelled';
  const failed = cases.filter((c) => c.run_info.status === 'failed').length;
  const ok = cases.filter((c) => c.run_info.status === 'successful').length;
  if (failed && ok) return 'partial';
  if (failed) return 'failed';
  if (cases.some((c) => c.run_info.status === 'cancelled')) return 'cancelled';
  return ok ? 'successful' : 'failed';
}

function diagnosticsOf(e: unknown): Diagnostic[] {
  if (e instanceof ApiClientError) return e.diagnostics.length ? e.diagnostics : [{ severity: 'error', message: e.message }];
  if (e instanceof ModelicaError) return e.diagnostics;
  return [{ severity: 'error', message: e instanceof Error ? e.message : String(e) }];
}

export function analysisToRequest(exp: Experiment): CreateExperimentRequest {
  const a = exp.analysis;
  const ncp = pointsOf(a);
  const variables: Record<string, number | string | boolean> = {};
  for (const [k, v] of Object.entries(exp.modifiers)) {
    const n = Number(v);
    variables[k] = v.trim() === '' ? '' : Number.isFinite(n) && /^[-+.\deE]+$/.test(v.trim()) ? n : v === 'true' ? true : v === 'false' ? false : v;
  }
  return {
    label: exp.name,
    experiment: {
      version: 2,
      base: {
        model: {
          modelica: {
            className: exp.className,
            compilerOptions: { ...a.advanced.compiler },
            runtimeOptions: { ...a.advanced.runtime },
            compilerLogLevel: 'warning',
            fmiTarget: 'me',
            fmiVersion: '2.0',
            platform: 'auto',
          },
        },
        modifiers: { variables },
        analysis: {
          type: a.type,
          parameters: a.type === 'dynamic' ? { start_time: a.startTime, final_time: a.stopTime } : { start_time: a.startTime },
          simulationOptions: { ncp, dynamic_diagnostics: a.advanced.simulation.dynamic_diagnostics, store_event_points: a.advanced.simulation.store_event_points },
          solverOptions: {
            solver: a.solver,
            rtol: a.tolerance,
            atol: a.advanced.solver.atol,
            ...(a.solver === 'ExplicitEuler' ? { step_size: a.stepSize } : {}),
          },
          simulationLogLevel: 'WARNING',
        },
      },
      extensions: [],
    },
  };
}

// ---------------------------------------------------------------------------
// shared trajectory requests
// ---------------------------------------------------------------------------

const TRAJECTORY_CHUNK = 200;
/** How long a failed trajectory request keeps render-path (implicit) fetches from retrying it. */
const FAILED_TRAJECTORY_RETRY_MS = 15_000;
/** In-flight trajectory requests keyed `${resultId}/${caseId}/${variable}`; concurrent callers share one request. */
export const pendingTrajectories = new Map<string, Promise<void>>();
/** Variables collected per `${resultId}/${caseId}` for the next request; flushed in a microtask so one render pass costs one request. */
const trajectoryBatches = new Map<string, { variables: Set<string>; promise: Promise<void> }>();
/** Keys whose last request failed -> failure time. */
const failedTrajectories = new Map<string, number>();

const trajectoryKey = (resultId: string, caseId: string, variable: string): string => `${resultId}/${caseId}/${variable}`;

/** Slices that belong to one workspace and must not leak into the next (editor, history, run, results, logs, banners). */
function workspaceScopedReset(detailsTab: string): Partial<AppState> {
  return {
    activeClass: undefined,
    mode: 'model',
    view: 'diagram',
    selection: [],
    selectedConnection: undefined,
    diagram: undefined,
    diagramError: undefined,
    undoStack: [],
    redoStack: [],
    codeDraft: undefined,
    detailsTab: ['PROPERTIES', 'INFORMATION', 'COMPONENTS'].includes(detailsTab) ? detailsTab : 'PROPERTIES',
    running: undefined,
    results: [],
    activeResult: {},
    compilationLog: '',
    simulationLog: '',
    logOpen: false,
    logHasErrors: false,
    banners: [],
    trajectories: {},
    resultVariables: {},
    sliderTime: 0,
    sliderPlaying: false,
    caseIndex: 0,
    fileVersions: {},
  };
}

const RESULT_LABEL_RE = /^Result(\d+)$/;

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------

export const useStore = create<AppState>()((set, get) => {
  const persist = () => {
    const s = get();
    if (!s.workspaceId) return;
    const data: Persisted = {
      experiments: s.experiments,
      activeExperiment: s.activeExperiment,
      plots: s.plots,
      stickies: s.stickies,
      views: s.views,
      viewports: s.viewports,
      favorites: s.favorites,
      plotCounter: s.plotCounter,
      resultNames: {},
      resultCounter: s.resultCounter,
    };
    try {
      localStorage.setItem(persistKey(s.workspaceId), JSON.stringify(data));
    } catch {
      /* ignore quota errors */
    }
  };

  const computeDiagram = (className: string | undefined): { diagram?: DiagramView; diagramError?: string } => {
    if (!className) return { diagram: undefined, diagramError: undefined };
    try {
      return { diagram: buildDiagramView(get().registry, className), diagramError: undefined };
    } catch (e) {
      return { diagram: undefined, diagramError: e instanceof Error ? e.message : String(e) };
    }
  };

  const fileKeyOf = (className: string): { libraryId: string; path: string } | undefined => {
    const f = get().registry.fileOf(className);
    return f ? { libraryId: f.libraryId, path: f.path } : undefined;
  };
  type FileKey = { libraryId: string; path: string };
  const fkOf = (f: FileKey): string => ClassRegistry.fileKey(f.libraryId, f.path);

  const setFileVersion = (fk: string, version: number | undefined) => {
    const fileVersions = { ...get().fileVersions };
    if (version === undefined) delete fileVersions[fk];
    else fileVersions[fk] = version;
    set({ fileVersions });
  };

  const setFileDiagnostics = (fk: string, diags: Diagnostic[]) => {
    const fd = { ...get().fileDiagnostics };
    if (diags.length) fd[fk] = diags;
    else delete fd[fk];
    set({ fileDiagnostics: fd });
  };

  // ---- serialised, versioned source writes -------------------------------------------------
  /** Tail of the write queue per file key: full-file PUTs of one file reach the server strictly in order. */
  const writeChains = new Map<string, Promise<unknown>>();
  /** Generation per file key; bumped when a write fails so writes queued on top of the discarded text are dropped. */
  const fileGenerations = new Map<string, number>();
  const genOf = (fk: string): number => fileGenerations.get(fk) ?? 0;
  const bumpGen = (fk: string): void => void fileGenerations.set(fk, genOf(fk) + 1);

  type WriteOutcome = { ok: true; skipped: false; version: number; text: string } | { ok: false; skipped: true } | { ok: false; skipped: false; error: unknown };
  const statusOf = (e: unknown): number | undefined => (e instanceof ApiClientError ? e.status : undefined);

  /**
   * Queues a full-file PUT of `text` for the file declaring `className`. The server's file version is
   * sent along: it is known from an earlier response, or fetched first — in which case the server text
   * must still equal `baseText` (the text the change was computed from), otherwise the write is treated
   * as a 409. Never throws; the outcome says whether the write succeeded, failed or was dropped because
   * the workspace changed or an earlier write of the file failed.
   */
  const writeSource = (wid: string, className: string, key: FileKey, text: string, baseText: string): Promise<WriteOutcome> => {
    const fk = fkOf(key);
    const gen = genOf(fk);
    const job = async (): Promise<WriteOutcome> => {
      if (get().workspaceId !== wid || genOf(fk) !== gen) return { ok: false, skipped: true };
      try {
        let version = get().fileVersions[fk];
        if (version === undefined) {
          const dto = await api.getClassSource(wid, className);
          if (dto.text !== baseText) throw new ApiClientError(409, { error: { code: 'conflict', message: `'${key.path}' was changed on the server` } }, 'conflict');
          version = dto.version;
        }
        const res = await api.updateClassSource(wid, className, { text, version });
        if (get().workspaceId === wid) setFileVersion(fk, res.version);
        return { ok: true, skipped: false, version: res.version, text: res.text };
      } catch (error) {
        bumpGen(fk);
        return { ok: false, skipped: false, error };
      }
    };
    const prev = writeChains.get(fk) ?? Promise.resolve();
    const next = prev.then(job, job);
    writeChains.set(fk, next);
    void next.then(() => {
      if (writeChains.get(fk) === next) writeChains.delete(fk);
    });
    return next;
  };

  const dropHistoryOf = (fk: string) => set({ undoStack: get().undoStack.filter((h) => fkOf(h) !== fk), redoStack: get().redoStack.filter((h) => fkOf(h) !== fk) });

  /**
   * Resynchronises a file after the server rejected a write for it (409: changed elsewhere, 404:
   * deleted): the server text replaces the local file (or the file is removed), the file's undo/redo
   * history is dropped (it no longer describes the file) and a banner explains what happened.
   */
  const resyncFile = async (wid: string, className: string, key: FileKey, error: unknown): Promise<void> => {
    const fk = fkOf(key);
    let gone = statusOf(error) === 404;
    let dto: ClassSourceDto | undefined;
    if (!gone) {
      try {
        dto = await api.getClassSource(wid, className);
      } catch (e) {
        if (statusOf(e) === 404) gone = true;
      }
    }
    if (get().workspaceId !== wid) return;
    const registry = get().registry;
    if (dto) {
      setFileDiagnostics(fk, registry.addFile(dto.libraryId, dto.file, dto.text));
      setFileVersion(fk, dto.version);
    } else if (gone) {
      registry.removeFile(key.libraryId, key.path);
      setFileDiagnostics(fk, []);
      setFileVersion(fk, undefined);
    } else {
      // Could not reload either: forget the version so the next write re-validates against the server.
      setFileVersion(fk, undefined);
    }
    dropHistoryOf(fk);
    const active = get().activeClass;
    set({ registryVersion: get().registryVersion + 1, activeClass: active && !registry.has(active) ? undefined : active });
    set(computeDiagram(get().activeClass));
    const reason = diagnosticsOf(error)[0]?.message ?? 'unknown error';
    const message = gone
      ? `${className} no longer exists on the server; it was removed from the workspace.`
      : dto
        ? `The file was changed elsewhere; reloaded ${key.path} from the server. Your last change was not saved.`
        : `Saving ${className} failed (${reason}) and the file could not be reloaded from the server.`;
    get().pushBanner({ severity: gone ? 'warning' : 'error', message, className });
  };

  /**
   * Reverts an optimistic edit whose write failed for a reason other than a conflict: the file goes
   * back to the text before the edit, and the edit plus every later (unsent, now dropped) edit of the
   * same file leave the history. The redo history cleared by the edit is restored when nothing was
   * edited since.
   */
  const revertFailedEdit = (entry: HistoryEntry, prevRedo: HistoryEntry[], error: unknown): void => {
    const fk = fkOf(entry);
    const stack = get().undoStack;
    const idx = stack.indexOf(entry);
    if (idx < 0) return; // already handled (e.g. by a resync)
    const dropped = new Set(stack.slice(idx).filter((h) => fkOf(h) === fk));
    get().registry.addFile(entry.libraryId, entry.path, entry.before);
    set({
      registryVersion: get().registryVersion + 1,
      undoStack: stack.filter((h) => !dropped.has(h)),
      redoStack: idx === stack.length - 1 ? prevRedo : get().redoStack.filter((h) => fkOf(h) !== fk),
    });
    set(computeDiagram(get().activeClass));
    for (const d of diagnosticsOf(error)) get().pushBanner({ severity: 'error', message: `Saving ${entry.className} failed: ${d.message} The change was reverted.`, loc: d.loc, className: entry.className });
  };

  /** Failure path shared by undo()/redo(): conflicts resync the file, anything else puts text and history back. */
  const recoverHistoryWrite = async (wid: string, entry: HistoryEntry, previousText: string, direction: 'undo' | 'redo', prevUndo: HistoryEntry[], prevRedo: HistoryEntry[], error: unknown): Promise<void> => {
    const key = { libraryId: entry.libraryId, path: entry.path };
    const status = statusOf(error);
    if (status === 409 || status === 404) return resyncFile(wid, entry.className, key, error);
    const fk = fkOf(key);
    get().registry.addFile(key.libraryId, key.path, previousText);
    // Entries of this file added while the write was pending were built on the reverted text: drop them.
    const keep = (h: HistoryEntry, before: HistoryEntry[]) => fkOf(h) !== fk || before.includes(h);
    if (direction === 'undo') {
      set({ undoStack: [...get().undoStack.filter((h) => h !== entry && keep(h, prevUndo)), entry], redoStack: get().redoStack.filter((h) => h !== entry && keep(h, prevRedo)) });
    } else {
      set({ redoStack: [...get().redoStack.filter((h) => h !== entry && keep(h, prevRedo)), entry], undoStack: get().undoStack.filter((h) => h !== entry && keep(h, prevUndo)) });
    }
    set({ registryVersion: get().registryVersion + 1 });
    set(computeDiagram(get().activeClass));
    const reason = diagnosticsOf(error)[0]?.message ?? 'unknown error';
    get().pushBanner({ severity: 'error', message: `Could not ${direction} the last change of ${entry.className}: ${reason}`, className: entry.className });
  };

  /** Issues one request for a batch of variables and caches the result; shared by all callers waiting on it. */
  const requestTrajectories = async (wid: string, resultId: string, caseId: string, names: string[]): Promise<void> => {
    try {
      const chunks: string[][] = [];
      for (let i = 0; i < names.length; i += TRAJECTORY_CHUNK) chunks.push(names.slice(i, i + TRAJECTORY_CHUNK));
      const data = await Promise.all(chunks.map((chunk) => api.getCaseTrajectories(wid, resultId, caseId, { variable_names: chunk })));
      if (get().workspaceId !== wid) return;
      const patch: Record<string, number[]> = {};
      chunks.forEach((chunk, ci) => chunk.forEach((v, i) => (patch[trajectoryKey(resultId, caseId, v)] = data[ci][i] ?? [])));
      set({ trajectories: { ...get().trajectories, ...patch } });
    } catch (e) {
      const now = Date.now();
      for (const v of names) failedTrajectories.set(trajectoryKey(resultId, caseId, v), now);
      throw e;
    } finally {
      for (const v of names) pendingTrajectories.delete(trajectoryKey(resultId, caseId, v));
    }
  };

  /**
   * `Result${n}`: n is one above every `ResultN` the workspace already has (server list, so other
   * clients count too) and above every number handed out before (persisted), which keeps names unique
   * and monotonic even after results were deleted. Impact numbers results per workspace.
   */
  const nextResultLabel = async (wid: string): Promise<string> => {
    const labels = await api.listExperiments(wid).then(
      (r) => r.data.items.map((e) => e.meta_data.label),
      () => get().results.map((r) => r.name),
    );
    let max = get().resultCounter;
    for (const label of labels) {
      const m = RESULT_LABEL_RE.exec(label);
      if (m) max = Math.max(max, Number(m[1]));
    }
    const n = max + 1;
    set({ resultCounter: n });
    persist();
    return `Result${n}`;
  };

  const settings = loadSettings();
  applyTheme(settings);

  return {
    // ---------------------------------------------------------------- workspace
    workspaceId: undefined,
    workspace: undefined,
    projects: [],
    dependencies: [],
    libraries: [],
    registry: new ClassRegistry(),
    registryVersion: 0,
    fileDiagnostics: {},
    fileVersions: {},
    loading: false,
    loadError: undefined,

    async loadWorkspace(wid) {
      // Everything scoped to the previous workspace (open class, history, running job, results, banners…)
      // is dropped before the new one loads, so e.g. Ctrl+Z can never replay another workspace's edit.
      const switching = get().workspaceId !== wid;
      set({ loading: true, loadError: undefined, workspaceId: wid, ...(switching ? workspaceScopedReset(get().detailsTab) : {}) });
      if (switching) failedTrajectories.clear();
      try {
        const [ws, projects, deps, libs] = await Promise.all([api.getWorkspace(wid), api.listProjects(wid), api.listDependencies(wid), api.listLibraries(wid)]);
        const registry = new ClassRegistry();
        const fileDiagnostics: Record<string, Diagnostic[]> = {};
        for (const lib of libs.data.items) {
          registry.addLibrary({ id: lib.libraryId, name: lib.name, readOnly: lib.readOnly });
          const files = [...lib.files].sort((a, b) => {
            const ap = a.path.endsWith('package.mo') ? 0 : 1;
            const bp = b.path.endsWith('package.mo') ? 0 : 1;
            return ap - bp || a.path.localeCompare(b.path);
          });
          for (const f of files) {
            const diags = registry.addFile(lib.libraryId, f.path, f.text);
            if (diags.length) fileDiagnostics[ClassRegistry.fileKey(lib.libraryId, f.path)] = diags;
          }
        }
        const persisted = loadPersisted(wid);
        if (get().workspaceId !== wid) return; // another workspace was opened meanwhile
        set({
          workspace: ws,
          projects: projects.data.items,
          dependencies: deps.data.items,
          libraries: libs.data.items,
          registry,
          registryVersion: get().registryVersion + 1,
          fileDiagnostics,
          loading: false,
          experiments: persisted.experiments ?? [],
          activeExperiment: persisted.activeExperiment ?? {},
          plots: persisted.plots ?? {},
          stickies: persisted.stickies ?? {},
          views: persisted.views ?? {},
          viewports: persisted.viewports ?? {},
          favorites: persisted.favorites ?? {},
          plotCounter: persisted.plotCounter ?? 0,
          resultCounter: persisted.resultCounter ?? 0,
          results: [],
          activeResult: {},
          trajectories: {},
          resultVariables: {},
          fileVersions: {},
        });
        await get().loadResults();
      } catch (e) {
        if (get().workspaceId !== wid) return;
        set({ loading: false, loadError: e instanceof Error ? e.message : String(e) });
      }
    },

    async saveClassSource(className, text) {
      const wid = get().workspaceId;
      const key = fileKeyOf(className);
      if (!wid || !key) return { ok: false, diagnostics: [{ severity: 'error', message: `Unknown class ${className}` }] };
      const registry = get().registry;
      const base = registry.getFile(key.libraryId, key.path)?.text ?? '';
      const outcome = await writeSource(wid, className, key, text, base);
      if (outcome.skipped) return { ok: false, diagnostics: [{ severity: 'error', message: `${className} was reloaded while saving; please save again.` }] };
      if (!outcome.ok) {
        const status = statusOf(outcome.error);
        if (status === 409 || status === 404) {
          await resyncFile(wid, className, key, outcome.error);
          const message = status === 404 ? `${className} no longer exists on the server.` : 'The file was changed elsewhere; reloaded from the server. Please re-apply your change.';
          return { ok: false, diagnostics: [{ severity: 'error', message }] };
        }
        return { ok: false, diagnostics: diagnosticsOf(outcome.error) };
      }
      if (get().workspaceId !== wid) return { ok: true, diagnostics: [] };
      setFileDiagnostics(fkOf(key), registry.addFile(key.libraryId, key.path, outcome.text));
      set({ registryVersion: get().registryVersion + 1, codeDraft: undefined });
      set(computeDiagram(get().activeClass));
      return { ok: true, diagnostics: [] };
    },

    async createClass(req) {
      const wid = get().workspaceId;
      if (!wid) throw new Error('No workspace');
      const res = await api.createClass(wid, req);
      if (get().workspaceId !== wid) return req.className;
      const registry = get().registry;
      registry.addFile(res.libraryId, res.file, res.text);
      setFileVersion(fkOf({ libraryId: res.libraryId, path: res.file }), res.version);
      // refresh library bundle list lazily
      set({ registryVersion: get().registryVersion + 1 });
      return req.className;
    },

    async deleteClass(className) {
      const wid = get().workspaceId;
      const key = fileKeyOf(className);
      if (!wid || !key) return;
      await api.deleteClass(wid, className);
      // Reload the library bundle that changed.
      const lib = await api.getLibrary(wid, key.libraryId);
      if (get().workspaceId !== wid) return;
      const registry = get().registry;
      registry.removeLibrary(key.libraryId);
      registry.addLibrary({ id: lib.libraryId, name: lib.name, readOnly: lib.readOnly });
      for (const f of lib.files) registry.addFile(lib.libraryId, f.path, f.text);
      const active = get().activeClass;
      // Bundles carry no per-file versions: forget the library's versions (re-validated on the next write)
      // and drop history entries of files that are gone, so undo cannot resurrect a deleted class.
      const prefix = ClassRegistry.fileKey(key.libraryId, '');
      const fileVersions = Object.fromEntries(Object.entries(get().fileVersions).filter(([k]) => !k.startsWith(prefix)));
      const exists = (h: HistoryEntry) => registry.getFile(h.libraryId, h.path) !== undefined;
      set({
        registryVersion: get().registryVersion + 1,
        fileVersions,
        undoStack: get().undoStack.filter(exists),
        redoStack: get().redoStack.filter(exists),
        activeClass: active === className || active?.startsWith(`${className}.`) ? undefined : active,
      });
      set(computeDiagram(get().activeClass));
    },

    getClassText(className) {
      return get().registry.fileOf(className)?.text;
    },

    isReadOnly(className) {
      return get().registry.isReadOnly(className);
    },

    // ---------------------------------------------------------------- editor
    activeClass: undefined,
    mode: 'model',
    view: 'diagram',
    selection: [],
    selectedConnection: undefined,
    diagram: undefined,
    diagramError: undefined,
    undoStack: [],
    redoStack: [],
    detailsOpen: true,
    detailsTab: 'PROPERTIES',
    workspacePanelOpen: true,
    codeDraft: undefined,

    openClass(className) {
      if (get().activeClass === className) return;
      set({ activeClass: className, selection: [], selectedConnection: undefined, codeDraft: undefined, banners: [] });
      set(computeDiagram(className));
      get().ensureExperiment(className);
      const results = get().getResultsFor(className);
      if (results.length && !get().activeResult[className]) get().setActiveResult(className, results[0].id);
    },

    setMode(mode: Mode) {
      const tabsByMode: Record<Mode, string[]> = {
        model: ['PROPERTIES', 'INFORMATION', 'COMPONENTS'],
        experiment: ['PROPERTIES', 'COMPONENTS', 'EXPERIMENT'],
        results: ['PROPERTIES', 'SIMULATIONS', 'CALCULATED VALUES'],
      };
      const tab = tabsByMode[mode].includes(get().detailsTab) ? get().detailsTab : tabsByMode[mode][mode === 'model' ? 0 : mode === 'experiment' ? 2 : 2];
      set({ mode, detailsTab: tab });
    },

    setView(view) {
      set({ view });
    },

    select(names, connection) {
      set({ selection: names, selectedConnection: connection });
    },

    setDetailsOpen(open) {
      set({ detailsOpen: open });
    },

    setDetailsTab(tab) {
      set({ detailsTab: tab, detailsOpen: true });
    },

    setWorkspacePanelOpen(open) {
      set({ workspacePanelOpen: open });
    },

    setCodeDraft(text) {
      set({ codeDraft: text });
    },

    async applyEdit(op, className) {
      const target = className ?? get().activeClass;
      const wid = get().workspaceId;
      if (!target || !wid) return undefined;
      const registry = get().registry;
      const key = fileKeyOf(target);
      if (!key) return undefined;
      if (registry.isReadOnly(target)) {
        get().pushBanner({ severity: 'warning', message: `${target} belongs to a read-only library and cannot be edited.` });
        return undefined;
      }
      const before = registry.getFile(key.libraryId, key.path)?.text ?? '';
      let result: EditResult;
      try {
        result = coreApplyEdit(registry, target, op);
      } catch (e) {
        get().pushBanner({ severity: 'error', message: e instanceof Error ? e.message : String(e), className: target });
        return undefined;
      }
      if (result.diagnostics.some((d) => d.severity === 'error')) {
        for (const d of result.diagnostics) get().pushBanner({ severity: d.severity, message: d.message, loc: d.loc, className: target });
        return result;
      }
      // optimistic local update; the write is queued behind earlier writes of the same file
      registry.addFile(key.libraryId, key.path, result.text);
      const entry: HistoryEntry = { workspaceId: wid, ...key, before, after: result.text, className: target };
      const prevRedo = get().redoStack;
      set({ registryVersion: get().registryVersion + 1, undoStack: [...get().undoStack, entry].slice(-100), redoStack: [] });
      set(computeDiagram(get().activeClass));
      const outcome = await writeSource(wid, target, key, result.text, before);
      if (outcome.ok) return result;
      if (outcome.skipped || get().workspaceId !== wid) return undefined; // dropped: an earlier write of the file failed and reverted/reloaded it
      const status = statusOf(outcome.error);
      if (status === 409 || status === 404) await resyncFile(wid, target, key, outcome.error);
      else revertFailedEdit(entry, prevRedo, outcome.error);
      return undefined;
    },

    async undo() {
      const wid = get().workspaceId;
      if (!wid) return;
      const registry = get().registry;
      // Entries made in another workspace or for files that no longer exist are not replayable: drop them.
      const usable = (h: HistoryEntry) => h.workspaceId === wid && registry.getFile(h.libraryId, h.path) !== undefined;
      let stack = get().undoStack;
      while (stack.length && !usable(stack[stack.length - 1])) stack = stack.slice(0, -1);
      const entry = stack[stack.length - 1];
      if (!entry) {
        if (stack.length !== get().undoStack.length) set({ undoStack: stack });
        return;
      }
      const key = { libraryId: entry.libraryId, path: entry.path };
      const current = registry.getFile(key.libraryId, key.path)!.text;
      const prevUndo = get().undoStack;
      const prevRedo = get().redoStack;
      registry.addFile(key.libraryId, key.path, entry.before);
      set({ undoStack: stack.slice(0, -1), redoStack: [...prevRedo, entry], registryVersion: get().registryVersion + 1 });
      set(computeDiagram(get().activeClass));
      const outcome = await writeSource(wid, entry.className, key, entry.before, current);
      if (outcome.ok || outcome.skipped || get().workspaceId !== wid) return;
      await recoverHistoryWrite(wid, entry, current, 'undo', prevUndo, prevRedo, outcome.error);
    },

    async redo() {
      const wid = get().workspaceId;
      if (!wid) return;
      const registry = get().registry;
      const usable = (h: HistoryEntry) => h.workspaceId === wid && registry.getFile(h.libraryId, h.path) !== undefined;
      let stack = get().redoStack;
      while (stack.length && !usable(stack[stack.length - 1])) stack = stack.slice(0, -1);
      const entry = stack[stack.length - 1];
      if (!entry) {
        if (stack.length !== get().redoStack.length) set({ redoStack: stack });
        return;
      }
      const key = { libraryId: entry.libraryId, path: entry.path };
      const current = registry.getFile(key.libraryId, key.path)!.text;
      const prevUndo = get().undoStack;
      const prevRedo = get().redoStack;
      registry.addFile(key.libraryId, key.path, entry.after);
      set({ redoStack: stack.slice(0, -1), undoStack: [...prevUndo, entry], registryVersion: get().registryVersion + 1 });
      set(computeDiagram(get().activeClass));
      const outcome = await writeSource(wid, entry.className, key, entry.after, current);
      if (outcome.ok || outcome.skipped || get().workspaceId !== wid) return;
      await recoverHistoryWrite(wid, entry, current, 'redo', prevUndo, prevRedo, outcome.error);
    },

    refreshDiagram() {
      set(computeDiagram(get().activeClass));
    },

    // ---------------------------------------------------------------- experiments
    experiments: [],
    activeExperiment: {},

    getExperimentsFor(className) {
      return get().experiments.filter((e) => e.className === className);
    },

    getActiveExperiment(className) {
      const cls = className ?? get().activeClass;
      if (!cls) return undefined;
      const id = get().activeExperiment[cls];
      return get().experiments.find((e) => e.id === id) ?? get().experiments.find((e) => e.className === cls);
    },

    ensureExperiment(className) {
      const existing = get().getActiveExperiment(className);
      if (existing) {
        if (get().activeExperiment[className] !== existing.id) set({ activeExperiment: { ...get().activeExperiment, [className]: existing.id } });
        return existing;
      }
      // A "virtual" experiment so that a model can be simulated immediately.
      const exp = get().createExperiment(className, 'Experiment 1');
      // Honour the class's experiment annotation if present.
      try {
        const cls = get().registry.get(className);
        const stop = cls?.def.annotation?.mods.find((m) => m.name === 'experiment')?.modification.mods.find((m) => m.name === 'StopTime')?.modification.value;
        const start = cls?.def.annotation?.mods.find((m) => m.name === 'experiment')?.modification.mods.find((m) => m.name === 'StartTime')?.modification.value;
        const tol = cls?.def.annotation?.mods.find((m) => m.name === 'experiment')?.modification.mods.find((m) => m.name === 'Tolerance')?.modification.value;
        const interval = cls?.def.annotation?.mods.find((m) => m.name === 'experiment')?.modification.mods.find((m) => m.name === 'Interval')?.modification.value;
        const num = (e: unknown): number | undefined => (e && typeof e === 'object' && (e as { kind: string }).kind === 'number' ? (e as { value: number }).value : undefined);
        const patch: Partial<AnalysisSettings> = {};
        if (num(stop) !== undefined) patch.stopTime = num(stop)!;
        if (num(start) !== undefined) patch.startTime = num(start)!;
        if (num(tol) !== undefined) patch.tolerance = num(tol)!;
        if (num(interval) !== undefined) patch.interval = num(interval)!;
        else if (patch.stopTime !== undefined) patch.interval = (patch.stopTime - (patch.startTime ?? 0)) / 500;
        if (Object.keys(patch).length) get().updateAnalysis(exp.id, patch);
      } catch {
        /* ignore */
      }
      return get().experiments.find((e) => e.id === exp.id) ?? exp;
    },

    createExperiment(className, name) {
      const existing = get().getExperimentsFor(className);
      const exp: Experiment = {
        id: uid('exp'),
        name: name ?? `Experiment ${existing.length + 1}`,
        className,
        createdAt: new Date().toISOString(),
        analysis: { ...DEFAULT_ANALYSIS, advanced: JSON.parse(JSON.stringify(DEFAULT_EXECUTION_SETTINGS)) },
        modifiers: {},
        outputs: [],
      };
      set({ experiments: [...get().experiments, exp], activeExperiment: { ...get().activeExperiment, [className]: exp.id } });
      persist();
      return exp;
    },

    duplicateExperiment(id) {
      const src = get().experiments.find((e) => e.id === id);
      if (!src) return undefined;
      const copy: Experiment = { ...JSON.parse(JSON.stringify(src)), id: uid('exp'), name: `${src.name} copy`, createdAt: new Date().toISOString() };
      set({ experiments: [...get().experiments, copy], activeExperiment: { ...get().activeExperiment, [src.className]: copy.id } });
      persist();
      return copy;
    },

    renameExperiment(id, name) {
      set({ experiments: get().experiments.map((e) => (e.id === id ? { ...e, name } : e)) });
      persist();
    },

    deleteExperiment(id) {
      const exp = get().experiments.find((e) => e.id === id);
      const remaining = get().experiments.filter((e) => e.id !== id);
      const active = { ...get().activeExperiment };
      if (exp && active[exp.className] === id) {
        const next = remaining.find((e) => e.className === exp.className);
        if (next) active[exp.className] = next.id;
        else delete active[exp.className];
      }
      set({ experiments: remaining, activeExperiment: active });
      persist();
    },

    setActiveExperiment(className, id) {
      set({ activeExperiment: { ...get().activeExperiment, [className]: id } });
      persist();
    },

    updateAnalysis(id, patch) {
      set({
        experiments: get().experiments.map((e) => {
          if (e.id !== id) return e;
          const analysis = { ...e.analysis, ...patch };
          if (patch.advanced) analysis.advanced = { ...e.analysis.advanced, ...patch.advanced };
          return { ...e, analysis };
        }),
      });
      persist();
    },

    setModifier(id, name, valueText) {
      set({
        experiments: get().experiments.map((e) => {
          if (e.id !== id) return e;
          const modifiers = { ...e.modifiers };
          if (valueText === null || valueText.trim() === '') delete modifiers[name];
          else modifiers[name] = valueText;
          return { ...e, modifiers };
        }),
      });
      persist();
    },

    addOutputFilter(id, filter) {
      set({ experiments: get().experiments.map((e) => (e.id === id ? { ...e, outputs: [...e.outputs, { ...filter, id: uid('flt') }] } : e)) });
      persist();
    },

    removeOutputFilter(id, filterId) {
      set({ experiments: get().experiments.map((e) => (e.id === id ? { ...e, outputs: e.outputs.filter((f) => f.id !== filterId) } : e)) });
      persist();
    },

    caseCount(id) {
      const exp = get().experiments.find((e) => e.id === id);
      if (!exp) return 1;
      return Object.values(exp.modifiers).reduce((n, v) => n * modifierCaseCount(v), 1);
    },

    // ---------------------------------------------------------------- simulation
    running: undefined,
    results: [],
    activeResult: {},
    compilationLog: '',
    simulationLog: '',
    logOpen: false,
    logTab: 'compilation',
    logHasErrors: false,
    banners: [],
    trajectories: {},
    resultVariables: {},
    sliderTime: 0,
    sliderPlaying: false,
    caseIndex: 0,
    resultCounter: 0,

    async simulate(kind = 'dynamic') {
      const wid = get().workspaceId;
      const className = get().activeClass;
      if (!wid || !className || get().running) return;
      // Once the user opens another workspace this run must not touch the store any more.
      const stale = () => get().workspaceId !== wid;
      const exp = get().ensureExperiment(className);
      const request = analysisToRequest(exp);
      if (kind === 'steady state') request.experiment.base.analysis = { ...request.experiment.base.analysis, type: 'steady state', parameters: { start_time: exp.analysis.startTime } };
      get().clearBanners();
      set({ running: { className, experimentId: exp.id, phase: 'compiling', progress: 0, startedAt: Date.now() }, compilationLog: '', simulationLog: '', logHasErrors: false });
      try {
        // Compilation step (model executable) — surfaces structural errors before simulating.
        const fmu = await api.createModelExecutable(wid, { input: request.experiment.base.model && 'modelica' in request.experiment.base.model ? request.experiment.base.model.modelica : { className } });
        await api.startCompilation(wid, fmu.id);
        let comp = await api.getCompilation(wid, fmu.id);
        while (comp.status !== 'done' && comp.status !== 'cancelled') {
          if (stale()) return;
          if (get().running?.cancelled) {
            set({ running: undefined });
            return;
          }
          await new Promise((r) => setTimeout(r, 150));
          comp = await api.getCompilation(wid, fmu.id);
          if (stale()) return;
          set({ running: { ...get().running!, progress: Math.min(0.3, comp.progress * 0.3) } });
        }
        const compLog = await api.getCompilationLog(wid, fmu.id);
        const fmuInfo = await api.getModelExecutable(wid, fmu.id);
        if (stale()) return;
        set({ compilationLog: typeof compLog === 'string' ? compLog : JSON.stringify(compLog) });
        if (fmuInfo.run_info.status !== 'successful') {
          const errors = fmuInfo.run_info.errors ?? ['Compilation failed'];
          set({ running: undefined, logHasErrors: true });
          get().pushBanner({ severity: 'error', message: `Compilation failed for ${className}: ${errors[0]}`, className, log: 'compilation' });
          get().showLog('compilation', true);
          return;
        }
        if (kind === 'compile') {
          set({ running: undefined });
          get().pushBanner({ severity: 'info', message: `Compilation of ${className} succeeded.` });
          return;
        }
        // Simulation step (experiment execution)
        request.label = await nextResultLabel(wid);
        if (stale()) return;
        const created = await api.createExperiment(wid, request);
        if (stale()) return;
        set({ running: { ...get().running!, phase: 'simulating', serverExperimentId: created.experiment_id, progress: 0.3 } });
        await api.startExecution(wid, created.experiment_id);
        let status = await api.getExecution(wid, created.experiment_id);
        while (status.status !== 'done' && status.status !== 'cancelled') {
          if (stale()) return;
          if (get().running?.cancelled) {
            await api.cancelExecution(wid, created.experiment_id).catch(() => undefined);
          }
          await new Promise((r) => setTimeout(r, 300));
          status = await api.getExecution(wid, created.experiment_id);
          if (stale()) return;
          set({ running: { ...get().running!, progress: 0.3 + 0.7 * status.progress } });
        }
        await get().loadResults();
        if (stale()) return;
        const entry = get().results.find((r) => r.id === created.experiment_id);
        set({ running: undefined });
        if (entry) {
          get().setActiveResult(className, entry.id);
          set({ sliderTime: entry.stopTime, caseIndex: 0 });
          await get().loadCaseLogs(entry.id);
          if (entry.status === 'failed' || entry.status === 'partial') {
            const failedCase = entry.cases.find((c) => c.run_info.status === 'failed');
            const msg = failedCase?.run_info.failures?.[0] ?? 'Simulation failed';
            set({ logHasErrors: true });
            get().pushBanner({ severity: 'error', message: `Simulation of ${className} failed: ${msg}`, className, log: 'simulation' });
            get().showLog('simulation', true);
          }
        }
      } catch (e) {
        if (stale()) return;
        set({ running: undefined, logHasErrors: true });
        for (const d of diagnosticsOf(e)) get().pushBanner({ severity: 'error', message: d.message, loc: d.loc, className, log: 'compilation' });
      }
    },

    async cancelSimulation() {
      const r = get().running;
      const wid = get().workspaceId;
      if (!r || !wid) return;
      set({ running: { ...r, cancelled: true } });
      if (r.serverExperimentId) await api.cancelExecution(wid, r.serverExperimentId).catch(() => undefined);
    },

    async loadResults(className) {
      const wid = get().workspaceId;
      if (!wid) return;
      const list = await api.listExperiments(wid, className);
      const entries: ResultEntry[] = [];
      for (const exp of list.data.items) {
        const cases = (await api.listCases(wid, exp.id).catch(() => ({ data: { items: [] as CaseDto[] } }))).data.items;
        const params = exp.experiment.base.analysis.parameters ?? {};
        entries.push({
          id: exp.id,
          name: exp.meta_data.label,
          className: exp.className,
          createdAt: exp.meta_data.created_at,
          finishedAt: cases.map((c) => c.run_info.datetime_finished).filter(Boolean).sort().pop(),
          status: resultStatus(exp, cases),
          cases,
          experiment: exp,
          startTime: Number(params.start_time ?? 0),
          stopTime: Number(params.final_time ?? 1),
        });
      }
      entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (get().workspaceId !== wid) return; // the workspace changed while loading: these results belong elsewhere
      const others = className ? get().results.filter((r) => r.className !== className) : [];
      set({ results: [...entries, ...others] });
      // make sure each class has an active result
      const active = { ...get().activeResult };
      for (const r of entries) if (!active[r.className] || !entries.some((e) => e.id === active[r.className])) active[r.className] = active[r.className] && entries.some((e) => e.id === active[r.className]) ? active[r.className] : r.id;
      set({ activeResult: active });
    },

    getResultsFor(className) {
      return get().results.filter((r) => r.className === className);
    },

    getActiveResult(className) {
      const cls = className ?? get().activeClass;
      if (!cls) return undefined;
      const id = get().activeResult[cls];
      return get().results.find((r) => r.id === id) ?? get().results.find((r) => r.className === cls);
    },

    setActiveResult(className, id) {
      const r = get().results.find((x) => x.id === id);
      set({ activeResult: { ...get().activeResult, [className]: id }, caseIndex: 0, sliderTime: r ? Math.min(Math.max(get().sliderTime, r.startTime), r.stopTime) : get().sliderTime });
    },

    async renameResult(id, name) {
      const wid = get().workspaceId;
      if (!wid) return;
      await api.relabelExperiment(wid, id, name);
      set({ results: get().results.map((r) => (r.id === id ? { ...r, name } : r)) });
    },

    async deleteResult(id) {
      const wid = get().workspaceId;
      if (!wid) return;
      await api.deleteExperiment(wid, id);
      const results = get().results.filter((r) => r.id !== id);
      const active = { ...get().activeResult };
      for (const [cls, rid] of Object.entries(active)) if (rid === id) {
        const next = results.find((r) => r.className === cls);
        if (next) active[cls] = next.id;
        else delete active[cls];
      }
      const trajectories = Object.fromEntries(Object.entries(get().trajectories).filter(([k]) => !k.startsWith(`${id}/`)));
      for (const k of [...failedTrajectories.keys()]) if (k.startsWith(`${id}/`)) failedTrajectories.delete(k);
      set({ results, activeResult: active, trajectories });
    },

    async ensureTrajectories(resultId, caseId, variables, opts) {
      const wid = get().workspaceId;
      const out: Record<string, number[]> = {};
      if (!wid) return out;
      // `time` is always needed to evaluate a trajectory at the slider time.
      const wanted = variables.includes('time') ? variables : [...variables, 'time'];
      const waits: Promise<void>[] = [];
      const fresh: string[] = [];
      for (const v of wanted) {
        const k = trajectoryKey(resultId, caseId, v);
        if (get().trajectories[k]) continue;
        const pending = pendingTrajectories.get(k);
        if (pending) {
          waits.push(pending);
          continue;
        }
        const failedAt = failedTrajectories.get(k);
        if (failedAt !== undefined) {
          if (!opts?.retryFailed && Date.now() - failedAt < FAILED_TRAJECTORY_RETRY_MS) continue;
          failedTrajectories.delete(k);
        }
        if (!fresh.includes(v)) fresh.push(v);
      }
      if (fresh.length) {
        const gk = `${resultId}/${caseId}`;
        let batch = trajectoryBatches.get(gk);
        if (!batch) {
          const created = { variables: new Set<string>(), promise: Promise.resolve() };
          // Flush in a microtask: every caller of the current render pass lands in this one request.
          created.promise = new Promise<void>((resolve) => queueMicrotask(resolve)).then(() => {
            trajectoryBatches.delete(gk);
            return requestTrajectories(wid, resultId, caseId, [...created.variables]);
          });
          created.promise.catch(() => undefined); // every waiter handles the rejection itself
          trajectoryBatches.set(gk, created);
          batch = created;
        }
        for (const v of fresh) {
          batch.variables.add(v);
          pendingTrajectories.set(trajectoryKey(resultId, caseId, v), batch.promise);
        }
        waits.push(batch.promise);
      }
      await Promise.all(waits);
      for (const v of variables) {
        const cached = get().trajectories[trajectoryKey(resultId, caseId, v)];
        if (cached) out[v] = cached;
      }
      return out;
    },

    fetchTrajectories(resultId, caseId, variables) {
      return get().ensureTrajectories(resultId, caseId, variables, { retryFailed: true });
    },

    async fetchResultVariables(resultId) {
      const wid = get().workspaceId;
      if (!wid) return [];
      const cached = get().resultVariables[resultId];
      if (cached) return cached;
      const res = await api.getExperimentVariables(wid, resultId);
      if (get().workspaceId === wid) set({ resultVariables: { ...get().resultVariables, [resultId]: res.variables } });
      return res.variables;
    },

    valueAt(variable, resultId, caseId, opts) {
      const r = resultId ? get().results.find((x) => x.id === resultId) : get().getActiveResult();
      if (!r) return undefined;
      const cid = caseId ?? r.cases[Math.min(get().caseIndex, Math.max(0, r.cases.length - 1))]?.id;
      if (!cid) return undefined;
      const values = get().trajectories[trajectoryKey(r.id, cid, variable)];
      const time = get().trajectories[trajectoryKey(r.id, cid, 'time')];
      if (!values || !time) {
        // Pure read unless asked otherwise; the ensure call is de-duplicated and batched, so render paths may call this per row.
        if (opts?.fetch !== false) void get().ensureTrajectories(r.id, cid, [variable]).catch(() => undefined);
        return undefined;
      }
      if (values.length === 1) return values[0];
      if (!values.length || !time.length) return undefined;
      const t = get().sliderTime;
      if (t <= time[0]) return values[0];
      if (t >= time[time.length - 1]) return values[values.length - 1];
      let lo = 0;
      let hi = time.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (time[mid] <= t) lo = mid;
        else hi = mid;
      }
      const f = time[hi] === time[lo] ? 0 : (t - time[lo]) / (time[hi] - time[lo]);
      return values[lo] + f * (values[hi] - values[lo]);
    },

    showLog(tab, open = true) {
      set({ logTab: tab, logOpen: open });
    },

    setLogOpen(open) {
      set({ logOpen: open });
    },

    pushBanner(b) {
      set({ banners: [...get().banners, { ...b, id: uid('banner') }].slice(-6) });
    },

    dismissBanner(id) {
      set({ banners: get().banners.filter((b) => b.id !== id) });
    },

    clearBanners() {
      set({ banners: [] });
    },

    setSliderTime(t) {
      set({ sliderTime: t });
    },

    setSliderPlaying(playing) {
      set({ sliderPlaying: playing });
    },

    setCaseIndex(i) {
      set({ caseIndex: i });
    },

    async loadCaseLogs(resultId, caseId) {
      const wid = get().workspaceId;
      const r = get().results.find((x) => x.id === resultId);
      if (!wid || !r) return;
      const cid = caseId ?? r.cases[0]?.id;
      if (!cid) return;
      try {
        const log = await api.getCaseLog(wid, resultId, cid);
        if (get().workspaceId === wid) set({ simulationLog: log.log });
      } catch {
        /* ignore */
      }
    },

    // ---------------------------------------------------------------- canvas
    plots: {},
    stickies: {},
    views: {},
    viewports: {},
    favorites: {},
    settings,
    plotCounter: 0,

    addPlot(className, traces = [], at) {
      const n = get().plotCounter + 1;
      const existing = get().plots[className] ?? [];
      const plot: PlotWindow = {
        id: uid('plot'),
        title: `Plot ${n}`,
        x: at ? at[0] : 40 + (existing.length % 4) * 30,
        y: at ? at[1] : 40 + (existing.length % 4) * 30,
        width: 500,
        height: 300,
        traces: traces.map((t, i) => ({ ...t, color: t.color ?? PLOT_PALETTE[i % PLOT_PALETTE.length] })),
        xVariable: 'time',
        showLegend: true,
        logY: false,
        showGrid: true,
        pinned: false,
      };
      set({ plots: { ...get().plots, [className]: [...existing, plot] }, plotCounter: n });
      persist();
      return plot;
    },

    updatePlot(className, id, patch) {
      set({ plots: { ...get().plots, [className]: (get().plots[className] ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)) } });
      persist();
    },

    removePlot(className, id) {
      set({ plots: { ...get().plots, [className]: (get().plots[className] ?? []).filter((p) => p.id !== id) } });
      persist();
    },

    addTrace(className, plotId, trace: PlotTrace) {
      const plots = (get().plots[className] ?? []).map((p) => {
        if (p.id !== plotId) return p;
        if (p.traces.some((t) => t.variable === trace.variable && t.resultId === trace.resultId)) return p;
        const used = new Set(p.traces.map((t) => t.color));
        const color = trace.color ?? PLOT_PALETTE.find((c) => !used.has(c)) ?? PLOT_PALETTE[p.traces.length % PLOT_PALETTE.length];
        return { ...p, traces: [...p.traces, { ...trace, color }] };
      });
      set({ plots: { ...get().plots, [className]: plots } });
      persist();
    },

    removeTrace(className, plotId, variable, resultId) {
      const plots = (get().plots[className] ?? []).map((p) => (p.id === plotId ? { ...p, traces: p.traces.filter((t) => !(t.variable === variable && t.resultId === resultId)) } : p));
      set({ plots: { ...get().plots, [className]: plots } });
      persist();
    },

    addSticky(className, sticky) {
      const s: Sticky = { ...sticky, id: uid('sticky') };
      set({ stickies: { ...get().stickies, [className]: [...(get().stickies[className] ?? []), s] } });
      persist();
      return s;
    },

    updateSticky(className, id, patch) {
      set({ stickies: { ...get().stickies, [className]: (get().stickies[className] ?? []).map((s) => (s.id === id ? { ...s, ...patch } : s)) } });
      persist();
    },

    removeSticky(className, id) {
      set({ stickies: { ...get().stickies, [className]: (get().stickies[className] ?? []).filter((s) => s.id !== id) } });
      persist();
    },

    saveView(className, name) {
      const view: SavedView = { name, plots: JSON.parse(JSON.stringify(get().plots[className] ?? [])), stickies: JSON.parse(JSON.stringify(get().stickies[className] ?? [])) };
      const views = (get().views[className] ?? []).filter((v) => v.name !== name);
      set({ views: { ...get().views, [className]: [...views, view] } });
      persist();
    },

    loadView(className, name) {
      const view = (get().views[className] ?? []).find((v) => v.name === name);
      if (!view) return;
      set({ plots: { ...get().plots, [className]: JSON.parse(JSON.stringify(view.plots)) }, stickies: { ...get().stickies, [className]: JSON.parse(JSON.stringify(view.stickies)) } });
      persist();
    },

    deleteView(className, name) {
      set({ views: { ...get().views, [className]: (get().views[className] ?? []).filter((v) => v.name !== name) } });
      persist();
    },

    clearCanvasObjects(className) {
      set({ plots: { ...get().plots, [className]: [] }, stickies: { ...get().stickies, [className]: [] } });
      persist();
    },

    setViewport(className, vp) {
      set({ viewports: { ...get().viewports, [className]: vp } });
      persist();
    },

    toggleFavorite(className, variable) {
      const cur = get().favorites[className] ?? [];
      const next = cur.includes(variable) ? cur.filter((v) => v !== variable) : [...cur, variable];
      set({ favorites: { ...get().favorites, [className]: next } });
      persist();
    },

    updateSettings(patch) {
      const next = { ...get().settings, ...patch };
      set({ settings: next });
      applyTheme(next);
      try {
        localStorage.setItem('impact-clone:settings', JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
  };
});

/** Convenience selector hooks. */
export const useActiveClass = () => useStore((s) => s.activeClass);
export const useMode = () => useStore((s) => s.mode);
export const useRegistry = () => useStore((s) => s.registry);
export const useRegistryVersion = () => useStore((s) => s.registryVersion);
export type { Point };
