/**
 * Resolves a PlotWindow's traces into chart series: one series per (trace, case), fetched
 * through the store's trajectory cache. Multi-case results get `[case_2]` suffixes and a
 * palette rotation; traces bound to a non-active result get a `[ResultName]` suffix.
 * A failed request shows as `(error)` only while its data is missing: data that arrives through
 * another component wins, and the key is requested again after a pause (see ./seriesState).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { PLOT_PALETTE, useStore } from '../../store';
import type { PlotWindow, ResultEntry } from '../../store/types';
import { SERIES_ERROR_RETRY_MS, canRequest, pruneErrors, resolveSeries } from './seriesState';
import type { ResolvedSeries, SeriesError, SeriesTarget } from './seriesState';

export type { ResolvedSeries, SeriesStatus } from './seriesState';

export interface PlotSeriesState {
  series: ResolvedSeries[];
  loading: boolean;
  error?: string;
  /** Result used for traces without an explicit resultId. */
  activeResult?: ResultEntry;
}

export function caseLabelOf(r: ResultEntry, index: number): string {
  const c = r.cases[index];
  return c?.meta?.label || `case_${index + 1}`;
}

/** Colour of a trace for the given case: the trace colour, rotated through the palette per case. */
export function traceColor(traceColor: string | undefined, traceIndex: number, caseIndex: number): string {
  const base = traceColor ? PLOT_PALETTE.indexOf(traceColor) : -1;
  if (caseIndex === 0 && traceColor) return traceColor;
  const start = base >= 0 ? base : traceIndex;
  return PLOT_PALETTE[(start + caseIndex) % PLOT_PALETTE.length];
}

