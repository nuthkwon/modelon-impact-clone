/**
 * REST protocol shared by `apps/server` and `apps/web`. The resource model mirrors the
 * Modelon Impact public API (workspaces, projects, model executables, experiments, cases,
 * custom functions, trajectories) with a few UI-support endpoints for class browsing and
 * editing.
 *
 * All endpoints are under `/api`. Errors are `{ error: { code: string; message: string } }`.
 */

// ---------------------------------------------------------------------------
// Workspaces & projects
// ---------------------------------------------------------------------------

export type ContentType = 'MODELICA' | 'VIEWS' | 'FAVOURITES' | 'CUSTOM_FUNCTIONS' | 'REFERENCE_RESULTS' | 'EXPERIMENT_DEFINITIONS' | 'GENERIC';
export type ProjectType = 'LOCAL' | 'RELEASED' | 'SYSTEM';

export interface ProjectContent {
  id: string;
  /** Path relative to the project root, e.g. `MyLibrary.mo` or `MyLibrary/` */
  relpath: string;
  contentType: ContentType;
  /** Top-level class name for MODELICA content. */
  name: string;
  defaultDisabled: boolean;
  /** True for libraries that cannot be modified (e.g. Modelica Standard Library). */
  readOnly?: boolean;
}

export interface ProjectDefinition {
  name: string;
  format: string;
  content: ProjectContent[];
  dependencies?: { name: string; versionSpecifier?: string }[];
}

export interface Project {
  id: string;
  definition: ProjectDefinition;
  projectType: ProjectType;
}

export interface WorkspaceDefinition {
  name: string;
  /** Format version string, e.g. `1.0.0` */
  format: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  /** Projects owned by the workspace (editable). */
  projects: { reference: { id: string }; disabled: boolean }[];
  /** Read-only library dependencies (MSL, ...). */
  dependencies: { reference: { id: string }; disabled: boolean }[];
}

export interface Workspace {
  id: string;
  definition: WorkspaceDefinition;
  /** Size in bytes. */
  sizeInfo?: { total: number };
}

// ---------------------------------------------------------------------------
// Installed libraries (Workspace Management → Libraries)
// ---------------------------------------------------------------------------

/**
 * A read-only Modelica library installed on the server (`GET /api/libraries`). Imported
 * libraries are shared by every workspace; a workspace uses one by listing it among its
 * dependencies. The Modelica Standard Library is listed too (`projectType: 'SYSTEM'`, not
 * removable).
 */
export interface InstalledLibraryDto {
  /** Library (= dependency project) id. */
  id: string;
  /** Top-level class name, e.g. `ThermoPower`. */
  name: string;
  /** `version` annotation of the top-level package, when present. */
  version?: string;
  /** Description string of the top-level class. */
  description?: string;
  projectType: ProjectType;
  /** Where the library was imported from (a server path, or `upload`). */
  source?: string;
  importedAt?: string;
  fileCount: number;
  /** Size of the Modelica sources in bytes. */
  size: number;
  /** Workspaces listing this library among their dependencies. */
  usedIn: { id: string; name: string }[];
}

/**
 * `POST /api/libraries`: import a library either from a path on the server (`path`: a
 * `package.mo`, a single-file library `Name.mo`, or a directory holding `package.mo`) or from
 * uploaded files (`files`: paths relative to the upload root, e.g. `ThermoPower/package.mo`).
 * With `workspaceId` the library is also added to that workspace's dependencies.
 */
export interface ImportLibraryRequest {
  path?: string;
  files?: { path: string; text: string }[];
  workspaceId?: string;
}

/** One entry of a server directory listing (`GET /api/filesystem`). */
export interface FileSystemEntry {
  name: string;
  /** Absolute path on the server. */
  path: string;
  kind: 'directory' | 'file';
  /** Directories: holds a `package.mo` (a Modelica package directory). */
  modelicaPackage?: boolean;
  size?: number;
  modifiedAt?: string;
}

/** `GET /api/filesystem?path=...`: directories and `.mo` files of a server directory. */
export interface FileSystemListing {
  /** Absolute, normalised directory path. */
  path: string;
  /** Parent directory, absent at a root. */
  parent?: string;
  /** Filesystem roots (`/`, or the drive letters on Windows). */
  roots: string[];
  /** The server user's home directory. */
  home: string;
  separator: string;
  entries: FileSystemEntry[];
}

export interface ItemsResponse<T> {
  data: { items: T[] };
}

export interface CreateWorkspaceRequest {
  new: { name: string; description?: string };
}

// ---------------------------------------------------------------------------
// Class browsing & editing (UI support; not part of the Impact public API)
// ---------------------------------------------------------------------------

export interface ClassTreeNodeDto {
  name: string;
  shortName: string;
  restriction: string;
  description?: string;
  partial: boolean;
  hasChildren: boolean;
  libraryId: string;
  readOnly: boolean;
  droppable: boolean;
  /** Icon layer serialized (see @impact/core GraphicsLayer); omitted when absent. */
  icon?: unknown;
}

