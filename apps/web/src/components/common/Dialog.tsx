/**
 * Modal dialog rendered in a portal with the `.dialog-*` classes from global.css.
 *
 *   <Dialog open title="New class" onClose={close} onSubmit={create}
 *           actions={<><button className="text-button" onClick={close}>Cancel</button>
 *                     <button className="contained-button" onClick={create}>Create</button></>}>
 *     ...fields...
 *   </Dialog>
 *
 * Behaviour: Escape and backdrop click call `onClose`; the first input/select/textarea (or the
 * first focusable element) in the body is focused on open; pressing Enter inside an input or
 * select calls `onSubmit` when given. `width` sets a fixed width in px; `size` picks a preset.
 */
import { useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from '../icons';
import './common.css';

export interface DialogProps {
  open: boolean;
  title?: ReactNode;
  onClose: () => void;
  /** Called on Enter inside an input/select (not textarea). */
  onSubmit?: () => void;
  actions?: ReactNode;
  children?: ReactNode;
  width?: number;
  size?: 'compact' | 'default' | 'wide';
  /** Show an × button in the title (default true). */
  closeButton?: boolean;
  /** Prevent closing via backdrop/Escape (e.g. while busy). */
  persistent?: boolean;
  className?: string;
  /** Extra CSS class for the body container. */
  bodyClassName?: string;
  /** z-index override (stacked dialogs). */
  zIndex?: number;
}

export function Dialog({ open, title, onClose, onSubmit, actions, children, width, size = 'default', closeButton = true, persistent, className, bodyClassName, zIndex }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement;
    const t = window.setTimeout(() => {
      const root = bodyRef.current ?? ref.current;
      const dialog = ref.current;
      const actionButtons = Array.from(dialog?.querySelectorAll('.dialog-actions button:not(:disabled)') ?? []) as HTMLElement[];
      const first =
        root?.querySelector<HTMLElement>('input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled)') ??
        dialog?.querySelector<HTMLElement>('[data-autofocus]:not(:disabled)') ??
        root?.querySelector<HTMLElement>('button:not(:disabled):not(.dialog-close), [tabindex]:not([tabindex="-1"])') ??
        actionButtons[actionButtons.length - 1] ??
        ref.current;
      first?.focus({ preventScroll: true });
      if (first instanceof HTMLInputElement && (first.type === 'text' || first.type === '')) first.select();
    }, 10);
    return () => {
      window.clearTimeout(t);
      const prev = previousFocus.current;
      if (prev instanceof HTMLElement) prev.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!persistent) onClose();
      return;
    }
    if (e.key === 'Enter' && onSubmit) {
      const t = e.target as HTMLElement;
      const tag = t.tagName;
      if (tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A') return;
      if (t.isContentEditable) return;
      if (t.closest('.cm-editor')) return;
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      onSubmit();
    }
  };

  const onBackdropMouseDown = (e: ReactMouseEvent) => {
    if (e.target === e.currentTarget && !persistent) onClose();
  };

  return createPortal(
    <div className="dialog-backdrop" onMouseDown={onBackdropMouseDown} style={zIndex ? { zIndex } : undefined}>
      <div
        ref={ref}
        className={`dialog ${size !== 'default' ? size : ''}${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        style={width ? { width, minWidth: Math.min(width, 420) } : undefined}
        onKeyDown={onKeyDown}
      >
        {(title || closeButton) && (
          <div className="dialog-title">
            <span>{title}</span>
            {closeButton && (
              <button type="button" className="icon-button dialog-close" aria-label="Close" onClick={onClose}>
                <CloseIcon />
              </button>
            )}
          </div>
        )}
        <div ref={bodyRef} className={`dialog-body${bodyClassName ? ` ${bodyClassName}` : ''}`}>{children}</div>
        {actions && <div className="dialog-actions">{actions}</div>}
      </div>
    </div>,
    document.body,
  );
}

export default Dialog;
