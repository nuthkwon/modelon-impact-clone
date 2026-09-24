/**
 * Class browsing & editing (UI support endpoints):
 *
 *   GET    /:wid/classes?parent=&q=                 class tree / search
 *   POST   /:wid/classes                            create class
 *   GET    /:wid/classes/:className/source          file text + version
 *   PUT    /:wid/classes/:className/source          save (422 on syntax error, 409 on stale version)
 *   DELETE /:wid/classes/:className                 delete class (file or nested)
 *   POST   /:wid/classes/:className/edit            applyEdit operation
 *   GET    /:wid/classes/:className/diagram         DiagramView
 *   GET    /:wid/classes/:className/parameters      ParameterInfo[]
 *   GET    /:wid/classes/:className/documentation   Documentation annotation
 */
import { Router } from 'express';
import { applyEdit, buildClassTree, buildDiagramView, getParameters, parse, parseDocumentation, searchClasses, type ClassTreeNode, type EditOperation, type RegisteredClass } from '@impact/core';
import type { ClassSourceDto, ClassTreeNodeDto, CreateClassRequest, ItemsResponse } from '@impact/protocol';
import type { AppContext } from '../context.js';
import { conflict, diagnosticsOf, notFound, readOnly, unprocessable } from '../errors.js';
import { readText } from '../fsutil.js';
import type { ClassFileHit, LibraryEntry, LoadedFile, WorkspaceRegistry } from '../registry-cache.js';
import path from 'node:path';
import { optionalEnum, optionalNumber, optionalString, queryString, requireClassName, requireObject, requireString } from '../validate.js';

const RESTRICTIONS = ['model', 'package', 'block', 'connector', 'record', 'type', 'function'] as const;

function toTreeDto(n: ClassTreeNode): ClassTreeNodeDto {
  return {
    name: n.name,
    shortName: n.shortName,
    restriction: n.restriction,
    ...(n.description !== undefined ? { description: n.description } : {}),
    partial: n.partial,
    hasChildren: n.hasChildren,
    libraryId: n.libraryId,
    readOnly: n.readOnly,
    droppable: n.droppable,
    ...(n.icon !== undefined ? { icon: n.icon } : {}),
  };
}

function sourceDto(className: string, lib: LibraryEntry, file: LoadedFile): ClassSourceDto {
  return { className, libraryId: lib.id, file: file.path, text: file.text, readOnly: lib.readOnly, version: file.version };
}

/** Persists a library file to disk and re-indexes it. */
function saveLibraryFile(ctx: AppContext, wr: WorkspaceRegistry, lib: LibraryEntry, relpath: string, text: string): LoadedFile {
  if (lib.readOnly || !lib.projectId) throw readOnly(`Library '${lib.name}' is read-only`);
  ctx.storage.writeProjectFile(wr.wid, lib.projectId, relpath, text);
  ctx.registries.setFile(wr, lib, relpath, text);
  return lib.files.get(relpath)!;
}

