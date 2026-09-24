/**
 * Experiment mode (docs/UI_SPEC.md §6.1, §6.4, §6.5, §6.6): analysis settings persist in
 * localStorage, experiment modifiers with `range()` produce a multi-case result.
 */
import { expect, test } from '@playwright/test';
import { API_URL, component, createWorkspace, deleteWorkspace, listExperiments, modeLabels, openWorkspace, runSimulation, selectDetailsTab, setParameterValue, stamp } from './helpers';

const CLASS = 'Examples.RCCircuit';

test.describe('Experiment mode', () => {
  let wid: string;

  test.beforeAll(async ({ request }) => {
    wid = (await createWorkspace(request, `E2E experiment ${stamp()}`)).id;
  });

  test.afterAll(async ({ request }) => {
    if (wid) await deleteWorkspace(request, wid);
  });

  test('"Stop time" edits persist across a reload (localStorage)', async ({ page }) => {
    await openWorkspace(page, wid, { className: CLASS, mode: 'experiment' });
    await expect(page.locator('.mode-button.active .mode-label')).toHaveText('Experiment 1');
    await selectDetailsTab(page, 'EXPERIMENT');
    await expect(page.locator('.exp-row.active .exp-row-name')).toHaveText('Experiment 1');
    await expect(page.getByRole('radio', { name: 'Dynamic' })).toHaveAttribute('aria-checked', 'true');

    // Defaults come from the class's experiment annotation (StopTime=5, Interval=0.005 → 1000 points).
    const stop = page.locator('#an-stop');
    await expect(stop).toHaveValue('5');
    await expect(page.locator('#an-interval')).toHaveValue('1000');
    await expect(page.locator('#an-solver')).toHaveValue('CVode');

    await stop.fill('2');
    await stop.press('Enter');
    await expect(stop).toHaveValue('2');
    await expect(page.locator('#an-interval')).toHaveValue('400');

    await page.reload();
    await expect(page.locator('.workspace-panel')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.mode-button.active .mode-label')).toHaveText('Experiment 1');
    await selectDetailsTab(page, 'EXPERIMENT');
    await expect(page.locator('#an-stop')).toHaveValue('2');
    await expect(page.locator('#an-interval')).toHaveValue('400');

    const stored = await page.evaluate((id) => localStorage.getItem(`impact-clone:${id}`), wid);
    expect(stored).toBeTruthy();
    const persisted = JSON.parse(stored!) as { experiments: { className: string; name: string; analysis: { stopTime: number } }[] };
    const exp = persisted.experiments.find((e) => e.className === CLASS);
    expect(exp?.name).toBe('Experiment 1');
    expect(exp?.analysis.stopTime).toBe(2);
  });

  test('a range() override on resistor.R yields a 3-case sweep with a case selector', async ({ page, request }) => {
    await openWorkspace(page, wid, { className: CLASS, mode: 'experiment' });
    await expect(page.locator('.read-only-chip')).toHaveText('Read-only');

    await test.step('set resistor.R = range(100, 300, 3) in PROPERTIES', async () => {
      await component(page, 'resistor').click();
      await expect(page.locator('.details-title')).toHaveText('resistor');
      await selectDetailsTab(page, 'PROPERTIES');
      await setParameterValue(page, 'resistor.R', 'range(100, 300, 3)');
      const row = page.locator('.param-row[data-name="resistor.R"]');
      await expect(row.locator('input[aria-label="resistor.R"]')).toHaveClass(/param-value--experiment/);
      await expect(row.locator('.param-cases .chip')).toHaveText('3 cases');
      await expect(row.getByRole('button', { name: 'Remove experiment modifier' })).toBeVisible();

      await selectDetailsTab(page, 'EXPERIMENT');
      await expect(page.locator('.exp-row.active .chip')).toHaveText('3 cases');
      await page.getByRole('tab', { name: 'MODIFICATIONS' }).click();
      await expect(page.locator('.mod-row code')).toHaveText('resistor.R = range(100, 300, 3)');
    });

    await test.step('run → result with 3 cases', async () => {
      await runSimulation(page, 90_000);
      await expect(modeLabels(page).nth(2)).toHaveText('Result1');
      await page.keyboard.press('3');
      await selectDetailsTab(page, 'SIMULATIONS');
      const row = page.locator('.sim-row').first();
      await expect(row.locator('.sim-status.ok')).toBeVisible();
      await expect(row.locator('.sim-cases')).toHaveText('3 cases');

      const experiments = await listExperiments(request, wid, CLASS);
      expect(experiments).toHaveLength(1);
      expect(experiments[0].run_info.successful).toBe(3);
      expect(experiments[0].experiment.base.modifiers.variables['resistor.R']).toBe('range(100, 300, 3)');
      const cases = await (await request.get(`${API_URL}/api/workspaces/${wid}/experiments/${experiments[0].id}/cases`)).json();
      expect(cases.data.items.map((c: { input: { parametrization: Record<string, unknown> } }) => c.input.parametrization['resistor.R'])).toEqual([100, 200, 300]);
    });

    await test.step('case selector in CALCULATED VALUES (and next to the time slider)', async () => {
      await selectDetailsTab(page, 'CALCULATED VALUES');
      const select = page.locator('#calc-case-select');
      await expect(select).toBeVisible();
      await expect(select.locator('option')).toHaveCount(3);
      const rRow = page.locator('.calc-tree .var-row[data-variable="resistor.R"]');
      await expect(rRow.locator('.var-value')).toHaveText('100');
      await select.selectOption({ index: 2 });
      await expect(rRow.locator('.var-value')).toHaveText('300');
      await expect(page.getByTestId('time-slider')).toHaveClass(/multi-case/);
      await expect(page.getByTestId('time-slider').getByRole('combobox', { name: 'Case' })).toHaveValue('2');
    });
  });
});
