/**
 * Playwright configuration of the end-to-end suite (apps/web/e2e/*.spec.ts).
 *
 * Two web servers are started per run: the Express API on port 8199 with a throw-away data
 * directory (apps/web/e2e/.data, wiped by the server command — Playwright launches `webServer`
 * entries before `globalSetup`, so deleting it there would empty a store the server has
 * already seeded) and vite on port 5199 whose `/api` proxy is pointed at 8199 via `API_PORT`.
 *
 * Both commands `exec` the node binaries directly instead of going through `npx`: Playwright
 * stops a web server by signalling the process group of the command it spawned and only
 * escalates to SIGKILL while that leader is alive, so an `npx → sh → tsx → node` chain leaves
 * orphaned wrappers behind once the shell leader has exited.
 *
 * The bundled browser download is blocked in this environment, so Chromium is launched from
 * `/opt/pw-browsers/chromium`.
 */
import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = path.resolve(webDir, '..', '..');
const dataDir = path.join(webDir, 'e2e', '.data');
const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');

export const API_PORT = 8199;
export const WEB_PORT = 5199;
export const API_URL = `http://localhost:${API_PORT}`;
export const BASE_URL = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts$/,
  outputDir: './e2e/test-results',
  globalSetup: './e2e/global-setup.ts',
  // One worker: the simulator runs synchronously inside the API process and every spec talks to
  // the same server, so parallel workers would only slow each other down and make timings flaky.
  workers: 1,
  fullyParallel: false,
  retries: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1600, height: 900 },
    launchOptions: { executablePath: '/opt/pw-browsers/chromium' },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  webServer: [
    {
      // Fresh store on every run: the directory is removed right before the server starts.
      // (Run from apps/server with a relative entry so the command line does not match the
      // `tsx apps/server/src/index.ts` pattern other tooling on the machine may `pkill`.)
      command: `rm -rf "${dataDir}" && exec node --import tsx src/index.ts`,
      cwd: path.join(repoRoot, 'apps', 'server'),
      url: `${API_URL}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { PORT: String(API_PORT), DATA_DIR: dataDir },
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `exec node "${viteBin}" --port ${WEB_PORT} --strictPort`,
      cwd: webDir,
      url: `${BASE_URL}/`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { API_PORT: String(API_PORT) },
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
