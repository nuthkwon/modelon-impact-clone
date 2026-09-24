/**
 * Diagram editing (docs/UI_SPEC.md §5.1, §6.1, §7): new class via the "+" dialog, library drop,
 * port-to-port connection, parameter edit, rename, delete and undo — every step is verified
 * against the model text the server holds.
 */
import { expect, test } from '@playwright/test';
import { canvas, classText, collectErrors, component, components, connectPorts, createClass, defaultWorkspace, deleteClass, dropClassOnCanvas, expandTreeNode, openWorkspace, port, selectDetailsTab, setParameterValue, stamp, treeRow } from './helpers';

const RESISTOR = 'Modelica.Electrical.Analog.Basic.Resistor';
const GROUND = 'Modelica.Electrical.Analog.Basic.Ground';

test.describe('Diagram editing', () => {
  let wid: string;
  const created: string[] = [];

  test.beforeAll(async ({ request }) => {
    wid = (await defaultWorkspace(request)).id;
  });

  test.afterEach(async ({ request }) => {
    for (const cls of created.splice(0)) await deleteClass(request, wid, cls);
  });

  test('create a model, drop components, connect, edit, rename, delete and undo', async ({ page, request }) => {
    const errors = collectErrors(page);
    const name = `E2E_${stamp()}`;
    const fullName = `Examples.${name}`;
    const text = () => classText(request, wid, fullName);
    await openWorkspace(page, wid, { className: 'Examples.RCCircuit' });

    await test.step('create the class through the "+" (New class) dialog', async () => {
      await page.getByRole('button', { name: 'Create class' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.locator('.dialog-title')).toContainText('New class');
      await dialog.locator('#newclass-name').fill(name);
      await expect(dialog.locator('#newclass-type')).toHaveValue('model');
      await expect(dialog.locator('.location-tree .tree-row.selected .tree-name')).toHaveText('Examples');
      await expect(dialog.locator('.new-class-preview')).toHaveText(fullName);
      await dialog.getByRole('button', { name: 'Create' }).click();
      created.push(fullName);
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('.mode-button.active .mode-label')).toHaveText(name);
      await expect(page).toHaveURL(new RegExp(`class=${fullName}`));
      await expect(treeRow(page, fullName)).toHaveClass(/active/);
      await expect(components(page)).toHaveCount(0);
      expect(await text()).toContain(`model ${name}`);
    });

    await test.step('drop a Resistor from the expanded library tree', async () => {
      await expandTreeNode(page, 'Modelica');
      await expandTreeNode(page, 'Modelica.Electrical');
      await expandTreeNode(page, 'Modelica.Electrical.Analog');
      await expandTreeNode(page, 'Modelica.Electrical.Analog.Basic');
      const row = treeRow(page, RESISTOR);
      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute('draggable', 'true');
      const box = (await canvas(page).boundingBox())!;
      await dropClassOnCanvas(page, RESISTOR, { x: box.width / 2 - 160, y: box.height / 2 });
      const resistor = component(page, 'resistor');
      await expect(resistor).toBeVisible();
      await expect(resistor).toHaveClass(/selected/);
      await expect(page.locator('.details-title')).toHaveText('resistor');
      await expect(page.locator('.details-subtitle')).toContainText(RESISTOR);
      await expect.poll(text).toContain(`${RESISTOR} resistor`);

      // The Code view shows the same declaration.
      await page.getByRole('button', { name: 'Code view', exact: true }).click();
      await expect(page.locator('.code-view .cm-content')).toContainText(`${RESISTOR} resistor`);
      await page.getByRole('button', { name: 'Diagram view' }).click();
      await expect(component(page, 'resistor')).toBeVisible();
    });

    await test.step('drop a Ground found through the Filter field', async () => {
      const filter = page.getByRole('textbox', { name: 'Filter classes' });
      await filter.fill('Ground');
      await expect(treeRow(page, GROUND)).toBeVisible();
      const box = (await canvas(page).boundingBox())!;
      await dropClassOnCanvas(page, GROUND, { x: box.width / 2 + 160, y: box.height / 2 + 120 });
      await expect(component(page, 'ground')).toBeVisible();
      await expect(components(page)).toHaveCount(2);
      await expect.poll(text).toContain(`${GROUND} ground`);
      await page.getByRole('button', { name: 'Clear filter' }).click();
    });

    await test.step('connect resistor.n → ground.p by dragging between the ports', async () => {
      await expect(port(page, 'resistor.n')).toBeVisible();
      await expect(port(page, 'ground.p')).toBeVisible();
      await connectPorts(page, 'resistor.n', 'ground.p');
      await expect(page.locator('.diagram-svg [data-connection]')).toHaveCount(1);
      await expect.poll(text).toContain('connect(resistor.n, ground.p)');
    });

    await test.step('set R = 220 in PROPERTIES', async () => {
      await component(page, 'resistor').click();
      await expect(component(page, 'resistor')).toHaveClass(/selected/);
      await expect(page.locator('.details-title')).toHaveText('resistor');
      await selectDetailsTab(page, 'PROPERTIES');
      await setParameterValue(page, 'resistor.R', '220');
      await expect.poll(text).toContain('resistor(R=220)');
      await expect(page.locator('.param-row[data-name="resistor.R"] input[aria-label="resistor.R"]')).toHaveValue('220');
    });

    await test.step('rename the component through the Details header', async () => {
      await page.locator('.details-title').click();
      const input = page.getByRole('textbox', { name: 'Component name' });
      await expect(input).toBeVisible();
      await input.fill('r1');
      await input.press('Enter');
      await expect(component(page, 'r1')).toBeVisible();
      await expect(component(page, 'resistor')).toHaveCount(0);
      await expect.poll(text).toContain('Resistor r1(R=220)');
      expect(await text()).toContain('connect(r1.n, ground.p)');
      // NOTE: the header shows the class again here — see the fixme test below.
    });

    await test.step('Delete removes the component and its connection; Ctrl+Z restores both', async () => {
      await component(page, 'r1').click();
      await expect(component(page, 'r1')).toHaveClass(/selected/);
      await page.keyboard.press('Delete');
      await expect(component(page, 'r1')).toHaveCount(0);
      await expect(page.locator('.diagram-svg [data-connection]')).toHaveCount(0);
      await expect.poll(text).not.toContain('connect(');
      expect(await text()).not.toContain('Resistor r1');

      await page.keyboard.press('Control+z');
      await expect(component(page, 'r1')).toBeVisible();
      await expect(page.locator('.diagram-svg [data-connection]')).toHaveCount(1);
      await expect.poll(text).toContain('connect(r1.n, ground.p)');
      expect(await text()).toContain('Resistor r1(R=220)');
    });

    expect(errors).toEqual([]);
  });

  // Product bug: DetailsHeader.commit() applies `renameComponent` but leaves `selection` pointing at
  // the old name, so the panel flips back to the class instead of showing the renamed component
  // (RenameDialog remaps the selection; the inline header rename does not).
  test('renaming through the Details header keeps the renamed component selected', async ({ page, request }) => {
    const name = `E2E_${stamp()}`;
    const fullName = `Examples.${name}`;
    await createClass(request, wid, { className: fullName, restriction: 'model' });
    created.push(fullName);
    await openWorkspace(page, wid, { className: fullName });
    const box = (await canvas(page).boundingBox())!;
    const filter = page.getByRole('textbox', { name: 'Filter classes' });
    await filter.fill('Resistor');
    await dropClassOnCanvas(page, RESISTOR, { x: box.width / 2, y: box.height / 2 });
    await page.getByRole('button', { name: 'Clear filter' }).click();
    await expect(component(page, 'resistor')).toHaveClass(/selected/);
    await expect(page.locator('.details-title')).toHaveText('resistor');

    await page.locator('.details-title').click();
    const input = page.getByRole('textbox', { name: 'Component name' });
    await input.fill('r1');
    await input.press('Enter');
    await expect(component(page, 'r1')).toBeVisible();
    await expect(component(page, 'r1')).toHaveClass(/selected/);
    await expect(page.locator('.details-title')).toHaveText('r1');
    await expect(page.locator('.details-subtitle')).toContainText(RESISTOR);
  });
});
