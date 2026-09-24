/**
 * Simulation worker (`worker_threads`). One worker serves one experiment execution: it gets
 * the workspace's library sources once (`init`), rebuilds a `ClassRegistry` from them and then
 * flattens + simulates one case per `run` request, streaming progress (in ~2 % steps), solver
 * log lines and finally the compact result back to the job runner.
 *
 * Running here keeps the server's event loop free while `simulate()` crunches, and lets
 * `DELETE …/execution` interrupt a case at any point with `worker.terminate()` — which is why
 * there is no cancel flag in this file.
 *
 * Entry point is `sim-worker.boot.mjs` (registers tsx so the `.ts` sources resolve).
 */
import { parentPort } from 'node:worker_threads';
import { ClassRegistry, flatten, simulate } from '@impact/core';
import { diagnosticsOf } from './errors.js';
import { buildSimulationOptions, compactResult, type CaseRunInput, type SerializedLibrary, type WorkerRequest, type WorkerResponse } from './sim-protocol.js';

if (!parentPort) throw new Error('sim-worker.ts must run inside a worker thread');
const port = parentPort;
const post = (message: WorkerResponse): void => port.postMessage(message);

/** Progress messages are posted when the value moved by at least this much. */
const PROGRESS_STEP = 0.02;

let registry: ClassRegistry | undefined;

function buildRegistry(libraries: SerializedLibrary[]): ClassRegistry {
  const r = new ClassRegistry();
  for (const lib of libraries) {
    r.addLibrary({ id: lib.id, name: lib.name, readOnly: lib.readOnly });
    for (const f of lib.files) r.addFile(lib.id, f.path, f.text);
  }
  return r;
}

function run(id: number, input: CaseRunInput): void {
  try {
    if (!registry) throw new Error('Simulation worker received a case before its libraries');
    const flat = flatten(registry, input.className, { modifiers: input.modifiers, strict: true });
    const options = buildSimulationOptions(input.analysis, flat, input.modifiers);
    post({ type: 'flattened', id, info: { stats: { ...flat.stats }, diagnostics: flat.diagnostics ?? [], options } });
    let lastReported = -1;
    const result = simulate(flat, options, {
      onProgress: (progress) => {
        const p = Math.max(0, Math.min(1, progress));
        if (p - lastReported >= PROGRESS_STEP || (p >= 1 && lastReported < 1)) {
          lastReported = p;
          post({ type: 'progress', id, progress: p });
        }
        return true;
      },
      onLog: (level, message) => post({ type: 'log', id, level, message }),
    });
    post({ type: 'result', id, result: compactResult(result) });
  } catch (e) {
    post({ type: 'error', id, diagnostics: diagnosticsOf(e) });
  }
}

port.on('message', (message: WorkerRequest) => {
  if (message.type === 'init') registry = buildRegistry(message.libraries);
  else if (message.type === 'run') run(message.id, message.input);
});
