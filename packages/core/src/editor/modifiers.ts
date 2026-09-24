/**
 * Path-based access to nested modifications. A dotted parameter path such as `i.start` may be
 * written flat (`i.start = 1`) or nested (`i(start = 1)`); these helpers find and update either
 * form in place and create the nested form when the path is new.
 */
import type { Expr, Modification, Modifier } from '../ast.js';

function pathParts(m: Modifier): string[] {
  return m.name.split('.');
}

function isPrefix(parts: string[], path: string[]): boolean {
  return parts.length <= path.length && parts.every((p, i) => p === path[i]);
}

/** The modifier addressed by `path` (`['i', 'start']`), whichever form it is written in. */
export function findModifierPath(mod: Modification | undefined, path: string[]): Modifier | undefined {
  if (!mod || !path.length) return undefined;
  for (const m of mod.mods) {
    if (m.redeclare) continue;
    const parts = pathParts(m);
    if (!isPrefix(parts, path)) continue;
    if (parts.length === path.length) return m;
    const found = findModifierPath(m.modification, path.slice(parts.length));
    if (found) return found;
  }
  return undefined;
}

/** Every modifier along `path` that exists (outermost first) — used to check `final`. */
export function modifiersAlongPath(mod: Modification | undefined, path: string[]): Modifier[] {
  const out: Modifier[] = [];
  let cur = mod;
  let rest = path;
  while (cur && rest.length) {
    const m = cur.mods.find((x) => !x.redeclare && isPrefix(pathParts(x), rest));
    if (!m) break;
    out.push(m);
    rest = rest.slice(pathParts(m).length);
    cur = m.modification;
  }
  return out;
}

/**
 * Sets `path = value`. An existing modifier (flat or nested) is updated in place; otherwise the
 * deepest existing prefix is extended with nested modifiers (`i(start = value)`).
 */
export function setModifierValue(mod: Modification, path: string[], value: Expr): void {
  const existing = findModifierPath(mod, path);
  if (existing) {
    existing.modification.value = value;
    return;
  }
  let cur = mod;
  let rest = path;
  for (;;) {
    const next = cur.mods.find((m) => !m.redeclare && pathParts(m).length < rest.length && isPrefix(pathParts(m), rest));
    if (!next) break;
    rest = rest.slice(pathParts(next).length);
    cur = next.modification;
  }
  let leaf: Modifier = { name: rest[rest.length - 1], modification: { mods: [], value } };
  for (let i = rest.length - 2; i >= 0; i--) leaf = { name: rest[i], modification: { mods: [leaf] } };
  cur.mods.push(leaf);
}

/**
 * Removes the value at `path`. A leaf without nested modifiers is dropped entirely and parents
 * left empty are dropped too; a leaf that still has nested modifiers (`R(start=1) = 5` → remove
 * `R`) only loses its `= value`. Returns true when something was removed.
 */
export function removeModifierPath(mod: Modification | undefined, path: string[]): boolean {
  if (!mod || !path.length) return false;
  for (let idx = 0; idx < mod.mods.length; idx++) {
    const m = mod.mods[idx];
    if (m.redeclare) continue;
    const parts = pathParts(m);
    if (!isPrefix(parts, path)) continue;
    if (parts.length === path.length) {
      if (m.modification.mods.length) {
        if (m.modification.value === undefined) continue;
        delete m.modification.value;
        return true;
      }
      mod.mods.splice(idx, 1);
      return true;
    }
    if (removeModifierPath(m.modification, path.slice(parts.length))) {
      if (isEmptyModification(m.modification)) mod.mods.splice(idx, 1);
      return true;
    }
  }
  return false;
}

export function isEmptyModification(mod: Modification | undefined): boolean {
  return !mod || (mod.mods.length === 0 && mod.value === undefined);
}
