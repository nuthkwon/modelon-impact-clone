/**
 * Component clipboard (module state, not the system clipboard). Copy stores the class,
 * placement and modified parameters of each component; paste re-adds them offset by 20 units.
 */
import type { ComponentView, DiagramView, EditOperation, EditResult, Placement } from '@impact/core';
import { extentSize } from '@impact/core';

export interface ClipboardEntry {
  className: string;
  placement: Placement;
  parameters: { name: string; valueText: string }[];
}

let clipboard: ClipboardEntry[] = [];

export const PASTE_OFFSET = 20;

export function copyComponents(diagram: DiagramView | undefined, names: string[]): number {
  if (!diagram) return 0;
  const byName = new Map(diagram.components.map((c) => [c.name, c]));
  clipboard = names
    .map((n) => byName.get(n))
    .filter((c): c is ComponentView => !!c && !c.isConnector)
    .map((c) => ({
      className: c.className,
      placement: JSON.parse(JSON.stringify(c.placement)) as Placement,
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
  for (const entry of clipboard) {
    const t = entry.placement.transformation;
    const [w] = extentSize(t.extent);
    const result = await applyEdit({
      op: 'addComponent',
      className: entry.className,
      name: undefined,
      position: [t.origin[0] + PASTE_OFFSET, t.origin[1] - PASTE_OFFSET],
      rotation: t.rotation,
      size: w > 0 ? w : undefined,
    });
    const name = result?.createdName;
    if (!name) continue;
    created.push(name);
    for (const p of entry.parameters) await applyEdit({ op: 'setParameter', component: name, name: p.name, valueText: p.valueText });
  }
  // Subsequent pastes land further away.
  clipboard = clipboard.map((e) => ({
    ...e,
    placement: { ...e.placement, transformation: { ...e.placement.transformation, origin: [e.placement.transformation.origin[0] + PASTE_OFFSET, e.placement.transformation.origin[1] - PASTE_OFFSET] } },
  }));
  return created;
}
