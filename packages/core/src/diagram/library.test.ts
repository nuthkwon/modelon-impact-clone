/**
 * Smoke test against the shipped libraries (`libraries/Modelica`, `libraries/Examples`) when they
 * are present: every class must produce a diagram view without throwing, and every example model
 * must build without error diagnostics.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ClassRegistry } from '../registry.js';
import { getParameters, getVariables } from './parameters.js';
import { buildClassTree, searchClasses } from './tree.js';
import { buildDiagramView, resolveIcon } from './view.js';

const LIBRARIES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'libraries');
const MODELICA_DIR = join(LIBRARIES, 'Modelica');
const EXAMPLES_DIR = join(LIBRARIES, 'Examples');

/** All `.mo` files below `dir`, `package.mo` files first (parents before children), then alphabetical. */
function listModelicaFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d).sort()) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.mo')) out.push(full);
    }
  };
  walk(dir);
  return out.sort((a, b) => {
    const da = a.split('/').length;
    const db = b.split('/').length;
    const pa = a.endsWith('package.mo') ? 0 : 1;
    const pb = b.endsWith('package.mo') ? 0 : 1;
    return da - db || pa - pb || a.localeCompare(b);
  });
}

function loadLibrary(registry: ClassRegistry, id: string, dir: string, readOnly: boolean): string[] {
  registry.addLibrary({ id, name: id, readOnly });
  const problems: string[] = [];
  for (const file of listModelicaFiles(dir)) {
    const diagnostics = registry.addFile(id, relative(dir, file), readFileSync(file, 'utf8'));
    for (const d of diagnostics) problems.push(`${file}: ${d.message}`);
  }
  return problems;
}

const hasModelica = existsSync(MODELICA_DIR) && listModelicaFiles(MODELICA_DIR).length > 0;
const hasExamples = existsSync(EXAMPLES_DIR) && listModelicaFiles(EXAMPLES_DIR).length > 0;

describe.skipIf(!hasModelica)('shipped Modelica library', () => {
  const registry = new ClassRegistry();
  const problems = hasModelica ? loadLibrary(registry, 'Modelica', MODELICA_DIR, true) : [];
  if (hasExamples) problems.push(...loadLibrary(registry, 'Examples', EXAMPLES_DIR, false));

  it('parses without diagnostics', () => {
    expect(problems).toEqual([]);
  });

  it('builds a diagram view, parameters and variables of every class without throwing', () => {
    const names = registry.allClassNames();
    expect(names.length).toBeGreaterThan(10);
    for (const name of names) {
      const view = buildDiagramView(registry, name);
      expect(view.className).toBe(name);
      getParameters(registry, name);
      getVariables(registry, name);
    }
  });

  it('resolves MSL icons, packages and signal connectors', () => {
    expect(resolveIcon(registry, 'Modelica')?.graphics.length).toBeGreaterThan(0);
    expect(resolveIcon(registry, 'Modelica.Blocks')?.graphics.length).toBeGreaterThan(0);
    const input = resolveIcon(registry, 'Modelica.Blocks.Interfaces.RealInput');
    expect(input?.graphics).toHaveLength(1);
    expect(input?.coordinateSystem.initialScale).toBe(0.2);
    const tree = buildClassTree(registry, 'Modelica');
    expect(tree.length).toBeGreaterThan(0);
    expect(tree.every((n) => n.readOnly && n.icon)).toBe(true);
    expect(searchClasses(registry, 'integrator', 5)[0]?.name).toBe('Modelica.Blocks.Continuous.Integrator');
  });

  it('builds a block with signal ports and dialog groups', () => {
    if (!registry.has('Modelica.Blocks.Continuous.Integrator')) return;
    const view = buildDiagramView(registry, 'Modelica.Blocks.Continuous.Integrator');
    expect(view.components.map((c) => [c.name, c.isConnector])).toEqual([['u', true], ['y', true]]);
    const params = getParameters(registry, 'Modelica.Blocks.Continuous.Integrator');
    expect(params.find((p) => p.name === 'k')).toMatchObject({ defaultText: '1', evaluated: 1 });
    expect(params.find((p) => p.name === 'y_start')?.dialog).toEqual({ tab: 'General', group: 'Initialization' });
  });

  it.skipIf(!hasExamples)('builds every example model without error diagnostics', () => {
    const examples = registry.allClassNames().filter((n) => {
      const cls = registry.get(n);
      return cls?.libraryId === 'Examples' && cls.def.restriction === 'model' && !cls.def.partial;
    });
    expect(examples.length).toBeGreaterThan(0);
    for (const name of examples) {
      const view = buildDiagramView(registry, name);
      const errors = view.diagnostics.filter((d) => d.severity === 'error');
      expect(errors, `${name}: ${errors.map((d) => d.message).join('; ')}`).toEqual([]);
    }
  });
});
