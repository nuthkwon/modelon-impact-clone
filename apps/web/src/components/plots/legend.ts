/**
 * Legend rows of a plot window grouped by component (docs/UI_SPEC.md §5.5): a 600-weight group
 * name (`resistor`) followed by rows `v`, `i`, `der(i)`; top-level variables belong to the model
 * itself and are listed first. Pure — unit-tested in legend.test.ts.
 */
import { variableSegments } from '../results/variableTree';
import type { ResolvedSeries } from './seriesState';

/** `Examples.RLCCircuit` → `RLCCircuit`. */
export const shortClassName = (name: string): string => name.split('.').pop() ?? name;

export interface LegendItem {
  series: ResolvedSeries;
  /** Row text: the variable without its component prefix plus any `[case]` / `[Result]` suffix. */
  name: string;
}
export interface LegendGroup {
  /** Component name, or the model's short class name for top-level variables. */
  name: string;
  items: LegendItem[];
}

/**
 * Legend rows grouped by component (first segment of the variable name, `der(a.b)` counting as
 * `a` → `der(b)` like the CALCULATED VALUES tree); top-level variables belong to the model itself.
 */
export function legendGroups(series: readonly ResolvedSeries[], className: string): LegendGroup[] {
  const model = shortClassName(className);
  const groups = new Map<string, LegendGroup>();
  for (const s of series) {
    const v = s.variable;
    const suffix = s.label.startsWith(v) ? s.label.slice(v.length) : '';
    const segs = variableSegments(v);
    const groupName = segs.length > 1 ? segs[0] : model;
    const name = s.label.startsWith(v) ? (segs.length > 1 ? segs.slice(1).join('.') : v) + suffix : s.label;
    let g = groups.get(groupName);
    if (!g) {
      g = { name: groupName, items: [] };
      groups.set(groupName, g);
    }
    g.items.push({ series: s, name });
  }
  // the model's own variables first, then components in first-seen order
  return [...groups.values()].sort((a, b) => (a.name === model ? -1 : b.name === model ? 1 : 0));
}
