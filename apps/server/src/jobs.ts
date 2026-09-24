/**
 * In-process job runner for model compilation and experiment execution.
 *
 * Jobs run inside the server process. `flatten`/`simulate` are synchronous, so each unit of
 * work (one compilation, one case) is scheduled with `setImmediate`, which lets the event
 * loop serve requests between cases. Progress is reported through the solver's `onProgress`
 * hook, which also consumes the cancel flag set by `DELETE …/execution`.
 */
import { performance } from 'node:perf_hooks';
import type { Diagnostic, FlatModel, SimulationOptions, SimulationResult, SolverName } from '@impact/core';
import { normalizeSolverName } from '@impact/core';
import type { CaseDto, CaseStatus, ExecutionStatus, ExecutionStatusResponse, ExperimentAnalysis, ExperimentDto } from '@impact/protocol';
import type { Engine } from './engine.js';
import { conflict, diagnosticsOf } from './errors.js';
import type { RegistryCache } from './registry-cache.js';
import type { Storage } from './storage.js';

interface CompileJob {
  status: ExecutionStatus;
  progress: number;
  lines: string[];
}

interface ExecutionJob {
  status: ExecutionStatus;
  progress: number;
  cancelled: boolean;
}


export function formatDiagnostic(d: Diagnostic): string {
  let s = d.message;
  if (d.path) s += ` (${d.path})`;
  if (d.file && d.loc) s += ` [${d.file}:${d.loc.line}:${d.loc.column}]`;
  else if (d.file) s += ` [${d.file}]`;
  return s;
}

const seconds = (t0: number) => ((performance.now() - t0) / 1000).toFixed(2);

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/** Maps Impact analysis settings onto solver options; the model's `experiment` annotation supplies defaults. */
export function buildSimulationOptions(analysis: ExperimentAnalysis, flat: FlatModel | undefined, modifiers: Record<string, number | string | boolean>): SimulationOptions {
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

function statsLines(flat: FlatModel): string[] {
  const s = flat.stats;
  return [`Model statistics: ${s.unknowns} unknowns, ${s.equations} equations, ${s.states} states, ${s.parameters} parameters (${s.components} components, ${s.connections} connections)`];
}

/** Drops fields the result endpoints never read so `<cid>.result.json` stays small. */
function compactResult(result: SimulationResult): SimulationResult {
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
    log: [],
  };
}

export class JobRunner {
  private compilations = new Map<string, CompileJob>();
  private executions = new Map<string, ExecutionJob>();

  constructor(
    private readonly storage: Storage,
    private readonly registries: RegistryCache,
    private readonly engine: Engine,
    private readonly log: (line: string) => void = () => {},
  ) {}

  forgetWorkspace(wid: string): void {
    for (const key of [...this.compilations.keys()]) if (key.startsWith(`${wid}/`)) this.compilations.delete(key);
    for (const key of [...this.executions.keys()]) if (key.startsWith(`${wid}/`)) this.executions.delete(key);
  }

  forgetExperiment(wid: string, eid: string): void {
    this.executions.delete(`${wid}/${eid}`);
  }

  forgetExecutable(wid: string, fid: string): void {
    this.compilations.delete(`${wid}/${fid}`);
  }

  // ---------------------------------------------------------------------------------------
  // Compilation
  // ---------------------------------------------------------------------------------------

  startCompilation(wid: string, fid: string): ExecutionStatusResponse {
    const executable = this.storage.requireExecutable(wid, fid);
    const key = `${wid}/${fid}`;
    const existing = this.compilations.get(key);
    if (existing && (existing.status === 'pending' || existing.status === 'running')) throw conflict(`Compilation of '${fid}' is already running`);
    const job: CompileJob = { status: 'pending', progress: 0, lines: [] };
    this.compilations.set(key, job);
    executable.run_info = { status: 'not_started' };
    executable.statistics = undefined;
    this.storage.saveExecutable(wid, executable);
    setImmediate(() => this.runCompilation(wid, fid, job));
    return { status: 'pending', progress: 0 };
  }

  private runCompilation(wid: string, fid: string, job: CompileJob): void {
    const executable = this.storage.getExecutable(wid, fid);
    if (!executable) {
      job.status = 'done';
      job.progress = 1;
      return;
    }
    const className = executable.input.className;
    const t0 = performance.now();
    const started = new Date().toISOString();
    job.status = 'running';
    job.progress = 0.1;
    const lines = job.lines;
    lines.push(`Compiling model ${className}`);
    lines.push(`Flattening ${className}...`);
    const warnings: string[] = [];
    const errors: string[] = [];
    let statistics: Record<string, number> | undefined;
    try {
      const wr = this.registries.get(wid);
      const flat = this.engine.flatten(wr.registry, className, { strict: true });
      job.progress = 0.8;
      lines.push(...statsLines(flat));
      statistics = { ...flat.stats };
      for (const d of flat.diagnostics ?? []) {
        const text = formatDiagnostic(d);
        if (d.severity === 'error') {
          errors.push(text);
          lines.push(`Error: ${text}`);
        } else {
          warnings.push(text);
          lines.push(`${d.severity === 'warning' ? 'Warning' : 'Info'}: ${text}`);
        }
      }
    } catch (e) {
      for (const d of diagnosticsOf(e)) {
        const text = formatDiagnostic(d);
        errors.push(text);
        lines.push(`Error: ${text}`);
      }
    }
    const ok = errors.length === 0;
    lines.push(`Compilation ${ok ? 'succeeded' : 'failed'} in ${seconds(t0)} s`);
    executable.run_info = {
      status: ok ? 'successful' : 'failed',
      datetime_started: started,
      datetime_finished: new Date().toISOString(),
      errors,
      warnings,
    };
    executable.statistics = statistics;
    this.storage.saveExecutable(wid, executable);
    this.storage.writeExecutableLog(wid, fid, lines.join('\n') + '\n');
    job.status = 'done';
    job.progress = 1;
    this.log(`compilation ${fid} (${className}): ${ok ? 'successful' : 'failed'}`);
  }

