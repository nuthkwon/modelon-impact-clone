import { describe, expect, it } from 'vitest';
import type { ParameterInfo } from '@impact/core';
import {
  attributeCommitText,
  attributeValue,
  enumLiteralOf,
  filterParameters,
  formatDateTime,
  formatParamValue,
  formatResultValue,
  fullVariableName,
  groupParameters,
  hasAttributeModifier,
  hasVisibleContent,
  intervalFromPoints,
  linkedExecutionPatch,
  modelicaLinkTarget,
  parseBooleanText,
  parseNumeric,
  pointsFromInterval,
  renameIntent,
  resolveTab,
  sanitizeHtml,
  shortClassName,
  validateTimes,
} from './helpers';

function param(name: string, extra: Partial<ParameterInfo> = {}): ParameterInfo {
  return { name, typeName: 'Real', baseType: 'Real', final: false, constant: false, ...extra };
}

describe('resolveTab', () => {
  it('keeps a stored tab that exists in the mode', () => {
    expect(resolveTab('model', 'INFORMATION')).toBe('INFORMATION');
    expect(resolveTab('experiment', 'EXPERIMENT')).toBe('EXPERIMENT');
    expect(resolveTab('results', 'CALCULATED VALUES')).toBe('CALCULATED VALUES');
  });
  it('falls back to the first tab', () => {
    expect(resolveTab('experiment', 'INFORMATION')).toBe('PROPERTIES');
    expect(resolveTab('results', undefined)).toBe('PROPERTIES');
  });
});

describe('groupParameters', () => {
  it('uses General/Parameters defaults and preserves order', () => {
    const tabs = groupParameters([param('R'), param('T', { dialog: { tab: 'General', group: 'Temperature' } }), param('k', { dialog: { tab: 'Advanced', group: 'Numerics' } })]);
    expect(tabs.map((t) => t.name)).toEqual(['General', 'Advanced']);
    expect(tabs[0].groups.map((g) => g.name)).toEqual(['Parameters', 'Temperature']);
    expect(tabs[0].groups[0].params.map((p) => p.name)).toEqual(['R']);
    expect(tabs[1].groups[0].params.map((p) => p.name)).toEqual(['k']);
  });
  it('puts General first even when another tab is declared before it', () => {
    const tabs = groupParameters([param('a', { dialog: { tab: 'Advanced', group: 'X' } }), param('b')]);
    expect(tabs.map((t) => t.name)).toEqual(['General', 'Advanced']);
  });
  it('treats empty tab/group strings as defaults', () => {
    const tabs = groupParameters([param('a', { dialog: { tab: '', group: ' ' } })]);
    expect(tabs).toEqual([{ name: 'General', groups: [{ name: 'Parameters', params: [tabs[0].groups[0].params[0]] }] }]);
  });
  it('returns an empty list for no parameters', () => {
    expect(groupParameters([])).toEqual([]);
  });
});

describe('attribute modifiers', () => {
  const R = param('R');
  // core surfaces `R.start = 1` as `attributes` of R; there is no sibling parameter named `R.start`.
  it('detects attribute modifiers reported on the parameter itself', () => {
    expect(hasAttributeModifier(param('R', { attributes: { start: '5' } }))).toBe(true);
    expect(hasAttributeModifier(param('R', { attributes: { start: '' } }))).toBe(false);
    expect(hasAttributeModifier(R)).toBe(false);
    expect(hasAttributeModifier(R, undefined, undefined, undefined)).toBe(false);
  });
  it('ignores attributes the class itself declares unless the component changes them', () => {
    const declared = param('R', { attributes: { start: '1', min: '0' } });
    expect(hasAttributeModifier(param('R', { attributes: { start: '1', min: '0' } }), undefined, 'resistor', declared)).toBe(false);
    expect(hasAttributeModifier(param('R', { attributes: { start: '5', min: '0' } }), undefined, 'resistor', declared)).toBe(true);
    expect(hasAttributeModifier(param('R', { attributes: { start: '1', min: '0', displayUnit: '"kOhm"' } }), undefined, 'resistor', declared)).toBe(true);
  });
  it('detects experiment modifiers keyed by the full name', () => {
    expect(hasAttributeModifier(R, { 'resistor.R.min': '0' }, 'resistor')).toBe(true);
    expect(hasAttributeModifier(R, { 'other.R.min': '0' }, 'resistor')).toBe(false);
  });
  it('reads attribute values from the experiment first, then the parameter attributes', () => {
    const p = param('R', { attributes: { max: '10', displayUnit: '"kOhm"' } });
    expect(attributeValue(p, 'max')).toBe('10');
    expect(attributeValue(p, 'displayUnit')).toBe('"kOhm"');
    expect(attributeValue(p, 'max', { 'resistor.R.max': '20' }, 'resistor')).toBe('20');
    expect(attributeValue(p, 'min')).toBeUndefined();
    expect(attributeValue(R, 'start')).toBeUndefined();
  });
  it('quotes string attributes so `R(displayUnit=kOhm)` cannot be written', () => {
    expect(attributeCommitText('displayUnit', 'kOhm')).toBe('"kOhm"');
    expect(attributeCommitText('displayUnit', ' kOhm ')).toBe('"kOhm"');
    expect(attributeCommitText('displayUnit', '"kOhm"')).toBe('"kOhm"');
    expect(attributeCommitText('unit', 'V')).toBe('"V"');
    expect(attributeCommitText('quantity', '"Resistance"')).toBe('"Resistance"');
    expect(attributeCommitText('displayUnit', '')).toBeNull();
    expect(attributeCommitText('displayUnit', null)).toBeNull();
  });
  it('leaves numeric and Boolean attributes as expressions', () => {
    expect(attributeCommitText('start', ' 2*pi ')).toBe('2*pi');
    expect(attributeCommitText('fixed', 'true')).toBe('true');
    expect(attributeCommitText('min', '')).toBeNull();
  });
});

