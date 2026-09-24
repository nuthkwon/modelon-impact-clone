/**
 * File-backed store. Layout (see docs/ARCHITECTURE.md, "Server data layout"):
 *
 *   <dataDir>/workspaces/<wid>/workspace.json                       WorkspaceDefinition
 *   <dataDir>/workspaces/<wid>/projects/<pid>/project.json          { definition, projectType }
 *   <dataDir>/workspaces/<wid>/projects/<pid>/<Lib>.mo | <Lib>/…    Modelica sources
 *   <dataDir>/workspaces/<wid>/experiments/<eid>/experiment.json    ExperimentDto
 *   <dataDir>/workspaces/<wid>/experiments/<eid>/cases/<cid>.json   CaseDto
 *   <dataDir>/workspaces/<wid>/experiments/<eid>/cases/<cid>.result.json  SimulationResult
 *   <dataDir>/workspaces/<wid>/experiments/<eid>/cases/<cid>.log    simulation log text
 *   <dataDir>/workspaces/<wid>/model-executables/<fid>.json         ModelExecutableDto
 *   <dataDir>/workspaces/<wid>/model-executables/<fid>.log          compilation log text
 *
 * The read-only `Modelica` dependency is served from `<librariesDir>/Modelica/` and is never
 * copied. `<librariesDir>/Examples/` is copied into every new workspace as project `Examples`.
 */
import path from 'node:path';
import type { SimulationResult } from '@impact/core';
import type { CaseDto, ExperimentDto, ModelExecutableDto, Project, ProjectContent, ProjectType, Workspace, WorkspaceDefinition } from '@impact/protocol';
import { caseIndex, newContentId, newProjectId, newWorkspaceId } from './ids.js';
import { copyDirContents, dirSize, ensureDir, exists, isDirectory, isFile, isSafeRelative, listDir, listFilesRecursive, listSubdirs, readJson, readText, removeFile, removeRecursive, writeJsonAtomic, writeTextAtomic } from './fsutil.js';
import { notFound } from './errors.js';
import { isValidId } from './validate.js';

export const MODELICA_LIBRARY_ID = 'modelica';
export const MODELICA_LIBRARY_NAME = 'Modelica';
export const FORMAT_VERSION = '1.0.0';
export const PLACEHOLDER_EXAMPLES = 'package Examples "Example models"\nend Examples;\n';

/** A top-level Modelica library inside a container directory: `Modelica/` (directory package) or `Examples.mo` (single file). */
export interface LibraryRoot {
  /** Path relative to the container; directories end with `/`. */
  relpath: string;
  /** Top-level class name. */
  name: string;
}

export interface StorageOptions {
  dataDir: string;
  librariesDir: string;
}

interface StoredProject {
  definition: Project['definition'];
  projectType: ProjectType;
}

export class Storage {
  readonly dataDir: string;
  readonly librariesDir: string;

  constructor(options: StorageOptions) {
    this.dataDir = path.resolve(options.dataDir);
    this.librariesDir = path.resolve(options.librariesDir);
    ensureDir(this.workspacesDir);
  }

  // ---------------------------------------------------------------------------------------
  // Paths
  // ---------------------------------------------------------------------------------------

  get workspacesDir(): string {
    return path.join(this.dataDir, 'workspaces');
  }
  workspaceDir(wid: string): string {
    return path.join(this.workspacesDir, wid);
  }
  private workspaceFile(wid: string): string {
    return path.join(this.workspaceDir(wid), 'workspace.json');
  }
  projectsDir(wid: string): string {
    return path.join(this.workspaceDir(wid), 'projects');
  }
  projectDir(wid: string, pid: string): string {
    return path.join(this.projectsDir(wid), pid);
  }
  private projectFile(wid: string, pid: string): string {
    return path.join(this.projectDir(wid, pid), 'project.json');
  }
  experimentsDir(wid: string): string {
    return path.join(this.workspaceDir(wid), 'experiments');
  }
  experimentDir(wid: string, eid: string): string {
    return path.join(this.experimentsDir(wid), eid);
  }
  private experimentFile(wid: string, eid: string): string {
    return path.join(this.experimentDir(wid, eid), 'experiment.json');
  }
  casesDir(wid: string, eid: string): string {
    return path.join(this.experimentDir(wid, eid), 'cases');
  }
  private caseFile(wid: string, eid: string, cid: string): string {
    return path.join(this.casesDir(wid, eid), `${cid}.json`);
  }
  private caseResultFile(wid: string, eid: string, cid: string): string {
    return path.join(this.casesDir(wid, eid), `${cid}.result.json`);
  }
  private caseLogFile(wid: string, eid: string, cid: string): string {
    return path.join(this.casesDir(wid, eid), `${cid}.log`);
  }
  executablesDir(wid: string): string {
    return path.join(this.workspaceDir(wid), 'model-executables');
  }
  private executableFile(wid: string, fid: string): string {
    return path.join(this.executablesDir(wid), `${fid}.json`);
  }
  private executableLogFile(wid: string, fid: string): string {
    return path.join(this.executablesDir(wid), `${fid}.log`);
  }