  compilationStatus(wid: string, fid: string): ExecutionStatusResponse {
    const executable = this.storage.requireExecutable(wid, fid);
    const job = this.compilations.get(`${wid}/${fid}`);
    if (job) return { status: job.status, progress: job.progress, message: job.lines[job.lines.length - 1] ?? '' };
    if (executable.run_info.status === 'not_started') return { status: 'pending', progress: 0 };
    const logLines = this.storage.readExecutableLog(wid, fid).trimEnd().split('\n');
    return { status: 'done', progress: 1, message: logLines[logLines.length - 1] ?? '' };
  }

  compilationLog(wid: string, fid: string): string {
    this.storage.requireExecutable(wid, fid);
    const job = this.compilations.get(`${wid}/${fid}`);
    if (job && job.status !== 'done') return job.lines.join('\n') + (job.lines.length ? '\n' : '');
    return this.storage.readExecutableLog(wid, fid);
  }

  // ---------------------------------------------------------------------------------------
  // Experiment execution
  // ---------------------------------------------------------------------------------------

  startExecution(wid: string, eid: string): ExecutionStatusResponse {
    const experiment = this.storage.requireExperiment(wid, eid);
    const key = `${wid}/${eid}`;
    const existing = this.executions.get(key);
    if (existing && (existing.status === 'pending' || existing.status === 'running')) throw conflict(`Experiment '${eid}' is already running`);
    const job: ExecutionJob = { status: 'pending', progress: 0, cancelled: false };
    this.executions.set(key, job);
    // Re-running resets every case.
    for (const c of this.storage.listCases(wid, eid)) {
      c.run_info = { status: 'not_started' };
      this.storage.saveCase(wid, eid, c);
    }
    this.updateRunInfo(wid, eid, 'pending');
    setImmediate(() => this.runExecution(wid, eid, job));
    return { status: 'pending', progress: 0 };
  }

