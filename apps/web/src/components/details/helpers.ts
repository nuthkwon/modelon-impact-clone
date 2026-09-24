/**
 * Pure helpers for the Details panel (no React, no store): tab resolution per mode, grouping
 * of parameters by `Dialog(tab, group)`, value formatting, Interval ⇄ Points conversion and a
 * small HTML sanitiser for `Documentation(info=…)`.
 */
import type { ParameterInfo } from '@impact/core';
import { formatNumber } from '@impact/core';
import type { Mode } from '../../store/types';

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export const TABS_BY_MODE: Record<Mode, readonly string[]> = {
  model: ['PROPERTIES', 'INFORMATION', 'COMPONENTS'],
  experiment: ['PROPERTIES', 'COMPONENTS', 'EXPERIMENT'],
  results: ['PROPERTIES', 'SIMULATIONS', 'CALCULATED VALUES'],
};

/** The tab to show: the stored one when it exists in the current mode, else the first tab. */
export function resolveTab(mode: Mode, stored: string | undefined): string {
  const tabs = TABS_BY_MODE[mode];
  return stored && tabs.includes(stored) ? stored : tabs[0];
}

export const DEFAULT_DIALOG_TAB = 'General';
export const DEFAULT_DIALOG_GROUP = 'Parameters';
export const VARIABLES_TAB = 'Variables';

// ---------------------------------------------------------------------------
// Parameter grouping
// ---------------------------------------------------------------------------

export interface ParameterGroup {
  name: string;
  params: ParameterInfo[];
}

export interface ParameterTab {
  name: string;
  groups: ParameterGroup[];
}

/**
 * Groups parameters by `dialog.tab` (default "General") and inside a tab by `dialog.group`
 * (default "Parameters"). Declaration order is preserved: tabs and groups appear in the order
 * of their first parameter, except that "General" always comes first.
 */
export function groupParameters(params: readonly ParameterInfo[]): ParameterTab[] {
  const tabs = new Map<string, Map<string, ParameterInfo[]>>();
  for (const p of params) {
    const tab = p.dialog?.tab?.trim() || DEFAULT_DIALOG_TAB;
    const group = p.dialog?.group?.trim() || DEFAULT_DIALOG_GROUP;
    let groups = tabs.get(tab);
    if (!groups) {
      groups = new Map();
      tabs.set(tab, groups);
    }
    const list = groups.get(group);
    if (list) list.push(p);
    else groups.set(group, [p]);
  }
  const out: ParameterTab[] = [];
  for (const [name, groups] of tabs) {
    out.push({ name, groups: [...groups].map(([g, list]) => ({ name: g, params: list })) });
  }
  out.sort((a, b) => (a.name === DEFAULT_DIALOG_TAB ? -1 : b.name === DEFAULT_DIALOG_TAB ? 1 : 0));
  return out;
}

/** Full variable name of a parameter: `resistor.R` for a component, `R` at the top level. */
export function fullVariableName(componentName: string | undefined, name: string): string {
  return componentName ? `${componentName}.${name}` : name;
}

export const ATTRIBUTE_NAMES = ['start', 'fixed', 'min', 'max', 'nominal', 'displayUnit'] as const;
export type AttributeName = (typeof ATTRIBUTE_NAMES)[number];

/**
 * True when `p` has an attribute modifier (`R.start = 1`, …): either a sibling entry named
 * `<name>.<attr>` with a `valueText`, or an experiment modifier keyed `<fullName>.<attr>`.
 */
export function hasAttributeModifier(p: ParameterInfo, params: readonly ParameterInfo[], modifiers?: Record<string, string>, componentName?: string): boolean {
  for (const attr of ATTRIBUTE_NAMES) {
    const dotted = `${p.name}.${attr}`;
    if (params.some((q) => q.name === dotted && q.valueText !== undefined && q.valueText !== '')) return true;
    if (modifiers && modifiers[fullVariableName(componentName, dotted)] !== undefined) return true;
  }
  return false;
}

/** Current text of attribute `attr` of `p`: experiment modifier first, then a sibling `<name>.<attr>` entry. */
export function attributeValue(p: ParameterInfo, attr: AttributeName, params: readonly ParameterInfo[], modifiers?: Record<string, string>, componentName?: string): string | undefined {
  const dotted = `${p.name}.${attr}`;
  const fromExperiment = modifiers?.[fullVariableName(componentName, dotted)];
  if (fromExperiment !== undefined) return fromExperiment;
  const sibling = params.find((q) => q.name === dotted);
  return sibling?.valueText ?? sibling?.defaultText;
}

export interface ParameterFilter {
  text?: string;
  favoritesOnly?: boolean;
  favorites?: readonly string[];
  componentName?: string;
}

/** Applies the free-text filter (name / description, case-insensitive) and the Favorites chip. */
export function filterParameters(params: readonly ParameterInfo[], filter: ParameterFilter): ParameterInfo[] {
  const text = filter.text?.trim().toLowerCase() ?? '';
  return params.filter((p) => {
    if (filter.favoritesOnly && !(filter.favorites ?? []).includes(fullVariableName(filter.componentName, p.name))) return false;
    if (!text) return true;
    return p.name.toLowerCase().includes(text) || (p.description?.toLowerCase().includes(text) ?? false);
  });
}

