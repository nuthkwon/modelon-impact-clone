/**
 * Legend rows of a plot window grouped by component (docs/UI_SPEC.md §5.5): a 600-weight group
 * name (`resistor`) followed by rows `v`, `i`, `der(i)`; top-level variables belong to the model
 * itself and are listed first. Pure — unit-tested in legend.test.ts.
 */
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

/** Legend rows grouped by component (first dotted segment); top-level variables belong to the model itself. */
export function legendGroups(series: readonly ResolvedSeries[], className: string): LegendGroup[] {
  const model = shortClassName(className);
  const groups = new Map<string, LegendGroup>();
  for (const s of series) {
    const v = s.variable;
    const suffix = s.label.startsWith(v) ? s.label.slice(v.length) : '';
    const dot = /^der\(/.test(v) ? -1 : v.indexOf('.');
    const groupName = dot > 0 ? v.slice(0, dot) : model;
    const name = s.label.startsWith(v) ? (dot > 0 ? v.slice(dot + 1) : v) + suffix : s.label;
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
