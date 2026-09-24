/**
 * Experiments, execution and cases:
 *
 *   GET/POST   /:wid/experiments                       list (newest first, ?className=) / create
 *   GET/PUT/DELETE /:wid/experiments/:eid              get / relabel / delete
 *   POST/GET/DELETE /:wid/experiments/:eid/execution   start / status / cancel
 *   GET  /:wid/experiments/:eid/variables              union of result variables
 *   POST /:wid/experiments/:eid/trajectories           number[][][] (variable x case)
 *   GET  /:wid/experiments/:eid/cases[/:cid]
 *   POST /:wid/experiments/:eid/cases/:cid/trajectories   number[][] (per variable)
 *   GET  /:wid/experiments/:eid/cases/:cid/log
 *   GET  /:wid/experiments/:eid/cases/:cid/result[?format=json]   CSV download | raw SimulationResult
 *   GET  /:wid/experiments/:eid/cases/:cid/result/meta
 */
import { Router } from 'express';
import type { SimulationResult } from '@impact/core';
import type { CaseDto, CaseLogResponse, CaseResultMetaResponse, CreateExperimentRequest, ExperimentAnalysis, ExperimentBase, ExperimentDefinition, ExperimentDto, ExperimentExtension, ExperimentVariablesResponse, ItemsResponse, TrajectoriesRequest, TrajectoriesResponse } from '@impact/protocol';
import { expandCases, type ModifierValue } from '../cases.js';
import type { AppContext } from '../context.js';
import { badRequest, notFound } from '../errors.js';
import { caseId, newExperimentId } from '../ids.js';
import { parseModelSpec } from './model-executables.js';
import { optionalObject, optionalString, queryString, requireObject, requireString, requireStringArray } from '../validate.js';

// ---------------------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------------------

function parseVariables(value: unknown, what: string): Record<string, ModifierValue> {
  if (value === undefined || value === null) return {};
  const obj = requireObject(value, what);
  const out: Record<string, ModifierValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== 'number' && typeof v !== 'string' && typeof v !== 'boolean') throw badRequest(`${what}.${k} must be a number, string or boolean`);
    out[k] = v;
  }
  return out;
}

function parseAnalysis(value: unknown, what: string, partial: false): ExperimentAnalysis;
function parseAnalysis(value: unknown, what: string, partial: true): Partial<ExperimentAnalysis> | undefined;
function parseAnalysis(value: unknown, what: string, partial: boolean): ExperimentAnalysis | Partial<ExperimentAnalysis> | undefined {
  if (partial && (value === undefined || value === null)) return undefined;
  const obj = value === undefined || value === null ? {} : requireObject(value, what);
  const type = optionalString(obj.type, `${what}.type`);
  const parameters = optionalObject(obj.parameters, `${what}.parameters`);
  if (parameters) {
    for (const [k, v] of Object.entries(parameters)) {
      if (typeof v !== 'number' && typeof v !== 'string' && typeof v !== 'boolean') throw badRequest(`${what}.parameters.${k} must be a number, string or boolean`);
    }
  }
  const simulationOptions = optionalObject(obj.simulationOptions, `${what}.simulationOptions`);
  const solverOptions = optionalObject(obj.solverOptions, `${what}.solverOptions`);
  const simulationLogLevel = optionalString(obj.simulationLogLevel, `${what}.simulationLogLevel`) as ExperimentAnalysis['simulationLogLevel'];
  if (partial) {
    const out: Partial<ExperimentAnalysis> = {};
    if (type !== undefined) out.type = type;
    if (parameters) out.parameters = parameters as ExperimentAnalysis['parameters'];
    if (simulationOptions) out.simulationOptions = simulationOptions;
    if (solverOptions) out.solverOptions = solverOptions as ExperimentAnalysis['solverOptions'];
    if (simulationLogLevel) out.simulationLogLevel = simulationLogLevel;
    return out;
  }
  return {
    type: type ?? 'dynamic',
    parameters: (parameters ?? {}) as ExperimentAnalysis['parameters'],
    simulationOptions: simulationOptions ?? {},
    solverOptions: (solverOptions ?? {}) as ExperimentAnalysis['solverOptions'],
    ...(simulationLogLevel ? { simulationLogLevel } : {}),
  };
}

