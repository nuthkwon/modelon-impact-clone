/**
 * Small labelled inputs shared by the ANALYSIS panel and the Execution settings dialog.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { formatNumber } from '@impact/core';
import { parseNumeric } from './helpers';

export interface NumberInputProps {
  value: number;
  /** Called with the parsed number; NaN / empty / invalid text reverts to `value`. */
  onCommit: (n: number) => void;
  /** Extra check; returning false reverts. */
  accept?: (n: number) => boolean;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
  digits?: number;
  ariaLabel?: string;
}

/** Text input for a number: commits on Enter/blur, rejects NaN by reverting. */
export function NumberInput({ value, onCommit, accept, invalid, disabled, className, id, digits = 10, ariaLabel }: NumberInputProps) {
  const text = formatNumber(value, digits);
  const [draft, setDraft] = useState(text);
  const [focused, setFocused] = useState(false);
  const suppressBlurRef = useRef(false);
  useEffect(() => {
    if (!focused) setDraft(text);
  }, [text, focused]);
  const commit = () => {
    const n = parseNumeric(draft);
    if (n === undefined || (accept && !accept(n))) {
      setDraft(text);
      return;
    }
    if (n !== value) onCommit(n);
    else setDraft(text);
  };
  return (
    <input
      id={id}
      className={`text-field${invalid ? ' invalid' : ''}${className ? ` ${className}` : ''}`}
      value={draft}
      disabled={disabled}
      inputMode="decimal"
      spellCheck={false}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        if (suppressBlurRef.current) {
          suppressBlurRef.current = false;
          return;
        }
        commit();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
          suppressBlurRef.current = true;
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setDraft(text);
          suppressBlurRef.current = true;
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export interface FieldRowProps {
  label: ReactNode;
  unit?: string;
  children: ReactNode;
  helper?: string;
  htmlFor?: string;
}

/** `[label] [input] [unit]` row of the ANALYSIS panel. */
export function FieldRow({ label, unit, children, helper, htmlFor }: FieldRowProps) {
  return (
    <div className="analysis-field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      <span className="analysis-unit">{unit ?? ''}</span>
      {helper && (
        <div className="analysis-helper" role="alert">
          {helper}
        </div>
      )}
    </div>
  );
}

export interface SwitchProps {
  on: boolean;
  onToggle: () => void;
  ariaLabel: string;
  disabled?: boolean;
}

/** Tiny toggle switch (Interval ⇄ Points). */
export function Switch({ on, onToggle, ariaLabel, disabled }: SwitchProps) {
  return <button type="button" role="switch" aria-checked={on} aria-label={ariaLabel} className={`details-switch${on ? ' on' : ''}`} onClick={onToggle} disabled={disabled} />;
}
