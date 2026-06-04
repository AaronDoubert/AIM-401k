import { expect } from "vitest";
import type { Procedure, GoldenCase } from "./types.js";

// ── Metric prefix table ───────────────────────────────────────────────────────

const METRIC_FACTORS: Record<string, number> = {
  p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, m: 1e-3,
  k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12,
};

/**
 * Convert a Quantity to its SI value by stripping metric prefixes.
 * Only strips single-character prefixes — pure base units (Hz, Ω, F, V…) pass through.
 */
function toSIValue(qty: { value: number; unit: string }): number {
  const unit = qty.unit.trim();
  for (const [prefix, factor] of Object.entries(METRIC_FACTORS)) {
    if (unit.startsWith(prefix) && unit.length > prefix.length) {
      return qty.value * factor;
    }
  }
  return qty.value;
}

/**
 * Run all golden test cases for a procedure.
 * Each case calls proc.solve(input) and checks that every key in
 * case.expected appears in achieved or values within tolerancePct.
 * Comparison is magnitude-aware: quantities are converted to SI base before comparing.
 */
export function runGoldenTests<P, D>(proc: Procedure<P, D>): void {
  for (const testCase of proc.tests) {
    runSingleGoldenCase(proc, testCase);
  }
}

function runSingleGoldenCase<P, D>(
  proc: Procedure<P, D>,
  testCase: GoldenCase<P, D>
): void {
  const tolerancePct = testCase.tolerancePct ?? 0.1;
  const { values, achieved } = proc.solve(testCase.input);

  const expected = testCase.expected as Record<string, unknown>;
  const achievedRecord = achieved as Record<string, unknown>;
  const valuesRecord = values as Record<string, unknown>;

  for (const key of Object.keys(expected)) {
    const expectedVal = expected[key];

    // Look up in achieved first, then values
    const achievedVal = achievedRecord[key] ?? valuesRecord[key];

    if (
      expectedVal !== null &&
      typeof expectedVal === "object" &&
      "value" in (expectedVal as object) &&
      "unit" in (expectedVal as object)
    ) {
      // It's a Quantity — compare in SI magnitude within tolerance
      const expQty = expectedVal as { value: number; unit: string };
      const achQty = achievedVal as { value: number; unit: string } | undefined;

      expect(
        achQty,
        `[${proc.id}] Golden case "${testCase.label}": key "${key}" missing`
      ).toBeDefined();

      if (achQty) {
        const expSI = toSIValue(expQty);
        const achSI = toSIValue(achQty);
        const relErr =
          Math.abs(achSI - expSI) / (Math.abs(expSI) || 1);
        const toleranceFrac = tolerancePct / 100;

        expect(
          relErr,
          `[${proc.id}] Golden case "${testCase.label}": key "${key}" ` +
            `got ${achQty.value} ${achQty.unit} (SI: ${achSI}), ` +
            `expected ~${expQty.value} ${expQty.unit} (SI: ${expSI}) ` +
            `(tolerance ${tolerancePct}%, actual error ${(relErr * 100).toFixed(4)}%)`
        ).toBeLessThanOrEqual(toleranceFrac);
      }
    } else {
      // Non-quantity: exact match
      expect(
        achievedVal ?? valuesRecord[key],
        `[${proc.id}] Golden case "${testCase.label}": key "${key}"`
      ).toEqual(expectedVal);
    }
  }
}
