/** MIME type and payload of a variable drag (from CALCULATED VALUES / Variables rows onto plots or the canvas). */
export const VARIABLE_DRAG_TYPE = 'application/x-impact-variable';

export interface VariableDragPayload {
  resultId?: string;
  variable: string;
}

/** Writes the variable payload (plus a text/plain fallback) to a drag's DataTransfer. */
export function setVariableDrag(dt: DataTransfer, payload: VariableDragPayload): void {
  dt.setData(VARIABLE_DRAG_TYPE, JSON.stringify(payload));
  dt.setData('text/plain', payload.variable);
  dt.effectAllowed = 'copy';
}

/** True when a drag carries a variable (`application/x-impact-variable`). */
export function hasVariableDrag(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  return Array.from(dt.types ?? []).includes(VARIABLE_DRAG_TYPE);
}

/** Parses the variable drag payload (only readable on `drop`). */
export function readVariableDrag(dt: DataTransfer | null): VariableDragPayload | undefined {
  if (!dt) return undefined;
  try {
    const raw = dt.getData(VARIABLE_DRAG_TYPE);
    if (!raw) return undefined;
    const p = JSON.parse(raw) as Partial<VariableDragPayload>;
    if (typeof p.variable !== 'string' || !p.variable) return undefined;
    return { variable: p.variable, resultId: typeof p.resultId === 'string' ? p.resultId : undefined };
  } catch {
    return undefined;
  }
}
