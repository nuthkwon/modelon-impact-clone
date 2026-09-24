import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearAllDrafts, clearDraft, draftKey, followRegistryAction, markDraftFailed, peekDraft, stashDraft, takeDraft } from './drafts';

describe('code drafts stash', () => {
  beforeEach(() => clearAllDrafts());
  afterEach(() => clearAllDrafts());

  it('keys drafts per workspace and class', () => {
    expect(draftKey('ws1', 'Examples.A')).not.toBe(draftKey('ws2', 'Examples.A'));
    expect(draftKey('ws1', 'Examples.A')).not.toBe(draftKey('ws1', 'Examples.B'));
    expect(draftKey(undefined, 'Examples.A')).toBe(draftKey(undefined, 'Examples.A'));
  });

  it('keeps the text of a class that was left and hands it back once', () => {
    const key = draftKey('ws', 'Examples.RCCircuit');
    stashDraft(key, { text: 'model RCCircuit\n  Real x = ;\nend RCCircuit;' });
    expect(peekDraft(key)?.text).toContain('Real x = ;');
    expect(takeDraft(key)?.text).toContain('Real x = ;');
    expect(takeDraft(key)).toBeUndefined();
  });

  it('records the diagnostic of the failed save while the stash still holds that text', () => {
    const key = draftKey('ws', 'Examples.A');
    stashDraft(key, { text: 'bad' });
    markDraftFailed(key, 'bad', { severity: 'error', message: 'Unexpected token', loc: { line: 2, column: 12, offset: 20, length: 1 } });
    expect(peekDraft(key)).toEqual({ text: 'bad', diagnostic: { severity: 'error', message: 'Unexpected token', loc: { line: 2, column: 12, offset: 20, length: 1 } } });
    // A newer stash (the class was reopened, edited and left again) is not overwritten by an old failure.
    stashDraft(key, { text: 'newer' });
    markDraftFailed(key, 'bad', { severity: 'error', message: 'stale' });
    expect(peekDraft(key)).toEqual({ text: 'newer' });
  });

  it('drops the stash only when the saved text is the stashed one', () => {
    const key = draftKey('ws', 'Examples.A');
    stashDraft(key, { text: 'v2' });
    clearDraft(key, 'v1');
    expect(peekDraft(key)?.text).toBe('v2');
    clearDraft(key, 'v2');
    expect(peekDraft(key)).toBeUndefined();
  });
});

describe('followRegistryAction', () => {
  const saved = 'model A\n  parameter Real k = 1;\nend A;';
  it('does nothing while a draft exists or the texts agree', () => {
    expect(followRegistryAction({ codeDraft: 'x', registryText: saved, editorText: 'x', sentText: undefined })).toBe('none');
    expect(followRegistryAction({ codeDraft: undefined, registryText: saved, editorText: saved, sentText: saved })).toBe('none');
    expect(followRegistryAction({ codeDraft: undefined, registryText: undefined, editorText: 'x', sentText: undefined })).toBe('none');
  });
  it('loads external changes and server-normalised text when the editor is in sync', () => {
    expect(followRegistryAction({ codeDraft: undefined, registryText: `${saved}\n`, editorText: saved, sentText: undefined })).toBe('replace');
    // The save was sent with exactly the editor text: a normalised result replaces the document.
    expect(followRegistryAction({ codeDraft: undefined, registryText: `${saved}\n`, editorText: saved, sentText: saved })).toBe('replace');
  });
  it('keeps keystrokes typed while a save was in flight instead of snapping back', () => {
    const typed = `${saved}\nparameter Real m = 2;`;
    expect(followRegistryAction({ codeDraft: undefined, registryText: saved, editorText: typed, sentText: saved })).toBe('keepDirty');
  });
});