// ---------------------------------------------------------------------------
// Value formatting
// ---------------------------------------------------------------------------

/** Text shown for a parameter's evaluated/default value. */
export function formatParamValue(v: number | boolean | string | undefined, digits = 6): string {
  if (v === undefined) return '';
  if (typeof v === 'number') return formatNumber(v, digits);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return v;
}

/** Result value at the slider time: 6 significant digits, `–` while not loaded. */
export function formatResultValue(v: number | undefined, digits = 6): string {
  if (v === undefined || Number.isNaN(v)) return '–';
  return formatNumber(v, digits);
}

/** Truthiness of a Modelica Boolean literal text (`true`/`false`); undefined for anything else. */
export function parseBooleanText(text: string | undefined): boolean | undefined {
  const t = text?.trim().toLowerCase();
  if (t === 'true') return true;
  if (t === 'false') return false;
  return undefined;
}

/** Short class name: last dotted segment. */
export function shortClassName(fullName: string): string {
  const i = fullName.lastIndexOf('.');
  return i < 0 ? fullName : fullName.slice(i + 1);
}

/** Short enumeration literal: `Modelica.Blocks.Types.Init.NoInit` → `NoInit`. */
export function enumLiteralOf(text: string | undefined): string {
  if (!text) return '';
  return shortClassName(text.trim());
}

/** Parses a numeric text; undefined for empty text, NaN or infinities (Modelica `1e-6`, `-3`, `.5`). */
export function parseNumeric(text: string): number | undefined {
  const t = text.trim();
  if (!t) return undefined;
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** `2026-09-24 14:03` for an ISO timestamp (local time); the raw text when unparsable. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Interval ⇄ Points
// ---------------------------------------------------------------------------

/** points = (stop − start) / interval, rounded, at least 1. */
export function pointsFromInterval(start: number, stop: number, interval: number): number {
  const span = stop - start;
  if (!(interval > 0) || !(span > 0)) return 1;
  return Math.max(1, Math.round(span / interval));
}

/** interval = (stop − start) / points; falls back to the span when points < 1. */
export function intervalFromPoints(start: number, stop: number, points: number): number {
  const span = stop - start;
  const n = Math.max(1, Math.round(points));
  if (!(span > 0)) return 0;
  return span / n;
}

/** Validation of the dynamic analysis times. */
export function validateTimes(start: number, stop: number): string | undefined {
  if (!Number.isFinite(start) || !Number.isFinite(stop)) return 'Times must be numbers';
  if (stop <= start) return 'Stop time must be greater than start time';
  return undefined;
}

// ---------------------------------------------------------------------------
// HTML sanitiser for Documentation(info=…)
// ---------------------------------------------------------------------------

const DROP_WITH_CONTENT = ['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math'];
const DROP_TAGS = new Set(['link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select', 'option', 'frame', 'frameset', 'applet', 'html', 'head', 'body']);

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sanitizeAttributes(attrs: string): string {
  const out: string[] = [];
  const re = /([^\s"'=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrs))) {
    const name = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4];
    if (name.startsWith('on')) continue;
    if (name === 'style' || name === 'srcdoc' || name === 'formaction') continue;
    if (value === undefined) {
      out.push(name);
      continue;
    }
    if (name === 'href' || name === 'src' || name === 'xlink:href' || name === 'action' || name === 'background') {
      const v = value.replace(/[\s\u0000-\u001f]+/g, '').toLowerCase();
      if (v.startsWith('javascript:') || v.startsWith('vbscript:') || v.startsWith('data:')) continue;
    }
    out.push(`${name}="${escapeHtml(value.replace(/&quot;/g, '"'))}"`);
  }
  return out.length ? ` ${out.join(' ')}` : '';
}

/**
 * Sanitises documentation HTML: removes scripts/styles/frames (with their content), comments
 * and form elements, strips `on*` event handlers, `style` attributes and `javascript:` URLs and
 * replaces `<img>` with its alt text. Everything else (headings, paragraphs, lists, tables,
 * links, code, …) is kept.
 */
export function sanitizeHtml(html: string): string {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  for (const tag of DROP_WITH_CONTENT) {
    s = s.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '');
    s = s.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi'), '');
  }
  s = s.replace(/<img\b([^>]*)\/?>/gi, (_m, attrs: string) => {
    const alt = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs);
    const text = (alt?.[1] ?? alt?.[2] ?? alt?.[3] ?? '').trim();
    return text ? `<span class="doc-img-alt">${escapeHtml(text)}</span>` : '';
  });
  s = s.replace(/<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^>]*?)?)\s*(\/?)>/g, (_m, close: string, tag: string, attrs: string, selfClose: string) => {
    const name = tag.toLowerCase();
    if (DROP_TAGS.has(name)) return '';
    if (close) return `</${name}>`;
    return `<${name}${sanitizeAttributes(attrs)}${selfClose ? ' /' : ''}>`;
  });
  return s.trim();
}

/** True when the sanitised HTML has any visible text or content. */
export function hasVisibleContent(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0;
}
