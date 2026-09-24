/**
 * Types and pure helpers shared by the job runner (main thread), the case runners and the
 * simulation worker thread (`sim-worker.ts`). Everything that crosses the worker boundary is
 * plain data so it survives `postMessage` structured cloning.
 */
import type { Diagnostic, FlatModel, SimulationOptions, SimulationResult, SolverName } from '@impact/core';
import { normalizeSolverName } from '@impact/core';
import type { ExperimentAnalysis } from '@impact/protocol';

export type ModifierValue = number | string | boolean;

/** Snapshot of one workspace library: enough to rebuild a `ClassRegistry` in another thread. */
export interface SerializedLibrary {
  id: string;
  name: string;
  readOnly: boolean;
  files: { path: string; text: string }[];
}

/** What one case needs: the model, its parametrization and the analysis settings. */
export interface CaseRunInput {
  className: string;
  modifiers: Record<string, ModifierValue>;
  analysis: ExperimentAnalysis;
}

/** Reported once flattening succeeded, before the solver starts. */
export interface FlattenedInfo {
  stats: FlatModel['stats'];
  diagnostics: Diagnostic[];
  options: SimulationOptions;
}

export type CaseRunOutcome =
  /** The solver returned (a partial result when `result.stats.completed` is false after a cooperative cancel). */
  | { kind: 'result'; result: SimulationResult }
  /** flatten/simulate threw. */
  | { kind: 'error'; diagnostics: Diagnostic[] }
  /** The run was interrupted (worker terminated) and produced nothing. */
  | { kind: 'cancelled' };

export interface CaseRunEvents {
  onFlattened(info: FlattenedInfo): void;
  /** 0..1 within the case. */
  onProgress(progress: number): void;
  onLog(level: string, message: string): void;
}

/** Main thread -> worker. */
export type WorkerRequest = { type: 'init'; libraries: SerializedLibrary[] } | { type: 'run'; id: number; input: CaseRunInput };

/** Worker -> main thread; `id` echoes the `run` request it belongs to. */
export type WorkerResponse =
  | { type: 'flattened'; id: number; info: FlattenedInfo }
  | { type: 'progress'; id: number; progress: number }
  | { type: 'log'; id: number; level: string; message: string }
  | { type: 'result'; id: number; result: SimulationResult }
  | { type: 'error'; id: number; diagnostics: Diagnostic[] };

export function formatDiagnostic(d: Diagnostic): string {
  let s = d.message;
  if (d.path) s += ` (${d.path})`;
  if (d.file && d.loc) s += ` [${d.file}:${d.loc.line}:${d.loc.column}]`;
  else if (d.file) s += ` [${d.file}]`;
  return s;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/** Maps Impact analysis settings onto solver options; the model's `experiment` annotation supplies defaults. */
export function buildSimulationOptions(analysis: ExperimentAnalysis, flat: FlatModel | undefined, modifiers: Record<string, ModifierValue>): SimulationOptions {
  const p = analysis.parameters ?? {};
  const sim = analysis.simulationOptions ?? {};
  const sol = analysis.solverOptions ?? {};
  const startTime = num(p.start_time) ?? flat?.experiment?.StartTime ?? 0;
  const finalTime = num(p.final_time) ?? flat?.experiment?.StopTime ?? 1;
  const solverName: SolverName = (typeof sol.solver === 'string' ? normalizeSolverName(sol.solver) : undefined) ?? 'CVode';
  const atol = num(sol.atol);
  const stepSize = num(sol.step_size);
  return {
    startTime,
    finalTime,
    ncp: num(sim.ncp) ?? 500,
    rtol: num(sol.rtol) ?? flat?.experiment?.Tolerance ?? 1e-6,
    ...(atol !== undefined ? { atol } : {}),
    solver: solverName,
    ...(stepSize !== undefined ? { stepSize } : {}),
    dynamicDiagnostics: sim.dynamic_diagnostics === true,
    modifiers,
  };
}

/**
 * Drops fields the result endpoints never read so `<cid>.result.json` stays small and the
 * worker message stays cheap. `log` is kept (the runner merges it into the case log and
 * strips it before writing the file).
 */
export function compactResult(result: SimulationResult): SimulationResult {
  return {
    className: result.className,
    options: result.options,
    time: result.time,
    trajectories: result.trajectories.map((t) => ({
      name: t.name,
      values: t.values,
      kind: t.kind,
      ...(t.unit ? { unit: t.unit } : {}),
      ...(t.displayUnit ? { displayUnit: t.displayUnit } : {}),
      ...(t.description ? { description: t.description } : {}),
    })),
    stats: result.stats,
    log: (result.log ?? []).map((m) => ({ level: m.level, message: m.message, source: m.source, ...(m.time !== undefined ? { time: m.time } : {}) })),
  };
}
