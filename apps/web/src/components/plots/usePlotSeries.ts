/**
 * Resolves a PlotWindow's traces into chart series: one series per (trace, case), fetched
 * through the store's trajectory cache. Multi-case results get `[case_2]` suffixes and a
 * palette rotation; traces bound to a non-active result get a `[ResultName]` suffix.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { PLOT_PALETTE, useStore } from '../../store';
import type { PlotWindow, ResultEntry } from '../../store/types';
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

export interface PlotSeriesState {
  series: ResolvedSeries[];
  loading: boolean;
  error?: string;
  /** Result used for traces without an explicit resultId. */
  activeResult?: ResultEntry;
}

interface Target {
  traceIndex: number;
  variable: string;
  hidden?: boolean;
  color: string;
  label: string;
  result?: ResultEntry;
  caseId?: string;
  caseLabel?: string;
  xKey?: string;
  yKey?: string;
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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const requested = useRef(new Set<string>());
  const listed = useRef(new Set<string>());

  const activeResult = useMemo(
    () => results.find((r) => r.id === activeResultId) ?? results.find((r) => r.className === className),
    [results, activeResultId, className],
  );

  const targets = useMemo<Target[]>(() => {
    const out: Target[] = [];
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

  // Fetch whatever is missing, grouped per (result, case) so one request covers x and y.
  useEffect(() => {
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
        if (trajectories[key] || errors[key] || requested.current.has(key)) continue;
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
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          setErrors((prev) => {
            const next = { ...prev };
            keys.forEach((k) => (next[k] = msg));
            return next;
          });
        })
        .finally(() => keys.forEach((k) => requested.current.delete(k)));
    }
  }, [targets, trajectories, resultVariables, errors, plot.xVariable, fetchTrajectories, fetchResultVariables]);

  // Forget errors for results that disappeared (e.g. after a delete) so a re-run can retry.
  useEffect(() => {
    const ids = new Set(results.map((r) => r.id));
    setErrors((prev) => {
      const keep = Object.entries(prev).filter(([k]) => ids.has(k.split('/')[0]));
      return keep.length === Object.keys(prev).length ? prev : Object.fromEntries(keep);
    });
  }, [results]);

  const series = useMemo<ResolvedSeries[]>(
    () =>
      targets.map((t, idx) => {
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
        const known = resultVariables[t.result.id];
        if (known && t.variable !== 'time' && !known.includes(t.variable)) return { ...base, label: `${t.label} (not found)` };
        if (known && plot.xVariable !== 'time' && !known.includes(plot.xVariable)) return { ...base, label: `${t.label} (x not found)` };
        const err = errors[t.yKey!] ?? errors[t.xKey!];
        if (err) return { ...base, status: 'error', label: `${t.label} (error)` };
        let x = trajectories[t.xKey!];
        let y = trajectories[t.yKey!];
        if (!x || !y) return { ...base, status: 'loading' };
        if (!y.length || !x.length) return { ...base, label: `${t.label} (not found)` };
        // Parameters/constants come back as a single sample: draw them as a constant line.
        if (y.length === 1 && x.length > 1) y = new Array<number>(x.length).fill(y[0]);
        if (x.length === 1 && y.length > 1) x = new Array<number>(y.length).fill(x[0]);
        return { ...base, x, y, status: 'ready' };
      }),
    [targets, trajectories, resultVariables, errors, plot.xVariable],
  );

  const loading = series.some((s) => s.status === 'loading');
  const firstError = series.find((s) => s.status === 'error');
  const error = firstError ? (errors[`${firstError.resultId}/${firstError.caseId}/${firstError.variable}`] ?? 'Failed to load trajectories') : undefined;

  return { series, loading, error, activeResult };
}
