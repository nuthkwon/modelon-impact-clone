/**
 * Simulation flow (docs/UI_SPEC.md §5.2, §5.3, §6.5, §6.6, §8) in a workspace of its own so the
 * first result is deterministically named `Result1`.
 */
import { expect, test } from '@playwright/test';
import { API_URL, classText, collectErrors, createClass, createWorkspace, deleteWorkspace, executionFab, listExperiments, modeLabels, openWorkspace, runSimulation, selectDetailsTab, stamp } from './helpers';

test.describe('Simulation', () => {
  let wid: string;

  test.beforeAll(async ({ request }) => {
    wid = (await createWorkspace(request, `E2E simulation ${stamp()}`)).id;
  });

  test.afterAll(async ({ request }) => {
    if (wid) await deleteWorkspace(request, wid);
  });

  test('simulates Examples.HeatedRoom and explores the result', async ({ page, request }) => {
    const errors = collectErrors(page);
    await openWorkspace(page, wid, { className: 'Examples.HeatedRoom' });
    await expect(modeLabels(page).nth(2)).toHaveText('Results');
    await expect(page.getByTestId('time-slider')).toHaveCount(0);

    await test.step('Play → done → Result1', async () => {
      await runSimulation(page);
      await expect(modeLabels(page).nth(2)).toHaveText('Result1');
      await expect(page.getByTestId('time-slider')).toBeVisible();
      await expect(page.locator('.canvas-banners .banner.error')).toHaveCount(0);
      await expect(page.locator('.log-toggle')).not.toHaveClass(/has-errors/);
    });

    await test.step('SIMULATIONS lists one successful result', async () => {
      await page.keyboard.press('3');
      await expect(page.locator('.mode-button.active .mode-label')).toHaveText('Result1');
      await selectDetailsTab(page, 'SIMULATIONS');
      const rows = page.locator('.sim-row');
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toHaveClass(/active/);
      await expect(rows.first().locator('.sim-name')).toContainText('Result1');
      await expect(rows.first().locator('.sim-status.ok')).toBeVisible();
      await expect(rows.first().locator('.sim-meta')).toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    });

    const tRow = page.locator('.calc-tree .var-row[data-variable="room.T"]');
    await test.step('CALCULATED VALUES shows room → T with a numeric value', async () => {
      await selectDetailsTab(page, 'CALCULATED VALUES');
      const roomFolder = page.locator('.calc-tree .var-row.folder').filter({ has: page.locator('.var-name', { hasText: /^room$/ }) });
      await expect(roomFolder).toBeVisible();
      await expect(roomFolder).toHaveAttribute('aria-expanded', 'true');
      await expect(tRow).toBeVisible();
      await expect(tRow.locator('.var-value')).toHaveText(/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/);
      const value = Number(await tRow.locator('.var-value').innerText());
      expect(Number.isFinite(value)).toBe(true);
      // 283.15 K start, heated towards ~293 K: shown in K or °C depending on the display unit.
      expect(value).toBeGreaterThan(10);
      expect(value).toBeLessThan(300);
      await expect(tRow.locator('.var-unit')).not.toBeEmpty();
    });

    await test.step('"Add Variable to Plot" creates a plot with a legend entry and a trace', async () => {
      await tRow.hover();
      await tRow.getByRole('button', { name: 'Add room.T to plot' }).click();
      const plot = page.locator('.plot-window');
      await expect(plot).toHaveCount(1);
      await expect(plot.locator('.plot-title')).toHaveText('Plot 1');
      await expect(plot.locator('.plot-legend-group')).toHaveText('room');
      await expect(plot.locator('.plot-legend-item .plot-legend-label')).toHaveText('T');
      const trace = plot.locator('svg path.plot-series');
      await expect(trace).toHaveCount(1);
      await expect(trace).toHaveAttribute('d', /^M-?[\d.]+ -?[\d.]+L/);
      await expect(plot.locator('.plot-axis-title').first()).toContainText('Time [s]');
      // the dashed time cursor is a zero-width <line>, so check presence and position rather than visibility
      await expect(plot.locator('.plot-cursor')).toHaveCount(1);
      await expect(plot.locator('.plot-cursor')).toHaveAttribute('x1', /^\d+(\.\d+)?$/);
    });

    await test.step('time slider is visible and spans the experiment', async () => {
      const slider = page.getByTestId('time-slider');
      await expect(slider).toBeVisible();
      await expect(slider.getByRole('slider', { name: 'Time' })).toBeVisible();
      await expect(slider.locator('.time-caption')).toHaveText('Current time:');
      await expect(slider.locator('.time-bound.min')).toHaveText('0');
      await expect(slider.locator('.time-bound.max')).toHaveText('21600');
      await expect(slider.locator('.time-input')).toHaveValue('21600');
    });

    await test.step('the CSV download endpoint responds 200', async () => {
      const experiments = await listExperiments(request, wid, 'Examples.HeatedRoom');
      expect(experiments).toHaveLength(1);
      expect(experiments[0].meta_data.label).toBe('Result1');
      const res = await request.get(`${API_URL}/api/workspaces/${wid}/experiments/${experiments[0].id}/cases/case_1/result`);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toContain('text/csv');
      expect(res.headers()['content-disposition']).toContain('.csv');
      const lines = (await res.text()).trim().split('\n');
      expect(lines[0].split(',')[0]).toBe('time');
      expect(lines[0].split(',')).toContain('room.T');
      expect(lines.length).toBeGreaterThan(100);
    });

    expect(errors).toEqual([]);
  });

  test('simulates Examples.BouncingBall', async ({ page }) => {
    const errors = collectErrors(page);
    await openWorkspace(page, wid, { className: 'Examples.BouncingBall' });
    await runSimulation(page);
    await expect(modeLabels(page).nth(2)).toHaveText(/^Result\d+$/);
    await expect(page.getByTestId('time-slider')).toBeVisible();
    await expect(page.getByTestId('time-slider').locator('.time-bound.max')).toHaveText('3');
    await expect(page.locator('.canvas-banners .banner.error')).toHaveCount(0);
    await page.keyboard.press('3');
    await selectDetailsTab(page, 'CALCULATED VALUES');
    const h = page.locator('.calc-tree .var-row[data-variable="h"]');
    await expect(h).toBeVisible();
    await expect(h.locator('.var-value')).toHaveText(/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/);
    expect(errors).toEqual([]);
  });

  test('a structurally broken model shows an error banner and opens the Log Viewer', async ({ page, request }) => {
    const name = `E2E_Bad_${stamp()}`;
    const fullName = `Examples.${name}`;
    await createClass(request, wid, { className: fullName, restriction: 'model', description: 'e2e: unbalanced model' });

    await openWorkspace(page, wid, { className: fullName, view: 'code' });
    const content = page.locator('.code-view .cm-content');
    await expect(content).toContainText(`model ${name}`);
    await expect(page.locator('.code-status')).toHaveText('Saved');

    // Replace the file text with an unbalanced model (1 variable, 0 equations) and save.
    await content.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(`within Examples;\n\nmodel ${name} "Unbalanced on purpose"\n  Real x;\nequation\nend ${name};\n`);
    await expect(page.locator('.code-status')).toHaveText('Unsaved changes');
    await page.keyboard.press('Control+s');
    await expect(page.locator('.code-status')).toHaveText('Saved');
    await expect.poll(() => classText(request, wid, fullName)).toContain('Real x;');

    await page.getByRole('button', { name: 'Diagram view' }).click();
    const fab = executionFab(page);
    await expect(fab).toHaveAttribute('data-state', 'idle');
    await fab.click();

    const banner = page.locator('.canvas-banners .banner.error');
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner).toContainText('not balanced');
    await expect(banner).toContainText(/0 equations and 1 variable/);
    await expect(banner.getByRole('button', { name: 'Show log' })).toBeVisible();

    const log = page.locator('.log-panel');
    await expect(log).toBeVisible();
    await expect(log.locator('.log-tabs .tab.active')).toHaveText('Compilation log');
    await expect(log.locator('.log-body')).toContainText('not balanced');
    await expect(log.locator('.log-body .log-line.error').first()).toBeVisible();
    await expect(page.locator('.log-toggle')).toHaveClass(/has-errors/);
    await expect(fab).toHaveAttribute('data-state', 'idle');
    await expect(page.getByTestId('time-slider')).toHaveCount(0);
    await expect(modeLabels(page).nth(2)).toHaveText('Results');
  });
});
