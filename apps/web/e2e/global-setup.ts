/**
 * Global setup: runs once after Playwright has launched the two web servers. It makes sure the
 * result/screenshot directory exists and fails fast (with a readable message) when the API is
 * not the freshly seeded one the specs expect — a `Default` workspace with the `Examples`
 * project. Deleting `.data` itself happens in the API server command (see playwright.config.ts),
 * because Playwright starts `webServer` entries before this hook.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from '@playwright/test';
import { API_URL } from '../playwright.config';

const here = fileURLToPath(new URL('.', import.meta.url));

export default async function globalSetup(): Promise<void> {
  mkdirSync(path.join(here, 'test-results'), { recursive: true });

  const ctx = await request.newContext({ baseURL: API_URL });
  try {
    const health = await ctx.get('/api/health');
    if (!health.ok()) throw new Error(`API health check failed: ${health.status()} ${await health.text()}`);
    const list = await ctx.get('/api/workspaces');
    if (!list.ok()) throw new Error(`GET /api/workspaces failed: ${list.status()}`);
    const body = (await list.json()) as { data: { items: { id: string; definition: { name: string } }[] } };
    const def = body.data.items.find((w) => w.definition.name === 'Default');
    if (!def) throw new Error(`The API did not seed a 'Default' workspace (found: ${body.data.items.map((w) => w.definition.name).join(', ') || 'none'}).`);
    const projects = await ctx.get(`/api/workspaces/${def.id}/projects`);
    const pbody = (await projects.json()) as { data: { items: { definition: { name: string } }[] } };
    if (!pbody.data.items.some((p) => p.definition.name === 'Examples')) throw new Error(`Workspace 'Default' has no 'Examples' project.`);
  } finally {
    await ctx.dispose();
  }
}
