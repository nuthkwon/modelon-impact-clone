/**
 * Flattens every runnable model of the shipped libraries (`libraries/Modelica`,
 * `libraries/Examples`) and checks that each one is balanced. Skipped when the directories
 * do not exist yet. Failures print the diagnostics so the library author can fix the model.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ModelicaError } from '../ast.js';
import { ClassRegistry } from '../registry.js';
import { flatten } from './index.js';

const LIB_ROOT = fileURLToPath(new URL('../../../../libraries/', import.meta.url));
const MODELICA_DIR = join(LIB_ROOT, 'Modelica');
const EXAMPLES_DIR = join(LIB_ROOT, 'Examples');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (entry.endsWith('.mo')) out.push(p);
  }
  return out;
}

/** Loads every .mo file under `dir` into `registry` (package.mo of each directory first). */
function loadLibrary(registry: ClassRegistry, id: string, dir: string): string[] {
  const files = walk(dir).sort((a, b) => {
    const ka = a.replace(/package\.mo$/, '!package.mo');
    const kb = b.replace(/package\.mo$/, '!package.mo');
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  registry.addLibrary({ id, name: id, readOnly: id === 'Modelica' });
  const errors: string[] = [];
  for (const f of files) {
    const rel = relative(dir, f);
    const diags = registry.addFile(id, rel, readFileSync(f, 'utf8'));
    for (const d of diags) errors.push(`${id}/${rel}${d.loc ? `:${d.loc.line}:${d.loc.column}` : ''}: ${d.message}`);
  }
  return errors;
}

function runnableModels(registry: ClassRegistry, filter: (name: string) => boolean): string[] {
  return registry
    .allClassNames()
    .filter(filter)
    .filter((name) => {
      const cls = registry.get(name)!;
      return (cls.def.restriction === 'model' || cls.def.restriction === 'block') && !cls.def.partial;
    })
    .sort();
}

function describeFailure(name: string, e: unknown): string {
  if (e instanceof ModelicaError) {
    const lines = e.diagnostics.map((d) => `    [${d.severity}] ${d.message}${d.file ? ` (${d.file}${d.loc ? `:${d.loc.line}:${d.loc.column}` : ''})` : ''}`);
    return `${name}: ${e.message}\n${lines.join('\n')}`;
  }
  return `${name}: ${String(e)}`;
}

function checkAll(registry: ClassRegistry, models: string[]): { failures: string[]; timings: string[] } {
  const failures: string[] = [];
  const timings: string[] = [];
  for (const name of models) {
    const t0 = performance.now();
    try {
      const flat = flatten(registry, name);
      const ms = performance.now() - t0;
      timings.push(`${name}: ${flat.stats.unknowns} unknowns, ${flat.stats.equations} equations, ${flat.stats.states} states, ${ms.toFixed(1)} ms`);
      if (ms > 200) failures.push(`${name}: flattening took ${ms.toFixed(1)} ms (limit 200 ms)`);
      const warnings = flat.diagnostics.filter((d) => d.severity === 'warning');
      if (warnings.length) timings.push(warnings.map((w) => `    [warning] ${w.message}`).join('\n'));
    } catch (e) {
      failures.push(describeFailure(name, e));
    }
  }
  return { failures, timings };
}

const hasModelica = existsSync(MODELICA_DIR);
const hasExamples = existsSync(EXAMPLES_DIR);

describe.skipIf(!hasModelica)('shipped libraries', () => {
  const registry = new ClassRegistry();
  const parseErrors: string[] = [];
  if (hasModelica) parseErrors.push(...loadLibrary(registry, 'Modelica', MODELICA_DIR));
  if (hasExamples) parseErrors.push(...loadLibrary(registry, 'Examples', EXAMPLES_DIR));

  it('parses without errors', () => {
    expect(parseErrors, parseErrors.join('\n')).toEqual([]);
  });

  it.skipIf(!hasExamples)('flattens every model under Examples to a balanced system', () => {
    const models = runnableModels(registry, (n) => n.startsWith('Examples.'));
    expect(models.length).toBeGreaterThan(0);
    // warm-up (JIT) so the timing limit is meaningful
    try {
      flatten(registry, models[0]);
    } catch {
      /* reported below */
    }
    const { failures, timings } = checkAll(registry, models);
    console.log(`Examples:\n  ${timings.join('\n  ')}`);
    expect(failures, `\n${failures.join('\n\n')}`).toEqual([]);
  });

  it('flattens every Modelica.*.Examples.* model to a balanced system', () => {
    const models = runnableModels(registry, (n) => n.startsWith('Modelica.') && /\.Examples\.[^.]+$/.test(n));
    if (models.length === 0) {
      console.warn('no Modelica.*.Examples.* models found');
      return;
    }
    try {
      flatten(registry, models[0]);
    } catch {
      /* reported below */
    }
    const { failures, timings } = checkAll(registry, models);
    console.log(`Modelica examples:\n  ${timings.join('\n  ')}`);
    expect(failures, `\n${failures.join('\n\n')}`).toEqual([]);
  });
});
