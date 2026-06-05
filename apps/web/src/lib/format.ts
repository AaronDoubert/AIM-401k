import type { Quantity } from "@condenser/core-model";

/** Round to a number of significant figures for clean display. */
export function sigFigs(value: number, figs = 4): number {
  if (value === 0 || !Number.isFinite(value)) return value;
  const d = Math.ceil(Math.log10(Math.abs(value)));
  const power = figs - d;
  const mag = Math.pow(10, power);
  return Math.round(value * mag) / mag;
}

/** Human-readable quantity, e.g. { value: 994.72, unit: "Hz" } -> "994.7 Hz". */
export function fmtQ(q: Quantity | undefined): string {
  if (!q) return "—";
  return `${sigFigs(q.value)} ${q.unit}`;
}

/** Short label for a level badge. */
export function levelLabel(level: 0 | 1 | 2 | 3): string {
  return `L${level}`;
}

const LEVEL_NAMES = [
  "Formless",
  "Interface-defined",
  "Parameterized",
  "Real part",
] as const;

export function levelName(level: 0 | 1 | 2 | 3): string {
  return LEVEL_NAMES[level];
}
