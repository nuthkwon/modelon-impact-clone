/**
 * Shared helpers of the e2e specs: typed API access (seeding / cleanup through the REST API
 * described in packages/protocol), page-level utilities (opening a workspace, console error
 * collection, drag & drop from the library tree, connecting ports) and a few locators.
 */
import { expect } from '@playwright/test';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import type { ClassSourceDto, ClassTreeNodeDto, CreateClassRequest, ExperimentDto, ItemsResponse, Workspace } from '@impact/protocol';
import { API_URL } from '../playwright.config';

export { API_URL };

export const CLASS_MIME = 'application/x-modelica-class';

/** Unique identifier suffix for classes/workspaces created by a test. */
export const stamp = (): string => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export async function listWorkspaces(request: APIRequestContext): Promise<Workspace[]> {
  const res = await request.get(`${API_URL}/api/workspaces`);
  expect(res.ok(), `GET /api/workspaces -> ${res.status()}`).toBeTruthy();
  return ((await res.json()) as ItemsResponse<Workspace>).data.items;
}

/** The seeded `Default` workspace. */
export async function defaultWorkspace(request: APIRequestContext): Promise<Workspace> {
  const items = await listWorkspaces(request);
  const ws = items.find((w) => w.definition.name === 'Default');
  if (!ws) throw new Error(`No 'Default' workspace on the API (${items.map((w) => w.definition.name).join(', ')})`);
  return ws;
}

export async function createWorkspace(request: APIRequestContext, name: string, description?: string): Promise<Workspace> {
  const res = await request.post(`${API_URL}/api/workspaces`, { data: { new: { name, description } } });
  expect(res.status(), `POST /api/workspaces -> ${res.status()}`).toBe(201);
  return (await res.json()) as Workspace;
}

export async function deleteWorkspace(request: APIRequestContext, wid: string): Promise<void> {
  const res = await request.delete(`${API_URL}/api/workspaces/${wid}`);
  expect([204, 404]).toContain(res.status());
}

export async function classTree(request: APIRequestContext, wid: string, parent?: string, q?: string): Promise<ClassTreeNodeDto[]> {
  const params = new URLSearchParams();
  if (parent) params.set('parent', parent);
  if (q) params.set('q', q);
  const qs = params.toString();
  const res = await request.get(`${API_URL}/api/workspaces/${wid}/classes${qs ? `?${qs}` : ''}`);
  expect(res.ok(), `GET classes -> ${res.status()}`).toBeTruthy();
  return ((await res.json()) as ItemsResponse<ClassTreeNodeDto>).data.items;
}

export async function getClassSource(request: APIRequestContext, wid: string, className: string): Promise<ClassSourceDto> {
  const res = await request.get(`${API_URL}/api/workspaces/${wid}/classes/${encodeURIComponent(className)}/source`);
  expect(res.ok(), `GET source of ${className} -> ${res.status()}`).toBeTruthy();
  return (await res.json()) as ClassSourceDto;
}

/** Text of the file holding `className` (the model text the UI edits). */
export async function classText(request: APIRequestContext, wid: string, className: string): Promise<string> {
  return (await getClassSource(request, wid, className)).text;
}

export async function createClass(request: APIRequestContext, wid: string, req: CreateClassRequest): Promise<ClassSourceDto> {
  const res = await request.post(`${API_URL}/api/workspaces/${wid}/classes`, { data: req });
  expect(res.status(), `POST classes ${req.className} -> ${res.status()} ${await res.text()}`).toBe(201);
  return (await res.json()) as ClassSourceDto;
}

export async function deleteClass(request: APIRequestContext, wid: string, className: string): Promise<void> {
  const res = await request.delete(`${API_URL}/api/workspaces/${wid}/classes/${encodeURIComponent(className)}`);
  expect([204, 404], `DELETE ${className} -> ${res.status()}`).toContain(res.status());
}

export async function listExperiments(request: APIRequestContext, wid: string, className?: string): Promise<ExperimentDto[]> {
  const res = await request.get(`${API_URL}/api/workspaces/${wid}/experiments${className ? `?className=${encodeURIComponent(className)}` : ''}`);
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as ItemsResponse<ExperimentDto>).data.items;
}

export async function deleteExperiment(request: APIRequestContext, wid: string, eid: string): Promise<void> {
  const res = await request.delete(`${API_URL}/api/workspaces/${wid}/experiments/${eid}`);
  expect([204, 404]).toContain(res.status());
}

// ---------------------------------------------------------------------------
// Page utilities
// ---------------------------------------------------------------------------

