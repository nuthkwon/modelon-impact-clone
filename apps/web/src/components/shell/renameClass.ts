/**
 * Class rename: rewrites the class header (`model Old` → `model New`) and its matching
 * `end Old;` in the declaring file, saves through `saveClassSource` and opens the new name.
 * Only nested classes of an editable package can be renamed (top-level library roots and
 * classes stored in their own `within` file would need a file rename, which the server does
 * not support). References to the class elsewhere are not rewritten.
 */
import { useStore } from '../../store';

export const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface RenameOutcome {
  ok: boolean;
  newName?: string;
  error?: string;
}

export function canRenameClass(fullName: string): { ok: boolean; reason?: string } {
  const s = useStore.getState();
  const cls = s.registry.get(fullName);
  if (!cls) return { ok: false, reason: `Unknown class ${fullName}` };
  if (s.isReadOnly(fullName)) return { ok: false, reason: 'Classes of read-only libraries cannot be renamed.' };
  if (!cls.parentName) return { ok: false, reason: 'Top-level classes (library roots) cannot be renamed in this clone.' };
  const file = s.registry.fileOf(fullName);
  if (!file) return { ok: false, reason: 'The declaring file could not be found.' };
  const base = file.path.split('/').pop() ?? file.path;
  const ownFile = file.definition.within === cls.parentName && base !== 'package.mo' && base.replace(/\.mo$/, '') === cls.def.name;
  if (ownFile) return { ok: false, reason: 'Classes stored in their own file cannot be renamed in this clone.' };
  return { ok: true };
}

export async function renameClass(fullName: string, newShortName: string): Promise<RenameOutcome> {
  const s = useStore.getState();
  const check = canRenameClass(fullName);
  if (!check.ok) return { ok: false, error: check.reason };
  const cls = s.registry.get(fullName)!;
  const file = s.registry.fileOf(fullName)!;
  const oldShort = cls.def.name;
  if (!IDENTIFIER_RE.test(newShortName)) return { ok: false, error: 'Name must be a valid Modelica identifier.' };
  if (newShortName === oldShort) return { ok: true, newName: fullName };
  const newName = `${cls.parentName}.${newShortName}`;
  if (s.registry.has(newName)) return { ok: false, error: `${newName} already exists.` };

  const text = file.text;
  const nameLoc = cls.def.nameLoc;
  let headerStart: number;
  let headerEnd: number;
  if (nameLoc && text.slice(nameLoc.offset, nameLoc.offset + nameLoc.length) === oldShort) {
    headerStart = nameLoc.offset;
    headerEnd = nameLoc.offset + nameLoc.length;
  } else {
    // Fallback: first `<restriction> Old` at or after the class start.
    const from = cls.def.loc?.offset ?? 0;
    const re = new RegExp(`\\b(?:package|model|block|connector|record|type|function|class|operator|expandable\\s+connector|operator\\s+record|operator\\s+function)\\s+(${oldShort})\\b`, 'g');
    re.lastIndex = from;
    const m = re.exec(text);
    if (!m) return { ok: false, error: 'Could not locate the class declaration in the file.' };
    headerStart = m.index + m[0].length - oldShort.length;
    headerEnd = m.index + m[0].length;
  }

  let out = `${text.slice(0, headerStart)}${newShortName}${text.slice(headerEnd)}`;
  if (!cls.def.shortClass) {
    // First `end Old;` after the header closes this class (nested classes cannot share its name).
    const endRe = new RegExp(`\\bend\\s+${oldShort}\\s*;`, 'g');
    endRe.lastIndex = headerStart + newShortName.length;
    const em = endRe.exec(out);
    if (!em) return { ok: false, error: `Could not locate "end ${oldShort};" in the file.` };
    out = `${out.slice(0, em.index)}end ${newShortName};${out.slice(em.index + em[0].length)}`;
  }

  const res = await s.saveClassSource(fullName, out);
  if (!res.ok) return { ok: false, error: res.diagnostics[0]?.message ?? 'Saving failed.' };
  const after = useStore.getState();
  if (!after.registry.has(newName)) return { ok: false, error: 'The renamed class was not found after saving.' };
  if (after.activeClass === fullName || after.activeClass === undefined || !after.registry.has(after.activeClass)) {
    // openClass() short-circuits when the name is unchanged; the old name is gone so force a refresh.
    if (after.activeClass === newName) after.refreshDiagram();
    else after.openClass(newName);
  }
  return { ok: true, newName };
}
