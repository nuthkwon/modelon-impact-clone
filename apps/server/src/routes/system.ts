import { Router } from 'express';
import type { AppContext } from '../context.js';

export function systemRoutes(ctx: AppContext): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: ctx.version });
  });

  router.get('/system/info', (_req, res) => {
    res.json({ name: 'Modelon Impact Clone', version: ctx.version, node: process.version });
  });

  return router;
}
