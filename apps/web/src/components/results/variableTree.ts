/**
 * Pure helpers for the CALCULATED VALUES tree (docs/UI_SPEC.md §6.6): splitting dotted
 * Modelica names (with `der(...)` grouped under its component), building/pruning/flattening the
 * tree and classifying variables into Parameters / Variables / States / Derivatives.
 */
import type { CaseVariableMeta } from '@impact/protocol';

export type VariableKind = 'parameter' | 'variable' | 'state' | 'derivative';
export type TypeFilter = 'all' | 'parameters' | 'variables' | 'states' | 'derivatives';

export const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'parameters', label: 'Parameters' },
  { value: 'variables', label: 'Variables' },
  { value: 'states', label: 'States' },
  { value: 'derivatives', label: 'Derivatives' },
];

export interface TreeNode {
  /** Path key (`resistor.p`), unique within the tree. */
  key: string;
  /** Display segment (`p`, `der(v)`, `x[1]`). */
  name: string;
  /** Full variable name for leaves. */
  variable?: string;
  children: TreeNode[];
}

export interface TreeRow {
  node: TreeNode;
  depth: number;
  isLeaf: boolean;
  expanded: boolean;
}

/** Splits a dotted name on `.` outside brackets/parentheses. */
export function splitDotted(name: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of name) {
    if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth = Math.max(0, depth - 1);
    if (ch === '.' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.filter((s) => s.length > 0);
}

/** `der(a.b.c)` → `['a', 'b', 'der(c)']`; `a.b[1].c` → `['a', 'b[1]', 'c']`. */
export function variableSegments(name: string): string[] {
  const m = /^der\((.*)\)$/.exec(name);
  if (m) {
    const inner = variableSegments(m[1]);
    if (!inner.length) return [name];
    return [...inner.slice(0, -1), `der(${inner[inner.length - 1]})`];
  }
  return splitDotted(name);
}

/** First component segment of a variable (`''` for top-level variables). */
export function componentOf(name: string): string {
  const segs = variableSegments(name);
  return segs.length > 1 ? segs[0] : '';
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function sortNodes(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    const af = a.children.length > 0 ? 0 : 1;
    const bf = b.children.length > 0 ? 0 : 1;
    if (af !== bf) return af - bf;
    return collator.compare(a.name, b.name);
  });
  for (const n of nodes) if (n.children.length) sortNodes(n.children);
}

/** Builds the component hierarchy from flat variable names (folders first, natural order). */
export function buildVariableTree(names: string[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const index = new Map<string, TreeNode>();
  for (const name of names) {
    const segs = variableSegments(name);
    if (!segs.length) continue;
    let parentChildren = roots;
    let path = '';
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const isLeaf = i === segs.length - 1;
      path = path ? `${path}.${seg}` : seg;
      const key = isLeaf ? `${path}#leaf` : path;
      let node = index.get(key);
      if (!node) {
        node = { key, name: seg, children: [], variable: isLeaf ? name : undefined };
        index.set(key, node);
        parentChildren.push(node);
      }
      parentChildren = node.children;
    }
  }
  sortNodes(roots);
  return roots;
}

export interface ClassifyInput {
  metaKind?: CaseVariableMeta['kind'];
  /** Number of samples in the trajectory when loaded (1 → parameter). */
  trajectoryLength?: number;
  /** True when `der(<name>)` exists among the result variables. */
  hasDerivative?: boolean;
}

export function classifyVariable(name: string, input: ClassifyInput = {}): VariableKind {
  if (name.startsWith('der(')) return 'derivative';
  if (input.metaKind === 'derivative') return 'derivative';
  if (input.metaKind === 'parameter' || input.metaKind === 'constant') return 'parameter';
  if (input.hasDerivative) return 'state';
  if (input.metaKind === 'continuous' || input.metaKind === 'discrete') return 'variable';
  if (input.trajectoryLength === 1 && name !== 'time') return 'parameter';
  return 'variable';
}

export function matchesTypeFilter(kind: VariableKind, filter: TypeFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'parameters':
      return kind === 'parameter';
    case 'variables':
      return kind === 'variable' || kind === 'state';
    case 'states':
      return kind === 'state';
    case 'derivatives':
      return kind === 'derivative';
  }
}

/** Keeps leaves accepted by `keep` and the folders leading to them. */
export function pruneTree(nodes: TreeNode[], keep: (variable: string) => boolean): TreeNode[] {
  const out: TreeNode[] = [];
  for (const n of nodes) {
    if (n.variable !== undefined && !n.children.length) {
      if (keep(n.variable)) out.push(n);
      continue;
    }
    const children = pruneTree(n.children, keep);
    if (children.length) out.push({ ...n, children });
  }
  return out;
}

/** Depth-first visible rows; `expandAll` ignores the expanded set (used while filtering). */
export function flattenTree(nodes: TreeNode[], expanded: Set<string>, expandAll = false, limit = Infinity): { rows: TreeRow[]; total: number } {
  const rows: TreeRow[] = [];
  let total = 0;
  const walk = (list: TreeNode[], depth: number) => {
    for (const n of list) {
      const isLeaf = !n.children.length;
      const open = !isLeaf && (expandAll || expanded.has(n.key));
      total++;
      if (rows.length < limit) rows.push({ node: n, depth, isLeaf, expanded: open });
      if (open) walk(n.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return { rows, total };
}

export function countLeaves(nodes: TreeNode[]): number {
  let n = 0;
  for (const node of nodes) n += node.children.length ? countLeaves(node.children) : 1;
  return n;
}

/** Formats an ISO timestamp as `2026-09-24 14:03:12` in local time. */
export function formatTimestamp(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** `0.4 s`, `12.3 s`, `2 min 5 s`, `1 h 3 min`. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)} s`;
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${Math.round(s - m * 60)} s`;
  const h = Math.floor(m / 60);
  return `${h} h ${m - h * 60} min`;
}
