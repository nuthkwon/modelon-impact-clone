/**
 * Workspaces, projects, dependencies, library bundles and workspace diagnostics.
 */
import { Router } from 'express';
import type { ItemsResponse, LibraryBundleDto, Project, Workspace } from '@impact/protocol';
import type { AppContext } from '../context.js';
import { badRequest, notFound } from '../errors.js';
import type { LibraryEntry } from '../registry-cache.js';
import { optionalString, requireObject, requireString, validateIdParams } from '../validate.js';

function bundleOf(lib: LibraryEntry): LibraryBundleDto {
  return {
    libraryId: lib.id,
    name: lib.name,
    readOnly: lib.readOnly,
    files: [...lib.files.values()].map((f) => ({ path: f.path, text: f.text })),
    version: lib.version,
  };
}

export function workspaceRoutes(ctx: AppContext): Router {
  const router = Router();
  validateIdParams(router);

  router.get('/', (_req, res) => {
    const body: ItemsResponse<Workspace> = { data: { items: ctx.storage.listWorkspaces() } };
    res.json(body);
  });

  router.post('/', (req, res) => {
    const body = requireObject(req.body, 'body');
    // Impact shape `{ new: { name } }`; a bare `{ name }` is accepted too.
    const spec = body.new !== undefined ? requireObject(body.new, 'new') : body;
    const name = requireString(spec.name, 'name');
    const description = optionalString(spec.description, 'description');
    const ws = ctx.storage.createWorkspace(name, description);
    ctx.log(`workspace ${ws.id} '${name}' created`);
    res.status(201).json(ws);
  });

  router.get('/:wid', (req, res) => {
    res.json(ctx.storage.requireWorkspace(req.params.wid));
  });

  router.put('/:wid', (req, res) => {
    const body = requireObject(req.body, 'body');
    const spec = body.new !== undefined ? requireObject(body.new, 'new') : body.definition !== undefined ? requireObject(body.definition, 'definition') : body;
    const name = optionalString(spec.name, 'name');
    const description = optionalString(spec.description, 'description');
    if (name === undefined && description === undefined) throw badRequest('Nothing to update: provide name and/or description');
    if (name !== undefined) requireString(name, 'name');
    res.json(ctx.storage.updateWorkspace(req.params.wid, { name, description }));
  });

  router.delete('/:wid', (req, res) => {
    const { wid } = req.params;
    if (!ctx.storage.deleteWorkspace(wid)) throw notFound(`Workspace '${wid}' not found`);
    ctx.registries.invalidate(wid);
    ctx.jobs.forgetWorkspace(wid);
    res.status(204).end();
  });

  // -- projects & dependencies -------------------------------------------------------------

  router.get('/:wid/projects', (req, res) => {
    const body: ItemsResponse<Project> = { data: { items: ctx.storage.editableProjects(req.params.wid) } };
    res.json(body);
  });

  router.get('/:wid/dependencies', (req, res) => {
    ctx.storage.requireWorkspace(req.params.wid);
    const body: ItemsResponse<Project> = { data: { items: [ctx.storage.modelicaProject()] } };
    res.json(body);
  });

  // -- library bundles ---------------------------------------------------------------------

  router.get('/:wid/libraries', (req, res) => {
    const wr = ctx.registries.get(req.params.wid);
    const body: ItemsResponse<LibraryBundleDto> = { data: { items: [...wr.libraries.values()].map(bundleOf) } };
    res.json(body);
  });

  router.get('/:wid/libraries/:lid', (req, res) => {
    const wr = ctx.registries.get(req.params.wid);
    const lib = wr.libraries.get(req.params.lid);
    if (!lib) throw notFound(`Library '${req.params.lid}' not found in workspace '${req.params.wid}'`);
    res.json(bundleOf(lib));
  });

  // -- diagnostics -------------------------------------------------------------------------

  router.get('/:wid/diagnostics', (req, res) => {
    res.json({ data: { items: ctx.registries.diagnostics(req.params.wid) } });
  });

  return router;
}
