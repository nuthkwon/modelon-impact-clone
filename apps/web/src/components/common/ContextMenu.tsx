/**
 * Context menus and dropdown menu lists.
 *
 *   const menu = useContextMenu();
 *   <div onContextMenu={(e) => menu.open(e, [{ label: 'Open', onSelect }, { separator: true }, ...])} />
 *
 * `open(e, items)` prevents the default browser menu and shows a `.menu` at the pointer
 * position (clamped to the viewport). The menu closes on outside click, Escape, scroll, resize,
 * or after an item is selected. A single `<ContextMenuHost/>` (mounted by the app shell in
 * App.tsx) renders the currently open menu; other modules only call the hook.
 *
 * `MenuList` renders a list of `MenuItem`s (used by Popover-anchored dropdowns too):
 *   <MenuList items={items} onClose={close} />
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { create } from 'zustand';
import { CheckIcon } from '../icons';
import './common.css';

export interface MenuItem {
  label?: string;
  icon?: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  /** Renders a divider instead of an item (other fields ignored). */
  separator?: boolean;
  danger?: boolean;
  /** Right-aligned shortcut hint, e.g. "Ctrl+C". */
  shortcut?: string;
  /** Shows a check mark in front of the label (toggle items). */
  checked?: boolean;
  /** Non-interactive uppercase header row. */
  header?: boolean;
  /** Optional tooltip for the item (title attribute). */
  title?: string;
}

interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
  items: MenuItem[];
  show(x: number, y: number, items: MenuItem[]): void;
  close(): void;
}

export const useContextMenuStore = create<ContextMenuState>()((set) => ({
  open: false,
  x: 0,
  y: 0,
  items: [],
  show(x, y, items) {
    set({ open: true, x, y, items });
  },
  close() {
    set({ open: false, items: [] });
  },
}));

export interface ContextMenuApi {
  /** Opens the menu at the event position (calls preventDefault/stopPropagation). */
  open(e: ReactMouseEvent | MouseEvent, items: MenuItem[]): void;
  /** Opens the menu at explicit viewport coordinates. */
  openAt(x: number, y: number, items: MenuItem[]): void;
  close(): void;
}

const api: ContextMenuApi = {
  open(e, items) {
    e.preventDefault();
    e.stopPropagation();
    useContextMenuStore.getState().show(e.clientX, e.clientY, items);
  },
  openAt(x, y, items) {
    useContextMenuStore.getState().show(x, y, items);
  },
  close() {
    useContextMenuStore.getState().close();
  },
};

/** Returns a stable API object: `{ open(e, items), openAt(x, y, items), close() }`. */
export function useContextMenu(): ContextMenuApi {
  return api;
}

/** Imperative access for non-React code. */
export const contextMenu = api;

export interface MenuListProps {
  items: MenuItem[];
  onClose?: () => void;
  className?: string;
  style?: CSSProperties;
  /** When true (default) the list is rendered with the `.menu` fixed-positioned chrome. */
  chrome?: boolean;
  autoFocus?: boolean;
}

export function MenuList({ items, onClose, className, style, chrome = true, autoFocus = true }: MenuListProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    const first = ref.current?.querySelector<HTMLButtonElement>('button.menu-item:not(:disabled)');
    first?.focus({ preventScroll: true });
  }, [autoFocus]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button.menu-item:not(:disabled)') ?? []);
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      buttons[(idx + 1) % buttons.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      buttons[(idx - 1 + buttons.length) % buttons.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      buttons[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      buttons[buttons.length - 1]?.focus();
    }
  };

  return (
    <div ref={ref} role="menu" className={`${chrome ? 'menu ' : ''}menu-list${className ? ` ${className}` : ''}`} style={style} onKeyDown={onKeyDown}>
      {items.map((item, i) => {
        if (item.separator) return <div key={`sep-${i}`} className="menu-separator" role="separator" />;
        if (item.header) return <div key={`hdr-${i}`} className="menu-header">{item.label}</div>;
        return (
          <button
            key={`${item.label ?? ''}-${i}`}
            type="button"
            role="menuitem"
            className={`menu-item${item.danger ? ' danger' : ''}`}
            disabled={item.disabled}
            title={item.title}
            onClick={(e) => {
              e.stopPropagation();
              onClose?.();
              item.onSelect?.();
            }}
          >
            {item.checked !== undefined && <span className="menu-item-check">{item.checked ? <CheckIcon size={16} /> : null}</span>}
            {item.icon !== undefined && <span className="menu-item-icon">{item.icon}</span>}
            <span className="menu-item-label">{item.label}</span>
            {item.shortcut && <span className="menu-item-shortcut">{item.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Renders the global context menu; mount once (done in App.tsx). */
export function ContextMenuHost() {
  const { open, x, y, items, close } = useContextMenuStore();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });

  useLayoutEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4));
    const top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4));
    setPos({ left, top });
  }, [open, x, y, items]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    const off = () => close();
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('contextmenu', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', off);
    window.addEventListener('scroll', off, true);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('contextmenu', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', off);
      window.removeEventListener('scroll', off, true);
      window.removeEventListener('blur', off);
    };
  }, [open, close]);

  if (!open) return null;
  return (
    <div ref={ref} className="menu" style={{ left: pos.left, top: pos.top }} onContextMenu={(e) => e.preventDefault()}>
      <MenuList chrome={false} items={items} onClose={close} />
    </div>
  );
}

export default ContextMenuHost;
