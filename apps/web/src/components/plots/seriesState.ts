/**
 * Pure helpers behind usePlotSeries: resolving a (trace, case) target against the trajectory
 * cache, expiring recorded fetch failures, and the identity key that resets a chart's zoom.
 * No React, no store — unit-tested in seriesState.test.ts.
 */
import type { ResultEntry } from '../../store/types';
import type { ChartSeries } from './PlotChart';

export type SeriesStatus = 'ready' | 'loading' | 'missing' | 'error';

export interface ResolvedSeries extends ChartSeries {
  traceIndex: number;
  variable: string;
  resultId?: string;
  caseId?: string;
  caseLabel?: string;
  status: SeriesStatus;
}

/** One chart series to resolve: a plot trace for one case of one result. */
export interface SeriesTarget {
  traceIndex: number;
  variable: string;
  hidden?: boolean;
  color: string;
  label: string;
  result?: ResultEntry;
  caseId?: string;
  caseLabel?: string;
  /** Trajectory cache keys (`${resultId}/${caseId}/${variable}`) of the x and y data. */
  xKey?: string;
  yKey?: string;
}

/** A failed trajectory request for one cache key. */
export interface SeriesError {
  message: string;
  /** Failure time (ms since epoch); the key may be requested again after SERIES_ERROR_RETRY_MS. */
  at: number;
}

/** How long a failed key waits before the plot requests it again (matches the store's own retry pause). */
export const SERIES_ERROR_RETRY_MS = 15_000;

export interface SeriesContext {
  trajectories: Readonly<Record<string, number[] | undefined>>;
  resultVariables: Readonly<Record<string, string[] | undefined>>;
  errors: Readonly<Record<string, SeriesError | undefined>>;
  xVariable: string;
}

/** Turns a target into the series the chart draws, with a status / label suffix when data is missing. */
export function resolveSeries(t: SeriesTarget, idx: number, ctx: SeriesContext): ResolvedSeries {
  const id = `${t.traceIndex}:${t.result?.id ?? '-'}:${t.caseId ?? '-'}:${t.variable}:${idx}`;
  const base: ResolvedSeries = {
    id,
    label: t.label,
    color: t.color,
    x: [],
    y: [],
    hidden: t.hidden,
    traceIndex: t.traceIndex,
    variable: t.variable,
    resultId: t.result?.id,
    caseId: t.caseId,
    caseLabel: t.caseLabel,
    status: 'missing',
  };
  if (!t.result) return { ...base, label: `${t.label} (no result)` };
  if (!t.caseId) return { ...base, label: `${t.label} (no cases)` };
  const known = ctx.resultVariables[t.result.id];
  if (known && t.variable !== 'time' && !known.includes(t.variable)) return { ...base, label: `${t.label} (not found)` };
  if (known && ctx.xVariable !== 'time' && !known.includes(ctx.xVariable)) return { ...base, label: `${t.label} (x not found)` };
  let x = ctx.trajectories[t.xKey!];
  let y = ctx.trajectories[t.yKey!];
  if (!x || !y) {
    // Cached data always wins: a recorded failure shows only while the data is still missing.
    const err = ctx.errors[t.yKey!] ?? ctx.errors[t.xKey!];
    return err ? { ...base, status: 'error', label: `${t.label} (error)` } : { ...base, status: 'loading' };
  }
  if (!y.length || !x.length) return { ...base, label: `${t.label} (not found)` };
  // Parameters/constants come back as a single sample: draw them as a constant line.
  if (y.length === 1 && x.length > 1) y = new Array<number>(x.length).fill(y[0]);
  if (x.length === 1 && y.length > 1) x = new Array<number>(y.length).fill(x[0]);
  return { ...base, x, y, status: 'ready' };
}

/** Drops recorded failures whose data has since arrived (through any component); returns `errors` itself when nothing changed. */
export function pruneErrors<T>(errors: Record<string, T>, trajectories: Readonly<Record<string, number[] | undefined>>): Record<string, T> {
  let out: Record<string, T> | undefined;
  for (const k of Object.keys(errors)) {
    if (!trajectories[k]) continue;
    out ??= { ...errors };
    delete out[k];
  }
  return out ?? errors;
}

/** True when a key may be requested (again): never failed, or failed long enough ago. */
export function canRequest(err: SeriesError | undefined, now: number): boolean {
  return !err || now - err.at >= SERIES_ERROR_RETRY_MS;
}

type SeriesIdentity = Pick<ResolvedSeries, 'resultId' | 'caseId' | 'variable'>;

/** Order-independent identity of the data a chart shows: one entry per (result, case, variable). */
export function seriesIdentityKey(series: readonly SeriesIdentity[]): string {
  return [...new Set(series.map((s) => `${s.resultId ?? '-'}/${s.caseId ?? '-'}/${s.variable}`))].sort().join(',');
}

/** Changes whenever a chart's zoom window stops being meaningful: another x variable, other units, other data. */
export function zoomResetKey(xVariable: string, series: readonly SeriesIdentity[], displayUnits: boolean): string {
  return `${xVariable}|${displayUnits ? 'display' : 'si'}|${seriesIdentityKey(series)}`;
}
