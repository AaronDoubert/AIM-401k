import { unit as mathjsUnit } from "mathjs";
import type { Quantity } from "./types.js";

/**
 * Construct a Quantity.
 */
export function q(value: number, unit: string): Quantity {
  return { value, unit };
}

/**
 * Unit-aware equality: converts both quantities to the same base unit and compares.
 */
export function qEquals(a: Quantity, b: Quantity): boolean {
  try {
    const ua = mathjsUnit(a.value, a.unit);
    const ub = mathjsUnit(b.value, b.unit);
    // Convert b to a's unit and compare values
    const bInA = ub.toNumber(a.unit);
    return Math.abs(a.value - bInA) < 1e-12 * Math.max(Math.abs(a.value), Math.abs(bInA), 1);
  } catch {
    // If units are incompatible, fall back to exact match
    return a.value === b.value && a.unit === b.unit;
  }
}

/**
 * Convert a Quantity to a different unit.
 */
export function qConvert(qty: Quantity, toUnit: string): Quantity {
  const u = mathjsUnit(qty.value, qty.unit);
  const converted = u.toNumber(toUnit);
  return { value: converted, unit: toUnit };
}
