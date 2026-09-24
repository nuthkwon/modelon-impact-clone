/**
 * Installed libraries (Workspace Management → Libraries) and the server file browser used by
 * the *Import library* explorer.
 *
 *   GET    /api/libraries            installed libraries (MSL + imported), with the workspaces using them
 *   POST   /api/libraries            import from a server path or uploaded files (ImportLibraryRequest)
 *   DELETE /api/libraries/:lid       delete an imported library (removed from every workspace)
 *   GET    /api/filesystem?path=     directories and .mo files of a server directory
 *
 * Browsing and importing by path read the server's filesystem; they are disabled when the
 * app is created with `serverFileAccess: false` (env `SERVER_FILE_ACCESS=off`). Uploads work
 * either way.
 */
import { Router } from 'express';
import type { ItemsResponse, InstalledLibraryDto } from '@impact/protocol';
import type { AppContext } from '../context.js';
import { HttpError, badRequest } from '../errors.js';
import { collectFromPath, collectFromUpload, listDirectory } from '../library-import.js';
import { optionalString, requireObject, validateIdParams } from '../validate.js';

export function libraryRoutes(ctx: AppContext, options: { serverFileAccess: boolean }): Router {
  const router = Router();
  validateIdParams(router);

  const requireFileAccess = () => {
    if (!options.serverFileAccess) throw new HttpError(403, 'forbidden', 'Access to the server filesystem is disabled (SERVER_FILE_ACCESS=off); upload the library instead');
  };

  router.get('/libraries', (_req, res) => {
    const body: ItemsResponse<InstalledLibraryDto> = { data: { items: ctx.storage.listInstalledLibraries() } };
    res.json(body);
  });

  router.post('/libraries', (req, res) => {
    const body = requireObject(req.body, 'body');
    const libPath = optionalString(body.path, 'path');
    const workspaceId = optionalString(body.workspaceId, 'workspaceId');
    if (workspaceId !== undefined) ctx.storage.requireWorkspace(workspaceId);
    let collected;
    let source: string;
    if (libPath !== undefined) {
      requireFileAccess();
      collected = collectFromPath(libPath);
      source = libPath;
    } else if (Array.isArray(body.files)) {
      const files = body.files.map((f: unknown, i: number) => {
        const o = requireObject(f, `files[${i}]`);
        if (typeof o.path !== 'string' || typeof o.text !== 'string') throw badRequest(`files[${i}] must be { path: string, text: string }`);
        return { path: o.path, text: o.text };
      });
      collected = collectFromUpload(files);
      source = 'upload';
    } else {
      throw badRequest('Provide either path (a package.mo or .mo file on the server) or files');
    }
    // Check the target workspace first so a name clash does not leave a half-done import behind.
    if (workspaceId !== undefined) ctx.storage.assertTopLevelNamesFree(workspaceId, [collected.name]);
    const project = ctx.storage.installLibrary(collected, source);
    ctx.log(`library '${collected.name}' (${project.id}) imported from ${source}: ${collected.files.length} files`);
    if (workspaceId !== undefined) {
      ctx.storage.addDependency(workspaceId, project.id);
      ctx.registries.invalidate(workspaceId);
    }
    const dto = ctx.storage.listInstalledLibraries().find((l) => l.id === project.id)!;
    res.status(201).json(dto);
  });

  router.delete('/libraries/:lid', (req, res) => {
    const affected = ctx.storage.deleteInstalledLibrary(req.params.lid);
    for (const wid of affected) ctx.registries.invalidate(wid);
    ctx.log(`library ${req.params.lid} deleted${affected.length ? ` (removed from ${affected.join(', ')})` : ''}`);
    res.status(204).end();
  });

  router.get('/filesystem', (req, res) => {
    requireFileAccess();
    const p = typeof req.query.path === 'string' ? req.query.path : undefined;
    res.json(listDirectory(p));
  });

  return router;
}
