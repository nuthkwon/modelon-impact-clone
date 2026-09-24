/**
 * One PROPERTIES row: `[name 40%] [⋮ attributes] [value input 40%] [unit]` with hover star/eye,
 * the attributes popover and the experiment-modifier styling (UI_SPEC §6.1).
 */
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { ParameterInfo } from '@impact/core';
import { Tooltip } from '../common/Tooltip';
import { Icon } from '../icons';
import type { Mode } from '../../store/types';
import { modifierCaseCount } from '../../store';
import { DetailsPopover } from './DetailsPopover';
import { ATTRIBUTE_NAMES, enumLiteralOf, formatParamValue, formatResultValue, parseBooleanText } from './helpers';
import type { AttributeName } from './helpers';

export interface ParameterRowProps {
  p: ParameterInfo;
  /** `resistor.R` (component selected) or `R` (top level). */
  fullName: string;
  mode: Mode;
  /** The edited class is read-only (model mode disables editing; experiment modifiers stay editable). */
  readOnly: boolean;
  unit: string;
  favorite: boolean;
  onToggleFavorite: () => void;
  onSticky: () => void;
  /** Experiment modifier text for this parameter (experiment mode). */
  modifier?: string;
  onCommit: (valueText: string | null) => void;
  attributesActive: boolean;
  attributeValues: Record<AttributeName, string | undefined>;
  onCommitAttribute: (attr: AttributeName, valueText: string | null) => void;
  showResults: boolean;
  resultValue?: number;
}

function normalise(text: string): string | null {
  const t = text.trim();
  return t === '' ? null : t;
}