function parseDefinition(value: unknown): ExperimentDefinition {
  const def = requireObject(value, 'experiment');
  const base = requireObject(def.base, 'experiment.base');
  const model = requireObject(base.model, 'experiment.base.model');
  let modelSpec: ExperimentBase['model'];
  if (model.modelica !== undefined) modelSpec = { modelica: parseModelSpec(model.modelica, 'experiment.base.model.modelica') };
  else if (model.fmu !== undefined) {
    const fmu = requireObject(model.fmu, 'experiment.base.model.fmu');
    modelSpec = { fmu: { id: requireString(fmu.id, 'experiment.base.model.fmu.id') } };
  } else throw badRequest('experiment.base.model must contain `modelica` or `fmu`');
  const modifiers = optionalObject(base.modifiers, 'experiment.base.modifiers');
  const extensionsRaw = def.extensions === undefined || def.extensions === null ? [] : def.extensions;
  if (!Array.isArray(extensionsRaw)) throw badRequest('experiment.extensions must be an array');
  const extensions: ExperimentExtension[] = extensionsRaw.map((raw, i) => {
    const ext = requireObject(raw, `experiment.extensions[${i}]`);
    const extModifiers = optionalObject(ext.modifiers, `experiment.extensions[${i}].modifiers`);
    const caseData = optionalObject(ext.caseData, `experiment.extensions[${i}].caseData`);
    const label = caseData ? optionalString(caseData.label, `experiment.extensions[${i}].caseData.label`) : undefined;
    const analysis = parseAnalysis(ext.analysis, `experiment.extensions[${i}].analysis`, true);
    return {
      ...(extModifiers ? { modifiers: { variables: parseVariables(extModifiers.variables, `experiment.extensions[${i}].modifiers.variables`) } } : {}),
      ...(analysis ? { analysis } : {}),
      ...(label !== undefined ? { caseData: { label } } : {}),
    };
  });
  return {
    version: 2,
    base: {
      model: modelSpec,
      modifiers: { variables: parseVariables(modifiers?.variables, 'experiment.base.modifiers.variables') },
      analysis: parseAnalysis(base.analysis, 'experiment.base.analysis', false),
    },
    extensions,
  };
}

// ---------------------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------------------

/** Values of `name` in a result; parameters are expanded to the time grid; unknown -> []. */
function trajectoryValues(result: SimulationResult | undefined, name: string): number[] {
  if (!result) return [];
  if (name === 'time') return result.time;
  const t = result.trajectories.find((x) => x.name === name);
  if (!t) return [];
  if (t.values.length === 1 && result.time.length !== 1) return new Array<number>(result.time.length).fill(t.values[0]);
  return t.values;
}

