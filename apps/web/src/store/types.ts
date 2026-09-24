/**
 * Application state shape. The store is a single zustand store composed of the slices below.
 * UI components read state with selectors and call the actions; slices never import React.
 */
import type { ClassRegistry, Diagnostic, DiagramView, EditOperation, EditResult, Point, SourceLoc } from '@impact/core';
import type { CaseDto, ExperimentDto, LibraryBundleDto, Project, Workspace } from '@impact/protocol';

export type Mode = 'model' | 'experiment' | 'results';
export type View = 'diagram' | 'code';
export type SolverOption = 'CVode' | 'Radau5ODE' | 'ExplicitEuler';
export type AnalysisType = 'dynamic' | 'steady state';

// ---------------------------------------------------------------------------
// Workspace / libraries / registry
// ---------------------------------------------------------------------------

export interface WorkspaceSlice {
  workspaceId?: string;
  workspace?: Workspace;
  projects: Project[];
  dependencies: Project[];
  libraries: LibraryBundleDto[];
  /** Client-side class registry built from all library bundles. Mutable; `registryVersion` bumps on every change. */
  registry: ClassRegistry;
  registryVersion: number;
  /** Parse diagnostics per file key (`libraryId::path`). */
  fileDiagnostics: Record<string, Diagnostic[]>;
  loading: boolean;
  loadError?: string;

  loadWorkspace(wid: string): Promise<void>;
  /** Saves new text for the file that declares `className`; updates the registry on success. Returns diagnostics on parse errors (nothing saved). */
  saveClassSource(className: string, text: string): Promise<{ ok: boolean; diagnostics: Diagnostic[] }>;
  createClass(req: { className: string; restriction: 'model' | 'package' | 'block' | 'connector' | 'record' | 'type' | 'function'; description?: string; extendsClass?: string; libraryId?: string }): Promise<string>;
  deleteClass(className: string): Promise<void>;
  /** Text of the file declaring `className` (from the registry). */
  getClassText(className: string): string | undefined;
  isReadOnly(className: string): boolean;
}

// ---------------------------------------------------------------------------
// Editor: active class, mode, view, selection, edits
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  libraryId: string;
  path: string;
  before: string;
  after: string;
  className: string;
}

export interface EditorSlice {
  activeClass?: string;
  mode: Mode;
  view: View;
  /** Selected component names of the active class. */
  selection: string[];
  /** Selected connection (equation index) of the active class. */
  selectedConnection?: number;
  /** Cached diagram view of the active class (recomputed on registryVersion change). */
  diagram?: DiagramView;
  diagramError?: string;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  /** Details panel visibility / active tab. */
  detailsOpen: boolean;
  detailsTab: string;
  workspacePanelOpen: boolean;
  /** Code view unsaved text (undefined = in sync with the registry). */
  codeDraft?: string;

  openClass(className: string): void;
  setMode(mode: Mode): void;
  setView(view: View): void;
  select(names: string[], connection?: number): void;
  setDetailsOpen(open: boolean): void;
  setDetailsTab(tab: string): void;
  setWorkspacePanelOpen(open: boolean): void;
  setCodeDraft(text: string | undefined): void;
  /** Applies an edit to the active class (optimistic; persisted through the server). */
  applyEdit(op: EditOperation, className?: string): Promise<EditResult | undefined>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  refreshDiagram(): void;
}

// ---------------------------------------------------------------------------
// Experiments (client-side definitions, persisted in localStorage per workspace)
// ---------------------------------------------------------------------------

export interface ExecutionSettings {
  compiler: { c_compiler: string; generate_html_diagnostics: boolean; include_protected_variables: boolean; filter_warnings: boolean };
  runtime: { log_level: number };
  simulation: { ncp: number; dynamic_diagnostics: boolean; store_event_points: boolean };
  solver: { rtol: number; atol: number };
}

export interface AnalysisSettings {
  type: AnalysisType;
  startTime: number;
  stopTime: number;
  /** Output interval in seconds; `points` is derived and vice versa. */
  interval: number;
  useInterval: boolean;
  solver: SolverOption;
  tolerance: number;
  stepSize: number;
  advanced: ExecutionSettings;
}

export interface OutputFilter {
  id: string;
  kind: 'View' | 'Favorites' | 'Component' | 'Variable';
  value: string;
}

export interface Experiment {
  id: string;
  name: string;
  className: string;
  createdAt: string;
  analysis: AnalysisSettings;
  /** Parameter overrides as Modelica text: `resistor.R` -> `100` or `range(1,10,5)`. */
  modifiers: Record<string, string>;
  outputs: OutputFilter[];
}

export interface ExperimentSlice {
  experiments: Experiment[];
  /** Active experiment id per class. */
  activeExperiment: Record<string, string>;

  getExperimentsFor(className: string): Experiment[];
  getActiveExperiment(className?: string): Experiment | undefined;
  ensureExperiment(className: string): Experiment;
  createExperiment(className: string, name?: string): Experiment;
  duplicateExperiment(id: string): Experiment | undefined;
  renameExperiment(id: string, name: string): void;
  deleteExperiment(id: string): void;
  setActiveExperiment(className: string, id: string): void;
  updateAnalysis(id: string, patch: Partial<AnalysisSettings>): void;
  setModifier(id: string, name: string, valueText: string | null): void;
  addOutputFilter(id: string, filter: Omit<OutputFilter, 'id'>): void;
  removeOutputFilter(id: string, filterId: string): void;
  /** Number of cases the experiment expands to (range/choices). */
  caseCount(id: string): number;
}

// ---------------------------------------------------------------------------
// Simulation runs, results, logs, banners
// ---------------------------------------------------------------------------