/** Console/page errors of a page, ignoring the noise this offline environment produces (Google Fonts, network). */
export function collectErrors(page: Page, extraIgnore: RegExp[] = []): string[] {
  const errors: string[] = [];
  const ignorable = (t: string) => /ERR_CERT_AUTHORITY_INVALID|fonts\.g(oogleapis|static)\.com|net::ERR_|Failed to load resource/.test(t) || extraIgnore.some((re) => re.test(t));
  page.on('console', (m) => {
    if (m.type() === 'error' && !ignorable(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

export interface OpenOptions {
  className?: string;
  mode?: 'model' | 'experiment' | 'results';
  view?: 'diagram' | 'code';
}

/** Opens `/workspaces/<wid>?class=&mode=&view=` and waits for the shell to be ready. */
export async function openWorkspace(page: Page, wid: string, opts: OpenOptions = {}): Promise<void> {
  const q = new URLSearchParams();
  if (opts.className) q.set('class', opts.className);
  if (opts.mode) q.set('mode', opts.mode);
  if (opts.view) q.set('view', opts.view);
  const qs = q.toString();
  await page.goto(`/workspaces/${encodeURIComponent(wid)}${qs ? `?${qs}` : ''}`);
  await expect(page.locator('.workspace-panel')).toBeVisible({ timeout: 30_000 });
  if (opts.className) {
    await expect(page.locator('.mode-button').first().locator('.mode-label')).toHaveText(opts.className.split('.').pop()!, { timeout: 30_000 });
    if (opts.view !== 'code') await expect(page.locator('[data-testid="execution-fab"]')).toBeVisible();
  }
}

export const modeLabels = (page: Page): Locator => page.locator('.mode-group .mode-button .mode-label');
export const detailsTabs = (page: Page): Locator => page.locator('.details-panel > .tabs [role="tab"]');
export const executionFab = (page: Page): Locator => page.getByTestId('execution-fab');
export const canvas = (page: Page): Locator => page.locator('.canvas');
export const treeRow = (page: Page, className: string): Locator => page.locator(`.wp-tree [data-name="${className}"]`);
/** A placed component (the selection's rotation handle carries `data-component` too, hence `g.component`). */
export const component = (page: Page, name: string): Locator => page.locator(`.diagram-svg g.component[data-component="${name}"]`);
export const components = (page: Page): Locator => page.locator('.diagram-svg g.component[data-component]');
export const port = (page: Page, ref: string): Locator => page.locator(`.diagram-svg [data-port="${ref}"]`);

/** Clicks the details-panel tab with the given label. */
export async function selectDetailsTab(page: Page, label: string): Promise<void> {
  const tab = detailsTabs(page).filter({ hasText: new RegExp(`^${label}$`) });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/** Expands a package row of the class tree (no-op when already expanded). */
export async function expandTreeNode(page: Page, className: string): Promise<void> {
  const row = treeRow(page, className);
  await expect(row).toBeVisible();
  if ((await row.getAttribute('aria-expanded')) !== 'true') {
    await row.locator('.wp-chevron').click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
  }
}

/**
 * Drops a library class onto the canvas at `at` (pixels relative to the canvas), the way the
 * tree's `dragstart` handler does it: a synthetic DataTransfer carrying
 * `application/x-modelica-class` = full class name, dispatched as dragenter/dragover/drop.
 * Native HTML5 drags are unreliable in headless Chromium, so the events are dispatched directly.
 */
export async function dropClassOnCanvas(page: Page, className: string, at: { x: number; y: number }): Promise<void> {
  const target = canvas(page);
  const box = await target.boundingBox();
  if (!box) throw new Error('Canvas is not visible');
  const clientX = Math.round(box.x + at.x);
  const clientY = Math.round(box.y + at.y);
  // Make sure the source row exists (the real product drags from it); the filter may hide it otherwise.
  await expect(treeRow(page, className)).toBeVisible();
  await target.evaluate(
    (el, { mime, cls, clientX: cx, clientY: cy }) => {
      const dt = new DataTransfer();
      dt.setData(mime, cls);
      dt.setData('text/plain', cls);
      const fire = (type: string) => {
        const ev = new DragEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy, dataTransfer: dt });
        el.dispatchEvent(ev);
      };
      fire('dragenter');
      fire('dragover');
      fire('drop');
    },
    { mime: CLASS_MIME, cls: className, clientX, clientY },
  );
}

/** Center of a locator's bounding box in page coordinates. */
export async function centerOf(locator: Locator): Promise<{ x: number; y: number }> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error('Element has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Pointer-drags from one port to another (creates a connection in Model mode). */
export async function connectPorts(page: Page, from: string, to: string): Promise<void> {
  const a = await centerOf(port(page, from));
  const b = await centerOf(port(page, to));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 5, a.y + 5, { steps: 2 });
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.move(b.x, b.y);
  await page.mouse.up();
}

/** Types into a details-panel parameter input and commits with Enter. */
export async function setParameterValue(page: Page, fullName: string, value: string): Promise<void> {
  const input = page.locator(`.param-row[data-name="${fullName}"] input[aria-label="${fullName}"]`);
  await expect(input).toBeVisible();
  await input.click();
  await input.fill(value);
  await input.press('Enter');
}

/** Waits until the execution FAB reports `done` after clicking it. */
export async function runSimulation(page: Page, timeout = 60_000): Promise<void> {
  const fab = executionFab(page);
  await expect(fab).toHaveAttribute('data-state', /idle|done/);
  const before = await fab.getAttribute('data-state');
  await fab.click();
  // A short run can finish between two polls; only insist on seeing `running` when the FAB was already `done`.
  if (before === 'done') await expect(fab).toHaveAttribute('data-state', 'running', { timeout: 10_000 });
  await expect(fab).toHaveAttribute('data-state', 'done', { timeout });
}
