/**
 * One `ClassRegistry` per workspace, built lazily from the read-only `Modelica` dependency,
 * the workspace's imported library dependencies (read-only) and every MODELICA content of its
 * editable projects.
 *
 * Load order inside a library is deterministic: `package.mo` first, then the remaining
 * entries alphabetically (directories are packages and recurse the same way), and finally
 * `package.order` (applied through `registry.setChildOrder` once all children exist).
 *
 * The cache also keeps the raw text + version of every file — including files the parser
 * rejected, which the registry itself does not store — so the source endpoints can still
 * serve and repair them.
 */
import path from 'node:path';
import { ClassRegistry, type Diagnostic, type RegisteredClass } from '@impact/core';
import type { Project, ProjectContent } from '@impact/protocol';
import { isFile, listDir, readText } from './fsutil.js';
import { MODELICA_LIBRARY_ID, MODELICA_LIBRARY_NAME, Storage, type LibraryRoot } from './storage.js';

export interface LoadedFile {
  libraryId: string;
  /** Path relative to the library's container directory, e.g. `Modelica/Electrical/package.mo` or `Examples.mo`. */
  path: string;
  text: string;
  /** Optimistic-concurrency stamp; increases on every successful save. */
  version: number;
  diagnostics: Diagnostic[];
}

export interface LibraryEntry {
  id: string;
  name: string;
  readOnly: boolean;
  /** Directory that file paths are relative to. */
  containerDir: string;
  roots: LibraryRoot[];
  /** Owning project for editable libraries. */
  projectId?: string;
  /** Bundle version: increases whenever any file changes. */
  version: number;
  files: Map<string, LoadedFile>;
}

export interface WorkspaceRegistry {
  wid: string;
  registry: ClassRegistry;
  libraries: Map<string, LibraryEntry>;
}

export interface ClassFileHit {
  lib: LibraryEntry;
  file: LoadedFile;
  /** Present when the registry knows the class (i.e. the file parsed). */
  cls?: RegisteredClass;
}

export interface WorkspaceDiagnostic extends Diagnostic {
  libraryId: string;
}

export class RegistryCache {
  private cache = new Map<string, WorkspaceRegistry>();

  constructor(private readonly storage: Storage) {}

  /** The workspace registry, built on first access. Throws 404 for unknown workspaces. */
  get(wid: string): WorkspaceRegistry {
    let wr = this.cache.get(wid);
    if (!wr) {
      this.storage.requireWorkspace(wid);
      wr = this.build(wid);
      this.cache.set(wid, wr);
    }
    return wr;
  }

  invalidate(wid: string): void {
    this.cache.delete(wid);
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  private build(wid: string): WorkspaceRegistry {
    const registry = new ClassRegistry();
    const wr: WorkspaceRegistry = { wid, registry, libraries: new Map() };

    const { containerDir, roots } = this.storage.modelicaLibrary();
    const modelica: LibraryEntry = {
      id: MODELICA_LIBRARY_ID,
      name: MODELICA_LIBRARY_NAME,
      readOnly: true,
      containerDir,
      roots,
      version: 1,
      files: new Map(),
    };
    registry.addLibrary({ id: modelica.id, name: modelica.name, readOnly: true });
    wr.libraries.set(modelica.id, modelica);
    this.loadLibrary(wr, modelica);

    for (const dep of this.storage.dependencyProjects(wid)) {
      if (dep.id === MODELICA_LIBRARY_ID) continue;
      for (const content of dep.definition.content) {
        if (content.contentType !== 'MODELICA') continue;
        const lib: LibraryEntry = {
          id: content.id,
          name: content.name,
          readOnly: true,
          containerDir: this.storage.installedLibraryDir(dep.id),
          roots: [{ relpath: content.relpath, name: content.name }],
          version: 1,
          files: new Map(),
        };
        registry.addLibrary({ id: lib.id, name: lib.name, readOnly: true });
        wr.libraries.set(lib.id, lib);
        this.loadLibrary(wr, lib);
      }
    }

    for (const project of this.storage.editableProjects(wid)) {
      for (const content of project.definition.content) {
        if (content.contentType !== 'MODELICA') continue;
        this.addProjectLibrary(wr, project, content);
      }
    }
    return wr;
  }

  /** Registers a project content as an editable library and loads its files. */
  addProjectLibrary(wr: WorkspaceRegistry, project: Project, content: ProjectContent): LibraryEntry {
    const lib: LibraryEntry = {
      id: content.id,
      name: content.name,
      readOnly: content.readOnly === true,
      containerDir: this.storage.projectDir(wr.wid, project.id),
      roots: [{ relpath: content.relpath, name: content.name }],
      projectId: project.id,
      version: 1,
      files: new Map(),
    };
    wr.registry.addLibrary({ id: lib.id, name: lib.name, readOnly: lib.readOnly });
    wr.libraries.set(lib.id, lib);
    this.loadLibrary(wr, lib);
    return lib;
  }

  removeLibrary(wr: WorkspaceRegistry, libraryId: string): void {
    wr.registry.removeLibrary(libraryId);
    wr.libraries.delete(libraryId);
  }

  /** Reloads every file of a library from disk. */
  reloadLibrary(wr: WorkspaceRegistry, lib: LibraryEntry): void {
    for (const p of [...lib.files.keys()]) wr.registry.removeFile(lib.id, p);
    lib.files.clear();
    wr.registry.addLibrary({ id: lib.id, name: lib.name, readOnly: lib.readOnly });
    this.loadLibrary(wr, lib);
    lib.version++;
  }

  private loadLibrary(wr: WorkspaceRegistry, lib: LibraryEntry): void {
    for (const root of lib.roots) {
      if (root.relpath.endsWith('/')) {
        this.loadPackageDir(wr, lib, path.join(lib.containerDir, root.relpath), root.relpath, root.name);
      } else {
        this.loadFile(wr, lib, root.relpath);
      }
    }
  }

  private loadPackageDir(wr: WorkspaceRegistry, lib: LibraryEntry, absDir: string, relDir: string, qualifiedName: string): void {
    if (isFile(path.join(absDir, 'package.mo'))) this.loadFile(wr, lib, `${relDir}package.mo`);
    for (const entry of listDir(absDir)) {
      if (entry.name === 'package.mo' || entry.name === 'package.order') continue;
      if (entry.isDirectory()) {
        const sub = path.join(absDir, entry.name);
        if (containsModelica(sub)) this.loadPackageDir(wr, lib, sub, `${relDir}${entry.name}/`, `${qualifiedName}.${entry.name}`);
      } else if (entry.isFile() && entry.name.endsWith('.mo')) {
        this.loadFile(wr, lib, `${relDir}${entry.name}`);
      }
    }
    const order = readText(path.join(absDir, 'package.order'));
    if (order !== undefined) {
      const names = order
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('//'));
      if (names.length) wr.registry.setChildOrder(qualifiedName, names);
    }
  }

