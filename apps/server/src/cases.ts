/**
 * Expands an experiment definition into concrete cases.
 *
 * - Without extensions the base is the single case template; with extensions (Impact
 *   semantics) each extension is a case template (extension `modifiers.variables` and
 *   `analysis` are merged over the base) and the base itself is not a case.
 * - Modifier values of the form `range(a, b, n)` (n evenly spaced values, Impact's parameter
 *   sweep) or `choices(v1, v2, …)` expand into several cases; several such modifiers form a
 *   cartesian product. Expanded cases are labelled `R=100` (`R=100, C=0.001`).
 */
import type { ExperimentAnalysis, ExperimentDefinition } from '@impact/protocol';
import { badRequest } from './errors.js';

export type ModifierValue = number | string | boolean;

export interface CaseSpec {
  label: string;
  parametrization: Record<string, ModifierValue>;
  analysis: ExperimentAnalysis;
}

const RANGE_RE = /^\s*range\s*\((.*)\)\s*$/is;
const CHOICES_RE = /^\s*choices\s*\((.*)\)\s*$/is;

/** Splits on commas that are not inside quotes or parentheses. */
function splitArgs(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let cur = '';
  for (const ch of text) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      cur += ch;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      cur += ch;
    } else if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim() !== '' || out.length) out.push(cur);
  return out.map((s) => s.trim()).filter((s) => s !== '');
}

function parseLiteral(text: string): ModifierValue {
  const t = text.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  if (t === 'true') return true;
  if (t === 'false') return false;
  const n = Number(t);
  if (t !== '' && Number.isFinite(n)) return n;
  return t;
}

/** Values of a sweep modifier, or undefined when `value` is a plain modifier. */
export function parseSweep(value: ModifierValue): ModifierValue[] | undefined {
  if (typeof value !== 'string') return undefined;
  const range = RANGE_RE.exec(value);
  if (range) {
    const args = splitArgs(range[1]);
    if (args.length !== 3) throw badRequest(`range() takes 3 arguments (start, end, count): '${value}'`);
    const [a, b, n] = args.map((s) => Number(s));
    if (![a, b, n].every(Number.isFinite) || !Number.isInteger(n) || n < 1) {
      throw badRequest(`Invalid range() expression '${value}': expected range(start, end, count) with count >= 1`);
    }
    if (n === 1) return [a];
    const step = (b - a) / (n - 1);
    return Array.from({ length: n }, (_, i) => Number((a + i * step).toPrecision(12)));
  }
  const choices = CHOICES_RE.exec(value);
  if (choices) {
    const values = splitArgs(choices[1]).map(parseLiteral);
    if (!values.length) throw badRequest(`choices() needs at least one value: '${value}'`);
    return values;
  }
  return undefined;
}

export function formatValue(v: ModifierValue): string {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return v;
}

export function mergeAnalysis(base: ExperimentAnalysis, ext?: Partial<ExperimentAnalysis>): ExperimentAnalysis {
  if (!ext) return { ...base, parameters: { ...base.parameters }, simulationOptions: { ...base.simulationOptions }, solverOptions: { ...base.solverOptions } };
  return {
    ...base,
    ...ext,
    type: ext.type ?? base.type,
    parameters: { ...(base.parameters ?? {}), ...(ext.parameters ?? {}) },
    simulationOptions: { ...(base.simulationOptions ?? {}), ...(ext.simulationOptions ?? {}) },
    solverOptions: { ...(base.solverOptions ?? {}), ...(ext.solverOptions ?? {}) },
  };
}

function cartesian(sweeps: { name: string; values: ModifierValue[] }[]): [string, ModifierValue][][] {
  let combos: [string, ModifierValue][][] = [[]];
  for (const sweep of sweeps) {
    const next: [string, ModifierValue][][] = [];
    for (const combo of combos) for (const v of sweep.values) next.push([...combo, [sweep.name, v]]);
    combos = next;
  }
  return combos;
}

export function expandCases(def: ExperimentDefinition): CaseSpec[] {
  const baseVars = def.base.modifiers?.variables ?? {};
  const templates: { label?: string; variables: Record<string, ModifierValue>; analysis: ExperimentAnalysis }[] = [];
  if (!def.extensions?.length) templates.push({ variables: { ...baseVars }, analysis: mergeAnalysis(def.base.analysis) });
  for (const ext of def.extensions ?? []) {
    templates.push({
      label: ext.caseData?.label,
      variables: { ...baseVars, ...(ext.modifiers?.variables ?? {}) },
      analysis: mergeAnalysis(def.base.analysis, ext.analysis),
    });
  }

  const out: CaseSpec[] = [];
  let n = 0;
  for (const t of templates) {
    const sweeps: { name: string; values: ModifierValue[] }[] = [];
    const fixed: Record<string, ModifierValue> = {};
    for (const [name, value] of Object.entries(t.variables)) {
      const values = parseSweep(value);
      if (values) sweeps.push({ name, values });
      else fixed[name] = value;
    }
    for (const combo of cartesian(sweeps)) {
      n++;
      const parametrization: Record<string, ModifierValue> = { ...fixed };
      for (const [name, v] of combo) parametrization[name] = v;
      const sweepLabel = combo.map(([name, v]) => `${name}=${formatValue(v)}`).join(', ');
      const label = t.label ? (sweepLabel ? `${t.label} ${sweepLabel}` : t.label) : sweepLabel || `Case ${n}`;
      out.push({ label, parametrization, analysis: t.analysis });
    }
  }
  return out;
}
