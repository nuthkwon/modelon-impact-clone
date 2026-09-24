/**
 * Stickies (UI_SPEC §5.4): small HTML cards attached to a component (offset in diagram units)
 * showing `variable = value unit`. Editable stickies (parameters) contain an input that rewrites
 * the component modifier; result stickies show the value at the slider time. Each card
 * subscribes to the slider/trajectories itself so the SVG scene does not re-render.
 */
import { useEffect, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { DiagramView, Point } from '@impact/core';
import { formatNumber, unitLabel } from '@impact/core';
import { useStore } from '../../store';
import type { Sticky, Viewport } from '../../store/types';
import { Icon } from '../icons';
import { diagramToScreen, round2 } from './geometry';

const EMPTY: Sticky[] = [];

export function Stickies({ vp, readOnly }: { vp: Viewport; readOnly: boolean }) {
  const activeClass = useStore((s) => s.activeClass);
  const stickies = useStore((s) => (activeClass ? s.stickies[activeClass] : undefined)) ?? EMPTY;
  const diagram = useStore((s) => s.diagram);
  if (!activeClass || !stickies.length) return null;
  return (
    <div className="stickies-layer">
      {stickies.map((st) => (
        <StickyCard key={st.id} sticky={st} className={activeClass} diagram={diagram} vp={vp} readOnly={readOnly} />
      ))}
    </div>
  );
}

interface StickyCardProps {
  sticky: Sticky;
  className: string;
  diagram: DiagramView | undefined;
  vp: Viewport;
  readOnly: boolean;
}

function relativeName(sticky: Sticky): string {
  return sticky.component && sticky.variable.startsWith(`${sticky.component}.`) ? sticky.variable.slice(sticky.component.length + 1) : sticky.variable;
}

function StickyCard({ sticky, className, diagram, vp, readOnly }: StickyCardProps) {
  const updateSticky = useStore((s) => s.updateSticky);
  const removeSticky = useStore((s) => s.removeSticky);
  // Re-render on anything that changes the displayed value.
  useStore((s) => s.sliderTime);
  useStore((s) => s.trajectories);
  useStore((s) => s.caseIndex);
  useStore((s) => s.activeResult);
  useStore((s) => s.results);

  const component = sticky.component ? diagram?.components.find((c) => c.name === sticky.component) : undefined;
  const origin: Point = component ? component.placement.transformation.origin : [0, 0];
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const dx = drag ? drag.dx : sticky.dx;
  const dy = drag ? drag.dy : sticky.dy;
  const [sx, sy] = diagramToScreen(vp, [origin[0] + dx, origin[1] + dy]);

  const relName = relativeName(sticky);
  const param = component?.parameters.find((p) => p.name === relName);
  const unit = param?.displayUnit ?? param?.unit;
  const value = useStore.getState().valueAt(sticky.variable);
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

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (e.button !== 0 || t.closest('input,button,select')) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    const startX = e.clientX;
    const startY = e.clientY;
    const base = { dx: sticky.dx, dy: sticky.dy };
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
      if (last.dx !== base.dx || last.dy !== base.dy) updateSticky(className, sticky.id, last);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const displayValue = sticky.editable ? paramText || '–' : value === undefined ? '–' : formatNumber(value, 6);

  return (
    <div className={`sticky${sticky.pinned ? ' pinned' : ''}${drag ? ' dragging' : ''}`} style={{ left: sx, top: sy }} onPointerDown={onPointerDown} title={sticky.variable}>
      <div className="sticky-actions">
        <button className="sticky-btn" title={sticky.pinned ? 'Unpin' : 'Pin'} aria-label={sticky.pinned ? 'Unpin' : 'Pin'} onClick={() => updateSticky(className, sticky.id, { pinned: !sticky.pinned })}>
          <Icon.Pin />
        </button>
        <button className="sticky-btn" title="Remove" aria-label="Remove sticky" onClick={() => removeSticky(className, sticky.id)}>
          <Icon.Close />
        </button>
      </div>
      <span className="sticky-var">{sticky.variable}</span>
      <span className="sticky-eq"> = </span>
      {editable ? (
        <input
          className="sticky-input"
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
        <span className="sticky-value">{displayValue}</span>
      )}
      {unit && <span className="sticky-unit"> {unitLabel(unit)}</span>}
    </div>
  );
}
