// Temporary visual-check script for the canvas/plots/results restyle (deleted when done).
import { chromium } from '@playwright/test';
import { setTimeout as sleep } from 'node:timers/promises';

const SHOTS = '/tmp/claude-0/-home-user-modelon-impact-clone/1a5fb4f3-baa0-5583-ab94-6140b129ad41/scratchpad/restyle2-shots';
const API = 'http://localhost:8094';
const WEB = 'http://localhost:5184';
const errors = [];
const log = (...a) => console.log(...a);

const ws = await (await fetch(`${API}/api/workspaces`)).json();
const wid = ws.data.items[0].id;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem('impact-clone:settings', JSON.stringify({ showGrid: true }));
});
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

const shot = (name, opts = {}) => page.screenshot({ path: `${SHOTS}/${PREFIX}${name}.png`, ...opts });
const elShot = async (sel, name) => { const l = page.locator(sel).first(); if (await l.count()) await l.screenshot({ path: `${SHOTS}/${PREFIX}${name}.png` }); };

const CLS = process.argv[2] ?? 'Examples.RCCircuit';
const PREFIX = process.argv[3] ?? '';
await page.goto(`${WEB}/workspaces/${wid}?class=${CLS}`);
await sleep(3500);
await shot('01-model');
await elShot('.canvas-fabs', '01b-fabs');

// hover the execution FAB → menu
await page.locator('.execution-fab-group').hover();
await sleep(400);
await shot('02-fab-menu', { clip: { x: 1000, y: 250, width: 600, height: 400 } });
await page.mouse.move(700, 450);

const fab = page.locator('[data-testid="execution-fab"]');
log('fab state before:', await fab.getAttribute('data-state'));
await fab.click();
await sleep(600);
log('fab state after click:', await fab.getAttribute('data-state'));
await shot('03-running');
await elShot('.canvas-fabs', '03b-fabs-running');
for (let i = 0; i < 240; i++) {
  await sleep(500);
  const st = await fab.getAttribute('data-state');
  if (st !== 'running') break;
}
await sleep(1200);
log('fab state done:', await fab.getAttribute('data-state'));
await shot('04-after-sim');
await elShot('.canvas-fabs', '04b-fabs-done');
await elShot('[data-testid="time-slider"]', '04c-time-slider');

await page.keyboard.press('3');
await sleep(1000);
await shot('05-results');

// Calculated values tab → add plot traces & stickies
const calcTab = page.locator('.tab', { hasText: /calculated/i }).first();
if (await calcTab.count()) {
  await calcTab.click();
  await sleep(1200);
  const filter = page.locator('[aria-label="Filter variables"]');
  const addVar = async (name, kind) => {
    await filter.fill(name);
    await sleep(600);
    const row = page.locator(`.var-row[data-variable="${name}"]`).first();
    if (!(await row.count())) { log('row missing', name); return; }
    const btn = row.locator(kind === 'plot' ? '[aria-label^="Add "][aria-label$=" to plot"]' : '[aria-label^="Show "]');
    await btn.dispatchEvent('click');
    await sleep(300);
  };
  const VARS = (process.argv[4] ?? 'resistor.v,capacitor.v,resistor.i').split(',');
  for (const v of VARS) await addVar(v, 'plot');
  for (const v of VARS) await addVar(v, 'sticky');
  await filter.fill('');
  await sleep(800);
  await shot('06-results-plot');
  await elShot('.plot-window', '06b-plot');
  await elShot('.stickies-layer .sticky', '06c-sticky');
  // move the time slider to ~40 %
  const range = page.locator('.time-range');
  if (await range.count()) {
    const box = await range.boundingBox();
    if (box) await page.mouse.click(box.x + box.width * 0.4, box.y + box.height / 2);
    await sleep(400);
  }
  // hover a legend row
  const item = page.locator('.plot-legend-item').first();
  if (await item.count()) { await item.hover(); await sleep(300); await elShot('.plot-window', '07-legend-hover'); }
  await page.mouse.move(700, 450);
  await sleep(300);
  await shot('07b-results-full');
  await elShot('.details-panel, .details, [class*="details"]', '07c-details');
} else {
  log('no Calculated values tab found');
}

// log viewer
await page.locator('.log-toggle').click();
await sleep(600);
await shot('08-log');
await page.locator('.log-toggle').click();

// dark mode sanity
await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); });
await sleep(500);
await shot('09-dark');
await page.evaluate(() => { document.documentElement.removeAttribute('data-theme'); });

await browser.close();
log('console errors:', errors.length ? errors : 'none');
