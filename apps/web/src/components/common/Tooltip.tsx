/**
 * Tooltip: wraps a single element and shows `text` in a `.tooltip` after a 500ms hover delay.
 *
 *   <Tooltip text="Model mode (1)"><button/></Tooltip>
 *
 * The child receives mouse/focus handlers (existing handlers are preserved). Disabled buttons do
 * not emit mouse events, so a disabled child is wrapped in a `span.tooltip-anchor` instead.
 * Props: `text` (string; empty/undefined hides the tooltip), `placement` ('bottom' default,
 * 'top', 'left', 'right'), `delay` (ms, default 500), `disabled`.
 */
import { cloneElement, isValidElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode, SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import './common.css';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  text?: ReactNode;
  children: ReactElement;
  placement?: TooltipPlacement;
  delay?: number;
  disabled?: boolean;
}

interface Pos { left: number; top: number }

function computePosition(anchor: DOMRect, tip: DOMRect, placement: TooltipPlacement): Pos {
  const gap = 6;
  let left: number;
  let top: number;
  switch (placement) {
    case 'top':
      left = anchor.left + anchor.width / 2 - tip.width / 2;
      top = anchor.top - tip.height - gap;
      break;
    case 'left':
      left = anchor.left - tip.width - gap;
      top = anchor.top + anchor.height / 2 - tip.height / 2;
      break;
    case 'right':
      left = anchor.right + gap;
      top = anchor.top + anchor.height / 2 - tip.height / 2;
      break;
    default:
      left = anchor.left + anchor.width / 2 - tip.width / 2;
      top = anchor.bottom + gap;
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (top + tip.height > vh - 4) top = anchor.top - tip.height - gap;
  if (top < 4) top = anchor.bottom + gap;
  left = Math.max(4, Math.min(left, vw - tip.width - 4));
  return { left, top };
}

export function Tooltip({ text, children, placement = 'bottom', delay = 500, disabled }: TooltipProps) {
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const tipRef = useRef<HTMLDivElement>(null);
  const multiline = typeof text === 'string' && text.includes('\n');

  const clear = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  const hide = useCallback(() => {
    clear();
    setAnchorRect(null);
    setPos(null);
  }, [clear]);

  const show = useCallback(
    (el: Element) => {
      if (disabled || text === undefined || text === null || text === '') return;
      clear();
      const rect = el.getBoundingClientRect();
      timer.current = window.setTimeout(() => setAnchorRect(rect), delay);
    },
    [clear, delay, disabled, text],
  );

  useEffect(() => clear, [clear]);
  useEffect(() => {
    if (!anchorRect) return;
    const off = () => hide();
    window.addEventListener('scroll', off, true);
    window.addEventListener('resize', off);
    window.addEventListener('keydown', off);
    window.addEventListener('mousedown', off, true);
    return () => {
      window.removeEventListener('scroll', off, true);
      window.removeEventListener('resize', off);
      window.removeEventListener('keydown', off);
      window.removeEventListener('mousedown', off, true);
    };
  }, [anchorRect, hide]);

  useLayoutEffect(() => {
    if (!anchorRect || !tipRef.current) return;
    setPos(computePosition(anchorRect, tipRef.current.getBoundingClientRect(), placement));
  }, [anchorRect, placement, text]);

  if (!isValidElement(children)) return children;
  const child = children as ReactElement<Record<string, unknown>>;
  const childProps = child.props;
  const isDisabled = Boolean(childProps.disabled);

  const handlers = {
    onMouseEnter: (e: SyntheticEvent) => show(e.currentTarget),
    onMouseLeave: () => hide(),
    onFocus: (e: SyntheticEvent) => show(e.currentTarget),
    onBlur: () => hide(),
    onMouseDown: () => hide(),
  };

  const compose = (name: keyof typeof handlers) => (e: SyntheticEvent) => {
    const own = childProps[name];
    if (typeof own === 'function') (own as (ev: SyntheticEvent) => void)(e);
    handlers[name](e as never);
  };

  const anchor = isDisabled ? (
    <span className="tooltip-anchor" onMouseEnter={handlers.onMouseEnter} onMouseLeave={handlers.onMouseLeave}>
      {children}
    </span>
  ) : (
    cloneElement(child, {
      onMouseEnter: compose('onMouseEnter'),
      onMouseLeave: compose('onMouseLeave'),
      onFocus: compose('onFocus'),
      onBlur: compose('onBlur'),
      onMouseDown: compose('onMouseDown'),
    })
  );

  return (
    <>
      {anchor}
      {anchorRect &&
        createPortal(
          <div
            ref={tipRef}
            role="tooltip"
            className={`tooltip${pos ? ' visible' : ''}${multiline ? ' multiline' : ''}`}
            style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}

export default Tooltip;
