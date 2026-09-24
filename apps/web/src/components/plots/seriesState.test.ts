import { describe, expect, it } from 'vitest';
import type { ResultEntry } from '../../store/types';
import { SERIES_ERROR_RETRY_MS, canRequest, pruneErrors, resolveSeries, seriesIdentityKey, zoomResetKey } from './seriesState';
import type { SeriesContext, SeriesTarget } from './seriesState';

const result = { id: 'r1', name: 'Result1', className: 'M', cases: [{ id: 'case_1' }] } as unknown as ResultEntry;
const target: SeriesTarget = {
  traceIndex: 0,
  variable: 'resistor.v',
  color: '#1f77b4',
  label: 'resistor.v',
  result,
  caseId: 'case_1',
  caseLabel: 'case_1',
  xKey: 'r1/case_1/time',
  yKey: 'r1/case_1/resistor.v',
};
const ctx = (over: Partial<SeriesContext> = {}): SeriesContext => ({ trajectories: {}, resultVariables: {}, errors: {}, xVariable: 'time', ...over });
const data = { 'r1/case_1/time': [0, 1, 2], 'r1/case_1/resistor.v': [1, 2, 3] };
const failed = { 'r1/case_1/resistor.v': { message: 'Failed to fetch', at: 1000 } };

describe('resolveSeries', () => {
  it('is loading until both x and y are cached, then ready', () => {
    expect(resolveSeries(target, 0, ctx()).status).toBe('loading');
    const s = resolveSeries(target, 0, ctx({ trajectories: data }));
    expect(s.status).toBe('ready');
    expect(s.y).toEqual([1, 2, 3]);
    expect(s.label).toBe('resistor.v');
  });

  it('reports a recorded failure only while the data is still missing', () => {
    const s = resolveSeries(target, 0, ctx({ errors: failed }));
    expect(s.status).toBe('error');
    expect(s.label).toBe('resistor.v (error)');
  });

  it('prefers cached trajectories over a stale failure (data loaded by another component)', () => {
    const s = resolveSeries(target, 0, ctx({ trajectories: data, errors: failed }));
    expect(s.status).toBe('ready');
    expect(s.label).toBe('resistor.v');
    expect(s.y).toEqual([1, 2, 3]);
  });

  it('flags unknown variables and draws parameters as constant lines', () => {
    expect(resolveSeries(target, 0, ctx({ resultVariables: { r1: ['time', 'other'] } })).label).toBe('resistor.v (not found)');
    expect(resolveSeries(target, 0, ctx({ resultVariables: { r1: ['time', 'resistor.v'] }, xVariable: 'nope' })).label).toBe('resistor.v (x not found)');
    const s = resolveSeries(target, 0, ctx({ trajectories: { ...data, 'r1/case_1/resistor.v': [7] } }));
    expect(s.status).toBe('ready');
    expect(s.y).toEqual([7, 7, 7]);
    expect(resolveSeries({ ...target, result: undefined }, 0, ctx()).label).toBe('resistor.v (no result)');
    expect(resolveSeries({ ...target, caseId: undefined }, 0, ctx()).label).toBe('resistor.v (no cases)');
  });
});

describe('error bookkeeping', () => {
  it('drops failures whose data arrived and keeps the object identity otherwise', () => {
    const errors = { ...failed, 'r1/case_1/other': { message: 'x', at: 1 } };
    const pruned = pruneErrors(errors, data);
    expect(Object.keys(pruned)).toEqual(['r1/case_1/other']);
    expect(pruneErrors(errors, {})).toBe(errors);
  });
  it('allows a retry only after the pause', () => {
    const err = { message: 'x', at: 10_000 };
    expect(canRequest(undefined, 0)).toBe(true);
    expect(canRequest(err, 10_000 + SERIES_ERROR_RETRY_MS - 1)).toBe(false);
    expect(canRequest(err, 10_000 + SERIES_ERROR_RETRY_MS)).toBe(true);
  });
});

describe('zoom reset key', () => {
  const a = { resultId: 'r1', caseId: 'case_1', variable: 'ball.v' };
  const b = { resultId: 'r1', caseId: 'case_1', variable: 'ball.h' };
  it('is order independent and ignores duplicates', () => {
    expect(seriesIdentityKey([a, b])).toBe(seriesIdentityKey([b, a, a]));
  });
  it('changes with the x variable, the unit mode, the result and the trace set', () => {
    const base = zoomResetKey('time', [a], false);
    expect(zoomResetKey('ball.h', [a], false)).not.toBe(base);
    expect(zoomResetKey('time', [a], true)).not.toBe(base);
    expect(zoomResetKey('time', [{ ...a, resultId: 'r2' }], false)).not.toBe(base);
    expect(zoomResetKey('time', [a, b], false)).not.toBe(base);
    expect(zoomResetKey('time', [{ ...a, hidden: true } as typeof a], false)).toBe(base);
  });
});
