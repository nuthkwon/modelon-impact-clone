/**
 * Code view (§5.6): full-size CodeMirror 6 editor for the active class's file.
 *
 * - Text comes from `getClassText(activeClass)`; edits go to `codeDraft` in the store.
 * - `Ctrl+S`, leaving the view or switching class saves through `saveClassSource`. On a syntax
 *   error the draft is kept (nothing saved) and the error is shown as a red gutter marker + a
 *   banner "Line N: message".
 * - Read-only library classes are shown with `EditorState.readOnly` and a banner.
 * - `useShellActions().openCodeAtLine(n)` selects/scrolls to line n.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, drawSelection, gutter, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, rectangularSelection, crosshairCursor, dropCursor, highlightSpecialChars } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap, search } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import type { Diagnostic } from '@impact/core';
import { useStore } from '../../store';
import { useShellStore } from '../shell/shellActions';
import { CloseIcon, ErrorIcon, InfoIcon, SaveIcon } from '../icons';
import { Tooltip } from '../common/Tooltip';
import { modelica } from './modelica';
import './code.css';

// ---- error line marker ----------------------------------------------------------------------

const setErrorLine = StateEffect.define<number | null>();

const errorLineField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setErrorLine)) value = e.value;
    return value;
  },
});

class ErrorMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-error-gutter-marker';
    el.textContent = '●';
    el.title = 'Syntax error';
    return el;
  }
}
const errorMarker = new ErrorMarker();

const errorGutter = gutter({
  class: 'cm-error-gutter',
  lineMarker(view, line) {
    const n = view.state.field(errorLineField);
    if (n === null) return null;
    return view.state.doc.lineAt(line.from).number === n ? errorMarker : null;
  },
  lineMarkerChange: (update) => update.startState.field(errorLineField) !== update.state.field(errorLineField),
});

const errorLineDecoration = EditorView.decorations.compute(['doc', errorLineField], (state): DecorationSet => {
  const n = state.field(errorLineField);
  if (n === null || n < 1 || n > state.doc.lines) return Decoration.none;
  const line = state.doc.line(n);
  return Decoration.set([Decoration.line({ class: 'cm-error-line' }).range(line.from)]);
});

// ---- component ------------------------------------------------------------------------------

type Status = 'saved' | 'dirty' | 'error' | 'readonly' | 'saving';

export function CodeView() {
  const activeClass = useStore((s) => s.activeClass);
  const registryVersion = useStore((s) => s.registryVersion);
  const dirty = useStore((s) => s.codeDraft !== undefined);
  const codeTarget = useShellStore((s) => s.codeTarget);
  const clearCodeTarget = useShellStore((s) => s.clearCodeTarget);

  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [diagnostic, setDiagnostic] = useState<Diagnostic | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const fileInfo = useMemo(() => {
    void registryVersion;
    if (!activeClass) return undefined;
    const s = useStore.getState();
    const f = s.registry.fileOf(activeClass);
    return { path: f?.path, library: f ? s.registry.getLibrary(f.libraryId)?.name : undefined, readOnly: s.isReadOnly(activeClass) };
  }, [activeClass, registryVersion]);
  const readOnly = fileInfo?.readOnly ?? true;

  const save = useCallback(async (className: string, text: string): Promise<boolean> => {
    const s = useStore.getState();
    if (s.isReadOnly(className)) return false;
    const current = s.getClassText(className);
    if (current === text) {
      if (s.codeDraft !== undefined && s.activeClass === className) s.setCodeDraft(undefined);
      setDiagnostic(undefined);
      return true;
    }
    setSaving(true);
    try {
      const res = await s.saveClassSource(className, text);
      if (useStore.getState().activeClass !== className) return res.ok;
      if (!res.ok) {
        setDiagnostic(res.diagnostics.find((d) => d.severity === 'error') ?? res.diagnostics[0]);
        return false;
      }
      setDiagnostic(undefined);
      return true;
    } finally {
      setSaving(false);
    }
  }, []);

  // Create the editor for the active class.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !activeClass) return;
    const s = useStore.getState();
    const doc = s.codeDraft ?? s.getClassText(activeClass) ?? '';
    setDiagnostic(undefined);

    const extensions: Extension[] = [
      lineNumbers(),
      errorGutter,
      errorLineField,
      errorLineDecoration,
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      indentUnit.of('  '),
      bracketMatching(),
      closeBrackets(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      keymap.of([
        {
          key: 'Mod-s',
          run: (view) => {
            void save(activeClass, view.state.doc.toString());
            return true;
          },
        },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        indentWithTab,
      ]),
      modelica(),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        const text = update.state.doc.toString();
        const st = useStore.getState();
        if (st.activeClass !== activeClass) return;
        const base = st.getClassText(activeClass);
        const next = text === base ? undefined : text;
        if (next !== st.codeDraft) st.setCodeDraft(next);
      }),
    ];
    if (readOnly) extensions.push(EditorState.readOnly.of(true), EditorView.editable.of(false), EditorView.editorAttributes.of({ class: 'cm-readonly' }));

    const view = new EditorView({ state: EditorState.create({ doc, extensions }), parent: host });
    viewRef.current = view;

    return () => {
      viewRef.current = null;
      const text = view.state.doc.toString();
      view.destroy();
      const st = useStore.getState();
      if (!readOnly && st.registry.has(activeClass) && text !== st.getClassText(activeClass)) void save(activeClass, text);
    };
  }, [activeClass, readOnly, save]);

  // Follow registry changes while the editor is in sync (e.g. server-normalised text after a save, undo from elsewhere).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !activeClass) return;
    const s = useStore.getState();
    if (s.codeDraft !== undefined) return;
    const text = s.getClassText(activeClass);
    if (text === undefined) return;
    const current = view.state.doc.toString();
    if (current === text) return;
    const sel = Math.min(view.state.selection.main.head, text.length);
    view.dispatch({ changes: { from: 0, to: current.length, insert: text }, selection: { anchor: sel } });
  }, [registryVersion, activeClass]);

  // Reflect the diagnostic in the gutter.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: setErrorLine.of(diagnostic?.loc?.line ?? null) });
  }, [diagnostic, activeClass]);

  // Ctrl+S anywhere in the page while the Code view is shown (the editor keymap handles it when focused).
  useEffect(() => {
    if (!activeClass || readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's' || e.altKey || e.shiftKey) return;
      e.preventDefault();
      const view = viewRef.current;
      if (view) void save(activeClass, view.state.doc.toString());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeClass, readOnly, save]);

  const gotoLine = useCallback((line: number) => {
    const view = viewRef.current;
    if (!view) return;
    const n = Math.max(1, Math.min(line, view.state.doc.lines));
    const l = view.state.doc.line(n);
    view.dispatch({ selection: { anchor: l.from, head: l.to }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
    view.focus();
  }, []);

  // openCodeAtLine() requests.
  useEffect(() => {
    if (!codeTarget || !viewRef.current) return;
    gotoLine(codeTarget.line);
    clearCodeTarget(codeTarget.seq);
  }, [codeTarget, gotoLine, clearCodeTarget, activeClass]);

  if (!activeClass) {
    return (
      <div className="code-view">
        <div className="code-empty">Select a class to view its code.</div>
      </div>
    );
  }

  const status: Status = readOnly ? 'readonly' : saving ? 'saving' : diagnostic ? 'error' : dirty ? 'dirty' : 'saved';
  const statusLabel: Record<Status, string> = { saved: 'Saved', dirty: 'Unsaved changes', error: 'Syntax error', readonly: 'Read-only', saving: 'Saving…' };

  return (
    <div className="code-view">
      <div className="code-strip">
        <span className="code-path" title={fileInfo?.path}>
          {fileInfo?.library && <span className="code-lib">{fileInfo.library} / </span>}
          {fileInfo?.path ?? '—'}
        </span>
        <span className="code-class" title={activeClass}>
          {activeClass}
        </span>
        <span className="code-spacer" />
        <span className={`code-status ${status}`}>{statusLabel[status]}</span>
        {!readOnly && (
          <Tooltip text="Save (Ctrl+S)">
            <button type="button" className="icon-button" aria-label="Save" disabled={!dirty || saving} onClick={() => viewRef.current && void save(activeClass, viewRef.current.state.doc.toString())}>
              <SaveIcon />
            </button>
          </Tooltip>
        )}
      </div>
      {readOnly && (
        <div className="code-banner readonly" role="status">
          <InfoIcon size={16} />
          <span className="banner-text">Read-only library class</span>
        </div>
      )}
      {diagnostic && (
        <div className="code-banner error" role="alert">
          <ErrorIcon size={16} />
          <span className="banner-text">
            {diagnostic.loc ? (
              <>
                <button type="button" className="link" onClick={() => gotoLine(diagnostic.loc!.line)}>
                  Line {diagnostic.loc.line}
                </button>
                : {diagnostic.message}
              </>
            ) : (
              diagnostic.message
            )}
            {' — not saved'}
          </span>
          <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => setDiagnostic(undefined)}>
            <CloseIcon />
          </button>
        </div>
      )}
      <div ref={hostRef} className="code-editor" />
    </div>
  );
}

export default CodeView;
