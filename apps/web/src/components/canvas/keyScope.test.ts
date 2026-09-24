import { describe, expect, it } from 'vitest';
import { canvasOwnsKey, isPointerOver, type ScopeElement } from './keyScope';

/** Minimal element double: knows its descendants and whether the pointer is over it. */
function element(children: object[] = [], hovered = false): ScopeElement & { hovered: boolean } {
  const el = {
    hovered,
    contains: (n: Node | null) => n === (el as unknown) || children.includes(n as object),
    matches: (sel: string) => {
      if (sel !== ':hover') throw new Error(`unexpected selector ${sel}`);
      return el.hovered;
    },
  };
  return el;
}

const body = {} as EventTarget;
const button = {} as EventTarget; // a focused <button> somewhere in the shell
const treeRow = {} as EventTarget; // a focusable tree row

describe('canvasOwnsKey', () => {
  it('owns the key when the diagram (or something inside it) has focus', () => {
    const inner = {} as Node;
    const svg = element([inner]);
    expect(canvasOwnsKey(svg, svg as unknown as EventTarget, false, body)).toBe(true);
    expect(canvasOwnsKey(svg, inner, false, body)).toBe(true);
  });

  it('owns the key when nothing has focus and the pointer is over the diagram', () => {
    const svg = element([], true);
    expect(canvasOwnsKey(svg, body, true, body)).toBe(true);
    expect(canvasOwnsKey(svg, null, true, body)).toBe(true);
    expect(canvasOwnsKey(svg, body, false, body)).toBe(false);
  });

  it('leaves the key to a focused button or tree row even while the pointer rests over the diagram', () => {
    const svg = element([], true);
    expect(canvasOwnsKey(svg, button, true, body)).toBe(false);
    expect(canvasOwnsKey(svg, treeRow, true, body)).toBe(false);
  });

  it('never owns a key without a diagram element', () => {
    expect(canvasOwnsKey(null, body, true, body)).toBe(false);
    expect(canvasOwnsKey(undefined, body, true, body)).toBe(false);
  });
});

describe('isPointerOver', () => {
  it('reads :hover and tolerates missing elements or unsupported selectors', () => {
    expect(isPointerOver(element([], true))).toBe(true);
    expect(isPointerOver(element([], false))).toBe(false);
    expect(isPointerOver(null)).toBe(false);
    expect(isPointerOver({ contains: () => false, matches: () => { throw new Error('unsupported'); } })).toBe(false);
  });
});
