/**
 * Model executables (compilation):
 *
 *   GET/POST /:wid/model-executables            list / create (status not_started)
 *   GET/DELETE /:wid/model-executables/:fid
 *   POST /:wid/model-executables/:fid/compilation       start compiling (async)
 *   GET  /:wid/model-executables/:fid/compilation       ExecutionStatusResponse
 *   GET  /:wid/model-executables/:fid/compilation/log   text log
 */
import { Router } from 'express';
import type { CompileRequest, ItemsResponse, ModelExecutableDto, ModelicaModelSpec } from '@impact/protocol';
import type { AppContext } from '../context.js';
import { notFound } from '../errors.js';
import { newExecutableId } from '../ids.js';
import { optionalEnum, optionalObject, requireClassName, requireObject, validateIdParams } from '../validate.js';

export function parseModelSpec(value: unknown, what: string): ModelicaModelSpec {
  const spec = requireObject(value, what);
  const className = requireClassName(spec.className, `${what}.className`);
  const out: ModelicaModelSpec = { className };
  const compilerOptions = optionalObject(spec.compilerOptions, `${what}.compilerOptions`);
  const runtimeOptions = optionalObject(spec.runtimeOptions, `${what}.runtimeOptions`);
  const compilerLogLevel = optionalEnum(spec.compilerLogLevel, ['error', 'warning', 'info', 'verbose', 'debug'] as const, `${what}.compilerLogLevel`);
  const fmiTarget = optionalEnum(spec.fmiTarget, ['me', 'cs'] as const, `${what}.fmiTarget`);
  const fmiVersion = optionalEnum(spec.fmiVersion, ['1.0', '2.0'] as const, `${what}.fmiVersion`);
  if (compilerOptions) out.compilerOptions = compilerOptions;
  if (runtimeOptions) out.runtimeOptions = runtimeOptions;
  if (compilerLogLevel) out.compilerLogLevel = compilerLogLevel;
  if (fmiTarget) out.fmiTarget = fmiTarget;
  if (fmiVersion) out.fmiVersion = fmiVersion;
  if (typeof spec.platform === 'string') out.platform = spec.platform;
  return out;
}

export function modelExecutableRoutes(ctx: AppContext): Router {
  const router = Router();
  validateIdParams(router);

  router.get('/:wid/model-executables', (req, res) => {
    ctx.storage.requireWorkspace(req.params.wid);
    const body: ItemsResponse<ModelExecutableDto> = { data: { items: ctx.storage.listExecutables(req.params.wid) } };
    res.json(body);
  });

  router.post('/:wid/model-executables', (req, res) => {
    const { wid } = req.params;
    ctx.storage.requireWorkspace(wid);
    const body = requireObject(req.body, 'body') as Partial<CompileRequest>;
    const input = parseModelSpec(body.input, 'input');
    const executable: ModelExecutableDto = { id: newExecutableId(), input, run_info: { status: 'not_started' } };
    ctx.storage.saveExecutable(wid, executable);
    res.status(201).json(executable);
  });

  router.get('/:wid/model-executables/:fid', (req, res) => {
    res.json(ctx.storage.requireExecutable(req.params.wid, req.params.fid));
  });

  router.delete('/:wid/model-executables/:fid', (req, res) => {
    const { wid, fid } = req.params;
    if (!ctx.storage.deleteExecutable(wid, fid)) throw notFound(`Model executable '${fid}' not found in workspace '${wid}'`);
    ctx.jobs.forgetExecutable(wid, fid);
    res.status(204).end();
  });

  router.post('/:wid/model-executables/:fid/compilation', (req, res) => {
    res.status(202).json(ctx.jobs.startCompilation(req.params.wid, req.params.fid));
  });

  router.get('/:wid/model-executables/:fid/compilation', (req, res) => {
    res.json(ctx.jobs.compilationStatus(req.params.wid, req.params.fid));
  });

  router.get('/:wid/model-executables/:fid/compilation/log', (req, res) => {
    res.type('text/plain').send(ctx.jobs.compilationLog(req.params.wid, req.params.fid));
  });

  return router;
}
