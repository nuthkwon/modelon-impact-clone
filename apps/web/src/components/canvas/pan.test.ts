import { describe, expect, it } from 'vitest';
import { cursorStateOf, startsPan } from './useInteractions';

const base = { button: 0, spaceHeld: false, tool: 'select' as const, readOnly: false, onBackground: true, shiftKey: false };

describe('startsPan', () => {
  it('keeps Impact behaviour in the Select tool on an editable canvas: background drag selects', () => {
    expect(startsPan(base)).toBe(false);
    expect(startsPan({ ...base, onBackground: false })).toBe(false);
  });

  it('pans with the Pan tool anywhere, even over components', () => {
    expect(startsPan({ ...base, tool: 'pan' })).toBe(true);
    expect(startsPan({ ...base, tool: 'pan', onBackground: false })).toBe(true);
    expect(startsPan({ ...base, tool: 'pan', readOnly: true, onBackground: false })).toBe(true);
  });

  it('pans with Space + left drag and with the middle button', () => {
    expect(startsPan({ ...base, spaceHeld: true, onBackground: false })).toBe(true);
    expect(startsPan({ ...base, button: 1, onBackground: false })).toBe(true);
  });

  it('pans on the background of a read-only canvas unless Shift is held', () => {
    expect(startsPan({ ...base, readOnly: true })).toBe(true);
    expect(startsPan({ ...base, readOnly: true, shiftKey: true })).toBe(false);
    expect(startsPan({ ...base, readOnly: true, onBackground: false })).toBe(false);
  });

  it('leaves the right button to the press/drag disambiguation', () => {
    expect(startsPan({ ...base, button: 2 })).toBe(false);
    expect(startsPan({ ...base, button: 2, tool: 'pan' })).toBe(false);
  });
});

describe('cursorStateOf', () => {
  const idle = { kind: 'idle' } as const;
  it('shows the open hand when the Pan tool is active or Space is held', () => {
    expect(cursorStateOf(idle, false, 'select')).toBe('idle');
    expect(cursorStateOf(idle, true, 'select')).toBe('hand');
    expect(cursorStateOf(idle, false, 'pan')).toBe('hand');
  });

  it('shows the closed hand while panning and the plain cursor while a right press is undecided', () => {
    expect(cursorStateOf({ kind: 'pan', startClient: [0, 0], startVp: { scale: 1, tx: 0, ty: 0 }, button: 0 }, false, 'pan')).toBe('pan');
    expect(cursorStateOf({ kind: 'rightPress', startClient: [0, 0], startVp: { scale: 1, tx: 0, ty: 0 } }, false, 'select')).toBe('idle');
  });
});
