/**
 * Global keyboard shortcuts of the workspace page (§10): `1/2/3` switch modes, `Ctrl+Z/Y`
 * undo/redo (diagram view only — CodeMirror owns its own history), `?` opens the shortcuts
 * dialog. Keys are ignored while typing in inputs/textareas/contenteditable/CodeMirror or
 * while a dialog is open. Canvas-specific keys (Delete, copy/paste, zoom, F) are handled by the
 * canvas module.
 */
import { useEffect } from 'react';
import { useStore } from '../store';
import { useShellStore } from '../components/shell/shellActions';

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  if (target.closest('.cm-editor')) return true;
  return false;
}

export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (isTypingTarget(e.target)) return;
      const shell = useShellStore.getState();
      const dialogOpen = Boolean(shell.dialog || shell.confirmRequest) || (e.target instanceof HTMLElement && Boolean(e.target.closest('.dialog')));
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;

      if (!mod && !e.altKey) {
        if (e.key === '?' ) {
          if (dialogOpen) return;
          e.preventDefault();
          shell.actions.openShortcuts();
          return;
        }
        if (!e.shiftKey && (e.key === '1' || e.key === '2' || e.key === '3')) {
          if (dialogOpen) return;
          e.preventDefault();
          s.setMode(e.key === '1' ? 'model' : e.key === '2' ? 'experiment' : 'results');
          return;
        }
        return;
      }

      if (mod && !e.altKey && s.view === 'diagram' && !dialogOpen) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) {
          e.preventDefault();
          void s.undo();
        } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
          e.preventDefault();
          void s.redo();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

export default useGlobalShortcuts;
