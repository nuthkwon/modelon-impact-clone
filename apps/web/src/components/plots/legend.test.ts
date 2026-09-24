import { describe, expect, it } from 'vitest';
import { legendGroups, shortClassName } from './legend';
import type { ResolvedSeries } from './seriesState';

const mk = (variable: string, label = variable): ResolvedSeries => ({
  id: label,
  label,
  color: '#1f77b4',
  x: [],
  y: [],
  traceIndex: 0,
  variable,
  status: 'ready',
});

describe('legendGroups', () => {
  it('groups der(component.x) under its component, like the CALCULATED VALUES tree', () => {
    const g = legendGroups([mk('inductor.i'), mk('der(inductor.i)')], 'Examples.RLCCircuit');
    expect(g.map((x) => x.name)).toEqual(['inductor']);
    expect(g[0].items.map((i) => i.name)).toEqual(['i', 'der(i)']);
  });

  it('lists top-level variables (including der(x)) under the model and puts that group first', () => {
    const g = legendGroups([mk('ball.v'), mk('h'), mk('der(h)')], 'Examples.BouncingBall');
    expect(g.map((x) => x.name)).toEqual(['BouncingBall', 'ball']);
    expect(g[0].items.map((i) => i.name)).toEqual(['h', 'der(h)']);
    expect(g[1].items.map((i) => i.name)).toEqual(['v']);
  });

  it('keeps case / result suffixes, nested paths and array indices', () => {
    const g = legendGroups(
      [mk('resistor.p.v', 'resistor.p.v [case_2]'), mk('der(inductor.i)', 'der(inductor.i) [Result2]'), mk('a.b[1].c'), mk('x', 'x (not found)')],
      'Examples.RLCCircuit',
    );
    expect(g.map((x) => x.name)).toEqual(['RLCCircuit', 'resistor', 'inductor', 'a']);
    expect(g[0].items[0].name).toBe('x (not found)');
    expect(g[1].items[0].name).toBe('p.v [case_2]');
    expect(g[2].items[0].name).toBe('der(i) [Result2]');
    expect(g[3].items[0].name).toBe('b[1].c');
  });

  it('shortens class names', () => {
    expect(shortClassName('Examples.Sub.Model')).toBe('Model');
    expect(shortClassName('Model')).toBe('Model');
  });
});