export type ResultStatus = 'running' | 'successful' | 'failed' | 'cancelled' | 'partial';

export interface ResultEntry {
  /** Server experiment id. */
  id: string;
  name: string;
  className: string;
  createdAt: string;
  finishedAt?: string;
  status: ResultStatus;
  cases: CaseDto[];
  experiment?: ExperimentDto;
  startTime: number;
  stopTime: number;
}

export interface Banner {
  id: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  loc?: SourceLoc;
  className?: string;
  /** Which log tab to open from the banner link. */
  log?: 'compilation' | 'simulation';
}

export interface RunningJob {
  className: string;
  experimentId: string;
  serverExperimentId?: string;
  phase: 'compiling' | 'simulating' | 'pending';
  progress: number;
  startedAt: number;
  cancelled?: boolean;
}

export interface TrajectoryKey {
  resultId: string;
  caseId: string;
  variable: string;
}

export interface SimulationSlice {
  running?: RunningJob;
  results: ResultEntry[];
  /** Active result id per class. */
  activeResult: Record<string, string>;
  compilationLog: string;
  simulationLog: string;
  logOpen: boolean;
  logTab: 'compilation' | 'simulation';
  logHasErrors: boolean;
  banners: Banner[];
  /** Trajectory cache: `${resultId}/${caseId}/${variable}` -> values (time under variable `time`). */
  trajectories: Record<string, number[]>;
  /** Variable names available per result id. */
  resultVariables: Record<string, string[]>;
  /** Time slider state. */
  sliderTime: number;
  sliderPlaying: boolean;
  /** Selected case index for multi-case results. */
  caseIndex: number;

  simulate(kind?: 'dynamic' | 'steady state' | 'compile'): Promise<void>;
  cancelSimulation(): Promise<void>;
  loadResults(className?: string): Promise<void>;
  getResultsFor(className: string): ResultEntry[];
  getActiveResult(className?: string): ResultEntry | undefined;
  setActiveResult(className: string, id: string): void;
  renameResult(id: string, name: string): Promise<void>;
  deleteResult(id: string): Promise<void>;
  fetchTrajectories(resultId: string, caseId: string, variables: string[]): Promise<Record<string, number[]>>;
  fetchResultVariables(resultId: string): Promise<string[]>;
  /** Value of `variable` at the slider time for the active result/case, or undefined if not loaded (triggers a fetch). */
  valueAt(variable: string, resultId?: string, caseId?: string): number | undefined;
  showLog(tab: 'compilation' | 'simulation', open?: boolean): void;
  setLogOpen(open: boolean): void;
  pushBanner(b: Omit<Banner, 'id'>): void;
  dismissBanner(id: string): void;
  clearBanners(): void;
  setSliderTime(t: number): void;
  setSliderPlaying(playing: boolean): void;
  setCaseIndex(i: number): void;
  loadCaseLogs(resultId: string, caseId?: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Canvas UI: plots, stickies, views, viewport, settings
// ---------------------------------------------------------------------------

export interface PlotTrace {
  variable: string;
  /** Result id; undefined = active result. */
  resultId?: string;
  color?: string;
  hidden?: boolean;
}

export interface PlotWindow {
  id: string;
  title: string;
  /** Screen position/size in canvas pixels (relative to the canvas element). */
  x: number;
  y: number;
  width: number;
  height: number;
  traces: PlotTrace[];
  /** Independent variable (default `time`). */
  xVariable: string;
  showLegend: boolean;
  logY: boolean;
  showGrid: boolean;
  pinned: boolean;
}

export interface Sticky {
  id: string;
  /** Component the sticky is attached to ('' for top-level). */
  component: string;
  variable: string;
  /** Offset from the component origin in diagram units. */
  dx: number;
  dy: number;
  pinned: boolean;
  editable: boolean;
}

export interface SavedView {
  name: string;
  plots: PlotWindow[];
  stickies: Sticky[];
}

export interface Viewport {
  scale: number;
  tx: number;
  ty: number;
}

export interface AppSettings {
  showGrid: boolean;
  snapping: boolean;
  darkMode: boolean;
  excludeCanvasFromDark: boolean;
  autoPropagate: boolean;
  csvDecimalSeparator: '.' | ',';
  showDisplayUnits: boolean;
}

export interface CanvasSlice {
  plots: Record<string, PlotWindow[]>;
  stickies: Record<string, Sticky[]>;
  views: Record<string, SavedView[]>;
  viewports: Record<string, Viewport>;
  favorites: Record<string, string[]>;
  settings: AppSettings;
  plotCounter: number;

  addPlot(className: string, traces?: PlotTrace[], at?: Point): PlotWindow;
  updatePlot(className: string, id: string, patch: Partial<PlotWindow>): void;
  removePlot(className: string, id: string): void;
  addTrace(className: string, plotId: string, trace: PlotTrace): void;
  removeTrace(className: string, plotId: string, variable: string, resultId?: string): void;
  addSticky(className: string, sticky: Omit<Sticky, 'id'>): Sticky;
  updateSticky(className: string, id: string, patch: Partial<Sticky>): void;
  removeSticky(className: string, id: string): void;
  saveView(className: string, name: string): void;
  loadView(className: string, name: string): void;
  deleteView(className: string, name: string): void;
  clearCanvasObjects(className: string): void;
  setViewport(className: string, vp: Viewport): void;
  toggleFavorite(className: string, variable: string): void;
  updateSettings(patch: Partial<AppSettings>): void;
}

export type AppState = WorkspaceSlice & EditorSlice & ExperimentSlice & SimulationSlice & CanvasSlice;
