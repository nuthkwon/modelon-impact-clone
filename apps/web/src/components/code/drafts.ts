/**
 * Unsaved Code-view drafts that outlive the editor.
 *
 * `store.openClass()` clears `codeDraft` before the CodeView effect cleanup runs, and the cleanup's
 * auto-save is asynchronous: when the server rejects the text (syntax error) the class is no longer
 * active and the edits would be gone. The cleanup therefore stashes the text here (keyed per
 * workspace + class) before saving; a successful save removes the stash and re-opening the class
 * restores it as the draft together with the diagnostic of the failed save.
 *
 * The map is mirrored into `sessionStorage` (best effort) so a reload of the tab keeps the drafts.
 */
import type { Diagnostic } from '@impact/core';

export interface StashedDraft {
  text: string;
  /** Diagnostic of the failed save, when known. */
  diagnostic?: Diagnostic;
}

const STORAGE_KEY = 'impact.codeDrafts';

const drafts = new Map<string, StashedDraft>();
let loaded = false;

function storage(): Storage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, StashedDraft>;
    for (const [k, v] of Object.entries(parsed)) if (v && typeof v.text === 'string') drafts.set(k, v);
  } catch {
    // ignore: storage unavailable or corrupt
  }
}

function persist(): void {
  try {
    const s = storage();
    if (!s) return;
    if (drafts.size === 0) s.removeItem(STORAGE_KEY);
    else s.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(drafts)));
  } catch {
    // ignore: quota / private mode
  }
}

/** Key of a class's draft: drafts of one workspace must not leak into a class of the same name elsewhere. */
export function draftKey(workspaceId: string | undefined, className: string): string {
  return `${workspaceId ?? ''}\u0000${className}`;
}

/** Remembers `text` as the unsaved draft of `key` (replaces an earlier stash). */
export function stashDraft(key: string, draft: StashedDraft): void {
  load();
  drafts.set(key, draft);
  persist();
}

/** The stashed draft of `key`, if any (kept). */
export function peekDraft(key: string): StashedDraft | undefined {
  load();
  return drafts.get(key);
}

/** Removes and returns the stashed draft of `key`. */
export function takeDraft(key: string): StashedDraft | undefined {
  load();
  const d = drafts.get(key);
  if (d) {
    drafts.delete(key);
    persist();
  }
  return d;
}

/** Drops the stash of `key` when it still holds `text` (the text was saved or is otherwise current). */
export function clearDraft(key: string, text: string): void {
  load();
  if (drafts.get(key)?.text === text) {
    drafts.delete(key);
    persist();
  }
}

/** Attaches the diagnostic of a failed save to the stash of `key`, if it still holds `text`. */
export function markDraftFailed(key: string, text: string, diagnostic: Diagnostic | undefined): void {
  load();
  const d = drafts.get(key);
  if (!d || d.text !== text) return;
  drafts.set(key, { text, diagnostic });
  persist();
}

/** Stashed drafts of `workspaceId` whose save failed (the diagnostic is known), for the Code view's warning banners. */
export function failedDrafts(workspaceId: string | undefined): { className: string; diagnostic: Diagnostic }[] {
  load();
  const prefix = draftKey(workspaceId, '');
  const out: { className: string; diagnostic: Diagnostic }[] = [];
  for (const [k, d] of drafts) if (k.startsWith(prefix) && d.diagnostic) out.push({ className: k.slice(prefix.length), diagnostic: d.diagnostic });
  return out;
}

/** Test hook: forgets every stash (memory and storage). */
export function clearAllDrafts(): void {
  loaded = true;
  drafts.clear();
  persist();
}

// ---------------------------------------------------------------------------
// Follow-registry decision
// ---------------------------------------------------------------------------

export interface FollowRegistryInput {
  /** Unsaved draft in the store (undefined when the editor is believed to be in sync). */
  codeDraft: string | undefined;
  /** Current text of the class in the registry. */
  registryText: string | undefined;
  /** Current editor document. */
  editorText: string;
  /** Text of the save that is in flight / just completed for this class, if any. */
  sentText: string | undefined;
}

export type FollowRegistryAction = 'none' | 'replace' | 'keepDirty';

/**
 * What the Code view does when the registry changes while it believes the editor is in sync:
 * - `replace`: load the registry text into the editor (server-normalised text, undo from elsewhere);
 * - `keepDirty`: the user typed while a save was in flight — keep the editor text and mark it as
 *   the draft again instead of snapping back to the text that was saved;
 * - `none`: nothing to do (a draft exists, or the texts already agree).
 */
export function followRegistryAction({ codeDraft, registryText, editorText, sentText }: FollowRegistryInput): FollowRegistryAction {
  if (codeDraft !== undefined || registryText === undefined) return 'none';
  if (editorText === registryText) return 'none';
  if (sentText !== undefined && editorText !== sentText) return 'keepDirty';
  return 'replace';
}
