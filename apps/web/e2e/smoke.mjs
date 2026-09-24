/**
 * End-to-end smoke run: starts the server (port 8080) and vite (port 5173), opens the Default
 * workspace, opens Examples.RCCircuit, simulates, adds a plot, and saves screenshots to
 * apps/web/e2e/screenshots/. Usage: node apps/web/e2e/smoke.mjs [--keep]
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from '@playwright/test';

const root = new URL('../../../', import.meta.url).pathname;
const shots = `${root}apps/web/e2e/screenshots`;
mkdirSync(shots, { recursive: true });

function start(cmd, args, cwd, name) {
  const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: '8080' } });
  p.stdout.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  p.stderr.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  return p;
}

async function waitFor(url, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${url}`);
}

const server = start('npx', ['tsx', 'apps/server/src/index.ts'], root, 'server');
const web = start('npx', ['vite', '--port', '5173', '--strictPort'], `${root}apps/web`, 'web');
const errors = [];
try {
  await waitFor('http://localhost:8080/api/health');
  await waitFor('http://localhost:5173/');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${shots}/01-home.png` });
  const ws = await (await fetch('http://localhost:8080/api/workspaces')).json();
  const wid = ws.data.items[0].id;
  await page.goto(`http://localhost:5173/workspaces/${wid}?class=Examples.RCCircuit`);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${shots}/02-workspace-rc.png` });
  const play = page.locator('[data-testid="execution-fab"]');
  if (await play.count()) {
    await play.first().click();
    for (let i = 0; i < 120; i++) {
      await page.waitForTimeout(500);
      const running = await page.locator('[data-testid="execution-fab"][data-state="running"]').count();
      if (!running && i > 2) break;
    }
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${shots}/03-after-simulate.png` });
    await page.keyboard.press('3');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${shots}/04-results-mode.png` });
  } else {
    errors.push('execution-fab not found');
  }
  await page.keyboard.press('1');
  await page.locator('[data-testid="view-toggle-code"]').first().click().catch(() => errors.push('code view toggle not found'));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${shots}/05-code-view.png` });
  await browser.close();
} catch (e) {
  errors.push(String(e));
} finally {
  if (!process.argv.includes('--keep')) {
    server.kill('SIGTERM');
    web.kill('SIGTERM');
  }
}
console.log(JSON.stringify({ errors }, null, 2));
process.exit(errors.length ? 1 : 0);
