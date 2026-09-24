/**
 * Server-side render smoke test for the SVG chart (fixed size, no DOM): verifies the static
 * structure — series paths, gridlines, tick labels, axis title, cursor, log ticks, empty state.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlotChart } from './PlotChart';
import type { ChartSeries } from './PlotChart';

const n = 501;
const x = Array.from({ length: n }, (_, i) => i / (n - 1));
const series: ChartSeries[] = [
  { id: 'a', label: 'resistor.v', color: '#1f77b4', x, y: x.map((t) => Math.sin(2 * Math.PI * t)), unit: 'V' },
  { id: 'b', label: 'inductor.i', color: '#ff7f0e', x, y: x.map((t) => 0.5 * Math.cos(2 * Math.PI * t)), unit: 'A' },
  { id: 'c', label: 'hidden.one', color: '#2ca02c', x, y: x.map(() => 3), hidden: true },
];

const render = (props: Partial<Parameters<typeof PlotChart>[0]>) =>
  renderToStaticMarkup(createElement(PlotChart, { series, width: 500, height: 300, xLabel: 'time [s]', ...props }));

describe('PlotChart (static render)', () => {
  it('draws one path per visible series with the spec line style', () => {
    const html = render({});
    expect(html.match(/class="plot-series"/g)?.length).toBe(2);
    expect(html).toContain('stroke="#1f77b4"');
    expect(html).toContain('stroke="#ff7f0e"');
    expect(html).not.toContain('stroke="#2ca02c"');
    expect(html).toContain('<svg');
    expect(html).toContain('width="500"');
    expect(html).toContain('height="300"');
  });

  it('renders gridlines, nice tick labels and the x axis title', () => {
    const html = render({});
    expect(html).toContain('class="plot-grid"');
    for (const label of ['0', '0.2', '0.4', '0.6', '0.8', '1']) expect(html).toContain(`>${label}</text>`);
    expect(html).toContain('-1</text>');
    expect(html).toContain('time [s]</text>');
    // y axis unit only when a single visible series
    expect(html).not.toContain('[V]</text>');
    const single = render({ series: [series[0]] });
    expect(single).toContain('[V]</text>');
  });

  it('omits gridlines when showGrid is false and draws the slider cursor', () => {
    const html = render({ showGrid: false, cursorTime: 0.5 });
    expect(html).not.toContain('class="plot-grid"');
    expect(html).toContain('class="plot-cursor"');
    expect(render({ showGrid: false, cursorTime: 5 })).not.toContain('class="plot-cursor"');
  });

  it('uses decade ticks on a log y axis and drops non-positive samples', () => {
    const logSeries: ChartSeries[] = [{ id: 'l', label: 'p', color: '#1f77b4', x, y: x.map((t) => (t < 0.1 ? -1 : Math.pow(10, 4 * t))) }];
    const html = render({ series: logSeries, logY: true });
    for (const label of ['1', '10', '100', '1000', '10000']) expect(html).toContain(`>${label}</text>`);
    // the path never uses NaN coordinates
    expect(html).not.toContain('NaN');
  });

  it('shows the empty text when nothing is visible', () => {
    const html = render({ series: [], emptyText: 'Drag a variable here' });
    expect(html).toContain('Drag a variable here');
    expect(html.match(/class="plot-series"/g) ?? []).toHaveLength(0);
  });

  it('never emits NaN for degenerate data', () => {
    const flat: ChartSeries[] = [{ id: 'f', label: 'k', color: '#000', x: [0, 1], y: [2, 2] }];
    const html = render({ series: flat });
    expect(html).not.toContain('NaN');
    expect(html).toContain('class="plot-series"');
    const one: ChartSeries[] = [{ id: 'o', label: 'k', color: '#000', x: [0], y: [5] }];
    expect(render({ series: one })).not.toContain('NaN');
  });
});
