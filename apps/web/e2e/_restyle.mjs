// Temporary screenshot script for the visual-fidelity pass (deleted when done).
// Usage: node apps/web/e2e/_restyle.mjs <outDir> [prefix]
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const out = process.argv[2];
const prefix = process.argv[3] ?? '';
mkdirSync(out, { recursive: true });
const shot = (page, name) => page.screenshot({ path: `${out}/${prefix}${name}.png` });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// Home page
await page.goto('http://localhost:5183/');
await page.waitForSelector('.ws-row', { timeout: 30000 });
await page.waitForTimeout(600);
await shot(page, '01-home');
await page.click('button[aria-label="Apps"]');
await page.waitForTimeout(300);
await shot(page, '02-home-apps-menu');
await page.keyboard.press('Escape');
await page.click('button:has-text("New workspace")');
await page.waitForTimeout(300);
await shot(page, '03-home-new-dialog');
await page.keyboard.press('Escape');

// Workspace page
const ws = await (await fetch('http://localhost:8093/api/workspaces')).json();
const wid = ws.data.items[0].id;
await page.goto(`http://localhost:5183/workspaces/${wid}?class=Examples.RCCircuit`);
await page.waitForSelector('.details-panel', { timeout: 30000 });
await page.waitForTimeout(2500);
await shot(page, '04-workspace-model');
await page.click('button[aria-label="Apps"]');
await page.waitForTimeout(300);
await shot(page, '05-workspace-apps-menu');
await page.keyboard.press('Escape');
await page.click('button[aria-label="Help"]');
await page.waitForTimeout(300);
await shot(page, '05b-workspace-help-menu');
await page.keyboard.press('Escape');

// Select a component to see its parameters
const comp = page.locator('[data-component="resistor"], [data-name="resistor"]').first();
if (await comp.count()) {
  await comp.click();
  await page.waitForTimeout(500);
  await shot(page, '06-workspace-component');
}

// Experiment mode + EXPERIMENT tab
await page.keyboard.press('Escape');
await page.locator('.mode-button').nth(1).click();
await page.waitForTimeout(400);
const expTab = page.locator('.details-panel .tab', { hasText: 'EXPERIMENT' });
if (await expTab.count()) await expTab.click();
await page.waitForTimeout(400);
await shot(page, '07-workspace-experiment');

// Settings dialog
await page.click('button[aria-label="Application settings"]');
await page.waitForTimeout(400);
await shot(page, '08-settings-dialog');
await page.keyboard.press('Escape');

// New class dialog
await page.click('button[aria-label="Create class"]');
await page.waitForTimeout(400);
await shot(page, '09-newclass-dialog');
await page.keyboard.press('Escape');

// Code view
await page.locator('.mode-button').nth(0).click();
await page.click('button[aria-label="Code view"]');
await page.waitForTimeout(800);
await shot(page, '10-code-view');

// Context menu on tree row
await page.click('button[aria-label="Diagram view"]');
const row = page.locator('.wp-row').first();
await row.click({ button: 'right' });
await page.waitForTimeout(300);
await shot(page, '11-context-menu');
await page.keyboard.press('Escape');

// Dark mode
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
await page.waitForTimeout(300);
await shot(page, '12-dark-workspace');
await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));

await browser.close();
if (errors.length) console.log('console errors:', errors.slice(0, 10));
console.log('done');
