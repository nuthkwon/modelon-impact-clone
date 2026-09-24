/**
 * Stickies (UI_SPEC §5.4 / §9): white cards attached to a component (offset in diagram units).
 * A card lists every sticky of one component: title row = component name (600), one row per
 * variable = orange bullet, short variable name, the value in an `--accent-chip` chip and the
 * grey unit. Editable stickies (parameters) show the chip as an input that rewrites the
 * component modifier; result stickies show the value at the slider time. Rows subscribe to the
 * slider/trajectories themselves so the SVG scene does not re-render.
 */
import { useEffect, useMemo, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { ComponentView, DiagramView, Point } from '@impact/core';
import { formatNumber, unitLabel } from '@impact/core';
import { useStore } from '../../store';
import type { Sticky, Viewport } from '../../store/types';
import { Icon } from '../icons';
import { displayInfo, displayUnitOf, type VariableMetaMap, unitOf, useCaseMeta } from '../results/resultMeta';
import { diagramToScreen, round2, shortClassName } from './geometry';

const EMPTY: Sticky[] = [];

export interface StickyGroup {
  key: string;
  /** Component the card is attached to ('' for top-level variables). */
  component: string;
  stickies: Sticky[];
}

/** Groups stickies by component (first-seen order) so one card lists every variable of a component. */
export function groupStickies(stickies: Sticky[]): StickyGroup[] {
  const groups = new Map<string, StickyGroup>();
  for (const st of stickies) {
    let g = groups.get(st.component);
    if (!g) {
      g = { key: st.component || '$top', component: st.component, stickies: [] };
      groups.set(st.component, g);
    }
    g.stickies.push(st);
  }
  return [...groups.values()];
}

export function Stickies({ vp, readOnly }: { vp: Viewport; readOnly: boolean }) {
  const activeClass = useStore((s) => s.activeClass);
  const stickies = useStore((s) => (activeClass ? s.stickies[activeClass] : undefined)) ?? EMPTY;
  const diagram = useStore((s) => s.diagram);
  const groups = useMemo(() => groupStickies(stickies), [stickies]);
  if (!activeClass || !stickies.length) return null;
  return (
    <div className="stickies-layer">
      {groups.map((g) => (
        <StickyCard key={g.key} group={g} className={activeClass} diagram={diagram} vp={vp} readOnly={readOnly} />
      ))}
    </div>
  );
}

interface StickyCardProps {
  group: StickyGroup;
  className: string;
  diagram: DiagramView | undefined;
  vp: Viewport;
  readOnly: boolean;
}

function relativeName(sticky: Sticky): string {
  return sticky.component && sticky.variable.startsWith(`${sticky.component}.`) ? sticky.variable.slice(sticky.component.length + 1) : sticky.variable;
}

function StickyCard({ group, className, diagram, vp, readOnly }: StickyCardProps) {
  const updateSticky = useStore((s) => s.updateSticky);
  const removeSticky = useStore((s) => s.removeSticky);
  const activeResult = useStore((s) => s.getActiveResult(className));
  const caseIndex = useStore((s) => s.caseIndex);
  const caseId = activeResult?.cases[Math.min(caseIndex, Math.max(0, (activeResult?.cases.length ?? 1) - 1))]?.id;
  const meta = useCaseMeta(activeResult?.id, caseId);

  const lead = group.stickies[0];
  const component = group.component ? diagram?.components.find((c) => c.name === group.component) : undefined;
  const origin: Point = component ? component.placement.transformation.origin : [0, 0];
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const dx = drag ? drag.dx : lead.dx;
  const dy = drag ? drag.dy : lead.dy;
  const [sx, sy] = diagramToScreen(vp, [origin[0] + dx, origin[1] + dy]);
  const pinned = group.stickies.every((s) => s.pinned);
  const title = group.component || shortClassName(className);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (e.button !== 0 || t.closest('input,button,select')) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    const startX = e.clientX;
    const startY = e.clientY;
    const base = { dx: lead.dx, dy: lead.dy };
    let last = base;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      last = { dx: round2(base.dx + (ev.clientX - startX) / vp.scale), dy: round2(base.dy - (ev.clientY - startY) / vp.scale) };
      setDrag(last);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setDrag(null);
      if (last.dx !== base.dx || last.dy !== base.dy) for (const st of group.stickies) updateSticky(className, st.id, last);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const setPinned = (p: boolean) => {
    for (const st of group.stickies) updateSticky(className, st.id, { pinned: p });
  };
  const removeAll = () => {
    for (const st of group.stickies) removeSticky(className, st.id);
  };

  return (
    <div className={`sticky${pinned ? ' pinned' : ''}${drag ? ' dragging' : ''}`} style={{ left: sx, top: sy }} onPointerDown={onPointerDown} data-sticky-component={group.component || undefined}>
      <div className="sticky-title">
        <span className="sticky-title-text">{title}</span>
      </div>
      <div className="sticky-actions">
        <button className="sticky-btn sticky-pin" title={pinned ? 'Unpin' : 'Pin'} aria-label={pinned ? 'Unpin' : 'Pin'} onClick={() => setPinned(!pinned)}>
          <Icon.Pin />
        </button>
        <button className="sticky-btn" title="Remove" aria-label="Remove sticky" onClick={removeAll}>
          <Icon.Close />
        </button>
      </div>
      {group.stickies.map((st) => (
        <StickyRow key={st.id} sticky={st} component={component} meta={meta} readOnly={readOnly} onRemove={() => removeSticky(className, st.id)} />
      ))}
    </div>
  );
}

interface StickyRowProps {
  sticky: Sticky;
  component: ComponentView | undefined;
  meta: VariableMetaMap | undefined;
  readOnly: boolean;
  onRemove(): void;
}

function StickyRow({ sticky, component, meta, readOnly, onRemove }: StickyRowProps) {
  // Re-render on anything that changes the displayed value.
  useStore((s) => s.sliderTime);
  useStore((s) => s.trajectories);
  useStore((s) => s.caseIndex);
  useStore((s) => s.activeResult);
  useStore((s) => s.results);

  const relName = relativeName(sticky);
  const param = component?.parameters.find((p) => p.name === relName);
  const showDisplayUnits = useStore((s) => s.settings.showDisplayUnits);
  const disp = displayInfo(param?.unit ?? unitOf(meta, sticky.variable), param?.displayUnit ?? displayUnitOf(meta, sticky.variable), showDisplayUnits && !sticky.editable);
  const unit = disp.unit;
  const rawValue = useStore.getState().valueAt(sticky.variable);
  const value = rawValue === undefined ? undefined : disp.convert(rawValue);
  const paramText = param?.valueText ?? param?.defaultText ?? '';
  const [editText, setEditText] = useState<string | undefined>(undefined);
  useEffect(() => setEditText(undefined), [paramText]);

  const editable = sticky.editable && !readOnly && !!component && !(param?.final || param?.constant);

  const commit = () => {
    if (editText === undefined) return;
    const next = editText.trim();
    setEditText(undefined);
    if (next === paramText) return;
    void useStore.getState().applyEdit({ op: 'setParameter', component: sticky.component || undefined, name: relName, valueText: next === '' ? null : next });
  };

  const displayValue = sticky.editable ? paramText || '–' : value === undefined ? '–' : formatNumber(value, 6);

  return (
    <div className="sticky-row" title={sticky.variable}>
      <span className="sticky-bullet" aria-hidden="true" />
      <span className="sticky-var">{relName}</span>
      {editable ? (
        <input
          className="value-chip sticky-value sticky-input"
          value={editText ?? paramText}
          placeholder={param?.defaultText ?? ''}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') setEditText(undefined);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`${sticky.variable} value`}
        />
      ) : (
        <span className="value-chip sticky-value">{displayValue}</span>
      )}
      <span className="sticky-unit">{unit ? unitLabel(unit) : ''}</span>
      <button className="sticky-btn sticky-row-remove" title={`Remove ${sticky.variable}`} aria-label={`Remove ${sticky.variable}`} onClick={onRemove}>
        <Icon.Close />
      </button>
    </div>
  );
}
