/**
 * Popover anchored to an element (fixed-positioned, clamped to the viewport).
 *
 *   const [anchor, setAnchor] = useState<HTMLElement | null>(null);
 *   <button onClick={(e) => setAnchor(e.currentTarget)}>…</button>
 *   <Popover anchor={anchor} open={!!anchor} onClose={() => setAnchor(null)} placement="bottom-end">
 *     <MenuList items={items} onClose={() => setAnchor(null)} />
 *   </Popover>
 *
 * Closes on outside mousedown, Escape, window resize/scroll (outside the popover). `placement`:
 * 'bottom-start' (default) | 'bottom-end' | 'top-start' | 'top-end' | 'right-start' | 'left-start'.
 * `offset` is the gap in px (default 4). `closeOnScroll` defaults to true.
 * Use `hover` to open/close with mouse hover (the popover stays open while hovered).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './common.css';

export type PopoverPlacement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' | 'right-start' | 'left-start' | 'bottom-center';

export interface PopoverProps {
  anchor: HTMLElement | null | undefined;
  open: boolean;
  onClose: () => void;
  children?: ReactNode;
  placement?: PopoverPlacement;
  offset?: number;
  className?: string;
  style?: CSSProperties;
  /** Match the anchor width. */
  matchWidth?: boolean;
  closeOnScroll?: boolean;
  /** Called when the mouse leaves both anchor and popover (hover menus). */
  onMouseLeave?: () => void;
  onMouseEnter?: () => void;
  zIndex?: number;
}

export function Popover({ anchor, open, onClose, children, placement = 'bottom-start', offset = 4, className, style, matchWidth, closeOnScroll = true, onMouseLeave, onMouseEnter, zIndex }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; minWidth?: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor || !ref.current) return;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const p = ref.current!.getBoundingClientRect();
      let left = a.left;
      let top = a.bottom + offset;
      switch (placement) {
        case 'bottom-end':
          left = a.right - p.width;
          break;
        case 'bottom-center':
          left = a.left + a.width / 2 - p.width / 2;
          break;
        case 'top-start':
          top = a.top - p.height - offset;
          break;
        case 'top-end':
          left = a.right - p.width;
          top = a.top - p.height - offset;
          break;
        case 'right-start':
          left = a.right + offset;
          top = a.top;
          break;
        case 'left-start':
          left = a.left - p.width - offset;
          top = a.top;
          break;
        default:
          break;
      }
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (top + p.height > vh - 4) top = Math.max(4, placement.startsWith('bottom') ? a.top - p.height - offset : vh - p.height - 4);
      if (top < 4) top = 4;
      if (left + p.width > vw - 4) left = Math.max(4, vw - p.width - 4);
      if (left < 4) left = 4;
      setPos({ left, top, minWidth: matchWidth ? a.width : undefined });
    };
    place();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : undefined;
    ro?.observe(ref.current);
    return () => ro?.disconnect();
  }, [open, anchor, placement, offset, matchWidth, children]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (anchor && anchor.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onScroll = (e: Event) => {
      if (!closeOnScroll) return;
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const onResize = () => onClose();
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, anchor, onClose, closeOnScroll]);

  if (!open || !anchor) return null;
  return createPortal(
    <div
      ref={ref}
      className={`popover${className ? ` ${className}` : ''}`}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, minWidth: pos?.minWidth, visibility: pos ? 'visible' : 'hidden', zIndex, ...style }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </div>,
    document.body,
  );
}

export default Popover;
