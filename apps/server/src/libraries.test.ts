import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FileSystemListing, InstalledLibraryDto, LibraryBundleDto, Project, Workspace } from '@impact/protocol';
import { collectFromUpload, declaredClass, declaredVersion } from './library-import.js';
import { TMP_ROOT, api, firstWorkspaceId, items, startServer, stopServer, type TestServer } from './test-helpers.js';

/** A small directory library in the ThermoPower layout: package.mo + package.order + files + a sub-package + Resources. */
function makeExternalLibrary(): string {
  const root = fs.mkdtempSync(path.join(TMP_ROOT, 'impact-ext-'));
  const dir = path.join(root, 'ThermoLib 1.2');
  fs.mkdirSync(path.join(dir, 'Water'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'Resources', 'Scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'NotAPackage'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.mo'),
    'within ;\n// header comment\npackage ThermoLib "Thermal test library"\n  extends Modelica.Icons.Package;\n  constant Real x[3] = {i for i in 1:3};\n  annotation (version="1.2", uses(Modelica(version="4.0.0")));\nend ThermoLib;\n',
  );
  fs.writeFileSync(path.join(dir, 'package.order'), 'Pipe\nWater\n');
  fs.writeFileSync(path.join(dir, 'Pipe.mo'), 'within ThermoLib;\nmodel Pipe "A pipe"\n  parameter Real L = 1;\nend Pipe;\n');
  fs.writeFileSync(path.join(dir, 'Water', 'package.mo'), 'within ThermoLib;\npackage Water\nend Water;\n');
  fs.writeFileSync(path.join(dir, 'Water', 'Tank.mo'), 'within ThermoLib.Water;\nmodel Tank\nend Tank;\n');
  fs.writeFileSync(path.join(dir, 'Resources', 'Scripts', 'x.mo'), 'model Stray\nend Stray;\n');
  fs.writeFileSync(path.join(dir, 'NotAPackage', 'y.mo'), 'model Stray2\nend Stray2;\n');
  fs.writeFileSync(path.join(dir, 'Resources', 'logo.png'), 'png');
  return dir;
}

describe('library import helpers', () => {
  it('reads the declared class name, description and version', () => {
    expect(declaredClass('within ;\n/* c */ // d\nencapsulated package A_1 "Doc \\"q\\""\nend A_1;')).toEqual({ name: 'A_1', description: 'Doc "q"' });
    expect(declaredClass('within Foo.Bar;\npartial model M\nend M;')).toEqual({ name: 'M' });
    expect(declaredVersion('package P annotation(conversion(from(version="1.0")), version="2.1.0", versionDate="x"); end P;')).toBe('2.1.0');
    expect(declaredVersion('package P end P;')).toBeUndefined();
  });

  it('collects an uploaded folder from its package.mo and skips non-package directories', () => {
    const lib = collectFromUpload([
      { path: 'Lib/package.mo', text: 'package Lib\nend Lib;' },
      { path: 'Lib/A.mo', text: 'within Lib; model A end A;' },
      { path: 'Lib/Sub/package.mo', text: 'within Lib; package Sub end Sub;' },
      { path: 'Lib/Sub/B.mo', text: 'within Lib.Sub; model B end B;' },
      { path: 'Lib/Resources/C.mo', text: 'model C end C;' },
      { path: 'Lib/readme.txt', text: 'hi' },
    ]);
    expect(lib.name).toBe('Lib');
    expect(lib.relpath).toBe('Lib/');
    expect(lib.files.map((f) => f.path).sort()).toEqual(['Lib/A.mo', 'Lib/Sub/B.mo', 'Lib/Sub/package.mo', 'Lib/package.mo']);
    const single = collectFromUpload([{ path: 'Single.mo', text: 'package Single\nend Single;' }]);
    expect(single).toMatchObject({ name: 'Single', relpath: 'Single.mo' });
    expect(() => collectFromUpload([{ path: 'a.txt', text: '' }])).toThrow(/package\.mo/);
    expect(() => collectFromUpload([{ path: '../x/package.mo', text: 'package x end x;' }])).toThrow(/Invalid file path/);
  });
});