describe('renameIntent', () => {
  it('ignores empty and unchanged names', () => {
    expect(renameIntent('', 'RCCircuit')).toEqual({ kind: 'none' });
    expect(renameIntent('  RCCircuit ', 'RCCircuit')).toEqual({ kind: 'none' });
  });
  it('rejects names that are not Modelica identifiers', () => {
    expect(renameIntent('1abc', 'x')).toEqual({ kind: 'invalid', name: '1abc' });
    expect(renameIntent('a.b', 'x')).toEqual({ kind: 'invalid', name: 'a.b' });
    expect(renameIntent('new name', 'x')).toEqual({ kind: 'invalid', name: 'new name' });
  });
  it('returns the typed name to rename to', () => {
    expect(renameIntent(' NewName ', 'RCCircuit')).toEqual({ kind: 'rename', name: 'NewName' });
    expect(renameIntent('r1', 'resistor')).toEqual({ kind: 'rename', name: 'r1' });
  });
});

describe('filterParameters', () => {
  const params = [param('R', { description: 'Resistance' }), param('T', { description: 'Temperature' }), param('alpha')];
  it('filters by name or description, case-insensitively', () => {
    expect(filterParameters(params, { text: 'temp' }).map((p) => p.name)).toEqual(['T']);
    expect(filterParameters(params, { text: 'ALPHA' }).map((p) => p.name)).toEqual(['alpha']);
    expect(filterParameters(params, { text: '' })).toHaveLength(3);
  });
  it('applies the favourites filter with component-prefixed keys', () => {
    expect(filterParameters(params, { favoritesOnly: true, favorites: ['resistor.R'], componentName: 'resistor' }).map((p) => p.name)).toEqual(['R']);
    expect(filterParameters(params, { favoritesOnly: true, favorites: ['R'] }).map((p) => p.name)).toEqual(['R']);
  });
});

describe('value formatting', () => {
  it('formats numbers with 6 significant digits', () => {
    expect(formatParamValue(1)).toBe('1');
    expect(formatParamValue(0.1 + 0.2)).toBe('0.3');
    expect(formatParamValue(1234567)).toBe('1.23457e+6');
    expect(formatParamValue(true)).toBe('true');
    expect(formatParamValue('abc')).toBe('abc');
    expect(formatParamValue(undefined)).toBe('');
  });
  it('formats result values with a dash placeholder', () => {
    expect(formatResultValue(undefined)).toBe('–');
    expect(formatResultValue(NaN)).toBe('–');
    expect(formatResultValue(2.5)).toBe('2.5');
  });
  it('parses boolean literal text', () => {
    expect(parseBooleanText('true')).toBe(true);
    expect(parseBooleanText(' False ')).toBe(false);
    expect(parseBooleanText('1')).toBeUndefined();
  });
  it('derives short names and enumeration literals', () => {
    expect(shortClassName('Modelica.Electrical.Analog.Basic.Resistor')).toBe('Resistor');
    expect(shortClassName('RCCircuit')).toBe('RCCircuit');
    expect(enumLiteralOf('Modelica.Blocks.Types.Init.NoInit')).toBe('NoInit');
    expect(enumLiteralOf(undefined)).toBe('');
  });
  it('builds full variable names', () => {
    expect(fullVariableName('resistor', 'R')).toBe('resistor.R');
    expect(fullVariableName(undefined, 'R')).toBe('R');
  });
  it('parses numeric text and rejects garbage', () => {
    expect(parseNumeric('1e-6')).toBe(1e-6);
    expect(parseNumeric(' -3 ')).toBe(-3);
    expect(parseNumeric('.5')).toBe(0.5);
    expect(parseNumeric('abc')).toBeUndefined();
    expect(parseNumeric('')).toBeUndefined();
    expect(parseNumeric('1+2')).toBeUndefined();
    expect(parseNumeric('NaN')).toBeUndefined();
  });
  it('formats timestamps', () => {
    expect(formatDateTime('2026-09-24T14:03:12.000')).toBe('2026-09-24 14:03');
    expect(formatDateTime('not a date')).toBe('not a date');
  });
});

