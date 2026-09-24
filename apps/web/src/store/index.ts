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
import type { CaseDto, CreateExperimentRequest, ExperimentDto } from '@impact/protocol';
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

/** Expands `range(a,b,n)` / `choices(...)` modifier text into the number of cases. */
export function modifierCaseCount(text: string): number {
  const range = /^\s*range\s*\(\s*([^,]+),\s*([^,]+),\s*(\d+)\s*\)\s*$/i.exec(text);
  if (range) return Math.max(1, parseInt(range[3], 10));
  const choices = /^\s*choices\s*\(([^)]*)\)\s*$/i.exec(text);
  if (choices) return Math.max(1, choices[1].split(',').filter((s) => s.trim()).length);
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
    loading: false,
    loadError: undefined,

    async loadWorkspace(wid) {
      set({ loading: true, loadError: undefined, workspaceId: wid });
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
          results: [],
          activeResult: {},
          trajectories: {},
          resultVariables: {},
        });
        await get().loadResults();
      } catch (e) {
        set({ loading: false, loadError: e instanceof Error ? e.message : String(e) });
      }
    },

    async saveClassSource(className, text) {
      const wid = get().workspaceId;
      const key = fileKeyOf(className);
      if (!wid || !key) return { ok: false, diagnostics: [{ severity: 'error', message: `Unknown class ${className}` }] };
      try {
        const res = await api.updateClassSource(wid, className, { text });
        const registry = get().registry;
        const diags = registry.addFile(key.libraryId, key.path, res.text);
        const fd = { ...get().fileDiagnostics };
        const fk = ClassRegistry.fileKey(key.libraryId, key.path);
        if (diags.length) fd[fk] = diags;
        else delete fd[fk];
        set({ registryVersion: get().registryVersion + 1, fileDiagnostics: fd, codeDraft: undefined });
        set(computeDiagram(get().activeClass));
        return { ok: true, diagnostics: [] };
      } catch (e) {
        return { ok: false, diagnostics: diagnosticsOf(e) };
      }
    },

    async createClass(req) {
      const wid = get().workspaceId;
      if (!wid) throw new Error('No workspace');
      const res = await api.createClass(wid, req);
      const registry = get().registry;
      registry.addFile(res.libraryId, res.file, res.text);
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
      const registry = get().registry;
      registry.removeLibrary(key.libraryId);
      registry.addLibrary({ id: lib.libraryId, name: lib.name, readOnly: lib.readOnly });
      for (const f of lib.files) registry.addFile(lib.libraryId, f.path, f.text);
      const active = get().activeClass;
      set({ registryVersion: get().registryVersion + 1, activeClass: active === className || active?.startsWith(`${className}.`) ? undefined : active });
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
      // optimistic local update
      registry.addFile(key.libraryId, key.path, result.text);
      const entry: HistoryEntry = { ...key, before, after: result.text, className: target };
      set({ registryVersion: get().registryVersion + 1, undoStack: [...get().undoStack, entry].slice(-100), redoStack: [] });
      set(computeDiagram(get().activeClass));
      try {
        await api.updateClassSource(wid, target, { text: result.text });
      } catch (e) {
        registry.addFile(key.libraryId, key.path, before);
        set({ registryVersion: get().registryVersion + 1, undoStack: get().undoStack.filter((h) => h !== entry) });
        set(computeDiagram(get().activeClass));
        for (const d of diagnosticsOf(e)) get().pushBanner({ severity: 'error', message: d.message, loc: d.loc, className: target });
        return undefined;
      }
      return result;
    },

    async undo() {
      const stack = get().undoStack;
      const entry = stack[stack.length - 1];
      const wid = get().workspaceId;
      if (!entry || !wid) return;
      get().registry.addFile(entry.libraryId, entry.path, entry.before);
      set({ undoStack: stack.slice(0, -1), redoStack: [...get().redoStack, entry], registryVersion: get().registryVersion + 1 });
      set(computeDiagram(get().activeClass));
      await api.updateClassSource(wid, entry.className, { text: entry.before }).catch(() => undefined);
    },

    async redo() {
      const stack = get().redoStack;
      const entry = stack[stack.length - 1];
      const wid = get().workspaceId;
      if (!entry || !wid) return;
      get().registry.addFile(entry.libraryId, entry.path, entry.after);
      set({ redoStack: stack.slice(0, -1), undoStack: [...get().undoStack, entry], registryVersion: get().registryVersion + 1 });
      set(computeDiagram(get().activeClass));
      await api.updateClassSource(wid, entry.className, { text: entry.after }).catch(() => undefined);
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

    async simulate(kind = 'dynamic') {
      const wid = get().workspaceId;
      const className = get().activeClass;
      if (!wid || !className || get().running) return;
      const exp = get().ensureExperiment(className);
      const request = analysisToRequest(exp);
      if (kind === 'steady state') request.experiment.base.analysis = { ...request.experiment.base.analysis, type: 'steady state', parameters: { start_time: exp.analysis.startTime } };
      const resultsForClass = get().results.filter((r) => r.className === className);
      const allCount = get().results.length;
      request.label = `Result${allCount + 1}`;
      void resultsForClass;
      get().clearBanners();
      set({ running: { className, experimentId: exp.id, phase: 'compiling', progress: 0, startedAt: Date.now() }, compilationLog: '', simulationLog: '', logHasErrors: false });
      try {
        // Compilation step (model executable) — surfaces structural errors before simulating.
        const fmu = await api.createModelExecutable(wid, { input: request.experiment.base.model && 'modelica' in request.experiment.base.model ? request.experiment.base.model.modelica : { className } });
        await api.startCompilation(wid, fmu.id);
        let comp = await api.getCompilation(wid, fmu.id);
        while (comp.status !== 'done' && comp.status !== 'cancelled') {
          if (get().running?.cancelled) {
            set({ running: undefined });
            return;
          }
          await new Promise((r) => setTimeout(r, 150));
          comp = await api.getCompilation(wid, fmu.id);
          set({ running: { ...get().running!, progress: Math.min(0.3, comp.progress * 0.3) } });
        }
        const compLog = await api.getCompilationLog(wid, fmu.id);
        const fmuInfo = await api.getModelExecutable(wid, fmu.id);
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
        const created = await api.createExperiment(wid, request);
        set({ running: { ...get().running!, phase: 'simulating', serverExperimentId: created.experiment_id, progress: 0.3 } });
        await api.startExecution(wid, created.experiment_id);
        let status = await api.getExecution(wid, created.experiment_id);
        while (status.status !== 'done' && status.status !== 'cancelled') {
          if (get().running?.cancelled) {
            await api.cancelExecution(wid, created.experiment_id).catch(() => undefined);
          }
          await new Promise((r) => setTimeout(r, 300));
          status = await api.getExecution(wid, created.experiment_id);
          set({ running: { ...get().running!, progress: 0.3 + 0.7 * status.progress } });
        }
        await get().loadResults();
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
      set({ results, activeResult: active, trajectories });
    },

    async fetchTrajectories(resultId, caseId, variables) {
      const wid = get().workspaceId;
      const out: Record<string, number[]> = {};
      if (!wid) return out;
      const missing: string[] = [];
      for (const v of variables) {
        const k = `${resultId}/${caseId}/${v}`;
        const cached = get().trajectories[k];
        if (cached) out[v] = cached;
        else missing.push(v);
      }
      if (missing.length) {
        const names = missing.includes('time') ? missing : ['time', ...missing];
        const data = await api.getCaseTrajectories(wid, resultId, caseId, { variable_names: names });
        const patch: Record<string, number[]> = {};
        names.forEach((v, i) => {
          const arr = data[i] ?? [];
          patch[`${resultId}/${caseId}/${v}`] = arr;
          if (missing.includes(v)) out[v] = arr;
        });
        set({ trajectories: { ...get().trajectories, ...patch } });
      }
      return out;
    },

    async fetchResultVariables(resultId) {
      const wid = get().workspaceId;
      if (!wid) return [];
      const cached = get().resultVariables[resultId];
      if (cached) return cached;
      const res = await api.getExperimentVariables(wid, resultId);
      set({ resultVariables: { ...get().resultVariables, [resultId]: res.variables } });
      return res.variables;
    },

    valueAt(variable, resultId, caseId) {
      const r = resultId ? get().results.find((x) => x.id === resultId) : get().getActiveResult();
      if (!r) return undefined;
      const cid = caseId ?? r.cases[Math.min(get().caseIndex, Math.max(0, r.cases.length - 1))]?.id;
      if (!cid) return undefined;
      const values = get().trajectories[`${r.id}/${cid}/${variable}`];
      const time = get().trajectories[`${r.id}/${cid}/time`];
      if (!values || !time) {
        void get().fetchTrajectories(r.id, cid, [variable]).catch(() => undefined);
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
        set({ simulationLog: log.log });
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
