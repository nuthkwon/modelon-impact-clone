/**
 * Component clipboard (module state, not the system clipboard). Copy stores the class, the
 * visual centre, the placement and the modified parameters of each component; paste re-adds
 * them offset by 20 units (UI_SPEC §5.1) from where the original is drawn.
 */
import type { ComponentView, DiagramView, EditOperation, EditResult, Placement, Point } from '@impact/core';
import { extentCenter, extentSize, placementBounds } from '@impact/core';

export interface ClipboardEntry {
  className: string;
  placement: Placement;
  /**
   * Visual centre of the copied component in diagram coordinates. `transformation.origin` is not
   * the position: unrotated components are stored with origin {0,0} and an absolute extent.
   */
  center: Point;
  parameters: { name: string; valueText: string }[];
}

let clipboard: ClipboardEntry[] = [];

export const PASTE_OFFSET = 20;

/** Where a pasted copy of `entry` goes: 20 units right of and below the original. */
export function pastePosition(entry: Pick<ClipboardEntry, 'center'>): Point {
  return [entry.center[0] + PASTE_OFFSET, entry.center[1] - PASTE_OFFSET];
}

export function copyComponents(diagram: DiagramView | undefined, names: string[]): number {
  if (!diagram) return 0;
  const byName = new Map(diagram.components.map((c) => [c.name, c]));
  clipboard = names
    .map((n) => byName.get(n))
    .filter((c): c is ComponentView => !!c && !c.isConnector)
    .map((c) => ({
      className: c.className,
      placement: JSON.parse(JSON.stringify(c.placement)) as Placement,
      center: extentCenter(placementBounds(c.placement, c.icon.coordinateSystem)),
      parameters: c.parameters.filter((p) => p.valueText !== undefined && p.valueText !== '' && !p.final && !p.constant).map((p) => ({ name: p.name, valueText: p.valueText! })),
    }));
  return clipboard.length;
}

export function clipboardSize(): number {
  return clipboard.length;
}

/** Re-adds the copied components; returns the names of the created components. */
export async function pasteComponents(applyEdit: (op: EditOperation) => Promise<EditResult | undefined>): Promise<string[]> {
  const created: string[] = [];
  const entries = clipboard;
  // Subsequent pastes land further away. Bumped up front so that a second paste issued while this
  // one is still awaiting its edits (Ctrl+V twice) does not land on the same spot.
  clipboard = entries.map((e) => ({ ...e, center: pastePosition(e) }));
  for (const entry of entries) {
    const t = entry.placement.transformation;
    const [w] = extentSize(t.extent);
    const result = await applyEdit({
      op: 'addComponent',
      className: entry.className,
      name: undefined,
      position: pastePosition(entry),
      rotation: t.rotation,
      size: w > 0 ? w : undefined,
    });
    const name = result?.createdName;
    if (!name) continue;
    created.push(name);
    for (const p of entry.parameters) await applyEdit({ op: 'setParameter', component: name, name: p.name, valueText: p.valueText });
  }
  return created;
}
