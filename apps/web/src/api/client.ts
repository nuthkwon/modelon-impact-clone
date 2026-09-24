/**
 * Typed REST client for the server (see packages/protocol). All calls throw `ApiClientError`
 * with the server's error envelope on non-2xx responses.
 */
import type {
  ApiError,
  CaseDto,
  CaseLogResponse,
  CaseResultMetaResponse,
  ClassSourceDto,
  ClassTreeNodeDto,
  CompileRequest,
  CreateClassRequest,
  CreateExperimentRequest,
  CreateExperimentResponse,
  CreateWorkspaceRequest,
  CustomFunction,
  ExecutionStatusResponse,
  ExperimentDto,
  ExperimentVariablesResponse,
  ItemsResponse,
  LibraryBundleDto,
  ModelExecutableDto,
  Project,
  TrajectoriesRequest,
  TrajectoriesResponse,
  UpdateClassSourceRequest,
  Workspace,
} from '@impact/protocol';
import { API } from '@impact/protocol';
import type { Diagnostic, DiagramView, EditOperation, EditResult, ParameterInfo, SimulationResult } from '@impact/core';

export class ApiClientError extends Error {
  status: number;
  code: string;
  details?: unknown;
  diagnostics: Diagnostic[];
  constructor(status: number, body: ApiError | undefined, fallback: string) {
    super(body?.error?.message ?? fallback);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = body?.error?.code ?? 'unknown';
    this.details = body?.error?.details;
    const d = (body?.error?.details as { diagnostics?: Diagnostic[] } | undefined)?.diagnostics;
    this.diagnostics = Array.isArray(d) ? d : [];
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let body: ApiError | undefined;
    try {
      body = (await res.json()) as ApiError;
    } catch {
      body = undefined;
    }
    throw new ApiClientError(res.status, body, `${init?.method ?? 'GET'} ${url} failed with ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
const putJson = (body: unknown): RequestInit => ({ method: 'PUT', body: JSON.stringify(body) });
const enc = encodeURIComponent;

export const remoteApi = {
  // workspaces
  listWorkspaces: () => request<ItemsResponse<Workspace>>(API.workspaces()),
  createWorkspace: (req: CreateWorkspaceRequest) => request<Workspace>(API.workspaces(), json(req)),
  getWorkspace: (wid: string) => request<Workspace>(API.workspace(wid)),
  deleteWorkspace: (wid: string) => request<void>(API.workspace(wid), { method: 'DELETE' }),
  renameWorkspace: (wid: string, name: string, description?: string) => request<Workspace>(API.workspace(wid), putJson({ name, description })),
  listProjects: (wid: string) => request<ItemsResponse<Project>>(API.projects(wid)),
  listDependencies: (wid: string) => request<ItemsResponse<Project>>(API.dependencies(wid)),
  listLibraries: (wid: string) => request<ItemsResponse<LibraryBundleDto>>(API.libraries(wid)),
  getLibrary: (wid: string, lid: string) => request<LibraryBundleDto>(API.library(wid, lid)),
  getDiagnostics: (wid: string) => request<{ items: { libraryId: string; path: string; diagnostics: Diagnostic[] }[] }>(`/api/workspaces/${wid}/diagnostics`),

  // classes
  classTree: (wid: string, parent?: string, q?: string) =>
    request<ItemsResponse<ClassTreeNodeDto>>(`${API.classTree(wid, parent)}${q ? `${parent ? '&' : '?'}q=${enc(q)}` : ''}`),
  getClassSource: (wid: string, className: string) => request<ClassSourceDto>(API.classSource(wid, className)),
  updateClassSource: (wid: string, className: string, req: UpdateClassSourceRequest) => request<ClassSourceDto>(API.classSource(wid, className), putJson(req)),
  createClass: (wid: string, req: CreateClassRequest) => request<ClassSourceDto>(API.createClass(wid), json(req)),
  deleteClass: (wid: string, className: string) => request<void>(`/api/workspaces/${wid}/classes/${enc(className)}`, { method: 'DELETE' }),
  editClass: (wid: string, className: string, op: EditOperation) => request<EditResult & { version: number }>(`/api/workspaces/${wid}/classes/${enc(className)}/edit`, json({ op })),
  getDiagram: (wid: string, className: string) => request<DiagramView>(`/api/workspaces/${wid}/classes/${enc(className)}/diagram`),
  getParameters: (wid: string, className: string, component?: string) =>
    request<ParameterInfo[]>(`/api/workspaces/${wid}/classes/${enc(className)}/parameters${component ? `?component=${enc(component)}` : ''}`),
  getDocumentation: (wid: string, className: string) => request<{ info?: string; revisions?: string }>(`/api/workspaces/${wid}/classes/${enc(className)}/documentation`),

  // custom functions
  listCustomFunctions: (wid: string) => request<ItemsResponse<CustomFunction>>(API.customFunctions(wid)),

  // model executables
  createModelExecutable: (wid: string, req: CompileRequest) => request<ModelExecutableDto>(API.modelExecutables(wid), json(req)),
  startCompilation: (wid: string, fid: string) => request<ExecutionStatusResponse>(API.compilation(wid, fid), { method: 'POST' }),
  getCompilation: (wid: string, fid: string) => request<ExecutionStatusResponse>(API.compilation(wid, fid)),
  getCompilationLog: (wid: string, fid: string) => request<string>(API.compilationLog(wid, fid), { headers: { Accept: 'text/plain' } }),
  getModelExecutable: (wid: string, fid: string) => request<ModelExecutableDto>(API.modelExecutable(wid, fid)),

  // experiments
  listExperiments: (wid: string, className?: string) => request<ItemsResponse<ExperimentDto>>(`${API.experiments(wid)}${className ? `?className=${enc(className)}` : ''}`),
  createExperiment: (wid: string, req: CreateExperimentRequest) => request<CreateExperimentResponse>(API.experiments(wid), json(req)),
  getExperiment: (wid: string, eid: string) => request<ExperimentDto>(API.experiment(wid, eid)),
  deleteExperiment: (wid: string, eid: string) => request<void>(API.experiment(wid, eid), { method: 'DELETE' }),
  relabelExperiment: (wid: string, eid: string, label: string) => request<ExperimentDto>(API.experiment(wid, eid), putJson({ label })),
  startExecution: (wid: string, eid: string) => request<ExecutionStatusResponse>(API.execution(wid, eid), { method: 'POST' }),
  getExecution: (wid: string, eid: string) => request<ExecutionStatusResponse>(API.execution(wid, eid)),
  cancelExecution: (wid: string, eid: string) => request<void>(API.execution(wid, eid), { method: 'DELETE' }),
  getExperimentVariables: (wid: string, eid: string) => request<ExperimentVariablesResponse>(API.experimentVariables(wid, eid)),
  getExperimentTrajectories: (wid: string, eid: string, req: TrajectoriesRequest) => request<TrajectoriesResponse>(API.experimentTrajectories(wid, eid), json(req)),
  listCases: (wid: string, eid: string) => request<ItemsResponse<CaseDto>>(API.cases(wid, eid)),
  getCase: (wid: string, eid: string, cid: string) => request<CaseDto>(API.case(wid, eid, cid)),
  getCaseTrajectories: (wid: string, eid: string, cid: string, req: TrajectoriesRequest) => request<number[][]>(API.caseTrajectories(wid, eid, cid), json(req)),
  getCaseLog: (wid: string, eid: string, cid: string) => request<CaseLogResponse>(API.caseLog(wid, eid, cid)),
  getCaseResultMeta: (wid: string, eid: string, cid: string) => request<CaseResultMetaResponse>(API.caseResultMeta(wid, eid, cid)),
  getCaseResultJson: (wid: string, eid: string, cid: string) => request<SimulationResult>(`${API.caseResult(wid, eid, cid)}?format=json`),
  caseResultCsvUrl: (wid: string, eid: string, cid: string) => API.caseResult(wid, eid, cid),
};

export type Api = typeof remoteApi;

// ---------------------------------------------------------------------------
// Implementation switch: the app talks to the REST server by default; a browser-only
// implementation (apps/web/src/api/local) can be plugged in for static/demo deployments.
// ---------------------------------------------------------------------------

export type ApiMode = 'remote' | 'local';

let current: Api = remoteApi;
let currentMode: ApiMode = 'remote';

/** Replaces the active API implementation (call before the first render). */
export function setApiImplementation(impl: Api, mode: ApiMode): void {
  current = impl;
  currentMode = mode;
}

export function getApiMode(): ApiMode {
  return currentMode;
}

/** Facade used by the store and components; delegates every call to the active implementation. */
export const api: Api = new Proxy({} as Api, {
  get(_target, prop: string) {
    return (current as unknown as Record<string, unknown>)[prop];
  },
}) as Api;
