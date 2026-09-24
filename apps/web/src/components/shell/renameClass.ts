/**
 * Class rename.
 *
 * - A class nested in a file together with its parent (`package Examples … model Old … end Old; end Examples;`)
 *   is renamed in place: the header (`model Old`) and its matching `end Old;` are rewritten and the
 *   file is saved through `saveClassSource`.
 * - A class stored in its own `within` file (`Examples/Old.mo`) is moved: the server creates the new
 *   file (`createClass`), the renamed text replaces the stub (`saveClassSource`) and the old class is
 *   deleted (`deleteClass`), so file names and `package.order` stay consistent server-side.
 * Top-level classes (library roots) cannot be renamed. References to the class elsewhere are not rewritten.
 */
import type { RegisteredClass } from '@impact/core';
import type { CreateClassRequest } from '@impact/protocol';
import { useStore } from '../../store';

export const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const CREATABLE: CreateClassRequest['restriction'][] = ['model', 'package', 'block', 'connector', 'record', 'type', 'function'];

export interface RenameOutcome {
  ok: boolean;
  newName?: string;
  error?: string;
}

/** True when `cls` is the only top-level declaration of a `within` file named after it (`Pkg/Cls.mo`). */
function isOwnFile(cls: RegisteredClass): boolean {
  const file = useStore.getState().registry.fileOf(cls.fullName);
  if (!file) return false;
  const base = file.path.split('/').pop() ?? file.path;
  return file.definition.within === cls.parentName && base !== 'package.mo' && base.replace(/\.mo$/, '') === cls.def.name && file.classNames.length === 1;
}

export function canRenameClass(fullName: string): { ok: boolean; reason?: string } {
  const s = useStore.getState();
  const cls = s.registry.get(fullName);
  if (!cls) return { ok: false, reason: `Unknown class ${fullName}` };
  if (s.isReadOnly(fullName)) return { ok: false, reason: 'Classes of read-only libraries cannot be renamed.' };
  if (!cls.parentName) return { ok: false, reason: 'Top-level classes (library roots) cannot be renamed in this clone.' };
  if (!s.registry.fileOf(fullName)) return { ok: false, reason: 'The declaring file could not be found.' };
  if (isOwnFile(cls) && !CREATABLE.includes(cls.def.restriction as CreateClassRequest['restriction'])) return { ok: false, reason: `${cls.def.restriction} classes stored in their own file cannot be renamed in this clone.` };
  return { ok: true };
}

/** Rewrites the class header name and its `end Name;` inside `text`. */
function rewriteClassName(text: string, cls: RegisteredClass, newShortName: string): { text: string } | { error: string } {
  const oldShort = cls.def.name;
  const nameLoc = cls.def.nameLoc;
  let headerStart: number;
  let headerEnd: number;
  if (nameLoc && text.slice(nameLoc.offset, nameLoc.offset + nameLoc.length) === oldShort) {
    headerStart = nameLoc.offset;
    headerEnd = nameLoc.offset + nameLoc.length;
  } else {
    const from = cls.def.loc?.offset ?? 0;
    const re = new RegExp(`\\b(?:package|model|block|connector|record|type|function|class|operator)\\s+(${oldShort})\\b`, 'g');
    re.lastIndex = from;
    const m = re.exec(text);
    if (!m) return { error: 'Could not locate the class declaration in the file.' };
    headerStart = m.index + m[0].length - oldShort.length;
    headerEnd = m.index + m[0].length;
  }
  let out = `${text.slice(0, headerStart)}${newShortName}${text.slice(headerEnd)}`;
  if (!cls.def.shortClass) {
    // The first `end Old;` after the header closes this class (nested classes cannot share its name).
    const endRe = new RegExp(`\\bend\\s+${oldShort}\\s*;`, 'g');
    endRe.lastIndex = headerStart + newShortName.length;
    const em = endRe.exec(out);
    if (!em) return { error: `Could not locate "end ${oldShort};" in the file.` };
    out = `${out.slice(0, em.index)}end ${newShortName};${out.slice(em.index + em[0].length)}`;
  }
  return { text: out };
}

export async function renameClass(fullName: string, newShortName: string): Promise<RenameOutcome> {
  const s = useStore.getState();
  const check = canRenameClass(fullName);
  if (!check.ok) return { ok: false, error: check.reason };
  const cls = s.registry.get(fullName)!;
  const file = s.registry.fileOf(fullName)!;
  if (!IDENTIFIER_RE.test(newShortName)) return { ok: false, error: 'Name must be a valid Modelica identifier.' };
  if (newShortName === cls.def.name) return { ok: true, newName: fullName };
  const newName = `${cls.parentName}.${newShortName}`;
  if (s.registry.has(newName)) return { ok: false, error: `${newName} already exists.` };

  const rewritten = rewriteClassName(file.text, cls, newShortName);
  if ('error' in rewritten) return { ok: false, error: rewritten.error };

  const wasActive = s.activeClass === fullName;
  if (isOwnFile(cls)) {
    // Move: new file via the server, renamed text into it, then drop the old class.
    try {
      await s.createClass({ className: newName, restriction: cls.def.restriction as CreateClassRequest['restriction'], libraryId: cls.libraryId, description: cls.def.description });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    const res = await useStore.getState().saveClassSource(newName, rewritten.text);
    if (!res.ok) {
      await useStore.getState().deleteClass(newName).catch(() => undefined);
      return { ok: false, error: res.diagnostics[0]?.message ?? 'Saving failed.' };
    }
    try {
      await useStore.getState().deleteClass(fullName);
    } catch (e) {
      return { ok: false, error: `Renamed copy created, but the old class could not be deleted: ${e instanceof Error ? e.message : String(e)}` };
    }
  } else {
    const res = await s.saveClassSource(fullName, rewritten.text);
    if (!res.ok) return { ok: false, error: res.diagnostics[0]?.message ?? 'Saving failed.' };
  }

  const after = useStore.getState();
  if (!after.registry.has(newName)) return { ok: false, error: 'The renamed class was not found after saving.' };
  if (wasActive || after.activeClass === undefined || !after.registry.has(after.activeClass)) {
    if (after.activeClass === newName) after.refreshDiagram();
    else after.openClass(newName);
  }
  return { ok: true, newName };
}