export function ParameterRow(props: ParameterRowProps) {
  const { p, fullName, mode, readOnly, unit, favorite, onToggleFavorite, onSticky, modifier, onCommit, attributesActive, attributeValues, onCommitAttribute, showResults, resultValue } = props;
  const experiment = mode === 'experiment';
  const results = mode === 'results';
  const overridden = experiment && modifier !== undefined;
  const current = overridden ? modifier : p.valueText;
  const placeholder = p.defaultText ?? formatParamValue(p.evaluated);
  const locked = p.final || p.constant;
  const disabled = locked || results || (!experiment && readOnly);
  const attrDisabled = locked || results || (!experiment && readOnly);

  const [draft, setDraft] = useState(current ?? '');
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(current ?? '');
  }, [current, focused]);

  const inputRef = useRef<HTMLInputElement>(null);
  const attrButtonRef = useRef<HTMLButtonElement>(null);
  const [attrsOpen, setAttrsOpen] = useState(false);

  const commitText = () => {
    const next = normalise(draft);
    const prev = current === undefined ? null : normalise(current);
    if (next === prev) return;
    onCommit(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      commitText();
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(current ?? '');
      inputRef.current?.blur();
    }
  };

  const cases = overridden ? modifierCaseCount(modifier) : 1;
  const valueClass = ['param-value', overridden ? 'param-value--experiment' : current === undefined || current === '' ? 'param-value--default' : ''].filter(Boolean).join(' ');

  let valueControl: ReactNode;
  if (p.baseType === 'Boolean') {
    const checked = parseBooleanText(current ?? placeholder) ?? false;
    valueControl = (
      <div className={`param-checkbox${overridden ? ' param-checkbox--experiment' : ''}`}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onCommit(e.target.checked ? 'true' : 'false')} aria-label={fullName} />
      </div>
    );
  } else if (p.baseType === 'enumeration' && p.literals && p.literals.length) {
    const cur = enumLiteralOf(current);
    const qualify = (lit: string) => (lit.includes('.') || p.typeName === 'enumeration' || !p.typeName ? lit : `${p.typeName}.${lit}`);
    valueControl = (
      <select
        className={valueClass}
        value={p.literals.some((l) => enumLiteralOf(l) === cur) ? cur : ''}
        disabled={disabled}
        onChange={(e) => onCommit(e.target.value ? qualify(p.literals!.find((l) => enumLiteralOf(l) === e.target.value) ?? e.target.value) : null)}
        aria-label={fullName}
      >
        <option value="">{placeholder ? `${enumLiteralOf(placeholder)} (default)` : '(default)'}</option>
        {p.literals.map((l) => (
          <option key={l} value={enumLiteralOf(l)}>
            {enumLiteralOf(l)}
          </option>
        ))}
      </select>
    );
  } else {
    valueControl = (
      <input
        ref={inputRef}
        className={valueClass}
        value={disabled ? (current ?? placeholder) : draft}
        placeholder={placeholder}
        readOnly={disabled}
        disabled={disabled && !results}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commitText();
        }}
        onKeyDown={onKeyDown}
        spellCheck={false}
        aria-label={fullName}
        title={locked ? (p.final ? 'final parameter (read-only)' : 'constant (read-only)') : overridden ? `Experiment modifier: ${modifier}` : undefined}
      />
    );
  }

  const description = p.description ? `${fullName} — ${p.description}` : fullName;

  return (
    <div className={`param-row${results && showResults ? ' param-row--results' : ''}`} data-name={fullName}>
      <Tooltip text={description}>
        <div className="param-name">
          {favorite && <span className="param-fav-dot" aria-label="favorite" />}
          <span>{p.name}</span>
        </div>
      </Tooltip>
      <button
        ref={attrButtonRef}
        type="button"
        className={`param-attrs${attributesActive ? ' active' : ''}${attrsOpen ? ' open' : ''}`}
        onClick={() => setAttrsOpen((o) => !o)}
        aria-label="Attributes"
        title="Attributes (start, fixed, min, max, nominal, displayUnit)"
        disabled={attrDisabled && !attributesActive}
      >
        <Icon.MoreVert />
      </button>
      <div className="param-value-wrap">
        {valueControl}
        {overridden && (
          <button type="button" className="param-clear" onClick={() => onCommit(null)} aria-label="Remove experiment modifier" title="Remove override">
            <Icon.Close />
          </button>
        )}
      </div>
      {results && showResults && <div className="param-result">{formatResultValue(resultValue)}</div>}
      <div className="param-unit" title={unit}>
        {unit}
      </div>
      <div className="param-hover-actions">
        <Tooltip text="Show as sticky on the canvas">
          <button type="button" className="icon-button" onClick={onSticky} aria-label="Create sticky">
            <Icon.Eye />
          </button>
        </Tooltip>
        <Tooltip text={favorite ? 'Remove from favorites' : 'Add to favorites'}>
          <button type="button" className={`icon-button${favorite ? ' favorite' : ''}`} onClick={onToggleFavorite} aria-label="Toggle favorite">
            {favorite ? <Icon.Star /> : <Icon.StarBorder />}
          </button>
        </Tooltip>
      </div>
      {cases > 1 && (
        <div className="param-cases">
          <span className="chip">{cases} cases</span>
        </div>
      )}
      <DetailsPopover anchor={attrButtonRef.current} open={attrsOpen} onClose={() => setAttrsOpen(false)} width={280} align="left">
        <AttributesEditor fullName={fullName} values={attributeValues} disabled={attrDisabled} onCommit={onCommitAttribute} onClose={() => setAttrsOpen(false)} />
      </DetailsPopover>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attributes popover
// ---------------------------------------------------------------------------

interface AttributesEditorProps {
  fullName: string;
  values: Record<AttributeName, string | undefined>;
  disabled: boolean;
  onCommit: (attr: AttributeName, valueText: string | null) => void;
  onClose: () => void;
}

const ATTRIBUTE_LABELS: Record<AttributeName, string> = { start: 'start', fixed: 'fixed', min: 'min', max: 'max', nominal: 'nominal', displayUnit: 'displayUnit' };

function AttributesEditor({ fullName, values, disabled, onCommit, onClose }: AttributesEditorProps) {
  return (
    <div>
      <div className="details-popover-title">
        <span>Attributes of {fullName}</span>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
          <Icon.Close />
        </button>
      </div>
      <div className="attr-grid">
        {ATTRIBUTE_NAMES.map((attr) => (
          <AttrField key={attr} attr={attr} label={ATTRIBUTE_LABELS[attr]} value={values[attr]} disabled={disabled} onCommit={(v) => onCommit(attr, v)} />
        ))}
      </div>
    </div>
  );
}

function AttrField({ attr, label, value, disabled, onCommit }: { attr: AttributeName; label: string; value: string | undefined; disabled: boolean; onCommit: (v: string | null) => void }) {
  const [draft, setDraft] = useState(value ?? '');
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value ?? '');
  }, [value, focused]);
  const id = `attr-${attr}`;
  const commit = () => {
    const next = normalise(draft);
    const prev = value === undefined ? null : normalise(value);
    if (next !== prev) onCommit(next);
  };
  if (attr === 'fixed') {
    return (
      <>
        <label htmlFor={id}>{label}</label>
        <select id={id} className={`text-field${value ? ' attr-set' : ''}`} value={parseBooleanText(value) === undefined ? '' : String(parseBooleanText(value))} disabled={disabled} onChange={(e) => onCommit(e.target.value ? e.target.value : null)}>
          <option value="">default</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      </>
    );
  }
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className={`text-field${value ? ' attr-set' : ''}`}
        value={draft}
        placeholder={attr === 'displayUnit' ? 'e.g. kOhm' : 'default'}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setDraft(value ?? '');
          }
        }}
        spellCheck={false}
      />
    </>
  );
}