  // ---------------------------------------------------------------------------------------
  // Modelica dependency (read-only, served from <librariesDir>/Modelica)
  // ---------------------------------------------------------------------------------------

  /** Where the Modelica library files live and which top-level roots they form. */
  modelicaLibrary(): { containerDir: string; roots: LibraryRoot[] } {
    const dir = path.join(this.librariesDir, MODELICA_LIBRARY_NAME);
    if (isFile(path.join(dir, 'package.mo'))) {
      return { containerDir: this.librariesDir, roots: [{ relpath: `${MODELICA_LIBRARY_NAME}/`, name: MODELICA_LIBRARY_NAME }] };
    }
    return { containerDir: dir, roots: discoverRoots(dir) };
  }

  /** The Modelica dependency as an Impact `Project` (projectType SYSTEM). */
  modelicaProject(): Project {
    const { roots } = this.modelicaLibrary();
    const content: ProjectContent[] = (roots.length ? roots : [{ relpath: `${MODELICA_LIBRARY_NAME}/`, name: MODELICA_LIBRARY_NAME }]).map((root, i) => ({
      id: i === 0 ? MODELICA_LIBRARY_ID : `${MODELICA_LIBRARY_ID}-${root.name.toLowerCase()}`,
      relpath: root.relpath,
      contentType: 'MODELICA',
      name: root.name,
      defaultDisabled: false,
      readOnly: true,
    }));
    return {
      id: MODELICA_LIBRARY_ID,
      definition: { name: MODELICA_LIBRARY_NAME, format: FORMAT_VERSION, content, dependencies: [] },
      projectType: 'SYSTEM',
    };
  }

  // ---------------------------------------------------------------------------------------
  // Workspaces
  // ---------------------------------------------------------------------------------------

  /** Ids of the workspace directories on disk (well-formed ones only). */
  listWorkspaceIds(): string[] {
    return listSubdirs(this.workspacesDir).filter(isValidId);
  }

  listWorkspaces(): Workspace[] {
    const out: Workspace[] = [];
    for (const wid of this.listWorkspaceIds()) {
      const ws = this.getWorkspace(wid);
      if (ws) out.push(ws);
    }
    return out.sort((a, b) => a.definition.createdAt.localeCompare(b.definition.createdAt));
  }

  // Every id is checked against the strict id pattern (no `.`, `/`, `\`) before it is joined
  // into a path, so `ws_x/.`-style aliases of a directory never reach the filesystem or the
  // caches/job maps keyed by the raw id.

  getWorkspace(wid: string): Workspace | undefined {
    if (!isValidId(wid)) return undefined;
    const definition = readJson<WorkspaceDefinition>(this.workspaceFile(wid));
    if (!definition) return undefined;
    return { id: wid, definition, sizeInfo: { total: dirSize(this.workspaceDir(wid)) } };
  }

  requireWorkspace(wid: string): Workspace {
    const ws = this.getWorkspace(wid);
    if (!ws) throw notFound(`Workspace '${wid}' not found`);
    return ws;
  }

  /** Creates a workspace with the `Modelica` dependency and a seeded editable `Examples` project. */
  createWorkspace(name: string, description?: string): Workspace {
    const wid = newWorkspaceId();
    const now = new Date().toISOString();
    ensureDir(this.workspaceDir(wid));
    const project = this.seedExamplesProject(wid);
    const definition: WorkspaceDefinition = {
      name,
      format: FORMAT_VERSION,
      ...(description !== undefined ? { description } : {}),
      createdAt: now,
      updatedAt: now,
      projects: [{ reference: { id: project.id }, disabled: false }],
      dependencies: [{ reference: { id: MODELICA_LIBRARY_ID }, disabled: false }],
    };
    writeJsonAtomic(this.workspaceFile(wid), definition);
    return { id: wid, definition, sizeInfo: { total: dirSize(this.workspaceDir(wid)) } };
  }

