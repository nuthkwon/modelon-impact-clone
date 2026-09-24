/**
 * Collecting an external Modelica library for import (Workspace Management → Libraries →
 * Import): from a path on the server — a `package.mo`, a directory holding one, or a
 * single-file library `Name.mo` — or from uploaded files. Only Modelica sources are taken:
 * `.mo` files and `package.order`, inside directories that are Modelica packages (hold a
 * `package.mo`, Modelica spec §13.4). Resources, documentation images, hidden directories and
 * symbolic links are skipped.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FileSystemEntry, FileSystemListing } from '@impact/protocol';
import { badRequest, notFound } from './errors.js';
import { isDirectory, isFile, isSafeRelative, listDir, readText } from './fsutil.js';

/** A library source file; `path` is relative to the library container, e.g. `ThermoPower/Water.mo` or `MyLib.mo`. */
export interface LibraryFile {
  path: string;
  text: string;
}

export interface CollectedLibrary {
  /** Top-level class name. */
  name: string;
  /** `Name/` (directory package) or `Name.mo` (single file). */
  relpath: string;
  files: LibraryFile[];
  version?: string;
  description?: string;
}

export const MAX_LIBRARY_FILES = 20000;
export const MAX_LIBRARY_BYTES = 256 * 1024 * 1024;

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CLASS_HEADER =
  /^\s*(?:final\s+)?(?:encapsulated\s+)?(?:partial\s+)?(?:expandable\s+|operator\s+|pure\s+|impure\s+)?(?:package|model|block|connector|record|type|function|class|operator)\s+([A-Za-z_][A-Za-z0-9_]*)\s*("(?:[^"\\]|\\.)*")?/;

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/** Name (and description string) of the first class declared in a Modelica file, skipping comments and the `within` clause. */
export function declaredClass(text: string): { name: string; description?: string } | undefined {
  const body = stripComments(text).replace(/^\s*within\s*[A-Za-z0-9_.]*\s*;/, '');
  const m = CLASS_HEADER.exec(body);
  if (!m) return undefined;
  const description = m[2] ? m[2].slice(1, -1).replace(/\\(.)/g, '$1') : undefined;
  return { name: m[1], ...(description ? { description } : {}) };
}

/** Removes the balanced `name(...)` calls from `text` (strings are skipped while matching parentheses). */
function removeCalls(text: string, names: string[]): string {
  const re = new RegExp(`(?<![\\w.])(?:${names.join('|')})\\s*\\(`, 'g');
  let out = '';
  let pos = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < text.length && depth > 0; i++) {
      const ch = text[i];
      if (ch === '"') {
        for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
      } else if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    out += text.slice(pos, m.index);
    pos = i;
    re.lastIndex = i;
  }
  return out + text.slice(pos);
}

/** `version` annotation of a library's top-level file: the last `version = "…"` outside `uses(...)`/`conversion(...)`. */
export function declaredVersion(text: string): string | undefined {
  const re = /(?<![\w.])version\s*=\s*"([^"]*)"/g;
  const body = removeCalls(stripComments(text), ['uses', 'conversion']);
  let last: string | undefined;
  for (let m = re.exec(body); m; m = re.exec(body)) last = m[1];
  return last || undefined;
}

class Budget {
  files = 0;
  bytes = 0;
  add(size: number): void {
    this.files++;
    this.bytes += size;
    if (this.files > MAX_LIBRARY_FILES) throw badRequest(`The library has more than ${MAX_LIBRARY_FILES} Modelica files`);
    if (this.bytes > MAX_LIBRARY_BYTES) throw badRequest(`The library's Modelica sources exceed ${MAX_LIBRARY_BYTES / 1024 / 1024} MB`);
  }
}

function libraryName(declared: string | undefined, fallback: string, what: string): string {
  // Directory names may carry a version (`ThermoPower 3.1`); the declared class name wins.
  const name = declared ?? /^[A-Za-z_][A-Za-z0-9_]*/.exec(fallback)?.[0];
  if (!name || !IDENT.test(name)) throw badRequest(`Cannot determine the library name of ${what}`);
  return name;
}

function finish(name: string, relpath: string, files: LibraryFile[], topText: string): CollectedLibrary {
  const declared = declaredClass(topText);
  const version = declaredVersion(topText);
  return { name, relpath, files, ...(version ? { version } : {}), ...(declared?.description ? { description: declared.description } : {}) };
}

/** Reads `.mo` files and `package.order` of a package directory, descending only into sub-packages. */
function walkPackageDir(absDir: string, relDir: string, out: LibraryFile[], budget: Budget): void {
  for (const entry of listDir(absDir)) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (isFile(path.join(abs, 'package.mo'))) walkPackageDir(abs, `${relDir}${entry.name}/`, out, budget);
    } else if (entry.isFile() && (entry.name.endsWith('.mo') || entry.name === 'package.order')) {
      const text = readText(abs) ?? '';
      budget.add(Buffer.byteLength(text));
      out.push({ path: `${relDir}${entry.name}`, text });
    }
  }
}

/**
 * Collects a library from a server path: `…/Lib/package.mo` or `…/Lib` (the directory
 * package `Lib`) or `…/Lib.mo` (a single-file library).
 */
