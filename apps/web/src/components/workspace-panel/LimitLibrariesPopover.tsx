/**
 * "Limit libraries" popover under the funnel button: one checkbox per library.
 */
import { useEffect, useRef } from 'react';
import type { LibraryInfo } from '@impact/core';

export interface LimitLibrariesPopoverProps {
  libraries: LibraryInfo[];
  hidden: ReadonlySet<string>;
  onToggle(libraryId: string): void;
  onShowAll(): void;
  onClose(): void;
}

export function LimitLibrariesPopover({ libraries, hidden, onToggle, onShowAll, onClose }: LimitLibrariesPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = ref.current;
      if (el && !el.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.wp-funnel')) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="wp-popover" role="dialog" aria-label="Limit libraries">
      <div className="wp-popover-title">Limit libraries</div>
      {libraries.length === 0 && <div className="wp-popover-empty">No libraries loaded</div>}
      {libraries.map((lib) => (
        <label key={lib.id} className="wp-check">
          <input type="checkbox" checked={!hidden.has(lib.id)} onChange={() => onToggle(lib.id)} />
          <span className="wp-check-label">{lib.name}</span>
          {lib.readOnly && <span className="wp-check-hint">read-only</span>}
        </label>
      ))}
      <div className="wp-popover-actions">
        <button type="button" className="text-button" onClick={onShowAll} disabled={hidden.size === 0}>
          Show all
        </button>
        <button type="button" className="text-button" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
