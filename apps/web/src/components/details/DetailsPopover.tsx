/**
 * Anchored popover used by the Details panel (attributes editor, "+ New filter"): a thin
 * wrapper around the shared `Popover` that adds the panel's padding/width conventions.
 */
import type { ReactNode } from 'react';
import { Popover } from '../common/Popover';

export interface DetailsPopoverProps {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Preferred width in px. */
  width?: number;
  /** Horizontal alignment relative to the anchor. */
  align?: 'left' | 'right';
  className?: string;
}

export function DetailsPopover({ anchor, open, onClose, children, width = 260, align = 'right', className }: DetailsPopoverProps) {
  return (
    <Popover anchor={anchor} open={open} onClose={onClose} placement={align === 'right' ? 'bottom-end' : 'bottom-start'} className={`details-popover${className ? ` ${className}` : ''}`} style={{ width }} closeOnScroll={false}>
      {children}
    </Popover>
  );
}
