/**
 * Pure helpers for the Details panel (no React, no store): tab resolution per mode, grouping
 * of parameters by `Dialog(tab, group)`, value formatting, Interval ⇄ Points conversion and a
 * small HTML sanitiser for `Documentation(info=…)`.
 */
import type { ParameterInfo } from '@impact/core';
import { formatNumber } from '@impact/core';
import type { AnalysisSettings, Mode } from '../../store/types';

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

/** Attributes whose value is a Modelica String (`displayUnit="kOhm"`); other attributes are numeric/Boolean expressions. */
export const STRING_ATTRIBUTES: ReadonlySet<string> = new Set(['displayUnit', 'unit', 'quantity']);

const STRING_LITERAL_RE = /^"(?:[^"\\]|\\.)*"$/;

/**
 * Text written for attribute `attr`: string-typed attributes are quoted unless the text already is
 * a string literal (`kOhm` → `"kOhm"`, `"kOhm"` unchanged), so `R(displayUnit=kOhm)` — an unknown
 * identifier that breaks compilation — can no longer be produced from the popover. Empty → null.
 */
export function attributeCommitText(attr: string, valueText: string | null): string | null {
  const t = valueText?.trim() ?? '';
  if (t === '') return null;
  if (!STRING_ATTRIBUTES.has(attr) || STRING_LITERAL_RE.test(t)) return t;
  return JSON.stringify(t);
}

/**
 * True when `p` has an attribute modifier to highlight the `⋮` for: an experiment modifier keyed
 * `<fullName>.<attr>`, or a value in `p.attributes` (core surfaces `R.start = 1` there; dotted
 * modifiers are not parameters of their own) that differs from what the parameter's class itself
 * declares (`declared`, the same parameter without the owner component's modifiers).
 */
export function hasAttributeModifier(p: ParameterInfo, modifiers?: Record<string, string>, componentName?: string, declared?: ParameterInfo): boolean {
  for (const attr of ATTRIBUTE_NAMES) {
    if (modifiers && modifiers[fullVariableName(componentName, `${p.name}.${attr}`)] !== undefined) return true;
    const own = p.attributes?.[attr];
    if (own !== undefined && own !== '' && own !== declared?.attributes?.[attr]) return true;
  }
  return false;
}

/** Current text of attribute `attr` of `p`: experiment modifier first, then the attribute modifier the core reports on the parameter. */
export function attributeValue(p: ParameterInfo, attr: AttributeName, modifiers?: Record<string, string>, componentName?: string): string | undefined {
  const fromExperiment = modifiers?.[fullVariableName(componentName, `${p.name}.${attr}`)];
  if (fromExperiment !== undefined) return fromExperiment;
  return p.attributes?.[attr];
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

export type RenameIntent = { kind: 'none' } | { kind: 'invalid'; name: string } | { kind: 'rename'; name: string };

/** What an inline header rename commits: nothing (empty or unchanged), an error for a non-identifier, or the new short name. */
export function renameIntent(draft: string, current: string): RenameIntent {
  const name = draft.trim();
  if (!name || name === current) return { kind: 'none' };
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { kind: 'invalid', name };
  return { kind: 'rename', name };
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

/**
 * Execution-settings fields that mirror ANALYSIS fields: `ncp` is "Points" and `rtol` is
 * "Tolerance". `analysisToRequest` builds the request from `interval` and `tolerance`, so a value
 * typed in the Advanced dialog patches those fields instead of a copy that no run would read.
 */
export function linkedExecutionPatch(a: AnalysisSettings, field: 'ncp' | 'rtol', n: number): Partial<AnalysisSettings> {
  if (field === 'ncp') return { interval: intervalFromPoints(a.startTime, a.stopTime, n) };
  return { tolerance: n };
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

/** `modelica://Modelica.Blocks#anchor` → `Modelica.Blocks`; undefined for resource paths (`modelica://Lib/Resources/x.png`) and other schemes. */
export function modelicaLinkTarget(href: string): string | undefined {
  const m = /^modelica:\/\/([A-Za-z_][\w.]*)(?:#.*)?$/i.exec(href.trim());
  return m ? m[1] : undefined;
}

/** True when the sanitised HTML has any visible text or content. */
export function hasVisibleContent(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0;
}
