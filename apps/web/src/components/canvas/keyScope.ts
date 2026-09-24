/**
 * Scope of the canvas's window-level key listeners (Space → pan mode, ← / → → time slider).
 * They must not steal keys from the widget the user is working in: a focused button is
 * activated by Space, tree rows expand/collapse with the arrow keys. The diagram owns a key
 * only when it has focus (the event target is the diagram or something inside it) or when
 * nothing in particular has focus (the target is the document body) while the pointer is over
 * the diagram.
 */

/** The subset of `Element` the scope test needs (kept minimal so the logic is testable without a DOM). */
export interface ScopeElement {
  contains(node: Node | null): boolean;
  matches(selectors: string): boolean;
}

/** True while the pointer is over `el` (`:hover`); false when the selector is unsupported. */
export function isPointerOver(el: ScopeElement | null | undefined): boolean {
  try {
    return !!el && el.matches(':hover');
  } catch {
    return false;
  }
}

/**
 * Whether a key event dispatched at `target` belongs to the diagram `svg`.
 * `hovered` is `isPointerOver(svg)`, `body` the document body (the target when nothing has focus).
 */
export function canvasOwnsKey(svg: ScopeElement | null | undefined, target: EventTarget | null, hovered: boolean, body: EventTarget | null | undefined): boolean {
  if (!svg) return false;
  if (target && target !== body && svg.contains(target as Node)) return true;
  const unfocused = target === null || target === body || (typeof document !== 'undefined' && (target === document || target === document.documentElement));
  return unfocused && hovered;
}
