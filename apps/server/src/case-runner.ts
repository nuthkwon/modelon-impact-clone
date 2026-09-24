/**
 * Runs one experiment case (flatten + simulate) and reports what the job runner logs.
 *
 *  - `WorkerCaseRunner` (default): one `worker_threads` Worker per execution, fed the
 *    workspace's library sources once. The event loop stays responsive while a case
 *    simulates and `cancel()` interrupts the running case by terminating the thread.
 *  - `InlineCaseRunner`: runs the injected `Engine` on the main thread. Used by tests that
 *    replace the engine (a fake cannot cross a thread boundary) and by
 *    `createApp({ inlineSimulation: true })`. Cancel is cooperative through the solver's
 *    `onProgress` hook, i.e. it takes effect between solver steps / between cases.
 */
import { Worker } from 'node:worker_threads';
import type { ClassRegistry } from '@impact/core';
import type { Engine } from './engine.js';
import { diagnosticsOf } from './errors.js';
import type { WorkspaceRegistry } from './registry-cache.js';
import { buildSimulationOptions, compactResult, type CaseRunEvents, type CaseRunInput, type CaseRunOutcome, type SerializedLibrary, type WorkerRequest, type WorkerResponse } from './sim-protocol.js';

export interface CaseRunner {
  /** Runs one case; never rejects for model/solver errors (those are `error` outcomes). One case at a time. */
  run(input: CaseRunInput, events: CaseRunEvents): Promise<CaseRunOutcome>;
  /** Interrupts the current run; later `run()` calls resolve `cancelled`. */
  cancel(): void;
  /** Releases the thread (if any). */
  dispose(): void;
}

/** Library sources of a workspace registry, in load order, for `WorkerCaseRunner`. */
export function serializeLibraries(wr: WorkspaceRegistry): SerializedLibrary[] {
  return [...wr.libraries.values()].map((lib) => ({
    id: lib.id,
    name: lib.name,
    readOnly: lib.readOnly,
    files: [...lib.files.values()].map((f) => ({ path: f.path, text: f.text })),
  }));
}

export class InlineCaseRunner implements CaseRunner {
  private cancelled = false;

  constructor(
    private readonly engine: Engine,
    private readonly registry: () => ClassRegistry,
  ) {}

  run(input: CaseRunInput, events: CaseRunEvents): Promise<CaseRunOutcome> {
    if (this.cancelled) return Promise.resolve({ kind: 'cancelled' });
    try {
      const flat = this.engine.flatten(this.registry(), input.className, { modifiers: input.modifiers, strict: true });
      const options = buildSimulationOptions(input.analysis, flat, input.modifiers);
      events.onFlattened({ stats: { ...flat.stats }, diagnostics: flat.diagnostics ?? [], options });
      const result = this.engine.simulate(flat, options, {
        onProgress: (progress) => {
          events.onProgress(progress);
          return !this.cancelled;
        },
        onLog: (level, message) => events.onLog(level, message),
      });
      return Promise.resolve({ kind: 'result', result: compactResult(result) });
    } catch (e) {
      return Promise.resolve({ kind: 'error', diagnostics: diagnosticsOf(e) });
    }
  }

  cancel(): void {
    this.cancelled = true;
  }

  dispose(): void {
    /* nothing to release */
  }
}

interface PendingRun {
  id: number;
  events: CaseRunEvents;
  resolve: (outcome: CaseRunOutcome) => void;
}

export class WorkerCaseRunner implements CaseRunner {
  private worker?: Worker;
  private pending?: PendingRun;
  private nextId = 1;
  private cancelled = false;

  /** `libraries` is called when a worker is (re)spawned, so it sees the current sources. */
  constructor(private readonly libraries: () => SerializedLibrary[]) {}

  run(input: CaseRunInput, events: CaseRunEvents): Promise<CaseRunOutcome> {
    if (this.pending) return Promise.reject(new Error('WorkerCaseRunner runs one case at a time'));
    if (this.cancelled) return Promise.resolve({ kind: 'cancelled' });
    const worker = (this.worker ??= this.spawn());
    const id = this.nextId++;
    return new Promise<CaseRunOutcome>((resolve) => {
      this.pending = { id, events, resolve };
      const request: WorkerRequest = { type: 'run', id, input };
      worker.postMessage(request);
    });
  }

  cancel(): void {
    this.cancelled = true;
    this.dispose();
  }

  dispose(): void {
    const worker = this.worker;
    this.worker = undefined;
    if (worker) void worker.terminate();
  }

  private spawn(): Worker {
    // See sim-worker.boot.mjs for why the entry is a .mjs bootstrap rather than sim-worker.ts.
    const worker = new Worker(new URL('./sim-worker.boot.mjs', import.meta.url));
    const init: WorkerRequest = { type: 'init', libraries: this.libraries() };
    worker.postMessage(init);
    worker.on('message', (message: WorkerResponse) => this.onMessage(message));
    worker.on('error', (err) => {
      this.settle({ kind: 'error', diagnostics: [{ severity: 'error', message: `Simulation worker crashed: ${err.message}` }] });
    });
    worker.on('exit', (code) => {
      if (this.worker === worker) this.worker = undefined;
      // A pending run at exit time was interrupted: by cancel() (terminate) or by a crash.
      this.settle(this.cancelled ? { kind: 'cancelled' } : { kind: 'error', diagnostics: [{ severity: 'error', message: `Simulation worker exited unexpectedly (code ${code})` }] });
    });
    return worker;
  }

  private onMessage(message: WorkerResponse): void {
    const p = this.pending;
    if (!p || message.id !== p.id) return;
    switch (message.type) {
      case 'flattened':
        p.events.onFlattened(message.info);
        break;
      case 'progress':
        p.events.onProgress(message.progress);
        break;
      case 'log':
        p.events.onLog(message.level, message.message);
        break;
      case 'result':
        this.settle({ kind: 'result', result: message.result });
        break;
      case 'error':
        this.settle({ kind: 'error', diagnostics: message.diagnostics });
        break;
    }
  }

  private settle(outcome: CaseRunOutcome): void {
    const p = this.pending;
    if (!p) return;
    this.pending = undefined;
    p.resolve(outcome);
  }
}
