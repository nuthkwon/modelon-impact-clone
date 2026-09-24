/**
 * ResizablePanel: a panel with a drag handle on its inner edge.
 *
 *   <ResizablePanel side="left" size={width} min={200} max={window.innerWidth / 2}
 *                   onResize={setWidth} onCollapse={() => setOpen(false)}>…</ResizablePanel>
 *
 * - `side="left"`  → handle on the right edge, controls width.
 * - `side="right"` → handle on the left edge, controls width.
 * - `side="bottom"`→ handle on the top edge, controls height.
 * `min`/`max` clamp the size (`max` defaults to 50% of the viewport). Dragging below
 * `min - collapseThreshold` (default 60px) calls `onCollapse` when provided. `onResizeEnd`
 * fires once when the drag finishes (persist sizes there).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import './common.css';

export type ResizableSide = 'left' | 'right' | 'bottom';

export interface ResizablePanelProps {
  side: ResizableSide;
  size: number;
  min?: number;
  max?: number;
  onResize: (size: number) => void;
  onResizeEnd?: (size: number) => void;
  onCollapse?: () => void;
  collapseThreshold?: number;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Disable the handle (still renders the panel at `size`). */
  disabled?: boolean;
}

export function clampSize(size: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, size)));
}

export function ResizablePanel({ side, size, min = 200, max, onResize, onResizeEnd, onCollapse, collapseThreshold = 60, children, className, style, disabled }: ResizablePanelProps) {
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ start: number; startSize: number; last: number } | null>(null);
  const horizontal = side !== 'bottom';

  const maxSize = useCallback(() => max ?? Math.floor((horizontal ? window.innerWidth : window.innerHeight) / 2), [max, horizontal]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { start: horizontal ? e.clientX : e.clientY, startSize: size, last: size };
    setDragging(true);
    document.body.classList.add(horizontal ? 'resizing-col' : 'resizing-row');
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const cur = horizontal ? e.clientX : e.clientY;
    let delta = cur - d.start;
    if (side === 'right' || side === 'bottom') delta = -delta;
    const raw = d.startSize + delta;
    if (onCollapse && raw < min - collapseThreshold) {
      finish(e);
      onCollapse();
      return;
    }
    const next = clampSize(raw, min, maxSize());
    if (next !== d.last) {
      d.last = next;
      onResize(next);
    }
  };

  const finish = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    document.body.classList.remove('resizing-col', 'resizing-row');
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    onResizeEnd?.(d.last);
  };

  useEffect(() => () => document.body.classList.remove('resizing-col', 'resizing-row'), []);

  const dim: CSSProperties = horizontal ? { width: size } : { height: size };
  return (
    <div className={`resizable side-${side}${className ? ` ${className}` : ''}`} style={{ ...dim, ...style }}>
      <div className="resizable-content">{children}</div>
      {!disabled && (
        <div
          className={`resizable-handle${dragging ? ' dragging' : ''}`}
          role="separator"
          aria-orientation={horizontal ? 'vertical' : 'horizontal'}
          aria-valuenow={size}
          aria-valuemin={min}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finish}
          onPointerCancel={finish}
          onDoubleClick={() => onCollapse?.()}
        />
      )}
    </div>
  );
}

export default ResizablePanel;
