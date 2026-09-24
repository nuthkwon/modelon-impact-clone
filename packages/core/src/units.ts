/** Small formatting helpers shared by UI and server logs. */

export function formatNumber(v: number, digits = 6): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1e6 || abs < 1e-4) return v.toExponential(Math.max(0, digits - 1)).replace(/\.?0+e/, 'e');
  const s = v.toPrecision(digits);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Renders a Modelica unit string for display, e.g. `Ohm` -> `Ω`, `m/s2` -> `m/s²`. */
export function unitLabel(unit?: string): string {
  if (!unit) return '';
  return unit
    .replace(/Ohm/g, 'Ω')
    .replace(/degC/g, '°C')
    .replace(/deg/g, '°')
    .replace(/\b([a-zA-Z]+)2\b/g, '$1²')
    .replace(/\b([a-zA-Z]+)3\b/g, '$1³');
}