  updateWorkspace(wid: string, patch: { name?: string; description?: string }): Workspace {
    const ws = this.requireWorkspace(wid);
    const definition: WorkspaceDefinition = {
      ...ws.definition,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      updatedAt: new Date().toISOString(),
    };
    writeJsonAtomic(this.workspaceFile(wid), definition);
    return { id: wid, definition, sizeInfo: ws.sizeInfo };
  }

  touchWorkspace(wid: string): void {
    const definition = readJson<WorkspaceDefinition>(this.workspaceFile(wid));
    if (!definition) return;
    definition.updatedAt = new Date().toISOString();
    writeJsonAtomic(this.workspaceFile(wid), definition);
  }

  deleteWorkspace(wid: string): boolean {
    if (!this.getWorkspace(wid)) return false;
    removeRecursive(this.workspaceDir(wid));
    return true;
  }

  /** First-start seeding: a workspace `Default` with the `Examples` project. */
  seedIfEmpty(): Workspace | undefined {
    if (this.listWorkspaces().length > 0) return undefined;
    return this.createWorkspace('Default', 'Default workspace');
  }

  // ---------------------------------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------------------------------

  private seedExamplesProject(wid: string): Project {
    const pid = newProjectId();
    const dir = this.projectDir(wid, pid);
    ensureDir(dir);
    const src = path.join(this.librariesDir, 'Examples');
    if (isFile(path.join(src, 'package.mo'))) {
      copyDirContents(src, path.join(dir, 'Examples'));
    } else if (isDirectory(src) && listFilesRecursive(src).some((f) => f.endsWith('.mo'))) {
      copyDirContents(src, dir);
    } else {
      writeTextAtomic(path.join(dir, 'Examples.mo'), PLACEHOLDER_EXAMPLES);
    }
    const project: Project = {
      id: pid,
      definition: {
        name: 'Examples',
        format: FORMAT_VERSION,
        content: discoverRoots(dir).map((root) => rootToContent(root, newContentId())),
        dependencies: [{ name: MODELICA_LIBRARY_NAME }],
      },
      projectType: 'LOCAL',
    };
    this.saveProject(wid, project);
    return project;
  }

  listProjects(wid: string): Project[] {
    const ws = this.requireWorkspace(wid);
    const out: Project[] = [];
    for (const ref of ws.definition.projects) {
      const p = this.getProject(wid, ref.reference.id);
      if (p) out.push(p);
    }
    // Projects present on disk but missing from the workspace definition are still listed.
    for (const pid of listSubdirs(this.projectsDir(wid))) {
      if (out.some((p) => p.id === pid)) continue;
      const p = this.getProject(wid, pid);
      if (p) out.push(p);
    }
    return out;
  }

  /** Reads a project and reconciles its MODELICA content list with the files on disk. */
  getProject(wid: string, pid: string): Project | undefined {
    if (!isValidId(wid) || !isValidId(pid)) return undefined;
    const stored = readJson<StoredProject>(this.projectFile(wid, pid));
    if (!stored) return undefined;
    const project: Project = { id: pid, definition: stored.definition, projectType: stored.projectType ?? 'LOCAL' };
    if (this.reconcileContents(wid, project)) this.saveProject(wid, project);
    return project;
  }

  requireProject(wid: string, pid: string): Project {
    const p = this.getProject(wid, pid);
    if (!p) throw notFound(`Project '${pid}' not found in workspace '${wid}'`);
    return p;
  }

  saveProject(wid: string, project: Project): void {
    const stored: StoredProject = { definition: project.definition, projectType: project.projectType };
    writeJsonAtomic(this.projectFile(wid, project.id), stored);
  }

  /** Editable projects of the workspace, in workspace order. */
  editableProjects(wid: string): Project[] {
    return this.listProjects(wid).filter((p) => p.projectType !== 'SYSTEM');
  }

  /** The project owning MODELICA content `libraryId`. */
  findProjectByContent(wid: string, libraryId: string): { project: Project; content: ProjectContent } | undefined {
    for (const project of this.listProjects(wid)) {
      const content = project.definition.content.find((c) => c.id === libraryId);
      if (content) return { project, content };
    }
    return undefined;
  }

