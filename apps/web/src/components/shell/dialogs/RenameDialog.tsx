/** Rename dialog for a class (rewrites the class header/end) or a component (`renameComponent` edit). */
import { useMemo, useState } from 'react';
import { useStore } from '../../../store';
import { Dialog } from '../../common/Dialog';
import { canRenameClass, IDENTIFIER_RE, renameClass } from '../renameClass';
import type { RenameTarget } from '../shellActions';

export function RenameDialog({ target, onClose }: { target: RenameTarget; onClose: () => void }) {
  const shortName = target.kind === 'class' ? target.name.split('.').pop() ?? target.name : target.name;
  const [value, setValue] = useState(shortName);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const check = useMemo(() => (target.kind === 'class' ? canRenameClass(target.name) : { ok: true as boolean, reason: undefined as string | undefined }), [target]);

  const submit = async () => {
    const next = value.trim();
    if (!IDENTIFIER_RE.test(next)) {
      setError('The name must be a Modelica identifier (letters, digits, underscore; not starting with a digit).');
      return;
    }
    if (next === shortName) {
      onClose();
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      if (target.kind === 'class') {
        const res = await renameClass(target.name, next);
        if (!res.ok) {
          setError(res.error);
          return;
        }
      } else {
        const s = useStore.getState();
        if (s.diagram?.components.some((c) => c.name === next)) {
          setError(`A component named ${next} already exists.`);
          return;
        }
        const res = await s.applyEdit({ op: 'renameComponent', name: target.name, newName: next });
        if (!res || res.diagnostics.some((d) => d.severity === 'error')) {
          setError(res?.diagnostics.find((d) => d.severity === 'error')?.message ?? 'Rename failed.');
          return;
        }
        const after = useStore.getState();
        if (after.selection.includes(target.name)) after.select(after.selection.map((n) => (n === target.name ? next : n)), after.selectedConnection);
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      title={target.kind === 'class' ? 'Rename class' : 'Rename component'}
      onClose={onClose}
      onSubmit={() => void submit()}
      size="compact"
      actions={
        <>
          <button type="button" className="outlined-button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="contained-button" onClick={() => void submit()} disabled={busy || !check.ok || !value.trim()}>
            {busy ? 'Renaming…' : 'Rename'}
          </button>
        </>
      }
    >
      <div className="form-row">
        <label htmlFor="rename-input">New name</label>
        <input id="rename-input" className="text-field" value={value} onChange={(e) => setValue(e.target.value)} disabled={!check.ok} autoComplete="off" spellCheck={false} />
        <span className="form-help">{target.kind === 'class' ? target.name : `Component of ${useStore.getState().activeClass ?? ''}`}</span>
      </div>
      {!check.ok && <div className="form-error">{check.reason}</div>}
      {error && <div className="form-error">{error}</div>}
    </Dialog>
  );
}

export default RenameDialog;
