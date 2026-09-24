import { describe, expect, it } from 'vitest';
import { ClassRegistry } from '../registry.js';
import { cacheFor, registryStamp } from './cache.js';
import { MINI } from './fixtures.js';
import { getParameters } from './parameters.js';
import { buildDiagramView } from './view.js';

const WITH_A = `package P
  model A
    parameter Real k = 1;
    annotation (Icon(graphics={Rectangle(extent={{-50,-50},{50,50}})}));
  end A;
  model B
    A a annotation (Placement(transformation(extent={{-10,-10},{10,10}})));
  end B;
end P;`;

const WITHOUT_A = `package P
  model B
    A a annotation (Placement(transformation(extent={{-10,-10},{10,10}})));
  end B;
end P;`;

function makeRegistry(text: string): ClassRegistry {
  const registry = new ClassRegistry();
  registry.addLibrary({ id: 'Mini', name: 'Mini', readOnly: true });
  expect(registry.addFile('Mini', 'Mini.mo', MINI)).toEqual([]);
  registry.addLibrary({ id: 'P', name: 'P', readOnly: false });
  expect(registry.addFile('P', 'P.mo', text)).toEqual([]);
  return registry;
}

describe('registry cache stamp', () => {
  it('memoises while the registry is unchanged', () => {
    const registry = makeRegistry(WITH_A);
    const cache = cacheFor(registry);
    buildDiagramView(registry, 'P.B');
    expect(cacheFor(registry)).toBe(cache);
    expect(registryStamp(registry)).toBe(registryStamp(registry));
  });

  it('drops the cache when a library is removed and re-added with different content', () => {
    const registry = makeRegistry(WITH_A);
    const before = buildDiagramView(registry, 'P.B');
    expect(before.components[0]).toMatchObject({ name: 'a', className: 'P.A' });
    expect(before.components[0].icon.graphics).toHaveLength(1);
    expect(getParameters(registry, 'P.A').map((p) => p.name)).toEqual(['k']);
    const stampBefore = registryStamp(registry);
    const cacheBefore = cacheFor(registry);

    // What the web store's deleteClass / the server's reloadLibrary do: drop the library and add it back.
    registry.removeLibrary('P');
    registry.addLibrary({ id: 'P', name: 'P', readOnly: false });
    expect(registry.addFile('P', 'P.mo', WITHOUT_A)).toEqual([]);
    expect(registry.get('P.A')).toBeUndefined();

    expect(registryStamp(registry)).not.toBe(stampBefore);
    expect(cacheFor(registry)).not.toBe(cacheBefore);
    const after = buildDiagramView(registry, 'P.B');
    expect(after.diagnostics.map((d) => d.code)).toContain('unresolved-class');
    expect(after.components[0].icon.graphics).not.toHaveLength(1);
    expect(getParameters(registry, 'P.A')).toEqual([]);
  });

  it('drops the cache when a single file is removed and re-added at the same version', () => {
    const registry = makeRegistry(WITH_A);
    const cacheBefore = cacheFor(registry);
    registry.removeFile('P', 'P.mo');
    expect(registry.addFile('P', 'P.mo', WITHOUT_A)).toEqual([]);
    expect(registry.getFile('P', 'P.mo')?.version).toBe(1);
    expect(cacheFor(registry)).not.toBe(cacheBefore);
  });
});
