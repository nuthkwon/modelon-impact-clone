import { describe, expect, it } from 'vitest';
import { makeRegistry } from './fixtures.js';
import { buildClassTree, searchClasses } from './tree.js';

describe('buildClassTree', () => {
  const registry = makeRegistry();

  it('lists top-level classes of every library with read-only, children and icon flags', () => {
    const top = buildClassTree(registry);
    expect(top.map((n) => n.name)).toEqual(['Mini', 'MiniBlocks', 'Circuits', 'Loop']);
    const mini = top[0];
    expect(mini).toMatchObject({ shortName: 'Mini', restriction: 'package', description: 'Mini component library', partial: false, hasChildren: true, libraryId: 'Mini', readOnly: true, droppable: false });
    expect(mini.icon?.graphics).toHaveLength(2); // inherited from Mini.Icons.Package
    expect(top[2]).toMatchObject({ name: 'Circuits', libraryId: 'Examples', readOnly: false, hasChildren: true, droppable: false });
    expect(top[3]).toMatchObject({ name: 'Loop', restriction: 'model', readOnly: false, hasChildren: false, droppable: true });
    expect(top[3].icon).toBeUndefined();
  });

  it('marks droppable classes (model/block/connector/record, not partial or package) and inherited icons', () => {
    const basic = buildClassTree(registry, 'Mini.Electrical.Basic');
    expect(basic.map((n) => [n.shortName, n.droppable, n.hasChildren])).toEqual([['Resistor', true, false], ['Capacitor', true, false], ['Ground', true, false]]);
    expect(basic[0].icon?.graphics).toHaveLength(5);
    expect(basic[0].readOnly).toBe(true);

    const interfaces = buildClassTree(registry, 'Mini.Electrical.Interfaces');
    const byName = Object.fromEntries(interfaces.map((n) => [n.shortName, n]));
    expect(byName.Pin).toMatchObject({ restriction: 'connector', droppable: true });
    expect(byName.PositivePin.icon?.graphics).toHaveLength(1);
    expect(byName.OnePort).toMatchObject({ partial: true, droppable: false });
    expect(byName.TwoPin.droppable).toBe(false);

    const electrical = buildClassTree(registry, 'Mini').find((n) => n.shortName === 'Electrical')!;
    expect(electrical.icon?.graphics).toHaveLength(2);
    expect(buildClassTree(registry, 'Mini.Units').map((n) => [n.restriction, n.droppable, n.icon])).toContainEqual(['type', false, undefined]);
    expect(buildClassTree(registry, 'MiniBlocks.Records')[0]).toMatchObject({ restriction: 'record', droppable: true });
    expect(buildClassTree(registry, 'MiniBlocks.Continuous')[0]).toMatchObject({ restriction: 'block', droppable: true });
  });

  it('returns no children for leaves and unknown parents', () => {
    expect(buildClassTree(registry, 'Mini.Electrical.Basic.Resistor')).toEqual([]);
    expect(buildClassTree(registry, 'Nope')).toEqual([]);
  });
});

describe('searchClasses', () => {
  const registry = makeRegistry();

  it('orders short-name prefix matches, then name matches, then description matches', () => {
    const names = searchClasses(registry, 'pin').map((n) => n.name);
    expect(names).toEqual([
      'Mini.Electrical.Interfaces.Pin',
      'Mini.Electrical.Interfaces.PositivePin',
      'Mini.Electrical.Interfaces.NegativePin',
      'Mini.Electrical.Interfaces.TwoPin',
      'Mini.Electrical.Basic.Ground',
    ]);
    expect(searchClasses(registry, 'resist').map((n) => n.shortName)).toEqual(['Resistance', 'Resistor']);
  });

  it('is case-insensitive, honours the limit and ignores blank queries', () => {
    expect(searchClasses(registry, '  PIN ', 2).map((n) => n.shortName)).toEqual(['Pin', 'PositivePin']);
    expect(searchClasses(registry, 'zero potential')).toHaveLength(1);
    expect(searchClasses(registry, '')).toEqual([]);
    expect(searchClasses(registry, '   ')).toEqual([]);
    expect(searchClasses(registry, 'nomatchanywhere')).toEqual([]);
    const all = searchClasses(registry, 'i');
    expect(all.length).toBeGreaterThan(10);
    expect(searchClasses(registry, 'i', 3)).toEqual(all.slice(0, 3));
  });

  it('returns full tree nodes', () => {
    const [node] = searchClasses(registry, 'Resistor');
    expect(node).toMatchObject({ name: 'Mini.Electrical.Basic.Resistor', shortName: 'Resistor', restriction: 'model', droppable: true, readOnly: true, hasChildren: false, libraryId: 'Mini' });
    expect(node.icon?.graphics).toHaveLength(5);
  });
});