  /** Adds a MODELICA content entry (a new top-level library) to a project. */
  addContent(wid: string, project: Project, root: LibraryRoot): ProjectContent {
    const content = rootToContent(root, newContentId());
    project.definition.content.push(content);
    this.saveProject(wid, project);
    return content;
  }

  removeContent(wid: string, project: Project, contentId: string): void {
    project.definition.content = project.definition.content.filter((c) => c.id !== contentId);
    this.saveProject(wid, project);
  }

  private reconcileContents(wid: string, project: Project): boolean {
    const dir = this.projectDir(wid, project.id);
    const roots = discoverRoots(dir);
    let changed = false;
    const kept: ProjectContent[] = [];
    for (const c of project.definition.content) {
      if (c.contentType !== 'MODELICA') {
        kept.push(c);
        continue;
      }
      const root = roots.find((r) => r.relpath === c.relpath);
      if (root) kept.push(c);
      else changed = true;
    }
    for (const root of roots) {
      if (!kept.some((c) => c.relpath === root.relpath)) {
        kept.push(rootToContent(root, newContentId()));
        changed = true;
      }
    }
    if (changed) project.definition.content = kept;
    return changed;
  }

  projectFilePath(wid: string, pid: string, relpath: string): string {
    if (!isSafeRelative(relpath)) throw notFound(`Invalid file path '${relpath}'`);
    return path.join(this.projectDir(wid, pid), relpath);
  }

  readProjectFile(wid: string, pid: string, relpath: string): string | undefined {
    return readText(this.projectFilePath(wid, pid, relpath));
  }

  writeProjectFile(wid: string, pid: string, relpath: string, text: string): void {
    writeTextAtomic(this.projectFilePath(wid, pid, relpath), text);
    this.touchWorkspace(wid);
  }

  deleteProjectFile(wid: string, pid: string, relpath: string): void {
    removeFile(this.projectFilePath(wid, pid, relpath));
    this.touchWorkspace(wid);
  }

  deleteProjectDir(wid: string, pid: string, relpath: string): void {
    removeRecursive(this.projectFilePath(wid, pid, relpath));
    this.touchWorkspace(wid);
  }

  // ---------------------------------------------------------------------------------------
  // Experiments & cases
  // ---------------------------------------------------------------------------------------

  listExperiments(wid: string): ExperimentDto[] {
    const out: ExperimentDto[] = [];
    if (!isValidId(wid)) return out;
    for (const eid of listSubdirs(this.experimentsDir(wid))) {
      const e = this.getExperiment(wid, eid);
      if (e) out.push(e);
    }
    return out.sort((a, b) => b.meta_data.created_at.localeCompare(a.meta_data.created_at) || b.id.localeCompare(a.id));
  }

  getExperiment(wid: string, eid: string): ExperimentDto | undefined {
    if (!isValidId(wid) || !isValidId(eid)) return undefined;
    return readJson<ExperimentDto>(this.experimentFile(wid, eid));
  }

  requireExperiment(wid: string, eid: string): ExperimentDto {
    const e = this.getExperiment(wid, eid);
    if (!e) throw notFound(`Experiment '${eid}' not found in workspace '${wid}'`);
    return e;
  }

  saveExperiment(wid: string, experiment: ExperimentDto): void {
    writeJsonAtomic(this.experimentFile(wid, experiment.id), experiment);
  }

  deleteExperiment(wid: string, eid: string): boolean {
    if (!this.getExperiment(wid, eid)) return false;
    removeRecursive(this.experimentDir(wid, eid));
    return true;
  }

