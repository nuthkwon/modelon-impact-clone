/**
 * Zoom/pan state of the canvas. The viewport is local React state for smooth interaction and
 * is mirrored into the store (`viewports[className]`, debounced) so it survives class switches.
 * On class open the stored viewport is restored, otherwise the diagram extent is fitted.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Extent, Point } from '@impact/core';
import { useStore } from '../../store';
import type { Viewport } from '../../store/types';
import { FIT_PADDING, fitViewport, panBy, viewportMatrix, zoomAt } from './geometry';

export interface ViewportApi {
  vp: Viewport;
  /** `matrix(s 0 0 -s tx ty)` as an object. */
  matrix: ReturnType<typeof viewportMatrix>;
  /** Canvas element size in CSS pixels. */
  size: { width: number; height: number };
  set(vp: Viewport): void;
  fit(): void;
  zoomBy(factor: number, at?: Point): void;
  zoomAtScreen(at: Point, factor: number): void;
  pan(dx: number, dy: number): void;
  /** Converts a client (viewport) position to canvas-relative screen pixels. */
  clientToScreen(clientX: number, clientY: number): Point;
}

const DEFAULT_VP: Viewport = { scale: 1, tx: 0, ty: 0 };
const SAVE_DEBOUNCE_MS = 300;

export function useViewport(containerRef: RefObject<HTMLElement | null>, className: string | undefined, extent: Extent | undefined): ViewportApi {
  const setViewportStore = useStore((s) => s.setViewport);
  const [vp, setVp] = useState<Viewport>(() => (className ? useStore.getState().viewports[className] : undefined) ?? DEFAULT_VP);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const extentRef = useRef(extent);
  extentRef.current = extent;
  /** Class whose viewport has been initialised (restored or fitted). */
  const initializedFor = useRef<string | undefined>(undefined);
  const pendingFit = useRef(false);

  // Track the container size.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      const next = { width: r.width, height: r.height };
      if (next.width !== sizeRef.current.width || next.height !== sizeRef.current.height) setSize(next);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  const doFit = useCallback(() => {
    const { width, height } = sizeRef.current;
    const ext = extentRef.current ?? [[-100, -100], [100, 100]];
    if (width <= 0 || height <= 0) {
      pendingFit.current = true;
      return;
    }
    pendingFit.current = false;
    setVp(fitViewport(ext, width, height, FIT_PADDING));
  }, []);

  // Restore or fit when the class changes.
  useEffect(() => {
    if (!className) {
      initializedFor.current = undefined;
      return;
    }
    if (initializedFor.current === className) return;
    initializedFor.current = className;
    const stored = useStore.getState().viewports[className];
    if (stored && Number.isFinite(stored.scale) && stored.scale > 0) {
      pendingFit.current = false;
      setVp(stored);
    } else {
      doFit();
    }
  }, [className, doFit]);

  // A fit requested before the container had a size runs once it has one (or when the extent arrives).
  useEffect(() => {
    if (pendingFit.current && size.width > 0 && size.height > 0) doFit();
  }, [size, extent, doFit]);

  // Debounced store sync.
  useEffect(() => {
    if (!className || initializedFor.current !== className || pendingFit.current) return;
    const stored = useStore.getState().viewports[className];
    if (stored && stored.scale === vp.scale && stored.tx === vp.tx && stored.ty === vp.ty) return;
    const t = setTimeout(() => setViewportStore(className, vp), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [vp, className, setViewportStore]);

  const clientToScreen = useCallback(
    (clientX: number, clientY: number): Point => {
      const el = containerRef.current;
      if (!el) return [clientX, clientY];
      const r = el.getBoundingClientRect();
      return [clientX - r.left, clientY - r.top];
    },
    [containerRef],
  );

  const zoomAtScreen = useCallback((at: Point, factor: number) => setVp((v) => zoomAt(v, at, factor)), []);
  const zoomBy = useCallback(
    (factor: number, at?: Point) => {
      const { width, height } = sizeRef.current;
      zoomAtScreen(at ?? [width / 2, height / 2], factor);
    },
    [zoomAtScreen],
  );
  const pan = useCallback((dx: number, dy: number) => setVp((v) => panBy(v, dx, dy)), []);
  const set = useCallback((next: Viewport) => setVp(next), []);

  // Wheel: Ctrl/pinch zooms about the cursor, plain wheel pans. Needs a non-passive listener.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Let plot windows and other overlays scroll themselves.
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-canvas-scroll]')) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? sizeRef.current.height : 1;
      const dy = e.deltaY * unit;
      const dx = e.deltaX * unit;
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.min(2, Math.max(0.5, Math.exp(-dy * 0.0025)));
        zoomAtScreen(clientToScreen(e.clientX, e.clientY), factor);
      } else if (e.shiftKey && Math.abs(dx) < 1e-6) {
        pan(-dy, 0);
      } else {
        pan(-dx, -dy);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [containerRef, zoomAtScreen, pan, clientToScreen]);

  const matrix = useMemo(() => viewportMatrix(vp), [vp]);

  return useMemo<ViewportApi>(
    () => ({ vp, matrix, size, set, fit: doFit, zoomBy, zoomAtScreen, pan, clientToScreen }),
    [vp, matrix, size, set, doFit, zoomBy, zoomAtScreen, pan, clientToScreen],
  );
}