export function collectFromPath(p: string): CollectedLibrary {
  if (!p || !path.isAbsolute(p)) throw badRequest('path must be an absolute path on the server');
  const abs = path.resolve(p);
  let pkgDir: string | undefined;
  if (isDirectory(abs)) {
    if (!isFile(path.join(abs, 'package.mo'))) throw badRequest(`'${abs}' is not a Modelica package directory (no package.mo)`);
    pkgDir = abs;
  } else if (isFile(abs)) {
    if (!abs.toLowerCase().endsWith('.mo')) throw badRequest(`'${path.basename(abs)}' is not a Modelica file (.mo)`);
    if (path.basename(abs) === 'package.mo') pkgDir = path.dirname(abs);
  } else {
    throw notFound(`'${abs}' does not exist`);
  }

  if (pkgDir) {
    const topText = readText(path.join(pkgDir, 'package.mo')) ?? '';
    const name = libraryName(declaredClass(topText)?.name, path.basename(pkgDir), `'${pkgDir}'`);
    const files: LibraryFile[] = [];
    walkPackageDir(pkgDir, `${name}/`, files, new Budget());
    return finish(name, `${name}/`, files, topText);
  }
  const text = readText(abs) ?? '';
  new Budget().add(Buffer.byteLength(text));
  const name = libraryName(declaredClass(text)?.name, path.basename(abs, path.extname(abs)), `'${abs}'`);
  return finish(name, `${name}.mo`, [{ path: `${name}.mo`, text }], text);
}

/**
 * Collects a library from uploaded files (a folder upload keeps paths such as
 * `ThermoPower/package.mo`; a single `.mo` file is a single-file library). The shallowest
 * `package.mo` marks the library root.
 */
export function collectFromUpload(uploaded: { path: string; text: string }[]): CollectedLibrary {
  const budget = new Budget();
  const files = uploaded.map((f) => {
    const p = f.path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!isSafeRelative(p)) throw badRequest(`Invalid file path '${f.path}'`);
    return { path: p, text: f.text };
  });
  const packages = files.filter((f) => f.path === 'package.mo' || f.path.endsWith('/package.mo'));
  if (packages.length) {
    const top = packages.reduce((a, b) => (a.path.split('/').length <= b.path.split('/').length ? a : b));
    const rootDir = top.path.slice(0, -'package.mo'.length); // '' or 'ThermoPower/' (or 'x/ThermoPower/')
    const name = libraryName(declaredClass(top.text)?.name, rootDir.split('/').filter(Boolean).pop() ?? '', 'the uploaded package');
    const packageDirs = new Set(packages.map((f) => f.path.slice(0, -'package.mo'.length)));
    const out: LibraryFile[] = [];
    for (const f of files) {
      if (!f.path.startsWith(rootDir)) continue;
      const rel = f.path.slice(rootDir.length);
      const base = rel.split('/').pop()!;
      if (!(base.endsWith('.mo') || base === 'package.order') || rel.split('/').some((s) => s.startsWith('.'))) continue;
      // Every directory between the root and the file must be a package.
      const dirs = rel.split('/').slice(0, -1);
      let ok = true;
      for (let i = 1; i <= dirs.length && ok; i++) ok = packageDirs.has(rootDir + dirs.slice(0, i).join('/') + '/');
      if (!ok) continue;
      budget.add(Buffer.byteLength(f.text));
      out.push({ path: `${name}/${rel}`, text: f.text });
    }
    return finish(name, `${name}/`, out, top.text);
  }
  const mo = files.filter((f) => f.path.endsWith('.mo'));
  if (mo.length !== 1) throw badRequest('Select a library folder containing package.mo, or a single .mo file');
  budget.add(Buffer.byteLength(mo[0].text));
  const name = libraryName(declaredClass(mo[0].text)?.name, path.posix.basename(mo[0].path, '.mo'), `'${mo[0].path}'`);
  return finish(name, `${name}.mo`, [{ path: `${name}.mo`, text: mo[0].text }], mo[0].text);
}

// ---------------------------------------------------------------------------------------
// Server file browser (the Import library explorer)
// ---------------------------------------------------------------------------------------

function filesystemRoots(): string[] {
  if (process.platform !== 'win32') return ['/'];
  const roots: string[] = [];
  for (let c = 65; c <= 90; c++) {
    const drive = `${String.fromCharCode(c)}:\\`;
    try {
      fs.accessSync(drive);
      roots.push(drive);
    } catch {
      /* no such drive */
    }
  }
  return roots;
}

/** Directories and `.mo` files of `dir` (default: the home directory), directories first. */
export function listDirectory(dir: string | undefined): FileSystemListing {
  const home = os.homedir();
  const raw = dir?.trim() || home;
  if (!path.isAbsolute(raw)) throw badRequest('path must be an absolute path on the server');
  const target = path.resolve(raw);
  if (!isDirectory(target)) throw notFound(`Directory '${target}' does not exist`);
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(target, { withFileTypes: true });
  } catch (e) {
    throw badRequest(`Cannot read '${target}': ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
  }
  const entries: FileSystemEntry[] = [];
  for (const d of dirents) {
    if (d.name.startsWith('.')) continue;
    const p = path.join(target, d.name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(p); // follows links, so linked folders can be browsed
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      entries.push({ name: d.name, path: p, kind: 'directory', modelicaPackage: isFile(path.join(p, 'package.mo')), modifiedAt: stat.mtime.toISOString() });
    } else if (stat.isFile() && d.name.toLowerCase().endsWith('.mo')) {
      entries.push({ name: d.name, path: p, kind: 'file', size: stat.size, modifiedAt: stat.mtime.toISOString() });
    }
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  entries.sort((a, b) => (a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === 'directory' ? -1 : 1));
  const parent = path.dirname(target);
  return { path: target, ...(parent !== target ? { parent } : {}), roots: filesystemRoots(), home, separator: path.sep, entries };
}
