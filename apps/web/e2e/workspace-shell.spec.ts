/**
 * Workspace shell (docs/UI_SPEC.md §2–§6): four areas, mode buttons and keyboard modes, the
 * Diagram/Code toggle and the class-tree Filter, all on the seeded `Examples.RCCircuit`.
 */
import { expect, test } from '@playwright/test';
import { collectErrors, component, components, defaultWorkspace, detailsTabs, modeLabels, openWorkspace, treeRow } from './helpers';

const CLASS = 'Examples.RCCircuit';

test.describe('Workspace shell', () => {
  let wid: string;

  test.beforeAll(async ({ request }) => {
    wid = (await defaultWorkspace(request)).id;
  });

  test('shows the four areas and the mode buttons for Examples.RCCircuit', async ({ page }) => {
    const errors = collectErrors(page);
    await openWorkspace(page, wid, { className: CLASS });

    // Navigation bar, Workspace panel, canvas, Details panel.
    await expect(page.locator('header.navbar')).toBeVisible();
    await expect(page.locator('.navbar-workspace')).toHaveText('Default');
    await expect(page.locator('.workspace-panel')).toBeVisible();
    await expect(page.locator('.workspace-panel .wp-section-title')).toHaveText(['PROJECTS', 'LIBRARIES'], { ignoreCase: true });
    await expect(page.locator('.workspace-panel .wp-section-title').first()).toHaveCSS('text-transform', 'uppercase');
    await expect(page.locator('main.workspace-center .canvas')).toBeVisible();
    await expect(page.locator('.details-panel')).toBeVisible();

    // Mode buttons: active class short name / virtual experiment / no result yet.
    await expect(modeLabels(page)).toHaveText(['RCCircuit', 'Experiment 1', 'Results']);
    await expect(page.locator('.mode-button.active .mode-label')).toHaveText('RCCircuit');

    // The diagram of RCCircuit is rendered: 4 components, 4 connections.
    await expect(component(page, 'resistor')).toBeVisible();
    await expect(components(page)).toHaveCount(4);
    await expect(page.locator('.diagram-svg [data-connection]')).toHaveCount(4);

    // Tree marks the active class; Details header shows it; FABs are present.
    await expect(treeRow(page, CLASS)).toHaveClass(/active/);
    await expect(page.locator('.details-title')).toHaveText('RCCircuit');
    await expect(page.locator('.details-subtitle')).toContainText(CLASS);
    await expect(page.getByTestId('execution-fab')).toHaveAttribute('data-state', 'idle');
    await expect(page.getByTestId('views-fab')).toBeVisible();
    await expect(page.locator('.zoom-chip .zoom-value')).toHaveText(/\d+%/);
    expect(errors).toEqual([]);
  });

  test('keys 1/2/3 switch modes and the Details tabs follow', async ({ page }) => {
    await openWorkspace(page, wid, { className: CLASS });
    await expect(detailsTabs(page)).toHaveText(['PROPERTIES', 'INFORMATION', 'COMPONENTS']);
    await expect(page.locator('.canvas')).toHaveClass(/editable/);

    await page.keyboard.press('2');
    await expect(page.locator('.mode-button.active .mode-label')).toHaveText('Experiment 1');
    await expect(detailsTabs(page)).toHaveText(['PROPERTIES', 'COMPONENTS', 'EXPERIMENT']);
    await expect(page).toHaveURL(/mode=experiment/);
    await expect(page.locator('.canvas')).toHaveClass(/read-only/);
    await expect(page.locator('.read-only-chip')).toHaveText('Read-only');

    await page.keyboard.press('3');
    await expect(page.locator('.mode-button.active .mode-label')).toHaveText('Results');
    await expect(detailsTabs(page)).toHaveText(['PROPERTIES', 'SIMULATIONS', 'CALCULATED VALUES']);
    await expect(page).toHaveURL(/mode=results/);

    await page.keyboard.press('1');
    await expect(page.locator('.mode-button.active .mode-label')).toHaveText('RCCircuit');
    await expect(detailsTabs(page)).toHaveText(['PROPERTIES', 'INFORMATION', 'COMPONENTS']);
    await expect(page).not.toHaveURL(/mode=/);
    await expect(page.locator('.read-only-chip')).toHaveCount(0);

    // Clicking a mode button and opening via the URL work as well.
    await page.locator('.mode-button').nth(2).click();
    await expect(detailsTabs(page)).toHaveText(['PROPERTIES', 'SIMULATIONS', 'CALCULATED VALUES']);
    await openWorkspace(page, wid, { className: CLASS, mode: 'experiment' });
    await expect(page.locator('.mode-button.active .mode-label')).toHaveText('Experiment 1');
    await expect(detailsTabs(page)).toHaveText(['PROPERTIES', 'COMPONENTS', 'EXPERIMENT']);
  });

  test('the code toggle shows the Modelica text of the active class', async ({ page }) => {
    await openWorkspace(page, wid, { className: CLASS });
    await page.getByRole('button', { name: 'Code view', exact: true }).click();
    await expect(page.locator('.code-view .cm-editor')).toBeVisible();
    const content = page.locator('.code-view .cm-content');
    await expect(content).toContainText('model RCCircuit');
    await expect(content).toContainText('Modelica.Electrical.Analog.Basic.Resistor resistor(R=1000)');
    await expect(page.locator('.code-strip .code-path')).toContainText('Examples');
    await expect(page.locator('.code-strip .code-class')).toHaveText(CLASS);
    await expect(page.locator('.code-status')).toHaveText('Saved');
    await expect(page).toHaveURL(/view=code/);
    await expect(page.getByRole('button', { name: 'Code view', exact: true })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Diagram view' }).click();
    await expect(page.locator('.diagram-svg')).toBeVisible();
    await expect(page).not.toHaveURL(/view=code/);

    // Library classes open read-only in the Code view.
    await openWorkspace(page, wid, { className: 'Modelica.Electrical.Analog.Basic.Resistor', view: 'code' });
    await expect(page.locator('.code-banner.readonly')).toContainText('Read-only library class');
    await expect(page.locator('.code-status')).toHaveText('Read-only');
  });

  test('the Filter field filters the class tree', async ({ page }) => {
    await openWorkspace(page, wid, { className: CLASS });
    await expect(treeRow(page, CLASS)).toBeVisible();
    await expect(treeRow(page, 'Examples.VanDerPol')).toBeVisible();

    const filter = page.getByRole('textbox', { name: 'Filter classes' });
    await filter.fill('Van');
    await expect(treeRow(page, 'Examples.VanDerPol')).toBeVisible();
    await expect(treeRow(page, CLASS)).toHaveCount(0);
    await expect(treeRow(page, 'Examples.VanDerPol').locator('mark').first()).toHaveText(/^van$/i);
    // ancestors stay visible so the match is reachable
    await expect(treeRow(page, 'Examples')).toBeVisible();

    await filter.fill('NoSuchClassXyz');
    await expect(page.locator('.wp-tree .wp-empty')).toHaveText('No classes match');

    await page.getByRole('button', { name: 'Clear filter' }).click();
    await expect(filter).toHaveValue('');
    await expect(treeRow(page, CLASS)).toBeVisible();
  });
});
