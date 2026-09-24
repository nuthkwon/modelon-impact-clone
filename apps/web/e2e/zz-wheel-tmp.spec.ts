// TEMPORARY reproduction spec (deleted after use): wheel over the plot body must zoom the plot.
import { expect, test } from '@playwright/test';
import { collectErrors, createWorkspace, deleteWorkspace, modeLabels, openWorkspace, runSimulation, selectDetailsTab, stamp } from './helpers';

test.describe('TMP wheel zoom', () => {
  let wid: string;
  test.beforeAll(async ({ request }) => {
    wid = (await createWorkspace(request, `E2E wheel ${stamp()}`)).id;
  });
  test.afterAll(async ({ request }) => {
    if (wid) await deleteWorkspace(request, wid);
  });
  test('wheel over the plot zooms it (Reset button appears) and does not pan the canvas', async ({ page }) => {
    const errors = collectErrors(page);
    await openWorkspace(page, wid, { className: 'Examples.HeatedRoom' });
    await runSimulation(page);
    await expect(modeLabels(page).nth(2)).toHaveText('Result1');
    await expect(page.getByTestId('time-slider')).toBeVisible();
    await page.keyboard.press('3');
    await expect(page.locator('.mode-button.active .mode-label')).toHaveText('Result1');
    await selectDetailsTab(page, 'CALCULATED VALUES');
    const tRow = page.locator('.calc-tree .var-row[data-variable="room.T"]');
    await tRow.hover();
    await tRow.getByRole('button', { name: 'Add room.T to plot' }).click();
    const plot = page.locator('.plot-window');
    await expect(plot.locator('svg path.plot-series')).toHaveCount(1);
    const svg = plot.locator('svg.plot-chart-svg');
    const box = (await svg.boundingBox())!;
    const before = await plot.locator('.plot-ticks text').allInnerTexts();
    const canvasTransformBefore = await page.locator('.diagram-svg g[transform]').first().getAttribute('transform');
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
    await page.mouse.wheel(0, -120);
    await page.mouse.wheel(0, -120);
    await expect(plot.locator('.plot-reset-zoom')).toHaveCount(1);
    const after = await plot.locator('.plot-ticks text').allInnerTexts();
    expect(after).not.toEqual(before);
    const canvasTransformAfter = await page.locator('.diagram-svg g[transform]').first().getAttribute('transform');
    expect(canvasTransformAfter).toBe(canvasTransformBefore);
    expect(errors).toEqual([]);
  });
});
