import { describe, expect, it } from 'vitest';
import {
  buildVariableTree,
  classifyVariable,
  componentOf,
  countLeaves,
  flattenTree,
  formatDuration,
  formatTimestamp,
  matchesTypeFilter,
  pruneTree,
  splitDotted,
  variableSegments,
} from './variableTree';

describe('name splitting', () => {
  it('splits dotted names outside brackets and parentheses', () => {
    expect(splitDotted('resistor.p.v')).toEqual(['resistor', 'p', 'v']);
    expect(splitDotted('a.b[1].c')).toEqual(['a', 'b[1]', 'c']);
    expect(splitDotted('a.f(x.y).z')).toEqual(['a', 'f(x.y)', 'z']);
    expect(splitDotted('time')).toEqual(['time']);
  });
  it('groups der() under the component', () => {
    expect(variableSegments('der(inductor.i)')).toEqual(['inductor', 'der(i)']);
    expect(variableSegments('der(x)')).toEqual(['der(x)']);
    expect(variableSegments('der(der(a.b))')).toEqual(['a', 'der(der(b))']);
    expect(componentOf('resistor.p.v')).toBe('resistor');
    expect(componentOf('der(inductor.i)')).toBe('inductor');
    expect(componentOf('x')).toBe('');
  });
});

describe('tree', () => {
  const names = ['time', 'resistor.v', 'resistor.p.v', 'resistor.p.i', 'resistor.R', 'der(inductor.i)', 'inductor.i', 'ground.p.v'];
  const tree = buildVariableTree(names);
  it('builds folders first in natural order with leaves under their component', () => {
    expect(tree.map((n) => n.name)).toEqual(['ground', 'inductor', 'resistor', 'time']);
    const resistor = tree.find((n) => n.name === 'resistor')!;
    expect(resistor.children.map((n) => n.name)).toEqual(['p', 'R', 'v']);
    const inductor = tree.find((n) => n.name === 'inductor')!;
    expect(inductor.children.map((n) => n.name)).toEqual(['der(i)', 'i']);
    expect(inductor.children[0].variable).toBe('der(inductor.i)');
    expect(countLeaves(tree)).toBe(names.length);
  });
  it('flattens with an expanded set and a row limit', () => {
    const closed = flattenTree(tree, new Set());
    expect(closed.rows.map((r) => r.node.name)).toEqual(['ground', 'inductor', 'resistor', 'time']);
    const open = flattenTree(tree, new Set(['resistor', 'resistor.p']));
    expect(open.rows.map((r) => r.node.name)).toEqual(['ground', 'inductor', 'resistor', 'p', 'i', 'v', 'R', 'v', 'time']);
    expect(open.rows.find((r) => r.node.name === 'p')!.depth).toBe(1);
    const limited = flattenTree(tree, new Set(), true, 3);
    expect(limited.rows).toHaveLength(3);
    // 5 folders (ground, ground.p, inductor, resistor, resistor.p) + 8 leaves
    expect(limited.total).toBe(5 + names.length);
  });
  it('prunes to matching leaves keeping their folders', () => {
    const pruned = pruneTree(tree, (v) => v.endsWith('.v'));
    expect(countLeaves(pruned)).toBe(3);
    expect(pruned.map((n) => n.name)).toEqual(['ground', 'resistor']);
    expect(pruneTree(tree, () => false)).toEqual([]);
  });
});

describe('classification', () => {
  it('uses name, meta and trajectory length', () => {
    expect(classifyVariable('der(x)')).toBe('derivative');
    expect(classifyVariable('x', { metaKind: 'derivative' })).toBe('derivative');
    expect(classifyVariable('R', { metaKind: 'parameter' })).toBe('parameter');
    expect(classifyVariable('c', { metaKind: 'constant' })).toBe('parameter');
    expect(classifyVariable('x', { hasDerivative: true })).toBe('state');
    expect(classifyVariable('v', { metaKind: 'continuous' })).toBe('variable');
    expect(classifyVariable('R', { trajectoryLength: 1 })).toBe('parameter');
    expect(classifyVariable('time', { trajectoryLength: 1 })).toBe('variable');
    expect(classifyVariable('v')).toBe('variable');
  });
  it('maps kinds to the type filter', () => {
    expect(matchesTypeFilter('state', 'variables')).toBe(true);
    expect(matchesTypeFilter('state', 'states')).toBe(true);
    expect(matchesTypeFilter('parameter', 'variables')).toBe(false);
    expect(matchesTypeFilter('derivative', 'derivatives')).toBe(true);
    expect(matchesTypeFilter('derivative', 'all')).toBe(true);
  });
});

describe('formatting', () => {
  it('formats timestamps with zero padding in local time', () => {
    const d = new Date(2026, 8, 24, 14, 3, 12);
    expect(formatTimestamp(d.toISOString())).toBe('2026-09-24 14:03:12');
    expect(formatTimestamp(undefined)).toBe('');
    expect(formatTimestamp('garbage')).toBe('garbage');
  });
  it('formats durations', () => {
    expect(formatDuration(400)).toBe('0.4 s');
    expect(formatDuration(12_300)).toBe('12 s');
    expect(formatDuration(125_000)).toBe('2 min 5 s');
    expect(formatDuration(3_780_000)).toBe('1 h 3 min');
    expect(formatDuration(-1)).toBe('');
  });
});