function csvCell(v: unknown): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function resultToCsv(result: SimulationResult): string {
  const names = result.trajectories.map((t) => t.name);
  const columns = names.map((n) => trajectoryValues(result, n));
  const lines = [['time', ...names].map(csvCell).join(',')];
  for (let i = 0; i < result.time.length; i++) {
    lines.push([result.time[i], ...columns.map((c) => (i < c.length ? c[i] : ''))].join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function experimentRoutes(ctx: AppContext): Router {
  const router = Router();

  // -- experiments -------------------------------------------------------------------------

  router.get('/:wid/experiments', (req, res) => {
    const { wid } = req.params;
    ctx.storage.requireWorkspace(wid);
    const className = queryString(req.query.className);
    let items = ctx.storage.listExperiments(wid);
    if (className) items = items.filter((e) => e.className === className);
    const body: ItemsResponse<ExperimentDto> = { data: { items } };
    res.json(body);
  });

  router.post('/:wid/experiments', (req, res) => {
    const { wid } = req.params;
    ctx.storage.requireWorkspace(wid);
    const body = requireObject(req.body, 'body') as Partial<CreateExperimentRequest>;
    const definition = parseDefinition(body.experiment);
    const requestedLabel = optionalString(body.label, 'label');

    let className: string;
    let fmuId: string | undefined;
    if ('modelica' in definition.base.model) className = definition.base.model.modelica.className;
    else {
      fmuId = definition.base.model.fmu.id;
      const executable = ctx.storage.getExecutable(wid, fmuId);
      if (!executable) throw notFound(`Model executable '${fmuId}' not found in workspace '${wid}'`);
      className = executable.input.className;
    }

    const specs = expandCases(definition);
    const now = new Date().toISOString();
    const eid = newExperimentId();
    const experiment: ExperimentDto = {
      id: eid,
      experiment: definition,
      meta_data: { label: requestedLabel ?? `${className} ${now}`, created_at: now },
      run_info: { status: 'not_started', failed: 0, successful: 0, cancelled: 0, not_started: specs.length },
      className,
    };
    ctx.storage.saveExperiment(wid, experiment);
    specs.forEach((spec, i) => {
      const c: CaseDto = {
        id: caseId(i + 1),
        experiment_id: eid,
        meta: { label: spec.label },
        run_info: { status: 'not_started' },
        input: { analysis: spec.analysis, parametrization: spec.parametrization, ...(fmuId ? { fmu_id: fmuId } : {}) },
        consistent: true,
      };
      ctx.storage.saveCase(wid, eid, c);
    });
    ctx.log(`experiment ${eid} (${className}) created with ${specs.length} case(s)`);
    res.status(201).json({ ...experiment, experiment_id: eid });
  });

  router.get('/:wid/experiments/:eid', (req, res) => {
    res.json(ctx.storage.requireExperiment(req.params.wid, req.params.eid));
  });

  router.put('/:wid/experiments/:eid', (req, res) => {
    const { wid, eid } = req.params;
    const experiment = ctx.storage.requireExperiment(wid, eid);
    const body = requireObject(req.body, 'body');
    const meta = optionalObject(body.meta_data, 'meta_data');
    const label = requireString(body.label ?? meta?.label, 'label');
    experiment.meta_data = { ...experiment.meta_data, label };
    ctx.storage.saveExperiment(wid, experiment);
    res.json(experiment);
  });

  router.delete('/:wid/experiments/:eid', (req, res) => {
    const { wid, eid } = req.params;
    ctx.storage.requireExperiment(wid, eid);
    ctx.jobs.cancelExecution(wid, eid);
    ctx.storage.deleteExperiment(wid, eid);
    ctx.jobs.forgetExperiment(wid, eid);
    res.status(204).end();
  });

  // -- execution ---------------------------------------------------------------------------

  router.post('/:wid/experiments/:eid/execution', (req, res) => {
    res.status(202).json(ctx.jobs.startExecution(req.params.wid, req.params.eid));
  });

  router.get('/:wid/experiments/:eid/execution', (req, res) => {
    res.json(ctx.jobs.executionStatus(req.params.wid, req.params.eid));
  });

  router.delete('/:wid/experiments/:eid/execution', (req, res) => {
    const { wid, eid } = req.params;
    if (!ctx.jobs.cancelExecution(wid, eid)) throw notFound(`Experiment '${eid}' has no running execution`);
    res.status(204).end();
  });

  // -- variables & trajectories ------------------------------------------------------------

  router.get('/:wid/experiments/:eid/variables', (req, res) => {
    const { wid, eid } = req.params;
    ctx.storage.requireExperiment(wid, eid);
    const names = new Set<string>();
    for (const c of ctx.storage.listCases(wid, eid)) {
      if (c.run_info.status !== 'successful') continue;
      const result = ctx.storage.readCaseResult(wid, eid, c.id);
      for (const t of result?.trajectories ?? []) names.add(t.name);
    }
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    const body: ExperimentVariablesResponse = { variables: sorted.length ? ['time', ...sorted.filter((n) => n !== 'time')] : [] };
    res.json(body);
  });

  router.post('/:wid/experiments/:eid/trajectories', (req, res) => {
    const { wid, eid } = req.params;
    ctx.storage.requireExperiment(wid, eid);
    const body = requireObject(req.body, 'body') as Partial<TrajectoriesRequest>;
    const names = requireStringArray(body.variable_names, 'variable_names');
    const results = ctx.storage.listCases(wid, eid).map((c) => (c.run_info.status === 'successful' ? ctx.storage.readCaseResult(wid, eid, c.id) : undefined));
    const out: TrajectoriesResponse = names.map((name) => results.map((r) => trajectoryValues(r, name)));
    res.json(out);
  });

  // -- cases -------------------------------------------------------------------------------

  router.get('/:wid/experiments/:eid/cases', (req, res) => {
    const { wid, eid } = req.params;
    ctx.storage.requireExperiment(wid, eid);
    const body: ItemsResponse<CaseDto> = { data: { items: ctx.storage.listCases(wid, eid) } };
    res.json(body);
  });

  router.get('/:wid/experiments/:eid/cases/:cid', (req, res) => {
    const { wid, eid, cid } = req.params;
    ctx.storage.requireExperiment(wid, eid);
    res.json(ctx.storage.requireCase(wid, eid, cid));
  });

  router.post('/:wid/experiments/:eid/cases/:cid/trajectories', (req, res) => {
    const { wid, eid, cid } = req.params;
    ctx.storage.requireExperiment(wid, eid);
    ctx.storage.requireCase(wid, eid, cid);
    const body = requireObject(req.body, 'body') as Partial<TrajectoriesRequest>;
    const names = requireStringArray(body.variable_names, 'variable_names');
    const result = ctx.storage.readCaseResult(wid, eid, cid);
    res.json(names.map((name) => trajectoryValues(result, name)));
  });

  router.get('/:wid/experiments/:eid/cases/:cid/log', (req, res) => {
    const { wid, eid, cid } = req.params;
    ctx.storage.requireExperiment(wid, eid);
    ctx.storage.requireCase(wid, eid, cid);
    const body: CaseLogResponse = { log: ctx.storage.readCaseLog(wid, eid, cid) };
    res.json(body);
  });

  router.get('/:wid/experiments/:eid/cases/:cid/result', (req, res) => {
    const { wid, eid, cid } = req.params;
    const experiment = ctx.storage.requireExperiment(wid, eid);
    ctx.storage.requireCase(wid, eid, cid);
    const result = ctx.storage.readCaseResult(wid, eid, cid);
    if (!result) throw notFound(`Case '${cid}' has no result`);
    if (queryString(req.query.format) === 'json') {
      res.json(result);
      return;
    }
    const filename = `${experiment.className}_${cid}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(resultToCsv(result));
  });

  router.get('/:wid/experiments/:eid/cases/:cid/result/meta', (req, res) => {
    const { wid, eid, cid } = req.params;
    const experiment = ctx.storage.requireExperiment(wid, eid);
    ctx.storage.requireCase(wid, eid, cid);
    const result = ctx.storage.readCaseResult(wid, eid, cid);
    if (!result) throw notFound(`Case '${cid}' has no result`);
    const body: CaseResultMetaResponse = {
      className: result.className || experiment.className,
      time: { start: result.time[0] ?? 0, stop: result.time[result.time.length - 1] ?? 0, points: result.time.length },
      variables: result.trajectories.map((t) => ({
        name: t.name,
        kind: t.kind,
        ...(t.unit ? { unit: t.unit } : {}),
        ...(t.displayUnit ? { displayUnit: t.displayUnit } : {}),
        ...(t.description ? { description: t.description } : {}),
      })),
    };
    res.json(body);
  });

  return router;
}
