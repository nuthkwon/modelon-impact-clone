/**
 * Small anchored popover used by the Details panel (attributes editor, "+ New filter").
 * Renders into `document.body`, positioned below the anchor element (flips above / shifts left
 * when it would overflow the viewport). Closes on outside click and `Esc`.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface DetailsPopoverProps {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Preferred width in px. */
  width?: number;
  align?: 'left' | 'right';
  className?: string;
}

export function DetailsPopover({ anchor, open, onClose, children, width = 260, align = 'right', className }: DetailsPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', top: 0, left: 0, width, visibility: 'hidden' });

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const el = ref.current;
      const h = el?.offsetHeight ?? 200;
      const w = el?.offsetWidth ?? width;
      const margin = 8;
      let top = a.bottom + 4;
      if (top + h > window.innerHeight - margin) top = Math.max(margin, a.top - h - 4);
      let left = align === 'right' ? a.right - w : a.left;
      if (left + w > window.innerWidth - margin) left = window.innerWidth - margin - w;
      if (left < margin) left = margin;
      setStyle({ position: 'fixed', top, left, width, visibility: 'visible' });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchor, width, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (ref.current?.contains(t) || (anchor && anchor.contains(t))) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, anchor, onClose]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div ref={ref} className={`details-popover${className ? ` ${className}` : ''}`} style={style} role="dialog" onMouseDown={(e) => e.stopPropagation()}>
      {children}
    </div>,
    document.body,
  );
}
