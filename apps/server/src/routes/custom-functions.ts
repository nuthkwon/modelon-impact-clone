import { Router } from 'express';
import type { CustomFunction, ItemsResponse } from '@impact/protocol';
import type { AppContext } from '../context.js';
import { notFound } from '../errors.js';
import { validateIdParams } from '../validate.js';

export const CUSTOM_FUNCTIONS: CustomFunction[] = [
  {
    name: 'dynamic',
    version: '1.0.0',
    description: 'Dynamic simulation of the model over a time interval',
    parameters: [
      { name: 'start_time', type: 'Number', description: 'Start time of the simulation', defaultValue: 0 },
      { name: 'final_time', type: 'Number', description: 'Final time of the simulation', defaultValue: 1 },
    ],
  },
  {
    name: 'steady state',
    version: '1.0.0',
    description: 'Steady-state (equilibrium) computation of the model',
    parameters: [{ name: 'start_time', type: 'Number', description: 'Time at which the steady state is computed', defaultValue: 0 }],
  },
];

export function customFunctionRoutes(ctx: AppContext): Router {
  const router = Router();
  validateIdParams(router);

  router.get('/:wid/custom-functions', (req, res) => {
    ctx.storage.requireWorkspace(req.params.wid);
    const body: ItemsResponse<CustomFunction> = { data: { items: CUSTOM_FUNCTIONS } };
    res.json(body);
  });

  router.get('/:wid/custom-functions/:name', (req, res) => {
    ctx.storage.requireWorkspace(req.params.wid);
    const fn = CUSTOM_FUNCTIONS.find((f) => f.name === req.params.name);
    if (!fn) throw notFound(`Custom function '${req.params.name}' not found`);
    res.json(fn);
  });

  return router;
}
