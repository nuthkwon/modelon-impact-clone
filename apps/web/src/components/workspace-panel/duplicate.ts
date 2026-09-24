/**
 * Text helpers for "Duplicate to…": copy the source text of a class, rename its header and
 * `end` clause and splice it over the stub the server creates for the new class.
 */
import { printClass } from '@impact/core';
import type { ClassDef } from '@impact/core';

const RESTRICTION_KEYWORDS = 'package|model|block|connector|record|type|function|operator|class';

/** Source text of `def` inside `fileText` (from its first keyword through the trailing `;`). */
export function extractClassText(fileText: string, def: ClassDef): string | undefined {
  const loc = def.loc;
  if (!loc || loc.offset < 0 || loc.offset + loc.length > fileText.length) return undefined;
  let text = fileText.slice(loc.offset, loc.offset + loc.length);
  if (!text.trim()) return undefined;
  if (!/;\s*$/.test(text)) text = `${text.replace(/\s+$/, '')};`;
  return text;
}

/** Renames the class in `text` (its header name and its `end Name;`). `text` must start at `def.loc`. */
export function renameClassText(text: string, def: ClassDef, newName: string): string {
  const old = def.name;
  let out = text;
  let renamedHeader = false;
  if (def.nameLoc && def.loc) {
    const rel = def.nameLoc.offset - def.loc.offset;
    if (rel >= 0 && out.slice(rel, rel + old.length) === old) {
      out = out.slice(0, rel) + newName + out.slice(rel + old.length);
      renamedHeader = true;
    }
  }
  if (!renamedHeader) {
    const header = new RegExp(`^((?:\\s*(?:final|encapsulated|partial|expandable|replaceable|operator|inner|outer)\\s+)*(?:${RESTRICTION_KEYWORDS})\\s+)${escapeRe(old)}\\b`);
    out = out.replace(header, `$1${newName}`);
  }
  // Closing clause (absent for short class definitions).
  out = out.replace(new RegExp(`\\bend\\s+${escapeRe(old)}\\s*(;?)(\\s*)$`), `end ${newName}$1$2`);
  return out;
}

/**
 * Re-indents a multi-line class text: the base indentation (that of its last line) is removed
 * from every line after the first and `indent` is added instead.
 */
export function reindent(text: string, indent: string): string {
  const lines = text.split('\n');
  if (lines.length < 2) return text;
  const last = lines[lines.length - 1];
  let base = /^[ \t]*/.exec(last)?.[0] ?? '';
  if (!last.trim()) {
    let min: string | undefined;
    for (const l of lines.slice(1)) {
      if (!l.trim()) continue;
      const ws = /^[ \t]*/.exec(l)?.[0] ?? '';
      if (min === undefined || ws.length < min.length) min = ws;
    }
    base = min ?? '';
  }
  return lines
    .map((l, i) => {
      if (i === 0) return l;
      if (!l.trim()) return '';
      return indent + (l.startsWith(base) ? l.slice(base.length) : l.replace(/^[ \t]*/, ''));
    })
    .join('\n');
}

/** Replaces the text of `stub` (located through `stub.loc`) inside `fileText` with `classText`, keeping the stub's indentation. */
export function replaceClassInFile(fileText: string, stub: ClassDef, classText: string): string | undefined {
  const loc = stub.loc;
  if (!loc || loc.offset < 0 || loc.offset + loc.length > fileText.length) return undefined;
  const lineStart = fileText.lastIndexOf('\n', loc.offset - 1) + 1;
  const before = fileText.slice(lineStart, loc.offset);
  const indent = /^[ \t]*$/.test(before) ? before : '';
  let end = loc.offset + loc.length;
  // The stub's loc may stop right before its `;` (top-level classes): swallow it.
  if (fileText[end] === ';' && !/;\s*$/.test(fileText.slice(loc.offset, end))) end += 1;
  return fileText.slice(0, loc.offset) + reindent(classText, indent) + fileText.slice(end);
}

/**
 * Text of a copy of `original` named `newName`: the original source (renamed) when the file
 * text and locations are available, otherwise the pretty-printed AST.
 */
export function duplicateClassText(original: ClassDef, fileText: string | undefined, newName: string): string {
  if (fileText !== undefined) {
    const src = extractClassText(fileText, original);
    if (src) {
      const renamed = renameClassText(src, original, newName);
      if (renamed !== src || original.name === newName) return renamed;
    }
  }
  let printed = printClass({ ...original, name: newName });
  if (!/;\s*$/.test(printed)) printed = `${printed.replace(/\s+$/, '')};`;
  return printed;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
