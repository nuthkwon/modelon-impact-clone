/**
 * Loading and unloading external libraries (docs/UI_SPEC.md §4.1): Configure workspace →
 * Workspace Management → Libraries → Import opens the file explorer; picking a library's
 * `package.mo` imports it and it appears under LIBRARIES. Workspace configuration → Edit → ×
 * unloads it, + loads it again, and Libraries → ⋮ → Delete removes it from the server.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { API_URL, collectErrors, createWorkspace, deleteWorkspace, openWorkspace, stamp, treeRow } from './helpers';

/** A small directory library in the ThermoPower layout (package.mo + package.order + files + a sub-package). */
function writeLibrary(root: string, name: string): string {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, 'Water'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.mo'),
    `within ;\npackage ${name} "Open library for thermal test plants"\n  extends Modelica.Icons.Package;\n  annotation (version="3.1");\nend ${name};\n`,
  );
  fs.writeFileSync(path.join(dir, 'package.order'), 'Water\nPipe\n');
  fs.writeFileSync(path.join(dir, 'Pipe.mo'), `within ${name};\nmodel Pipe "A pipe"\n  parameter Real L = 1 "Length";\n  Real w = {i for i in 1:3} * {1, 1, 1};\nend Pipe;\n`);
  fs.writeFileSync(path.join(dir, 'Water', 'package.mo'), `within ${name};\npackage Water "Water components"\nend Water;\n`);
  fs.writeFileSync(path.join(dir, 'Water', 'Tank.mo'), `within ${name}.Water;\nmodel Tank\nend Tank;\n`);
  return dir;
}

async function openWorkspaceManagement(page: Page): Promise<void> {
  await page.locator('.workspace-panel').getByRole('button', { name: 'Configure workspace' }).click();
  await expect(page.locator('.wm-dialog')).toBeVisible();
}

test.describe('Library import', () => {
  let wid: string;
  let root: string;
  const libName = `ThermoTest${stamp()}`.replace(/[^A-Za-z0-9_]/g, '');

  test.beforeAll(async ({ request }) => {
    wid = (await createWorkspace(request, `Libraries ${stamp()}`)).id;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'impact-e2e-lib-'));
    writeLibrary(root, libName);
  });

  test.afterAll(async ({ request }) => {
    await deleteWorkspace(request, wid);
    const libs = (await (await request.get(`${API_URL}/api/libraries`)).json()) as { data: { items: { id: string; name: string }[] } };
    for (const l of libs.data.items.filter((x) => x.name === libName)) await request.delete(`${API_URL}/api/libraries/${l.id}`);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('imports a library by picking its package.mo, unloads, reloads and deletes it', async ({ page }) => {
    const errors = collectErrors(page);
    await openWorkspace(page, wid);
    await expect(treeRow(page, 'Modelica')).toBeVisible();
    await expect(treeRow(page, libName)).toHaveCount(0);

    // Configure workspace → Libraries → Import: the explorer lists folders and .mo files.
    await openWorkspaceManagement(page);
    const dialog = page.locator('.wm-dialog');
    await dialog.getByRole('tab', { name: 'Libraries' }).click();
    await expect(dialog.locator('.wm-library').first()).toContainText('Modelica');
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    const explorer = page.locator('.wm-import-dialog');
    await expect(explorer).toBeVisible();
    const pathField = explorer.getByLabel('Folder path');
    await pathField.fill(root);
    await pathField.press('Enter');
    await explorer.locator('.wm-import-row', { hasText: libName }).dblclick();
    await expect(pathField).toHaveValue(path.join(root, libName));
    await expect(explorer.locator('.wm-import-row .wm-import-label')).toHaveText(['Water', 'package.mo', 'Pipe.mo']);
    await expect(explorer.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
    await explorer.locator('.wm-import-row', { hasText: 'package.mo' }).click();
    await expect(explorer.locator('.wm-import-hint')).toContainText('Import the library in');
    await explorer.getByRole('button', { name: 'Import', exact: true }).click();

    // Imported and added to the workspace: listed, and shown under LIBRARIES in the tree.
    await expect(explorer).toHaveCount(0);
    await expect(dialog.locator('.wm-status.success')).toContainText(`${libName} 3.1 was imported (4 files) and added to the workspace`);
    const card = dialog.locator('.wm-library', { hasText: libName });
    await expect(card).toContainText('In this workspace');
    await expect(card).toContainText('Open library for thermal test plants');
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
    const libRow = treeRow(page, libName);
    await expect(libRow).toBeVisible();
    await libRow.locator('.wp-chevron').click();
    await expect(treeRow(page, `${libName}.Water`)).toBeVisible();
    await expect(treeRow(page, `${libName}.Pipe`)).toBeVisible();

    // Unload: Workspace configuration → Edit → ×.
    await openWorkspaceManagement(page);
    await dialog.getByRole('button', { name: 'Edit' }).click();
    await dialog.getByRole('button', { name: `Remove ${libName} from workspace` }).click();
    await expect(dialog.locator('.wm-status.success')).toContainText(`${libName} was removed from the workspace`);
    await expect(treeRow(page, libName)).toHaveCount(0);

    // Load again from the Available libraries.
    const available = dialog.locator('.wm-available');
    await expect(available).toContainText(libName);
    await available.getByRole('button', { name: `Add ${libName} to workspace` }).click();
    await expect(dialog.locator('.wm-status.success')).toContainText(`${libName} was added to the workspace`);
    await expect(treeRow(page, libName)).toBeVisible();
    await dialog.getByRole('button', { name: 'Done' }).click();

    // Delete from the server: Libraries → ⋮ → Delete → confirm.
    await dialog.getByRole('tab', { name: 'Libraries' }).click();
    await dialog.getByRole('button', { name: `${libName} actions` }).click();
    await page.locator('.menu .menu-item', { hasText: 'Delete' }).click();
    const confirm = page.locator('.dialog', { hasText: `Delete ${libName}?` });
    await expect(confirm).toContainText('will be removed from it');
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await expect(dialog.locator('.wm-status.success')).toContainText(`${libName} was deleted`);
    await expect(dialog.locator('.wm-library', { hasText: libName })).toHaveCount(0);
    await expect(treeRow(page, libName)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
