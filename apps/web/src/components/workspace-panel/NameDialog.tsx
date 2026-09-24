/**
 * Small dialog asking for a class name and a target package ("Duplicate to…", "Extend…").
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '../common/Dialog';
import { IDENTIFIER_RE } from './treeModel';
import type { LocationOption } from './treeModel';

export interface NameDialogProps {
  title: string;
  /** Text above the fields, e.g. "Duplicate Modelica.Electrical.Analog.Basic.Resistor to:". */
  message?: string;
  confirmLabel: string;
  initialName: string;
  locations: LocationOption[];
  initialLocation: string;
  /** Returns an error message for the full class name, or undefined when acceptable. */
  validate(fullName: string): string | undefined;
  onConfirm(name: string, location: string): void;
  onClose(): void;
  busy?: boolean;
}

export function NameDialog(props: NameDialogProps) {
  const [name, setName] = useState(props.initialName);
  const [location, setLocation] = useState(props.initialLocation);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const fullName = location ? `${location}.${name.trim()}` : name.trim();
  const error = useMemo(() => {
    const n = name.trim();
    if (!n) return 'Enter a name';
    if (!IDENTIFIER_RE.test(n)) return 'Names must start with a letter or underscore and contain only letters, digits and underscores';
    return props.validate(fullName);
  }, [name, fullName, props]);

  const submit = () => {
    if (error || props.busy) return;
    props.onConfirm(name.trim(), location);
  };

  return (
    <Dialog
      title={props.title}
      open
      onClose={props.onClose}
      actions={
        <>
          <button type="button" className="text-button" onClick={props.onClose} disabled={props.busy}>
            Cancel
          </button>
          <button type="button" className="contained-button" onClick={submit} disabled={!!error || props.busy}>
            {props.busy ? 'Working…' : props.confirmLabel}
          </button>
        </>
      }
    >
      <form
        className="wp-name-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {props.message && <div className="wp-name-message">{props.message}</div>}
        <label className="wp-field">
          <span className="wp-field-label">Name</span>
          <input ref={inputRef} className="text-field" value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} autoComplete="off" />
        </label>
        <label className="wp-field">
          <span className="wp-field-label">Location</span>
          <select className="text-field" value={location} onChange={(e) => setLocation(e.target.value)}>
            {props.locations.map((o) => (
              <option key={o.value || '<top>'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div className={`wp-name-preview ${error ? 'error' : ''}`.trim()}>{error ?? fullName}</div>
      </form>
    </Dialog>
  );
}
