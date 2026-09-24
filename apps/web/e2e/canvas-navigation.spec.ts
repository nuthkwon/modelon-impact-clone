/**
 * Canvas navigation (docs/UI_SPEC.md §5.1): Impact's wheel/zoom navigation plus hand panning —
 * the Pan tool (H), right-button drag, and background drag on a read-only canvas. Panning must
 * change only the view, never the model text.
 */
import { expect, test, type Page } from '@playwright/test';
import { canvas, classText, collectErrors, component, defaultWorkspace, openWorkspace } from './helpers';

const CLASS = 'Examples.RCCircuit';

const rootTransform = (page: Page) => page.locator('.diagram-svg .diagram-root').getAttribute('transform');
const svgState = (page: Page) => page.locator('.diagram-svg');

/** A point on the empty canvas background (left of the RC circuit), in page coordinates. */
async function backgroundPoint(page: Page): Promise<{ x: number; y: number }> {
  const box = (await canvas(page).boundingBox())!;
  return { x: box.x + 80, y: box.y + box.height / 2 };
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number, button: 'left' | 'right' | 'middle' = 'left'): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up({ button });
}

test.describe('Canvas navigation', () => {
  let wid: string;

  test.beforeAll(async ({ request }) => {
    wid = (await defaultWorkspace(request)).id;
  });

  test('the Pan tool moves the view with a hand cursor and never edits the model', async ({ page, request }) => {
    const errors = collectErrors(page);
    await openWorkspace(page, wid, { className: CLASS });
    await expect(component(page, 'resistor')).toBeVisible();
    const textBefore = await classText(request, wid, CLASS);

    // Select tool (default): a background drag draws a selection rectangle, the view stays put.
    const t0 = await rootTransform(page);
    await drag(page, await backgroundPoint(page), 60, 40);
    expect(await rootTransform(page)).toBe(t0);

    // Pan tool via the toolbar: open hand, then dragging — even starting on a component — pans.
    await page.getByRole('button', { name: 'Pan tool' }).click();
    await expect(page.getByRole('button', { name: 'Pan tool' })).toHaveAttribute('aria-pressed', 'true');
    await expect(svgState(page)).toHaveAttribute('data-state', 'hand');
    await expect(svgState(page)).toHaveCSS('cursor', 'grab');
    const before = (await component(page, 'resistor').boundingBox())!;
    await drag(page, { x: before.x + before.width / 2, y: before.y + before.height / 2 }, 120, 70);
    const after = (await component(page, 'resistor').boundingBox())!;
    expect(after.x - before.x).toBeCloseTo(120, 0);
    expect(after.y - before.y).toBeCloseTo(70, 0);
    expect(await rootTransform(page)).not.toBe(t0);
    // The resistor moved on screen only because the view moved.
    await expect.poll(() => classText(request, wid, CLASS)).toBe(textBefore);

    // Keyboard: V back to Select, H to Pan, Esc leaves the Pan tool.
    await page.locator('.diagram-svg').click({ position: { x: 20, y: 20 } });
    await page.keyboard.press('v');
    await expect(svgState(page)).toHaveAttribute('data-state', 'idle');
    await page.keyboard.press('h');
    await expect(svgState(page)).toHaveAttribute('data-state', 'hand');
    await page.keyboard.press('Escape');
    await expect(svgState(page)).toHaveAttribute('data-state', 'idle');
    expect(errors).toEqual([]);
  });

  test('right-button drag pans without opening the context menu; a right click still opens it', async ({ page, request }) => {
    await openWorkspace(page, wid, { className: CLASS });
    await expect(component(page, 'resistor')).toBeVisible();
    const textBefore = await classText(request, wid, CLASS);

    const before = (await component(page, 'resistor').boundingBox())!;
    await drag(page, await backgroundPoint(page), -90, 50, 'right');
    const after = (await component(page, 'resistor').boundingBox())!;
    expect(after.x - before.x).toBeCloseTo(-90, 0);
    expect(after.y - before.y).toBeCloseTo(50, 0);
    await expect(page.getByRole('menuitem', { name: /Fit to view/ })).toHaveCount(0);

    const p = await backgroundPoint(page);
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await expect(page.getByRole('menuitem', { name: /Fit to view/ })).toBeVisible();
    await page.keyboard.press('Escape');

    // Middle-button drag pans too.
    const mid = (await component(page, 'resistor').boundingBox())!;
    await drag(page, await backgroundPoint(page), 40, -30, 'middle');
    const moved = (await component(page, 'resistor').boundingBox())!;
    expect(moved.x - mid.x).toBeCloseTo(40, 0);
    expect(moved.y - mid.y).toBeCloseTo(-30, 0);
    await expect.poll(() => classText(request, wid, CLASS)).toBe(textBefore);
  });

  test('on a read-only canvas a background drag pans; zoom buttons zoom', async ({ page }) => {
    await openWorkspace(page, wid, { className: CLASS, mode: 'experiment' });
    await expect(page.locator('.read-only-chip')).toBeVisible();
    await expect(svgState(page)).toHaveCSS('cursor', 'grab');

    const before = (await component(page, 'resistor').boundingBox())!;
    await drag(page, await backgroundPoint(page), 100, -40);
    const after = (await component(page, 'resistor').boundingBox())!;
    expect(after.x - before.x).toBeCloseTo(100, 0);
    expect(after.y - before.y).toBeCloseTo(-40, 0);

    const zoomText = page.locator('.zoom-chip .zoom-value');
    const z0 = parseInt((await zoomText.textContent()) ?? '0', 10);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(async () => parseInt((await zoomText.textContent()) ?? '0', 10)).toBeGreaterThan(z0);
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expect.poll(async () => parseInt((await zoomText.textContent()) ?? '0', 10)).toBeLessThan(z0);
  });
});
