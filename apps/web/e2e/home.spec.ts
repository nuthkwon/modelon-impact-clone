/**
 * Home page (docs/UI_SPEC.md §1): workspace list, "+ New workspace" dialog, row menu → delete.
 */
import { expect, test } from '@playwright/test';
import { collectErrors, createWorkspace, defaultWorkspace, deleteWorkspace, listWorkspaces, stamp } from './helpers';

const rowNamed = (page: import('@playwright/test').Page, name: string | RegExp) => page.locator('.ws-row').filter({ has: page.locator('.ws-name', { hasText: name }) });

test.describe('Home page', () => {
  test('lists the Default workspace and opens it on click', async ({ page, request }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await expect(page).toHaveTitle(/Workspaces/);
    await expect(page.locator('.home-header h1')).toContainText('Workspaces');
    await expect(page.getByRole('button', { name: 'New workspace' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import workspace' })).toBeDisabled();

    const row = rowNamed(page, /^Default$/);
    await expect(row).toBeVisible();
    await expect(row.locator('.ws-desc')).toHaveText('Default workspace');
    await expect(row.locator('.ws-meta')).toContainText('Last modified');
    await expect(row.locator('.ws-meta')).toContainText(/\d+(\.\d+)? [KM]?B/);

    const ws = await defaultWorkspace(request);
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/workspaces/${ws.id}$`));
    await expect(page.locator('.navbar-workspace')).toHaveText('Default');
    await expect(page.locator('.workspace-panel')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('"+ New workspace" creates a workspace and the row menu deletes it after confirmation', async ({ page, request }) => {
    const errors = collectErrors(page);
    const name = `E2E workspace ${stamp()}`;
    let createdId: string | undefined;
    try {
      await page.goto('/');
      await page.getByRole('button', { name: 'New workspace' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('.dialog-title')).toContainText('New workspace');
      // Create is disabled until a name is entered.
      await expect(dialog.getByRole('button', { name: 'Create' })).toBeDisabled();
      await dialog.locator('#ws-name').fill(name);
      await dialog.locator('#ws-description').fill('created by the e2e suite');
      await dialog.getByRole('button', { name: 'Create' }).click();

      // The app opens the freshly created workspace…
      await expect(page).toHaveURL(/\/workspaces\/ws_[a-z0-9]+/);
      await expect(page.locator('.navbar-workspace')).toHaveText(name);
      await expect(page.locator('.wp-tree [data-name="Examples"]')).toBeVisible();
      const created = (await listWorkspaces(request)).find((w) => w.definition.name === name);
      expect(created, 'workspace exists on the API').toBeTruthy();
      createdId = created!.id;
      expect(page.url()).toContain(createdId);

      // …and it is listed on the Home page.
      await page.getByRole('link', { name: 'Home' }).click();
      await expect(page).toHaveURL(/\/$/);
      const row = rowNamed(page, name);
      await expect(row).toBeVisible();
      await expect(row.locator('.ws-desc')).toHaveText('created by the e2e suite');
      await expect(page.locator('.home-count')).toHaveText(String((await listWorkspaces(request)).length));

      // Row menu → Delete → confirm dialog → row disappears.
      await row.hover();
      await row.getByRole('button', { name: 'Workspace actions' }).click();
      const menu = page.locator('.menu');
      await expect(menu.getByRole('menuitem', { name: 'Open' })).toBeVisible();
      await menu.getByRole('menuitem', { name: 'Delete' }).click();
      const confirm = page.getByRole('dialog');
      await expect(confirm.locator('.dialog-title')).toContainText('Delete workspace?');
      await expect(confirm.locator('.dialog-message')).toContainText(name);
      await confirm.getByRole('button', { name: 'Delete' }).click();
      await expect(confirm).toHaveCount(0);
      await expect(row).toHaveCount(0);
      await expect(rowNamed(page, /^Default$/)).toBeVisible();
      await expect.poll(async () => (await listWorkspaces(request)).some((w) => w.id === createdId)).toBe(false);
      createdId = undefined;
      expect(errors).toEqual([]);
    } finally {
      if (createdId) await deleteWorkspace(request, createdId);
    }
  });

  test('cancelling the delete confirmation keeps the workspace', async ({ page, request }) => {
    const name = `E2E keep ${stamp()}`;
    const ws = await createWorkspace(request, name);
    try {
      await page.goto('/');
      const row = rowNamed(page, name);
      await expect(row).toBeVisible();
      await row.click({ button: 'right' });
      await page.locator('.menu').getByRole('menuitem', { name: 'Delete' }).click();
      const confirm = page.getByRole('dialog');
      await expect(confirm.locator('.dialog-title')).toContainText('Delete workspace?');
      await confirm.getByRole('button', { name: 'Cancel' }).click();
      await expect(confirm).toHaveCount(0);
      await expect(row).toBeVisible();
      expect((await listWorkspaces(request)).some((w) => w.id === ws.id)).toBe(true);
    } finally {
      await deleteWorkspace(request, ws.id);
    }
  });
});
