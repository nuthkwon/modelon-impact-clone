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

/**
 * Linear unit conversions `to = from * factor + offset` between an SI unit and a display unit
 * (the pairs used by the shipped library's `displayUnit` attributes).
 */
const UNIT_CONVERSIONS: Record<string, { factor: number; offset: number }> = {
  'K>degC': { factor: 1, offset: -273.15 },
  'K>degF': { factor: 1.8, offset: -459.67 },
  'rad>deg': { factor: 180 / Math.PI, offset: 0 },
  'rad/s>rpm': { factor: 30 / Math.PI, offset: 0 },
  'rad/s>rev/min': { factor: 30 / Math.PI, offset: 0 },
  'rad/s>deg/s': { factor: 180 / Math.PI, offset: 0 },
  'm/s>km/h': { factor: 3.6, offset: 0 },
  'Pa>bar': { factor: 1e-5, offset: 0 },
  'Pa>kPa': { factor: 1e-3, offset: 0 },
  'Pa>MPa': { factor: 1e-6, offset: 0 },
  'W>kW': { factor: 1e-3, offset: 0 },
  'W>MW': { factor: 1e-6, offset: 0 },
  'J>kJ': { factor: 1e-3, offset: 0 },
  'J>kWh': { factor: 1 / 3.6e6, offset: 0 },
  'J>MJ': { factor: 1e-6, offset: 0 },
  's>min': { factor: 1 / 60, offset: 0 },
  's>h': { factor: 1 / 3600, offset: 0 },
  's>ms': { factor: 1e3, offset: 0 },
  'm>mm': { factor: 1e3, offset: 0 },
  'm>cm': { factor: 1e2, offset: 0 },
  'm>km': { factor: 1e-3, offset: 0 },
  'm3>l': { factor: 1e3, offset: 0 },
  'm3/s>l/min': { factor: 6e4, offset: 0 },
  'm3/s>l/s': { factor: 1e3, offset: 0 },
  'kg>g': { factor: 1e3, offset: 0 },
  'kg/s>g/s': { factor: 1e3, offset: 0 },
  'V>kV': { factor: 1e-3, offset: 0 },
  'V>mV': { factor: 1e3, offset: 0 },
  'A>mA': { factor: 1e3, offset: 0 },
  'A>kA': { factor: 1e-3, offset: 0 },
  'Ohm>kOhm': { factor: 1e-3, offset: 0 },
  'Ohm>MOhm': { factor: 1e-6, offset: 0 },
  'F>uF': { factor: 1e6, offset: 0 },
  'F>nF': { factor: 1e9, offset: 0 },
  'H>mH': { factor: 1e3, offset: 0 },
  'Hz>kHz': { factor: 1e-3, offset: 0 },
  'N.m>kN.m': { factor: 1e-3, offset: 0 },
  'N>kN': { factor: 1e-3, offset: 0 },
};

/** Returns the conversion from `unit` to `displayUnit`, or undefined when unknown/identical. */
export function unitConversion(unit?: string, displayUnit?: string): { factor: number; offset: number } | undefined {
  if (!unit || !displayUnit || unit === displayUnit) return undefined;
  return UNIT_CONVERSIONS[`${unit}>${displayUnit}`];
}

/** Converts `value` in `unit` to `displayUnit` when a conversion is known; otherwise returns it unchanged with `unit`. */
export function toDisplayUnit(value: number, unit?: string, displayUnit?: string): { value: number; unit?: string } {
  const c = unitConversion(unit, displayUnit);
  if (!c) return { value, unit: unit ?? displayUnit };
  return { value: value * c.factor + c.offset, unit: displayUnit };
}