describe('interval ⇄ points', () => {
  it('converts points from interval', () => {
    expect(pointsFromInterval(0, 1, 0.002)).toBe(500);
    expect(pointsFromInterval(0, 10, 0.5)).toBe(20);
    expect(pointsFromInterval(0, 1, 0)).toBe(1);
    expect(pointsFromInterval(1, 1, 0.1)).toBe(1);
  });
  it('converts interval from points', () => {
    expect(intervalFromPoints(0, 1, 500)).toBeCloseTo(0.002, 12);
    expect(intervalFromPoints(2, 12, 20)).toBeCloseTo(0.5, 12);
    expect(intervalFromPoints(0, 1, 0)).toBe(1);
    expect(intervalFromPoints(1, 1, 10)).toBe(0);
  });
  it('round-trips', () => {
    const interval = intervalFromPoints(0, 3, 300);
    expect(pointsFromInterval(0, 3, interval)).toBe(300);
  });
  it('patches the analysis fields the Execution settings ncp/rtol mirror', () => {
    const a = { type: 'dynamic', startTime: 0, stopTime: 1, interval: 0.002, useInterval: true, solver: 'CVode', tolerance: 1e-6, stepSize: 0.01 } as Parameters<typeof linkedExecutionPatch>[0];
    expect(linkedExecutionPatch(a, 'ncp', 50)).toEqual({ interval: 0.02 });
    expect(pointsFromInterval(0, 1, linkedExecutionPatch(a, 'ncp', 50).interval!)).toBe(50);
    expect(linkedExecutionPatch(a, 'rtol', 1e-3)).toEqual({ tolerance: 1e-3 });
  });
  it('validates times', () => {
    expect(validateTimes(0, 1)).toBeUndefined();
    expect(validateTimes(1, 1)).toMatch(/greater/);
    expect(validateTimes(2, 1)).toMatch(/greater/);
    expect(validateTimes(NaN, 1)).toMatch(/numbers/);
  });
});

describe('sanitizeHtml', () => {
  it('removes scripts and styles with their content', () => {
    expect(sanitizeHtml('<p>a</p><script>alert(1)</script><style>p{}</style><p>b</p>')).toBe('<p>a</p><p>b</p>');
    expect(sanitizeHtml('<p>x</p><SCRIPT src="x.js"></SCRIPT>')).toBe('<p>x</p>');
  });
  it('strips event handlers, style attributes and javascript: urls', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)" onclick="x()">link</a>')).toBe('<a>link</a>');
    expect(sanitizeHtml('<p onmouseover=evil() style="color:red" class="c">t</p>')).toBe('<p class="c">t</p>');
    expect(sanitizeHtml('<a href="https://modelica.org" title="M">m</a>')).toBe('<a href="https://modelica.org" title="M">m</a>');
    expect(sanitizeHtml('<a href="modelica://Modelica.Blocks">blocks</a>')).toBe('<a href="modelica://Modelica.Blocks">blocks</a>');
  });
  it('replaces images with their alt text', () => {
    expect(sanitizeHtml('<p><img src="modelica://X/img.png" alt="Circuit"></p>')).toBe('<p><span class="doc-img-alt">Circuit</span></p>');
    expect(sanitizeHtml('<p>a<img src="x.png"/>b</p>')).toBe('<p>ab</p>');
  });
  it('removes comments, frames and form elements but keeps structure', () => {
    const html = '<!-- c --><h4>Title</h4><iframe src="x"></iframe><form><input value="1"></form><table><tr><td>1</td></tr></table><br/>';
    expect(sanitizeHtml(html)).toBe('<h4>Title</h4><table><tr><td>1</td></tr></table><br />');
  });
  it('extracts class names from modelica:// links', () => {
    expect(modelicaLinkTarget('modelica://Modelica.Blocks')).toBe('Modelica.Blocks');
    expect(modelicaLinkTarget('modelica://Modelica.Blocks.Continuous#PID')).toBe('Modelica.Blocks.Continuous');
    expect(modelicaLinkTarget('modelica://Modelica/Resources/Images/x.png')).toBeUndefined();
    expect(modelicaLinkTarget('https://modelica.org')).toBeUndefined();
  });
  it('detects visible content', () => {
    expect(hasVisibleContent('<p>&nbsp;</p>')).toBe(false);
    expect(hasVisibleContent('<p> hello </p>')).toBe(true);
    expect(hasVisibleContent('')).toBe(false);
  });
});