  private runExecution(wid: string, eid: string, job: ExecutionJob): void {
    const experiment = this.storage.getExperiment(wid, eid);
    if (!experiment) {
      job.status = 'done';
      job.progress = 1;
      return;
    }
    const cases = this.storage.listCases(wid, eid);
    const n = cases.length;
    job.status = 'running';
    this.updateRunInfo(wid, eid, 'running');
    this.log(`execution ${eid} (${experiment.className}): ${n} case(s)`);

    const step = (i: number): void => {
      if (i >= n || job.cancelled) {
        this.finishExecution(wid, eid, job);
        return;
      }
      setImmediate(() => {
        if (!this.storage.getExperiment(wid, eid)) {
          // Deleted while running.
          job.status = 'cancelled';
          job.progress = 1;
          return;
        }
        try {
          this.runCase(wid, eid, experiment.className, cases[i], i, n, job);
        } catch (e) {
          this.log(`case ${cases[i].id} crashed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
        }
        job.progress = Math.min(1, (i + 1) / n);
        this.updateRunInfo(wid, eid, 'running');
        step(i + 1);
      });
    };
    step(0);
  }

  private runCase(wid: string, eid: string, className: string, c: CaseDto, index: number, total: number, job: ExecutionJob): void {
    const t0 = performance.now();
    c.run_info = { status: 'started', datetime_started: new Date().toISOString() };
    this.storage.saveCase(wid, eid, c);
    const lines: string[] = [];
    let status: CaseStatus = 'successful';
    const modifiers = c.input.parametrization ?? {};
    try {
      const wr = this.registries.get(wid);
      const flat = this.engine.flatten(wr.registry, className, { modifiers, strict: true });
      const options = buildSimulationOptions(c.input.analysis, flat, modifiers);
      lines.push(`Simulating ${className} from t=${options.startTime} to t=${options.finalTime} with ${options.solver} (rtol=${options.rtol}${options.atol !== undefined ? `, atol=${options.atol}` : ''}, ncp=${options.ncp})`);
      const modifierEntries = Object.entries(modifiers);
      if (modifierEntries.length) lines.push(`Parameters: ${modifierEntries.map(([k, v]) => `${k}=${String(v)}`).join(', ')}`);
      lines.push(...statsLines(flat));
      for (const d of flat.diagnostics ?? []) lines.push(`${d.severity === 'error' ? 'Error' : d.severity === 'warning' ? 'Warning' : 'Info'}: ${formatDiagnostic(d)}`);
      const seen = new Set<string>();
      const result = this.engine.simulate(flat, options, {
        onProgress: (progress) => {
          job.progress = Math.min(1, (index + Math.max(0, Math.min(1, progress))) / total);
          return !job.cancelled;
        },
        onLog: (level, message) => {
          const line = `[${level.toUpperCase()}] ${message}`;
          seen.add(line);
          lines.push(line);
        },
      });
      for (const m of result.log ?? []) {
        const line = `[${m.level.toUpperCase()}] ${m.message}`;
        if (!seen.has(line)) lines.push(line);
      }
      this.storage.writeCaseResult(wid, eid, c.id, compactResult(result));
      const s = result.stats;
      lines.push(`Number of steps: ${s.steps}`);
      lines.push(`Number of rejected steps: ${s.rejectedSteps}`);
      lines.push(`Number of Newton iterations: ${s.newtonIterations}`);
      lines.push(`Number of Jacobian evaluations: ${s.jacobianEvaluations}`);
      lines.push(`Number of events: ${s.events}`);
      lines.push(`Result: ${result.time.length} time points, ${result.trajectories.length} variables`);
      c.run_info.statistics = { ...s };
      if (job.cancelled && !s.completed) status = 'cancelled';
      lines.push(`Simulation ${status === 'successful' ? 'finished' : 'cancelled'} in ${seconds(t0)} s (solver ${s.cpuTimeMs.toFixed(0)} ms)`);
    } catch (e) {
      status = 'failed';
      const failures = diagnosticsOf(e).map(formatDiagnostic);
      c.run_info.failures = failures;
      for (const f of failures) lines.push(`Error: ${f}`);
      lines.push(`Simulation failed in ${seconds(t0)} s`);
    }
    c.run_info.status = status;
    c.run_info.datetime_finished = new Date().toISOString();
    this.storage.saveCase(wid, eid, c);
    this.storage.writeCaseLog(wid, eid, c.id, lines.join('\n') + '\n');
  }

  private finishExecution(wid: string, eid: string, job: ExecutionJob): void {
    if (!this.storage.getExperiment(wid, eid)) {
      job.status = 'cancelled';
      job.progress = 1;
      return;
    }
    if (job.cancelled) {
      for (const c of this.storage.listCases(wid, eid)) {
        if (c.run_info.status === 'not_started' || c.run_info.status === 'started') {
          c.run_info.status = 'cancelled';
          this.storage.saveCase(wid, eid, c);
        }
      }
    }
    job.status = job.cancelled ? 'cancelled' : 'done';
    job.progress = 1;
    this.updateRunInfo(wid, eid, job.status);
    this.log(`execution ${eid}: ${job.status}`);
  }

  /** Recomputes the experiment's case counters and persists its status. */
  private updateRunInfo(wid: string, eid: string, status: ExperimentDto['run_info']['status']): void {
    const experiment = this.storage.getExperiment(wid, eid);
    if (!experiment) return;
    const cases = this.storage.listCases(wid, eid);
    const count = (s: CaseStatus) => cases.filter((c) => c.run_info.status === s).length;
    experiment.run_info = {
      status,
      failed: count('failed'),
      successful: count('successful'),
      cancelled: count('cancelled'),
      not_started: count('not_started') + count('started'),
    };
    this.storage.saveExperiment(wid, experiment);
  }

  executionStatus(wid: string, eid: string): ExecutionStatusResponse {
    const experiment = this.storage.requireExperiment(wid, eid);
    const job = this.executions.get(`${wid}/${eid}`);
    if (job) return { status: job.status, progress: job.progress };
    switch (experiment.run_info.status) {
      case 'done':
        return { status: 'done', progress: 1 };
      case 'cancelled':
        return { status: 'cancelled', progress: 1 };
      case 'running':
      case 'pending': {
        // No job in memory: the server restarted mid-run. Mark leftovers as cancelled.
        for (const c of this.storage.listCases(wid, eid)) {
          if (c.run_info.status === 'not_started' || c.run_info.status === 'started') {
            c.run_info.status = 'cancelled';
            this.storage.saveCase(wid, eid, c);
          }
        }
        this.updateRunInfo(wid, eid, 'cancelled');
        return { status: 'cancelled', progress: 1, message: 'Execution was interrupted by a server restart' };
      }
      default:
        return { status: 'pending', progress: 0 };
    }
  }

  /** Sets the cancel flag; returns false when nothing is running. */
  cancelExecution(wid: string, eid: string): boolean {
    this.storage.requireExperiment(wid, eid);
    const job = this.executions.get(`${wid}/${eid}`);
    if (!job || (job.status !== 'pending' && job.status !== 'running')) return false;
    job.cancelled = true;
    return true;
  }

  isExecuting(wid: string, eid: string): boolean {
    const job = this.executions.get(`${wid}/${eid}`);
    return !!job && (job.status === 'pending' || job.status === 'running');
  }
}