  listCases(wid: string, eid: string): CaseDto[] {
    const out: CaseDto[] = [];
    if (!isValidId(wid) || !isValidId(eid)) return out;
    for (const entry of listDir(this.casesDir(wid, eid))) {
      if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.endsWith('.result.json')) continue;
      const c = readJson<CaseDto>(path.join(this.casesDir(wid, eid), entry.name));
      if (c) out.push(c);
    }
    return out.sort((a, b) => caseIndex(a.id) - caseIndex(b.id));
  }

  getCase(wid: string, eid: string, cid: string): CaseDto | undefined {
    if (!isValidId(wid) || !isValidId(eid) || !isValidId(cid)) return undefined;
    return readJson<CaseDto>(this.caseFile(wid, eid, cid));
  }

  requireCase(wid: string, eid: string, cid: string): CaseDto {
    const c = this.getCase(wid, eid, cid);
    if (!c) throw notFound(`Case '${cid}' not found in experiment '${eid}'`);
    return c;
  }

  saveCase(wid: string, eid: string, c: CaseDto): void {
    writeJsonAtomic(this.caseFile(wid, eid, c.id), c);
  }

  readCaseResult(wid: string, eid: string, cid: string): SimulationResult | undefined {
    if (!isValidId(wid) || !isValidId(eid) || !isValidId(cid)) return undefined;
    return readJson<SimulationResult>(this.caseResultFile(wid, eid, cid));
  }

  writeCaseResult(wid: string, eid: string, cid: string, result: SimulationResult): void {
    writeJsonAtomic(this.caseResultFile(wid, eid, cid), result, /*pretty*/ false);
  }

  readCaseLog(wid: string, eid: string, cid: string): string {
    if (!isValidId(wid) || !isValidId(eid) || !isValidId(cid)) return '';
    return readText(this.caseLogFile(wid, eid, cid)) ?? '';
  }

  /** Removes a case's result and log files (before a re-run, so a failed run cannot show stale data). */
  clearCaseOutputs(wid: string, eid: string, cid: string): void {
    if (!isValidId(wid) || !isValidId(eid) || !isValidId(cid)) return;
    removeFile(this.caseResultFile(wid, eid, cid));
    removeFile(this.caseLogFile(wid, eid, cid));
  }

  writeCaseLog(wid: string, eid: string, cid: string, log: string): void {
    writeTextAtomic(this.caseLogFile(wid, eid, cid), log);
  }

  // ---------------------------------------------------------------------------------------
  // Model executables
  // ---------------------------------------------------------------------------------------

  listExecutables(wid: string): ModelExecutableDto[] {
    const out: ModelExecutableDto[] = [];
    if (!isValidId(wid)) return out;
    for (const entry of listDir(this.executablesDir(wid))) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const e = readJson<ModelExecutableDto>(path.join(this.executablesDir(wid), entry.name));
      if (e) out.push(e);
    }
    return out.sort((a, b) => (b.run_info.datetime_started ?? '').localeCompare(a.run_info.datetime_started ?? '') || b.id.localeCompare(a.id));
  }

  getExecutable(wid: string, fid: string): ModelExecutableDto | undefined {
    if (!isValidId(wid) || !isValidId(fid)) return undefined;
    return readJson<ModelExecutableDto>(this.executableFile(wid, fid));
  }

  requireExecutable(wid: string, fid: string): ModelExecutableDto {
    const e = this.getExecutable(wid, fid);
    if (!e) throw notFound(`Model executable '${fid}' not found in workspace '${wid}'`);
    return e;
  }

  saveExecutable(wid: string, executable: ModelExecutableDto): void {
    writeJsonAtomic(this.executableFile(wid, executable.id), executable);
  }

  deleteExecutable(wid: string, fid: string): boolean {
    if (!this.getExecutable(wid, fid)) return false;
    removeFile(this.executableFile(wid, fid));
    removeFile(this.executableLogFile(wid, fid));
    return true;
  }

  readExecutableLog(wid: string, fid: string): string {
    if (!isValidId(wid) || !isValidId(fid)) return '';
    return readText(this.executableLogFile(wid, fid)) ?? '';
  }

  writeExecutableLog(wid: string, fid: string, log: string): void {
    writeTextAtomic(this.executableLogFile(wid, fid), log);
  }
}

/** Top-level libraries found directly in `dir`: `X.mo` files and `X/` directories holding a `package.mo`. */
export function discoverRoots(dir: string): LibraryRoot[] {
  const roots: LibraryRoot[] = [];
  for (const entry of listDir(dir)) {
    if (entry.isDirectory()) {
      if (isFile(path.join(dir, entry.name, 'package.mo'))) roots.push({ relpath: `${entry.name}/`, name: entry.name });
    } else if (entry.isFile() && entry.name.endsWith('.mo') && entry.name !== 'package.mo') {
      roots.push({ relpath: entry.name, name: entry.name.slice(0, -3) });
    }
  }
  return roots;
}

function rootToContent(root: LibraryRoot, id: string): ProjectContent {
  return { id, relpath: root.relpath, contentType: 'MODELICA', name: root.name, defaultDisabled: false, readOnly: false };
}

export { exists };