export interface ClassSourceDto {
  className: string;
  /** Project content / library id the class lives in. */
  libraryId: string;
  /** Path of the file inside the library (virtual). */
  file: string;
  /** Full text of the file holding the class. */
  text: string;
  readOnly: boolean;
  /** Version stamp for optimistic concurrency. */
  version: number;
}

export interface UpdateClassSourceRequest {
  text: string;
  version?: number;
}

export interface CreateClassRequest {
  /** e.g. `MyProject` (package) or `MyProject.NewModel` */
  className: string;
  restriction: 'model' | 'package' | 'block' | 'connector' | 'record' | 'type' | 'function';
  description?: string;
  /** Optional class to extend / duplicate from. */
  extendsClass?: string;
  /** Project (content id) to create the class in. Defaults to the workspace's first editable project. */
  libraryId?: string;
}

/** A library as loaded in a workspace, plus all of its source files (for client-side parsing). */
export interface LibraryBundleDto {
  libraryId: string;
  name: string;
  readOnly: boolean;
  files: { path: string; text: string }[];
  version: number;
}

// ---------------------------------------------------------------------------
// Custom functions (analysis types) & experiment definitions
// ---------------------------------------------------------------------------

export type CustomFunctionParameterType = 'Number' | 'String' | 'Boolean' | 'Enumeration' | 'CaseResult' | 'ExperimentResult' | 'FileURI' | 'VariableNames';

export interface CustomFunctionParameter {
  name: string;
  type: CustomFunctionParameterType;
  description?: string;
  defaultValue?: number | string | boolean;
  values?: string[];
}

export interface CustomFunction {
  name: 'dynamic' | 'steady state' | string;
  version: string;
  description?: string;
  parameters: CustomFunctionParameter[];
}

export interface ModelicaModelSpec {
  className: string;
  compilerOptions?: Record<string, unknown>;
  runtimeOptions?: Record<string, unknown>;
  compilerLogLevel?: 'error' | 'warning' | 'info' | 'verbose' | 'debug';
  fmiTarget?: 'me' | 'cs';
  fmiVersion?: '1.0' | '2.0';
  platform?: string;
}

export interface ExperimentAnalysis {
  /** Custom function name, e.g. `dynamic` */
  type: string;
  /** Custom function parameters: `{ start_time: 0, final_time: 1 }` */
  parameters: Record<string, number | string | boolean>;
  simulationOptions: {
    ncp?: number;
    dynamic_diagnostics?: boolean;
    [key: string]: unknown;
  };
  solverOptions: {
    solver?: string;
    rtol?: number;
    atol?: number;
    step_size?: number;
    [key: string]: unknown;
  };
  simulationLogLevel?: 'NOTHING' | 'FATAL' | 'ERROR' | 'WARNING' | 'INFO' | 'VERBOSE' | 'DEBUG' | 'ALL';
}

export interface ExperimentBase {
  model: { modelica: ModelicaModelSpec } | { fmu: { id: string } };
  /** Parameter modifiers: flat variable name -> value or `range(...)`/`choices(...)` expression string. */
  modifiers: { variables: Record<string, number | string | boolean> };
  analysis: ExperimentAnalysis;
}

export interface ExperimentExtension {
  modifiers?: { variables: Record<string, number | string | boolean> };
  analysis?: Partial<ExperimentAnalysis>;
  caseData?: { label?: string };
}

export interface ExperimentDefinition {
  version: 2;
  base: ExperimentBase;
  extensions: ExperimentExtension[];
}

export interface CreateExperimentRequest {
  experiment: ExperimentDefinition;
  label?: string;
}

export interface CreateExperimentResponse {
  experiment_id: string;
}

export type ExecutionStatus = 'pending' | 'running' | 'done' | 'cancelled';
export type CaseStatus = 'successful' | 'failed' | 'cancelled' | 'not_started' | 'started';

export interface ExecutionStatusResponse {
  status: ExecutionStatus;
  /** 0..1 */
  progress: number;
  /** For compilation: log tail. */
  message?: string;
}

export interface CaseRunInfo {
  status: CaseStatus;
  datetime_started?: string;
  datetime_finished?: string;
  /** Simulation statistics; see @impact/core SimulationStats */
  statistics?: Record<string, number | boolean>;
  failures?: string[];
}

export interface CaseDto {
  id: string;
  experiment_id: string;
  meta: { label: string };
  run_info: CaseRunInfo;
  input: {
    analysis: ExperimentAnalysis;
    parametrization: Record<string, number | string | boolean>;
    fmu_id?: string;
  };
  consistent?: boolean;
}

export interface ExperimentDto {
  id: string;
  experiment: ExperimentDefinition;
  meta_data: { label: string; created_at: string; user_id?: string };
  run_info: {
    status: ExecutionStatus | 'not_started';
    failed: number;
    successful: number;
    cancelled: number;
    not_started: number;
    /** Set by the server when it changed the status itself, e.g. after a restart interrupted the run. */
    message?: string;
  };
  /** Model class name for quick listing. */
  className: string;
}