describe('installed libraries & workspace dependencies', () => {
  let t: TestServer;
  let wid: string;
  let extDir: string;
  beforeAll(async () => {
    t = await startServer();
    wid = await firstWorkspaceId(t.base);
    extDir = makeExternalLibrary();
  });
  afterAll(async () => {
    await stopServer(t);
    fs.rmSync(path.dirname(extDir), { recursive: true, force: true });
  });

  it('browses server directories showing folders and .mo files only', async () => {
    const r = await api<FileSystemListing>(t.base, 'GET', `/api/filesystem?path=${encodeURIComponent(extDir)}`);
    expect(r.status).toBe(200);
    expect(r.body.path).toBe(extDir);
    expect(r.body.parent).toBe(path.dirname(extDir));
    expect(r.body.entries.map((e) => `${e.kind}:${e.name}`)).toEqual(['directory:NotAPackage', 'directory:Resources', 'directory:Water', 'file:package.mo', 'file:Pipe.mo']);
    expect(r.body.entries.find((e) => e.name === 'Water')?.modelicaPackage).toBe(true);
    const home = await api<FileSystemListing>(t.base, 'GET', '/api/filesystem');
    expect(home.status).toBe(200);
    expect(path.isAbsolute(home.body.path)).toBe(true);
    expect((await api(t.base, 'GET', '/api/filesystem?path=relative/dir')).status).toBe(400);
    expect((await api(t.base, 'GET', `/api/filesystem?path=${encodeURIComponent(path.join(extDir, 'missing'))}`)).status).toBe(404);
  });

  it('imports a library from its package.mo, adds it to the workspace and serves it as a read-only bundle', async () => {
    const r = await api<InstalledLibraryDto>(t.base, 'POST', '/api/libraries', { path: path.join(extDir, 'package.mo'), workspaceId: wid });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ name: 'ThermoLib', version: '1.2', description: 'Thermal test library', projectType: 'RELEASED', fileCount: 4 });
    expect(r.body.usedIn.map((w) => w.id)).toEqual([wid]);
    const lid = r.body.id;

    const deps = items(await api<{ data: { items: Project[] } }>(t.base, 'GET', `/api/workspaces/${wid}/dependencies`));
    expect(deps.map((d) => d.definition.name)).toEqual(['Modelica', 'ThermoLib']);

    const libs = items(await api<{ data: { items: LibraryBundleDto[] } }>(t.base, 'GET', `/api/workspaces/${wid}/libraries`));
    const bundle = libs.find((l) => l.libraryId === lid)!;
    expect(bundle.readOnly).toBe(true);
    expect(bundle.files.map((f) => f.path).sort()).toEqual(['ThermoLib/Pipe.mo', 'ThermoLib/Water/Tank.mo', 'ThermoLib/Water/package.mo', 'ThermoLib/package.mo']);

    // The classes are browsable and read-only.
    const tree = await api<{ data: { items: { name: string }[] } }>(t.base, 'GET', `/api/workspaces/${wid}/classes?parent=ThermoLib`);
    expect(items(tree).map((n) => n.name)).toEqual(['ThermoLib.Pipe', 'ThermoLib.Water']);
    const edit = await api(t.base, 'PUT', `/api/workspaces/${wid}/classes/ThermoLib.Pipe/source`, { text: 'within ThermoLib;\nmodel Pipe\nend Pipe;\n' });
    expect(edit.status).toBe(403);

    // Listed with its usage; importing the same name again is a conflict.
    const all = items(await api<{ data: { items: InstalledLibraryDto[] } }>(t.base, 'GET', '/api/libraries'));
    expect(all.map((l) => l.name)).toEqual(['Modelica', 'ThermoLib']);
    const again = await api<{ error: { code: string } }>(t.base, 'POST', '/api/libraries', { path: extDir });
    expect(again.status).toBe(409);
  });

  it('removes (unloads) and re-adds a library in a workspace', async () => {
    const lid = items(await api<{ data: { items: InstalledLibraryDto[] } }>(t.base, 'GET', '/api/libraries')).find((l) => l.name === 'ThermoLib')!.id;
    expect((await api(t.base, 'DELETE', `/api/workspaces/${wid}/dependencies/${lid}`)).status).toBe(204);
    let libs = items(await api<{ data: { items: LibraryBundleDto[] } }>(t.base, 'GET', `/api/workspaces/${wid}/libraries`));
    expect(libs.some((l) => l.libraryId === lid)).toBe(false);
    expect((await api(t.base, 'GET', `/api/workspaces/${wid}/classes/ThermoLib.Pipe/source`)).status).toBe(404);
    expect((await api(t.base, 'DELETE', `/api/workspaces/${wid}/dependencies/${lid}`)).status).toBe(404);
    expect((await api(t.base, 'DELETE', `/api/workspaces/${wid}/dependencies/modelica`)).status).toBe(400);

    expect((await api(t.base, 'PUT', `/api/workspaces/${wid}/dependencies/${lid}`)).status).toBe(200);
    libs = items(await api<{ data: { items: LibraryBundleDto[] } }>(t.base, 'GET', `/api/workspaces/${wid}/libraries`));
    expect(libs.some((l) => l.libraryId === lid)).toBe(true);
    const ws = (await api<Workspace>(t.base, 'GET', `/api/workspaces/${wid}`)).body;
    expect(ws.definition.dependencies.map((d) => d.reference.id)).toEqual(['modelica', lid]);
  });

  it('rejects a library whose name is already loaded in the workspace without installing it', async () => {
    const r = await api<{ error: { code: string; message: string } }>(t.base, 'POST', '/api/libraries', {
      files: [{ path: 'Examples/package.mo', text: 'package Examples\nend Examples;\n' }],
      workspaceId: wid,
    });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/already loaded/);
    const all = items(await api<{ data: { items: InstalledLibraryDto[] } }>(t.base, 'GET', '/api/libraries'));
    expect(all.some((l) => l.name === 'Examples')).toBe(false);
  });

  it('imports uploaded files and deletes an installed library from every workspace', async () => {
    const other = (await api<Workspace>(t.base, 'POST', '/api/workspaces', { new: { name: 'Other' } })).body;
    const up = await api<InstalledLibraryDto>(t.base, 'POST', '/api/libraries', { files: [{ path: 'Uploaded.mo', text: 'package Uploaded\n  model M\n  end M;\nend Uploaded;\n' }] });
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ name: 'Uploaded', source: 'upload', usedIn: [] });
    expect((await api(t.base, 'PUT', `/api/workspaces/${wid}/dependencies/${up.body.id}`)).status).toBe(200);
    expect((await api(t.base, 'PUT', `/api/workspaces/${other.id}/dependencies/${up.body.id}`)).status).toBe(200);
    const listed = items(await api<{ data: { items: InstalledLibraryDto[] } }>(t.base, 'GET', '/api/libraries')).find((l) => l.id === up.body.id)!;
    expect(listed.usedIn.map((w) => w.name).sort()).toEqual(['Default', 'Other']);

    expect((await api(t.base, 'DELETE', `/api/libraries/${up.body.id}`)).status).toBe(204);
    for (const w of [wid, other.id]) {
      const libs = items(await api<{ data: { items: LibraryBundleDto[] } }>(t.base, 'GET', `/api/workspaces/${w}/libraries`));
      expect(libs.some((l) => l.name === 'Uploaded')).toBe(false);
    }
    expect(fs.existsSync(path.join(t.dataDir, 'libraries', up.body.id))).toBe(false);
    expect((await api(t.base, 'DELETE', `/api/libraries/${up.body.id}`)).status).toBe(404);
    expect((await api(t.base, 'DELETE', '/api/libraries/modelica')).status).toBe(400);
  });
});

describe('server file access disabled', () => {
  let t: TestServer;
  beforeAll(async () => {
    t = await startServer({ serverFileAccess: false });
  });
  afterAll(() => stopServer(t));

  it('refuses browsing and path imports but accepts uploads', async () => {
    expect((await api(t.base, 'GET', '/api/filesystem')).status).toBe(403);
    expect((await api(t.base, 'POST', '/api/libraries', { path: '/tmp' })).status).toBe(403);
    expect((await api(t.base, 'POST', '/api/libraries', { files: [{ path: 'U.mo', text: 'package U end U;' }] })).status).toBe(201);
  });
});
