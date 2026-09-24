/**
 * The Execution settings dialog's `ncp` and `rtol` mirror the ANALYSIS "Points" and "Tolerance":
 * a value committed there must reach the run request built by `analysisToRequest`.
 */
import { describe, expect, it } from 'vitest';
import { analysisToRequest, pointsOf } from '../../store';
import type { AnalysisSettings, Experiment } from '../../store/types';
import { linkedExecutionPatch } from './helpers';

const ANALYSIS: AnalysisSettings = {
  type: 'dynamic',
  startTime: 0,
  stopTime: 1,
  interval: 0.002,
  useInterval: true,
  solver: 'CVode',
  tolerance: 1e-6,
  stepSize: 0.01,
  advanced: {
    compiler: { c_compiler: 'gcc', generate_html_diagnostics: false, include_protected_variables: false, filter_warnings: false },
    runtime: { log_level: 3 },
    simulation: { ncp: 500, dynamic_diagnostics: false, store_event_points: true },
    solver: { rtol: 1e-6, atol: 1e-6 },
  },
};

function experiment(analysis: AnalysisSettings): Experiment {
  return { id: 'exp1', name: 'Experiment 1', className: 'Examples.RCCircuit', createdAt: '2026-09-24T00:00:00Z', analysis, modifiers: {}, outputs: [] };
}

describe('Execution settings ncp / rtol', () => {
  it('show the effective values (Points and Tolerance), not a separate copy', () => {
    const a: AnalysisSettings = { ...ANALYSIS, interval: 0.01, tolerance: 1e-4, advanced: { ...ANALYSIS.advanced, simulation: { ...ANALYSIS.advanced.simulation, ncp: 50 }, solver: { rtol: 1e-3, atol: 1e-6 } } };
    const req = analysisToRequest(experiment(a));
    // What the run uses…
    expect(req.experiment.base.analysis.simulationOptions.ncp).toBe(100);
    expect(req.experiment.base.analysis.solverOptions.rtol).toBe(1e-4);
    // …is what the dialog displays.
    expect(pointsOf(a)).toBe(100);
    expect(a.tolerance).toBe(1e-4);
  });

  it('committing ncp = 50 in the dialog makes the request carry ncp = 50', () => {
    const a: AnalysisSettings = { ...ANALYSIS, ...linkedExecutionPatch(ANALYSIS, 'ncp', 50) };
    expect(analysisToRequest(experiment(a)).experiment.base.analysis.simulationOptions.ncp).toBe(50);
    expect(pointsOf(a)).toBe(50);
  });

  it('committing rtol = 1e-3 in the dialog makes the request carry rtol = 1e-3', () => {
    const a: AnalysisSettings = { ...ANALYSIS, ...linkedExecutionPatch(ANALYSIS, 'rtol', 1e-3) };
    expect(analysisToRequest(experiment(a)).experiment.base.analysis.solverOptions.rtol).toBe(1e-3);
    expect(a.tolerance).toBe(1e-3);
  });
});