export function usePlotSeries(plot: PlotWindow, className: string): PlotSeriesState {
  const results = useStore((s) => s.results);
  const activeResultId = useStore((s) => s.activeResult[className]);
  const trajectories = useStore((s) => s.trajectories);
  const resultVariables = useStore((s) => s.resultVariables);
  const fetchTrajectories = useStore((s) => s.fetchTrajectories);
  const fetchResultVariables = useStore((s) => s.fetchResultVariables);
  const [errors, setErrors] = useState<Record<string, SeriesError>>({});
  /** Bumped once the oldest recorded failure is old enough to retry; re-runs the fetch effect. */
  const [retryTick, setRetryTick] = useState(0);
  const requested = useRef(new Set<string>());
  const listed = useRef(new Set<string>());

  const activeResult = useMemo(
    () => results.find((r) => r.id === activeResultId) ?? results.find((r) => r.className === className),
    [results, activeResultId, className],
  );

  const targets = useMemo<SeriesTarget[]>(() => {
    const out: SeriesTarget[] = [];
    plot.traces.forEach((trace, i) => {
      const r = trace.resultId ? results.find((x) => x.id === trace.resultId) : activeResult;
      const resultSuffix = trace.resultId && r && r.id !== activeResult?.id ? ` [${r.name}]` : '';
      if (!r) {
        out.push({ traceIndex: i, variable: trace.variable, hidden: trace.hidden, color: trace.color ?? PLOT_PALETTE[i % PLOT_PALETTE.length], label: trace.variable });
        return;
      }
      const cases = r.cases.filter((c) => c.run_info.status !== 'not_started');
      if (!cases.length) {
        out.push({ traceIndex: i, variable: trace.variable, hidden: trace.hidden, color: trace.color ?? PLOT_PALETTE[i % PLOT_PALETTE.length], label: `${trace.variable}${resultSuffix}`, result: r });
        return;
      }
      const multi = r.cases.length > 1;
      cases.forEach((c) => {
        const ci = r.cases.indexOf(c);
        const caseLabel = caseLabelOf(r, ci);
        out.push({
          traceIndex: i,
          variable: trace.variable,
          hidden: trace.hidden,
          color: traceColor(trace.color, i, multi ? ci : 0),
          label: `${trace.variable}${resultSuffix}${multi ? ` [${caseLabel}]` : ''}`,
          result: r,
          caseId: c.id,
          caseLabel,
          xKey: `${r.id}/${c.id}/${plot.xVariable}`,
          yKey: `${r.id}/${c.id}/${trace.variable}`,
        });
      });
    });
    return out;
  }, [plot.traces, plot.xVariable, results, activeResult]);

  // Fetch whatever is missing, grouped per (result, case) so one request covers x and y. A key
  // whose last request failed is left alone for SERIES_ERROR_RETRY_MS, then requested again.
  useEffect(() => {
    const now = Date.now();
    const groups = new Map<string, { rid: string; cid: string; vars: Set<string> }>();
    const resultsToList = new Set<string>();
    for (const t of targets) {
      if (!t.result || !t.caseId) continue;
      const known = resultVariables[t.result.id];
      if (!known) resultsToList.add(t.result.id);
      for (const [key, v] of [
        [t.xKey!, plot.xVariable],
        [t.yKey!, t.variable],
      ] as const) {
        if (trajectories[key] || requested.current.has(key) || !canRequest(errors[key], now)) continue;
        if (known && v !== 'time' && !known.includes(v)) continue;
        const gk = `${t.result.id}/${t.caseId}`;
        let g = groups.get(gk);
        if (!g) groups.set(gk, (g = { rid: t.result.id, cid: t.caseId, vars: new Set() }));
        g.vars.add(v);
      }
    }
    for (const rid of resultsToList) {
      if (listed.current.has(rid)) continue;
      listed.current.add(rid);
      void fetchResultVariables(rid)
        .catch(() => undefined)
        .finally(() => listed.current.delete(rid));
    }
    for (const g of groups.values()) {
      const vars = [...g.vars];
      const keys = vars.map((v) => `${g.rid}/${g.cid}/${v}`);
      keys.forEach((k) => requested.current.add(k));
      fetchTrajectories(g.rid, g.cid, vars)
        .then(() => {
          // A re-fetch that succeeds clears the recorded failure (the data itself arrives via the store).
          setErrors((prev) => {
            if (!keys.some((k) => k in prev)) return prev;
            const next = { ...prev };
            keys.forEach((k) => delete next[k]);
            return next;
          });
        })
        .catch((e: unknown) => {
          const message = e instanceof Error ? e.message : String(e);
          const at = Date.now();
          setErrors((prev) => {
            const next = { ...prev };
            keys.forEach((k) => (next[k] = { message, at }));
            return next;
          });
        })
        .finally(() => keys.forEach((k) => requested.current.delete(k)));
    }
  }, [targets, trajectories, resultVariables, errors, retryTick, plot.xVariable, fetchTrajectories, fetchResultVariables]);

  // Data that arrived through another component (Calculated Values, stickies, …) supersedes a failure.
  useEffect(() => {
    setErrors((prev) => pruneErrors(prev, trajectories));
  }, [trajectories]);

  // Forget errors for results that disappeared (e.g. after a delete) so a re-run can retry.
  useEffect(() => {
    const ids = new Set(results.map((r) => r.id));
    setErrors((prev) => {
      const keep = Object.entries(prev).filter(([k]) => ids.has(k.split('/')[0]));
      return keep.length === Object.keys(prev).length ? prev : Object.fromEntries(keep);
    });
  }, [results]);

  // Wake the fetch effect once the oldest failure may be retried.
  useEffect(() => {
    const ats = Object.values(errors).map((e) => e.at);
    if (!ats.length) return;
    const wait = Math.max(0, Math.min(...ats) + SERIES_ERROR_RETRY_MS - Date.now()) + 20;
    const id = window.setTimeout(() => setRetryTick((t) => t + 1), wait);
    return () => window.clearTimeout(id);
  }, [errors]);

  const series = useMemo<ResolvedSeries[]>(
    () => targets.map((t, idx) => resolveSeries(t, idx, { trajectories, resultVariables, errors, xVariable: plot.xVariable })),
    [targets, trajectories, resultVariables, errors, plot.xVariable],
  );

  const loading = series.some((s) => s.status === 'loading');
  const firstError = series.find((s) => s.status === 'error');
  const error = firstError
    ? (errors[`${firstError.resultId}/${firstError.caseId}/${firstError.variable}`] ?? errors[`${firstError.resultId}/${firstError.caseId}/${plot.xVariable}`])?.message ??
      'Failed to load trajectories'
    : undefined;

  return { series, loading, error, activeResult };
}