export interface TrajectoriesRequest {
  variable_names: string[];
}

/** One array per requested variable, in request order; each holds one array per case. */
export type TrajectoriesResponse = number[][][];

export interface ExperimentVariablesResponse {
  /** Flat variable names including parameters. */
  variables: string[];
}

export interface CaseLogResponse {
  log: string;
}

export interface CaseVariableMeta {
  name: string;
  kind: 'continuous' | 'discrete' | 'parameter' | 'constant' | 'derivative';
  unit?: string;
  displayUnit?: string;
  description?: string;
}

export interface CaseResultMetaResponse {
  className: string;
  time: { start: number; stop: number; points: number };
  variables: CaseVariableMeta[];
}

// ---------------------------------------------------------------------------
// Model executables (compilation)
// ---------------------------------------------------------------------------

export interface CompileRequest {
  input: ModelicaModelSpec;
}

export interface ModelExecutableDto {
  id: string;
  input: ModelicaModelSpec;
  run_info: {
    /** `running` is persisted while a compilation is in progress so a restart can detect it. */
    status: 'successful' | 'failed' | 'cancelled' | 'not_started' | 'running';
    datetime_started?: string;
    datetime_finished?: string;
    errors?: string[];
    warnings?: string[];
  };
  /** Compiler statistics (unknowns, equations, states). */
  statistics?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Error envelope
// ---------------------------------------------------------------------------

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

// ---------------------------------------------------------------------------
// Route table (documentation + shared constants)
// ---------------------------------------------------------------------------

export const API = {
  workspaces: () => `/api/workspaces`,
  workspace: (wid: string) => `/api/workspaces/${wid}`,
  projects: (wid: string) => `/api/workspaces/${wid}/projects`,
  dependencies: (wid: string) => `/api/workspaces/${wid}/dependencies`,
  dependency: (wid: string, lid: string) => `/api/workspaces/${wid}/dependencies/${lid}`,
  installedLibraries: () => `/api/libraries`,
  installedLibrary: (lid: string) => `/api/libraries/${lid}`,
  filesystem: (path?: string) => `/api/filesystem${path !== undefined ? `?path=${encodeURIComponent(path)}` : ''}`,
  libraries: (wid: string) => `/api/workspaces/${wid}/libraries`,
  library: (wid: string, lid: string) => `/api/workspaces/${wid}/libraries/${lid}`,
  classTree: (wid: string, parent?: string) => `/api/workspaces/${wid}/classes${parent ? `?parent=${encodeURIComponent(parent)}` : ''}`,
  classSource: (wid: string, className: string) => `/api/workspaces/${wid}/classes/${encodeURIComponent(className)}/source`,
  createClass: (wid: string) => `/api/workspaces/${wid}/classes`,
  customFunctions: (wid: string) => `/api/workspaces/${wid}/custom-functions`,
  modelExecutables: (wid: string) => `/api/workspaces/${wid}/model-executables`,
  modelExecutable: (wid: string, fid: string) => `/api/workspaces/${wid}/model-executables/${fid}`,
  compilation: (wid: string, fid: string) => `/api/workspaces/${wid}/model-executables/${fid}/compilation`,
  compilationLog: (wid: string, fid: string) => `/api/workspaces/${wid}/model-executables/${fid}/compilation/log`,
  experiments: (wid: string) => `/api/workspaces/${wid}/experiments`,
  experiment: (wid: string, eid: string) => `/api/workspaces/${wid}/experiments/${eid}`,
  execution: (wid: string, eid: string) => `/api/workspaces/${wid}/experiments/${eid}/execution`,
  experimentVariables: (wid: string, eid: string) => `/api/workspaces/${wid}/experiments/${eid}/variables`,
  experimentTrajectories: (wid: string, eid: string) => `/api/workspaces/${wid}/experiments/${eid}/trajectories`,
  cases: (wid: string, eid: string) => `/api/workspaces/${wid}/experiments/${eid}/cases`,
  case: (wid: string, eid: string, cid: string) => `/api/workspaces/${wid}/experiments/${eid}/cases/${cid}`,
  caseTrajectories: (wid: string, eid: string, cid: string) => `/api/workspaces/${wid}/experiments/${eid}/cases/${cid}/trajectories`,
  caseLog: (wid: string, eid: string, cid: string) => `/api/workspaces/${wid}/experiments/${eid}/cases/${cid}/log`,
  caseResult: (wid: string, eid: string, cid: string) => `/api/workspaces/${wid}/experiments/${eid}/cases/${cid}/result`,
  caseResultMeta: (wid: string, eid: string, cid: string) => `/api/workspaces/${wid}/experiments/${eid}/cases/${cid}/result/meta`,
} as const;
