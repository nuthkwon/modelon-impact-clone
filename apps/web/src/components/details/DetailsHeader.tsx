/**
 * Details panel header (72px): class/component icon, editable title and class path subtitle.
 *
 * The title is an inline rename: click → input, `Enter`/blur confirms, `Esc` cancels. A component
 * rename rewrites the model text (`renameComponent`); a class rename runs the same routine as the
 * shell's Rename dialog (`renameClass`) with the typed name, and failures surface as a banner.
 */
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { ClassRestriction, ComponentView, GraphicsLayer } from '@impact/core';
import { IconSvg } from '../graphics/GraphicsLayerSvg';
import { Tooltip } from '../common/Tooltip';
import { renameClass } from '../shell/renameClass';
import { useStore } from '../../store';
import { renameIntent, shortClassName } from './helpers';

export interface DetailsHeaderProps {
  activeClass: string;
  /** The single selected component, if any. */
  component?: ComponentView;
  /** Number of selected components (> 1 shows "N components selected"). */
  selectionCount: number;
  icon?: GraphicsLayer;
  restriction?: ClassRestriction;
  readOnly: boolean;
}

export function DetailsHeader({ activeClass, component, selectionCount, icon, restriction, readOnly }: DetailsHeaderProps) {
  const applyEdit = useStore((s) => s.applyEdit);
  const openClass = useStore((s) => s.openClass);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  /** Set once an edit has been confirmed or cancelled, so the blur that follows the input's removal does not commit again. */
  const doneRef = useRef(false);

  const multi = selectionCount > 1;
  const title = multi ? `${selectionCount} components selected` : component ? component.name : shortClassName(activeClass);
  const editable = !readOnly && !multi;

  useEffect(() => {
    setEditing(false);
  }, [activeClass, component?.name, selectionCount]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const startEdit = () => {
    if (!editable) return;
    doneRef.current = false;
    setDraft(title);
    setEditing(true);
  };

  const cancel = () => {
    doneRef.current = true;
    setEditing(false);
  };

  const commit = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setEditing(false);
    const intent = renameIntent(draft, title);
    if (intent.kind === 'none') return;
    const { pushBanner } = useStore.getState();
    if (intent.kind === 'invalid') {
      pushBanner({ severity: 'warning', message: `"${intent.name}" is not a valid Modelica identifier (letters, digits and underscores, not starting with a digit).` });
      return;
    }
    const name = intent.name;
    if (component) {
      const oldName = component.name;
      void applyEdit({ op: 'renameComponent', name: oldName, newName: name }).then((result) => {
        if (!result || result.diagnostics.some((d) => d.severity === 'error')) return;
        // Keep the renamed component selected (the selection still holds the old name).
        const { selection, select, selectedConnection } = useStore.getState();
        if (selection.includes(oldName)) select(selection.map((n) => (n === oldName ? name : n)), selectedConnection);
      });
    } else {
      void renameClass(activeClass, name).then((res) => {
        if (!res.ok) pushBanner({ severity: 'error', message: `Could not rename ${activeClass} to ${name}: ${res.error ?? 'unknown error'}`, className: activeClass });
      });
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
    e.stopPropagation();
  };

  const subtitle = multi ? (
    <span>{shortClassName(activeClass)}</span>
  ) : component ? (
    <Tooltip text={`Open ${component.className}`}>
      <button type="button" onClick={() => openClass(component.className)}>
        {component.className}
      </button>
    </Tooltip>
  ) : (
    <span title={activeClass}>
      {activeClass}
      {restriction && <span className="details-restriction">{restriction}</span>}
    </span>
  );

  return (
    <div className="details-header">
      <div className="details-header-icon" aria-hidden>
        <IconSvg icon={icon} size={40} hideText fallback={<span className="details-header-glyph">{multi ? selectionCount : title.charAt(0).toUpperCase()}</span>} />
      </div>
      <div className="details-header-text">
        {editing ? (
          <input
            ref={inputRef}
            className="details-title-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={commit}
            aria-label={component ? 'Component name' : 'Class name'}
            spellCheck={false}
          />
        ) : (
          <Tooltip text={editable ? 'Click to rename' : title}>
            <button type="button" className={`details-title${editable ? ' details-title--editable' : ''}`} onClick={startEdit} disabled={!editable} title={title}>
              {title}
            </button>
          </Tooltip>
        )}
        <div className="details-subtitle">{subtitle}</div>
      </div>
    </div>
  );
}
