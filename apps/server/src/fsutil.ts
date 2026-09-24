/**
 * Small synchronous filesystem helpers: atomic JSON/text writes, recursive copy, listing
 * and directory size. Synchronous I/O keeps every request handler a single consistent
 * transaction against the on-disk store.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export function exists(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

/** Writes `text` to `file` via a temp file + rename so readers never observe a partial file. */
export function writeTextAtomic(file: string, text: string): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw e;
  }
}

export function writeJsonAtomic(file: string, value: unknown, pretty = true): void {
  writeTextAtomic(file, pretty ? JSON.stringify(value, null, 2) + '\n' : JSON.stringify(value));
}

export function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
}

export function readJson<T>(file: string): T | undefined {
  const text = readText(file);
  if (text === undefined) return undefined;
  return JSON.parse(text) as T;
}

export function removeRecursive(p: string): void {
  fs.rmSync(p, { recursive: true, force: true });
}

export function removeFile(p: string): void {
  try {
    fs.unlinkSync(p);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}

/** Sorted directory entries (names only); empty when the directory does not exist. */
export function listDir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

/** Sub-directory names of `dir`, sorted. */
export function listSubdirs(dir: string): string[] {
  return listDir(dir)
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

/** All files under `dir` as paths relative to `dir` (forward slashes), sorted. */
export function listFilesRecursive(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of listDir(dir)) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFilesRecursive(path.join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

/** Copies the contents of `src` into `dest` (created if needed). */
export function copyDirContents(src: string, dest: string): void {
  ensureDir(dest);
  for (const entry of listDir(src)) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirContents(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

export function dirSize(dir: string): number {
  let total = 0;
  for (const entry of listDir(dir)) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(p);
    else if (entry.isFile()) total += fs.statSync(p).size;
  }
  return total;
}

/** Normalises a relative path to forward slashes without leading `./`. */
export function toPosix(p: string): string {
  return p.split(path.sep).join('/').replace(/^\.\//, '');
}

/**
 * Rejects paths that would escape their root (`..`, absolute, empty segments). One trailing
 * separator is allowed: directory libraries/packages are addressed as `Examples/`.
 */
export function isSafeRelative(p: string): boolean {
  if (!p || path.isAbsolute(p)) return false;
  const trimmed = p.replace(/[\\/]$/, '');
  if (!trimmed) return false;
  const parts = trimmed.split(/[\\/]/);
  return parts.every((s) => s !== '..' && s !== '');
}
