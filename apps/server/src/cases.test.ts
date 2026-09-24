import { describe, expect, it } from 'vitest';
import type { ExperimentDefinition } from '@impact/protocol';
import { expandCases, mergeAnalysis, parseSweep } from './cases.js';

const analysis = { type: 'dynamic', parameters: { start_time: 0, final_time: 1 }, simulationOptions: { ncp: 500 }, solverOptions: { solver: 'CVode' } };

function definition(variables: Record<string, number | string | boolean>, extensions: ExperimentDefinition['extensions'] = []): ExperimentDefinition {
  return { version: 2, base: { model: { modelica: { className: 'Examples.Simple' } }, modifiers: { variables }, analysis }, extensions };
}

describe('parseSweep', () => {
  it('expands range(a, b, n) into n evenly spaced values', () => {
    expect(parseSweep('range(100, 300, 3)')).toEqual([100, 200, 300]);
    expect(parseSweep('range(0.1, 0.3, 3)')).toEqual([0.1, 0.2, 0.3]);
    expect(parseSweep('range(5, 9, 1)')).toEqual([5]);
    expect(parseSweep(' RANGE( 1 , 2 , 2 ) ')).toEqual([1, 2]);
  });

  it('expands choices(...) into literal values', () => {
    expect(parseSweep('choices(1, 2.5, true, "abc", CVode)')).toEqual([1, 2.5, true, 'abc', 'CVode']);
  });

  it('returns undefined for plain values', () => {
    expect(parseSweep(100)).toBeUndefined();
    expect(parseSweep(true)).toBeUndefined();
    expect(parseSweep('2*pi')).toBeUndefined();
  });

  it('rejects malformed sweeps with a 400 error', () => {
    expect(() => parseSweep('range(1, 2)')).toThrowError(/range\(\)/);
    expect(() => parseSweep('range(1, 2, 0)')).toThrowError(/count >= 1/);
    expect(() => parseSweep('range(a, 2, 3)')).toThrowError(/Invalid range/);
    expect(() => parseSweep('choices()')).toThrowError(/choices\(\)/);
  });
});

describe('expandCases', () => {
  it('creates a single case from the base when there is nothing to expand', () => {
    const cases = expandCases(definition({ R: 100 }));
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ label: 'Case 1', parametrization: { R: 100 } });
    expect(cases[0].analysis).toEqual(analysis);
  });

  it('expands the cartesian product of sweep modifiers and labels them', () => {
    const cases = expandCases(definition({ R: 'range(100, 300, 3)', b: 'choices(true, false)', fixed: 7 }));
    expect(cases).toHaveLength(6);
    expect(cases.map((c) => c.label)).toEqual(['R=100, b=true', 'R=100, b=false', 'R=200, b=true', 'R=200, b=false', 'R=300, b=true', 'R=300, b=false']);
    expect(cases[3].parametrization).toEqual({ R: 200, b: false, fixed: 7 });
  });

  it('caps the total number of cases before materialising them', () => {
    expect(() => expandCases(definition({ R: 'range(1, 3, 3)', C: 'choices(1, 2)' }), 5)).toThrowError(/would expand to 6 cases, more than the maximum of 5/);
    expect(() => expandCases(definition({ R: 'range(0, 1, 1e9)' }), 1000)).toThrowError(/count 1000000000 exceeds the maximum of 1000/);
    expect(() => parseSweep('range(1, 2, 11)', 10)).toThrowError(/exceeds the maximum of 10/);
    expect(() => parseSweep('choices(1, 2, 3)', 2)).toThrowError(/choices\(\) with 3 values exceeds the maximum of 2/);
    expect(expandCases(definition({ R: 'range(1, 3, 3)', C: 'choices(1, 2)' }), 6)).toHaveLength(6);
    // Several extensions add up.
    expect(() => expandCases(definition({}, [{ modifiers: { variables: { R: 'range(1, 3, 3)' } } }, { modifiers: { variables: { R: 'range(1, 3, 3)' } } }]), 5)).toThrowError(/6 cases/);
  });

  it('uses one case per extension (Impact semantics: the base is not a case), merging modifiers and analysis over the base', () => {
    const cases = expandCases(
      definition({ R: 100, C: 1 }, [
        { modifiers: { variables: { R: 50 } }, caseData: { label: 'Low R' }, analysis: { parameters: { final_time: 10 }, solverOptions: { rtol: 1e-8 } } },
        { modifiers: { variables: { C: 'range(1, 2, 2)' } } },
      ]),
    );
    expect(cases).toHaveLength(3);
    expect(cases[0]).toMatchObject({ label: 'Low R', parametrization: { R: 50, C: 1 } });
    expect(cases[0].analysis.parameters).toEqual({ start_time: 0, final_time: 10 });
    expect(cases[0].analysis.solverOptions).toEqual({ solver: 'CVode', rtol: 1e-8 });
    expect(cases[1]).toMatchObject({ label: 'C=1', parametrization: { R: 100, C: 1 } });
    expect(cases[2]).toMatchObject({ label: 'C=2', parametrization: { R: 100, C: 2 } });
  });
});

describe('mergeAnalysis', () => {
  it('deep-merges the option groups', () => {
    const merged = mergeAnalysis(analysis, { simulationOptions: { dynamic_diagnostics: true }, solverOptions: { atol: 1e-9 } });
    expect(merged.type).toBe('dynamic');
    expect(merged.simulationOptions).toEqual({ ncp: 500, dynamic_diagnostics: true });
    expect(merged.solverOptions).toEqual({ solver: 'CVode', atol: 1e-9 });
  });
});