  private loadFile(wr: WorkspaceRegistry, lib: LibraryEntry, relpath: string): void {
    const text = readText(path.join(lib.containerDir, relpath));
    if (text === undefined) return;
    const diagnostics = wr.registry.addFile(lib.id, relpath, text).map((d) => ({ ...d, file: d.file ?? relpath }));
    lib.files.set(relpath, {
      libraryId: lib.id,
      path: relpath,
      text,
      version: wr.registry.getFile(lib.id, relpath)?.version ?? 1,
      diagnostics,
    });
  }

  /**
   * Replaces the text of a file in the registry and the cache (the caller persists it).
   * Returns the parse diagnostics; on a parse error the registry keeps the previous
   * definition but the cache stores the new text so it can be served/fixed.
   */
  setFile(wr: WorkspaceRegistry, lib: LibraryEntry, relpath: string, text: string): Diagnostic[] {
    const diagnostics = wr.registry.addFile(lib.id, relpath, text).map((d) => ({ ...d, file: d.file ?? relpath }));
    const previous = lib.files.get(relpath);
    const registryVersion = wr.registry.getFile(lib.id, relpath)?.version ?? 0;
    const version = Math.max((previous?.version ?? 0) + 1, registryVersion);
    lib.files.set(relpath, { libraryId: lib.id, path: relpath, text, version, diagnostics });
    lib.version++;
    return diagnostics;
  }

  deleteFile(wr: WorkspaceRegistry, lib: LibraryEntry, relpath: string): void {
    wr.registry.removeFile(lib.id, relpath);
    lib.files.delete(relpath);
    lib.version++;
  }

  /**
   * The library + file holding `className`. Uses the registry when the class is known and
   * falls back to the conventional file layout (`A/B/C.mo`, `A/B/C/package.mo`, …, `A.mo`)
   * so that files with syntax errors can still be fetched and repaired.
   */
  fileOfClass(wr: WorkspaceRegistry, className: string): ClassFileHit | undefined {
    const cls = wr.registry.get(className);
    if (cls && !cls.builtin) {
      const lib = wr.libraries.get(cls.libraryId);
      const file = lib?.files.get(cls.file);
      if (lib && file) return { lib, file, cls };
    }
    const parts = className.split('.');
    const libs = [...wr.libraries.values()].sort((a, b) => Number(a.readOnly) - Number(b.readOnly));
    for (const lib of libs) {
      if (!lib.roots.some((r) => r.name === parts[0])) continue;
      for (let depth = parts.length; depth >= 1; depth--) {
        const base = parts.slice(0, depth).join('/');
        const file = lib.files.get(`${base}.mo`) ?? lib.files.get(`${base}/package.mo`);
        if (file) return { lib, file };
      }
    }
    return undefined;
  }

  /** Library entry by id (MODELICA content id or `modelica`). */
  library(wr: WorkspaceRegistry, libraryId: string): LibraryEntry | undefined {
    return wr.libraries.get(libraryId);
  }

  /** All parse diagnostics of the workspace, tagged with the library they belong to. */
  diagnostics(wid: string): WorkspaceDiagnostic[] {
    const wr = this.get(wid);
    const out: WorkspaceDiagnostic[] = [];
    for (const lib of wr.libraries.values()) {
      for (const file of lib.files.values()) {
        for (const d of file.diagnostics) out.push({ ...d, file: d.file ?? file.path, libraryId: lib.id });
      }
    }
    return out;
  }
}

function containsModelica(dir: string): boolean {
  for (const entry of listDir(dir)) {
    if (entry.isFile() && entry.name.endsWith('.mo')) return true;
    if (entry.isDirectory() && containsModelica(path.join(dir, entry.name))) return true;
  }
  return false;
}
