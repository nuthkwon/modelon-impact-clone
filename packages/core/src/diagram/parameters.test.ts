import { describe, expect, it } from 'vitest';
import { MINI, makeRegistry } from './fixtures.js';

const lineOf = (text: string, needle: string) => text.split('\n').findIndex((l) => l.includes(needle)) + 1;
import { getParameters, getVariables } from './parameters.js';

describe('getParameters', () => {
  const registry = makeRegistry();

  it('collects declared and inherited parameters, bases first, with type units and dialogs', () => {
    const params = getParameters(registry, 'Mini.Electrical.Basic.Resistor');
    expect(params.map((p) => p.name)).toEqual(['useHeatPort', 'T', 'R', 'T_ref', 'alpha']);
    const [useHeatPort, T, R, T_ref, alpha] = params;
    expect(useHeatPort).toMatchObject({ typeName: 'Boolean', baseType: 'Boolean', defaultText: 'false', evaluated: false, final: false, constant: false, dialog: { tab: 'Advanced', group: 'Parameters' } });
    expect(useHeatPort.valueText).toBeUndefined();
    expect(T).toMatchObject({ typeName: 'Mini.Units.Temperature', baseType: 'Real', unit: 'K', displayUnit: 'degC', defaultText: 'T_ref', evaluated: 300.15, dialog: { tab: 'General', group: 'Parameters', enable: true } });
    expect(R).toMatchObject({ typeName: 'Mini.Units.Resistance', unit: 'Ohm', description: 'Resistance', attributes: { start: '1' } });
    expect(R.defaultText).toBeUndefined();
    expect(R.evaluated).toBeUndefined();
    expect(T_ref).toMatchObject({ defaultText: '300.15', evaluated: 300.15, dialog: { tab: 'General', group: 'Temperature' } });
    expect(alpha).toMatchObject({ typeName: 'Real', defaultText: '0', evaluated: 0 });
    expect(alpha.attributes).toBeUndefined();
    expect(R.loc?.line).toBe(lineOf(MINI, 'parameter Units.Resistance R(start=1)'));
  });

  it('applies the owner component modifiers to valueText, attributes and evaluated', () => {
    const params = getParameters(registry, 'Mini.Electrical.Basic.Resistor', { ownerClassName: 'Circuits.RC', componentName: 'resistor' });
    const byName = Object.fromEntries(params.map((p) => [p.name, p]));
    expect(byName.R).toMatchObject({ valueText: 'Rval', evaluated: 100, attributes: { start: '1' } });
    expect(byName.T_ref).toMatchObject({ valueText: '310', defaultText: '300.15', evaluated: 310 });
    expect(byName.T).toMatchObject({ defaultText: 'T_ref', evaluated: 310 });
    expect(byName.alpha).toMatchObject({ defaultText: '0', attributes: { start: '0.1' } });
    expect(byName.alpha.valueText).toBeUndefined();
    // Dotted attribute modifiers are not parameters of their own.
    expect(params.some((p) => p.name.includes('.'))).toBe(false);
  });

  it('honours extends modifications on the owner path for inherited components', () => {
    const params = getParameters(registry, 'Mini.Electrical.Basic.Resistor', { ownerClassName: 'Circuits.ExtendedRC', componentName: 'resistor' });
    expect(params.find((p) => p.name === 'R')).toMatchObject({ valueText: '5', evaluated: 5 });
    expect(params.find((p) => p.name === 'T_ref')).toMatchObject({ valueText: '310', evaluated: 310 });
  });

  it('exposes enumeration literals and evaluates enumeration references', () => {
    const params = getParameters(registry, 'MiniBlocks.Continuous.Integrator');
    expect(params.map((p) => p.name)).toEqual(['k', 'initType', 'y_start']);
    const initType = params[1];
    expect(initType).toMatchObject({
      typeName: 'MiniBlocks.Types.Init',
      baseType: 'enumeration',
      literals: ['NoInit', 'SteadyState', 'InitialState', 'InitialOutput'],
      defaultText: 'MiniBlocks.Types.Init.InitialState',
      evaluated: 'InitialState',
      dialog: { tab: 'General', group: 'Initialization' },
    });
    const owned = getParameters(registry, 'MiniBlocks.Continuous.Integrator', { ownerClassName: 'Loop', componentName: 'integrator' });
    expect(owned[1]).toMatchObject({ valueText: 'MiniBlocks.Types.Init.SteadyState', evaluated: 'SteadyState' });
    expect(owned[0]).toMatchObject({ valueText: 'const.k*2', evaluated: 4 });
  });

  it('resolves constants of other classes, min/max and final parameters, skipping protected ones', () => {
    const params = getParameters(registry, 'MiniBlocks.Continuous.FirstOrder');
    expect(params.map((p) => p.name)).toEqual(['k', 'T', 'f', 'w']);
    expect(params[1]).toMatchObject({ defaultText: '0.1', evaluated: 0.1, min: 1e-60, attributes: { min: 'Constants.small' } });
    expect(params[3]).toMatchObject({ final: true, defaultText: 'MiniBlocks.Constants.twoPi*f' });
    expect(params[3].evaluated).toBeCloseTo(2 * Math.PI, 12);
    const owned = getParameters(registry, 'MiniBlocks.Continuous.FirstOrder', { ownerClassName: 'Loop', componentName: 'firstOrder' });
    expect(owned[1]).toMatchObject({ valueText: '0.5', evaluated: 0.5, min: 0.01, attributes: { min: '0.01' } });
    expect(owned[3].evaluated).toBeCloseTo(4 * Math.PI, 12);
    expect(getParameters(registry, 'MiniBlocks.Constants').map((p) => [p.name, p.evaluated, p.constant])).toEqual([
      ['pi', Math.PI, true], ['small', 1e-60, true], ['twoPi', 2 * Math.PI, true],
    ]);
  });

  it('flattens record-typed parameters one level', () => {
    const params = getParameters(registry, 'Loop');
    expect(params.map((p) => p.name)).toEqual(['data.a', 'data.b', 'data.n']);
    expect(params[0]).toMatchObject({ typeName: 'Real', defaultText: '10', evaluated: 10, description: 'Field a', constant: false });
    expect(params[1]).toMatchObject({ defaultText: '2', evaluated: 2, unit: 'm', attributes: { start: '5' } });
    expect(params[2]).toMatchObject({ typeName: 'Integer', baseType: 'Integer', defaultText: '3', evaluated: 3, constant: true });
    const placed = getParameters(registry, 'MiniBlocks.Records.Data', { ownerClassName: 'Loop', componentName: 'placedData' });
    expect(placed.map((p) => [p.name, p.valueText, p.evaluated])).toEqual([['a', '3', 3], ['b', undefined, 2], ['n', undefined, 3]]);
  });

  it('returns an empty list for classes without parameters and for unknown classes', () => {
    expect(getParameters(registry, 'Mini.Electrical.Interfaces.Pin')).toEqual([]);
    expect(getParameters(registry, 'Nope')).toEqual([]);
    expect(getParameters(registry, 'Real')).toEqual([]);
  });

  it('memoises results per registry content', () => {
    const reg = makeRegistry();
    const a = getParameters(reg, 'Mini.Electrical.Basic.Resistor');
    expect(getParameters(reg, 'Mini.Electrical.Basic.Resistor')).toBe(a);
    reg.addFile('Examples', 'Loop.mo', 'model Loop\nend Loop;');
    expect(getParameters(reg, 'Mini.Electrical.Basic.Resistor')).not.toBe(a);
    expect(getParameters(reg, 'Loop')).toEqual([]);
  });
});