/** Parses `text`; syntax errors become 422 responses. */
function checkSyntax(text: string, file: string): void {
  try {
    parse(text, file);
  } catch (e) {
    if (e instanceof Error && e.name === 'ModelicaError') throw unprocessable(`Syntax error in ${file}: ${e.message}`, diagnosticsOf(e));
    throw e;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Position of the `end Name;` that closes `cls` in `text`. */
function locateEnd(text: string, cls: RegisteredClass): { start: number; end: number } | undefined {
  const re = new RegExp(`\\bend\\s+${escapeRegExp(cls.def.name)}\\s*;`, 'g');
  const matches = [...text.matchAll(re)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
  if (!matches.length) return undefined;
  const loc = cls.def.loc;
  if (loc) {
    const regionEnd = loc.offset + loc.length;
    const inRegion = matches.filter((m) => m.start >= loc.offset && m.end <= regionEnd + 1);
    if (inRegion.length) return inRegion[inRegion.length - 1];
    const after = matches.filter((m) => m.start >= loc.offset);
    if (after.length) return after[0];
  }
  return matches[matches.length - 1];
}

/** Inserts `snippet` (unindented class text) as the last element of `parent`. */
function insertNestedClass(text: string, parent: RegisteredClass, snippet: string): string {
  const endMatch = locateEnd(text, parent);
  if (!endMatch) throw conflict(`Cannot locate 'end ${parent.def.name};' in the source of ${parent.fullName}`);
  const lineStart = text.lastIndexOf('\n', endMatch.start - 1) + 1;
  const prefix = text.slice(lineStart, endMatch.start);
  const body = snippet.replace(/\s+$/, '');
  if (/^\s*$/.test(prefix)) {
    const inner = `${prefix}  `;
    const block = body
      .split('\n')
      .map((l) => (l ? inner + l : l))
      .join('\n');
    return `${text.slice(0, lineStart)}${block}\n${text.slice(lineStart)}`;
  }
  const block = body
    .split('\n')
    .map((l) => (l ? `  ${l}` : l))
    .join('\n');
  return `${text.slice(0, endMatch.start)}\n${block}\n${text.slice(endMatch.start)}`;
}

/** Removes the text of `cls` (whole lines) from `text`; undefined when its extent is unknown. */
function removeClassText(text: string, cls: RegisteredClass): string | undefined {
  const loc = cls.def.loc;
  if (!loc) return undefined;
  let end: number;
  if (cls.def.shortClass) {
    end = loc.offset + loc.length;
    const semi = text.indexOf(';', Math.max(loc.offset, end - 1));
    if (semi >= 0 && semi < end + 2) end = semi + 1;
  } else {
    const endMatch = locateEnd(text, cls);
    if (!endMatch || endMatch.start < loc.offset) return undefined;
    end = endMatch.end;
  }
  let start = loc.offset;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  if (/^\s*$/.test(text.slice(lineStart, start))) start = lineStart;
  const nl = text.indexOf('\n', end);
  if (/^\s*$/.test(text.slice(end, nl < 0 ? text.length : nl))) end = nl < 0 ? text.length : nl + 1;
  return text.slice(0, start) + text.slice(end);
}

function newClassText(restriction: (typeof RESTRICTIONS)[number], shortName: string, description?: string, extendsClass?: string): string {
  const desc = description ? ` "${description.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : '';
  if (restriction === 'type') return `type ${shortName} = ${extendsClass ?? 'Real'}${desc};\n`;
  const lines = [`${restriction} ${shortName}${desc}`];
  if (extendsClass) lines.push(`  extends ${extendsClass};`);
  if (restriction === 'function') lines.push('algorithm');
  lines.push(`end ${shortName};`);
  return `${lines.join('\n')}\n`;
}

/** `Examples/Basic/package.mo` -> `Examples.Basic`; undefined for other files. */
function packageOfDir(relpath: string): string | undefined {
  if (!relpath.endsWith('package.mo')) return undefined;
  const dir = relpath.slice(0, -'package.mo'.length).replace(/\/$/, '');
  return dir ? dir.split('/').join('.') : undefined;
}

function requireHit(ctx: AppContext, wr: WorkspaceRegistry, className: string): ClassFileHit {
  const hit = ctx.registries.fileOfClass(wr, className);
  if (!hit) throw notFound(`Class '${className}' not found in workspace '${wr.wid}'`);
  return hit;
}

function requireClass(wr: WorkspaceRegistry, className: string): RegisteredClass {
  const cls = wr.registry.get(className);
  if (!cls || cls.builtin) throw notFound(`Class '${className}' not found in workspace '${wr.wid}'`);
  return cls;
}

export function classRoutes(ctx: AppContext): Router {
  const router = Router();

  // -- tree & search -----------------------------------------------------------------------

  router.get('/:wid/classes', (req, res) => {
    const wr = ctx.registries.get(req.params.wid);
    const parent = queryString(req.query.parent) || undefined;
    const q = queryString(req.query.q);
    const limit = optionalNumber(queryString(req.query.limit) !== undefined ? Number(queryString(req.query.limit)) : undefined, 'limit');
    const nodes = q ? searchClasses(wr.registry, q, limit ?? 50) : buildClassTree(wr.registry, parent);
    const body: ItemsResponse<ClassTreeNodeDto> = { data: { items: nodes.map(toTreeDto) } };
    res.json(body);
  });

  // -- create ------------------------------------------------------------------------------

  router.post('/:wid/classes', (req, res) => {
    const { wid } = req.params;
    const body = requireObject(req.body, 'body') as Partial<CreateClassRequest>;
    const className = requireClassName(body.className, 'className');
    const restriction = optionalEnum(body.restriction, RESTRICTIONS, 'restriction') ?? 'model';
    const description = optionalString(body.description, 'description');
    const extendsClass = body.extendsClass !== undefined ? requireClassName(body.extendsClass, 'extendsClass') : undefined;
    const libraryId = optionalString(body.libraryId, 'libraryId');
    const wr = ctx.registries.get(wid);
    if (wr.registry.has(className)) throw conflict(`Class '${className}' already exists`);

    const dot = className.lastIndexOf('.');
    if (dot >= 0) {
      const parentName = className.slice(0, dot);
      const shortName = className.slice(dot + 1);
      const parent = ctx.registries.fileOfClass(wr, parentName);
      if (!parent) throw notFound(`Parent class '${parentName}' not found`);
      if (parent.lib.readOnly) throw readOnly(`Library '${parent.lib.name}' is read-only`);
      if (!parent.cls) throw conflict(`Parent class '${parentName}' could not be parsed; fix its source first`, { diagnostics: parent.file.diagnostics });
      const snippet = newClassText(restriction, shortName, description, extendsClass);
      const lib = parent.lib;

      if (packageOfDir(parent.file.path) === parentName) {
        // Directory package: add a `within` file next to package.mo.
        const dir = parent.file.path.slice(0, -'package.mo'.length);
        const newPath = `${dir}${shortName}.mo`;
        if (lib.files.has(newPath)) throw conflict(`File '${newPath}' already exists`);
        const file = saveLibraryFile(ctx, wr, lib, newPath, `within ${parentName};\n\n${snippet}`);
        const orderPath = path.join(lib.containerDir, dir, 'package.order');
        const order = readText(orderPath);
        if (order !== undefined && lib.projectId) {
          ctx.storage.writeProjectFile(wid, lib.projectId, `${dir}package.order`, `${order.replace(/\s+$/, '')}\n${shortName}\n`);
          wr.registry.setChildOrder(parentName, `${order}\n${shortName}`.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
        }
        res.status(201).json(sourceDto(className, lib, file));
        return;
      }

      const newText = insertNestedClass(parent.file.text, parent.cls, snippet);
      const file = saveLibraryFile(ctx, wr, lib, parent.file.path, newText);
      res.status(201).json(sourceDto(className, lib, file));
      return;
    }

    // Top-level class: a new `<Name>.mo` file in the project.
    const project = libraryId ? ctx.storage.findProjectByContent(wid, libraryId)?.project : ctx.storage.editableProjects(wid)[0];
    if (!project) throw libraryId ? notFound(`Library '${libraryId}' not found in workspace '${wid}'`) : notFound(`Workspace '${wid}' has no editable project`);
    if (project.projectType === 'SYSTEM') throw readOnly(`Project '${project.definition.name}' is read-only`);
    const relpath = `${className}.mo`;
    if ([...wr.libraries.values()].some((l) => l.roots.some((r) => r.name === className))) throw conflict(`A library named '${className}' already exists`);
    if (ctx.storage.readProjectFile(wid, project.id, relpath) !== undefined) throw conflict(`File '${relpath}' already exists`);
    ctx.storage.writeProjectFile(wid, project.id, relpath, newClassText(restriction, className, description, extendsClass));
    const content = ctx.storage.addContent(wid, project, { relpath, name: className });
    const lib = ctx.registries.addProjectLibrary(wr, project, content);
    const file = lib.files.get(relpath);
    if (!file) throw new Error(`Failed to load the new file '${relpath}'`);
    res.status(201).json(sourceDto(className, lib, file));
  });

  // -- source ------------------------------------------------------------------------------

  router.get('/:wid/classes/:className/source', (req, res) => {
    const wr = ctx.registries.get(req.params.wid);
    const hit = requireHit(ctx, wr, req.params.className);
    res.json(sourceDto(req.params.className, hit.lib, hit.file));
  });

  router.put('/:wid/classes/:className/source', (req, res) => {
    const { wid, className } = req.params;
    const body = requireObject(req.body, 'body');
    const text = requireString(body.text, 'text');
    const version = optionalNumber(body.version, 'version');
    const wr = ctx.registries.get(wid);
    const hit = requireHit(ctx, wr, className);
    if (hit.lib.readOnly) throw readOnly(`Class '${className}' belongs to the read-only library '${hit.lib.name}'`);
    if (version !== undefined && version !== hit.file.version) {
      throw conflict(`Stale version ${version}: '${hit.file.path}' is at version ${hit.file.version}`, { currentVersion: hit.file.version });
    }
    checkSyntax(text, hit.file.path);
    const file = saveLibraryFile(ctx, wr, hit.lib, hit.file.path, text);
    res.json(sourceDto(className, hit.lib, file));
  });

  // -- delete ------------------------------------------------------------------------------

  router.delete('/:wid/classes/:className', (req, res) => {
    const { wid, className } = req.params;
    const wr = ctx.registries.get(wid);
    const hit = requireHit(ctx, wr, className);
    const { lib, file, cls } = hit;
    if (lib.readOnly || !lib.projectId) throw readOnly(`Class '${className}' belongs to the read-only library '${lib.name}'`);
    const pid = lib.projectId;
    const registered = wr.registry.getFile(lib.id, file.path);
    const topLevelInFile = !cls || cls.parentName === registered?.definition.within;
    const classesInFile = registered?.classNames.length ?? 1;

    if (topLevelInFile && classesInFile <= 1) {
      const root = lib.roots.find((r) => r.relpath === file.path || (r.relpath.endsWith('/') && file.path === `${r.relpath}package.mo`));
      if (root) {
        // The whole library goes away.
        if (root.relpath.endsWith('/')) ctx.storage.deleteProjectDir(wid, pid, root.relpath);
        else ctx.storage.deleteProjectFile(wid, pid, root.relpath);
        const found = ctx.storage.findProjectByContent(wid, lib.id);
        if (found) ctx.storage.removeContent(wid, found.project, lib.id);
        ctx.registries.removeLibrary(wr, lib.id);
      } else if (file.path.endsWith('package.mo')) {
        // A sub-package directory.
        const dir = file.path.slice(0, -'package.mo'.length);
        ctx.storage.deleteProjectDir(wid, pid, dir);
        for (const p of [...lib.files.keys()]) if (p.startsWith(dir)) ctx.registries.deleteFile(wr, lib, p);
      } else {
        ctx.storage.deleteProjectFile(wid, pid, file.path);
        ctx.registries.deleteFile(wr, lib, file.path);
      }
      res.status(204).end();
      return;
    }

    if (!cls) throw conflict(`Class '${className}' could not be located in '${file.path}' (file has syntax errors)`, { diagnostics: file.diagnostics });
    const newText = removeClassText(file.text, cls);
    if (newText === undefined) throw conflict(`Cannot determine the source extent of '${className}' in '${file.path}'`);
    saveLibraryFile(ctx, wr, lib, file.path, newText);
    res.status(204).end();
  });

  // -- edit --------------------------------------------------------------------------------

  router.post('/:wid/classes/:className/edit', (req, res) => {
    const { wid, className } = req.params;
    const body = requireObject(req.body, 'body');
    const op = requireObject(body.op, 'op');
    requireString(op.op, 'op.op');
    const wr = ctx.registries.get(wid);
    const hit = requireHit(ctx, wr, className);
    if (hit.lib.readOnly) throw readOnly(`Class '${className}' belongs to the read-only library '${hit.lib.name}'`);
    if (!hit.cls) throw conflict(`Class '${className}' could not be parsed; fix its source first`, { diagnostics: hit.file.diagnostics });
    const result = applyEdit(wr.registry, className, op as unknown as EditOperation);
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    if (errors.length) throw unprocessable(`Edit '${String(op.op)}' failed: ${errors[0].message}`, result.diagnostics);
    checkSyntax(result.text, hit.file.path);
    const file = saveLibraryFile(ctx, wr, hit.lib, hit.file.path, result.text);
    res.json({ ...result, version: file.version });
  });

  // -- views -------------------------------------------------------------------------------

  router.get('/:wid/classes/:className/diagram', (req, res) => {
    const wr = ctx.registries.get(req.params.wid);
    requireClass(wr, req.params.className);
    res.json(buildDiagramView(wr.registry, req.params.className));
  });

  router.get('/:wid/classes/:className/parameters', (req, res) => {
    const wr = ctx.registries.get(req.params.wid);
    const { className } = req.params;
    requireClass(wr, className);
    const component = queryString(req.query.component);
    if (!component) {
      res.json(getParameters(wr.registry, className));
      return;
    }
    // The component's declaration may be inherited: search the class itself first, then its bases.
    const chain = wr.registry.inheritanceChain(className).reverse();
    let ownerName: string | undefined;
    let typeName: string | undefined;
    for (const c of chain) {
      const decl = c.def.components.find((d) => d.name === component);
      if (decl) {
        ownerName = c.fullName;
        typeName = decl.typeName;
        break;
      }
    }
    if (!ownerName || !typeName) throw notFound(`Component '${component}' not found in class '${className}'`);
    const type = wr.registry.lookup(typeName, ownerName);
    if (!type) throw notFound(`Type '${typeName}' of component '${component}' could not be resolved`);
    res.json(getParameters(wr.registry, type.fullName, { ownerClassName: className, componentName: component }));
  });

  router.get('/:wid/classes/:className/documentation', (req, res) => {
    const wr = ctx.registries.get(req.params.wid);
    const cls = requireClass(wr, req.params.className);
    const doc = parseDocumentation(cls.def.annotation);
    res.json({
      className: cls.fullName,
      restriction: cls.def.restriction,
      ...(cls.def.description !== undefined ? { description: cls.def.description } : {}),
      info: doc?.info ?? '',
      revisions: doc?.revisions ?? '',
    });
  });

  return router;
}
