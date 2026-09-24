/**
 * Details panel header (72px): class/component icon, editable title and class path subtitle.
 */
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { ClassRestriction, ComponentView, GraphicsLayer } from '@impact/core';
import { IconSvg } from '../graphics/GraphicsLayerSvg';
import { Tooltip } from '../common/Tooltip';
import { useShellActions } from '../shell/shellActions';
import { useStore } from '../../store';
import { shortClassName } from './helpers';

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
  const shell = useShellActions();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

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
    setDraft(title);
    setEditing(true);
  };

  const commit = () => {
    const name = draft.trim();
    setEditing(false);
    if (!name || name === title) return;
    if (component) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return;
      void applyEdit({ op: 'renameComponent', name: component.name, newName: name });
    } else {
      shell.openRename({ kind: 'class', name: activeClass });
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditing(false);
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
            onBlur={() => setEditing(false)}
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