describe('getVariables', () => {
  const registry = makeRegistry();

  it('lists connector sub-variables, own variables and inherited ones with units and flow', () => {
    const vars = getVariables(registry, 'Mini.Electrical.Basic.Resistor');
    expect(vars.map((v) => v.name)).toEqual(['p.v', 'p.i', 'n.v', 'n.i', 'v', 'i', 'heatPort.T', 'heatPort.Q_flow', 'R_actual']);
    expect(vars[0]).toEqual({ name: 'p.v', typeName: 'Mini.Units.Voltage', description: 'Potential at the pin', unit: 'V', causality: 'none', variability: 'continuous', flow: false, inConnector: true });
    expect(vars[1]).toMatchObject({ name: 'p.i', unit: 'A', flow: true, inConnector: true });
    expect(vars[4]).toMatchObject({ name: 'v', unit: 'V', inConnector: false, description: 'Voltage drop' });
    expect(vars[7]).toMatchObject({ name: 'heatPort.Q_flow', unit: 'W', flow: true });
    expect(vars[8]).toMatchObject({ name: 'R_actual', typeName: 'Mini.Units.Resistance', unit: 'Ohm' });
  });

  it('classifies causality and variability of block variables and includes protected ones', () => {
    const vars = getVariables(registry, 'MiniBlocks.Continuous.FirstOrder');
    expect(vars.map((v) => [v.name, v.causality, v.variability, v.inConnector])).toEqual([
      ['u', 'input', 'continuous', true],
      ['y', 'output', 'continuous', true],
      ['x', 'output', 'continuous', false],
      ['cnt', 'none', 'discrete', false],
      ['on', 'none', 'discrete', false],
      ['trigger', 'input', 'discrete', true],
      ['reset', 'input', 'discrete', true],
      ['hiddenVar', 'none', 'continuous', false],
    ]);
    expect(vars[0].typeName).toBe('MiniBlocks.Interfaces.RealInput');
  });

  it('excludes sub-components but includes record fields', () => {
    const vars = getVariables(registry, 'Loop');
    expect(vars.map((v) => v.name)).toEqual(['placedData.a', 'placedData.b', 'placedData.n']);
    expect(vars[1]).toMatchObject({ unit: 'm', inConnector: false, variability: 'continuous' });
    expect(vars[2].variability).toBe('discrete');
    expect(getVariables(registry, 'Circuits.RC').map((v) => v.name)).toEqual(['pin.v', 'pin.i', 'hidden']);
  });
});
