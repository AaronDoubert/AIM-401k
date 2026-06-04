import { z } from "zod";
import { zQuantitySchema } from "@condenser/core-model";
import type { Quantity } from "@condenser/core-model";
import type { Procedure, SubcircuitFragment, Constraints } from "./types.js";
import { snapToESeries } from "./eseries.js";

// ── Param / value types ───────────────────────────────────────────────────────

export interface RCLpfParams {
  fc: Quantity;          // cutoff frequency (Hz)
  impedance?: Quantity;  // source impedance hint (Ohms), default 1kΩ
}

export interface RCLpfValues {
  R: Quantity;           // Ohms, E-series snapped
  C: Quantity;           // Farads, E-series snapped
  fcAchieved: Quantity;  // actual fc after snapping
}

// ── Zod schema ────────────────────────────────────────────────────────────────

const zRCLpfParamsSchema = z.object({
  fc: zQuantitySchema,
  impedance: zQuantitySchema.optional(),
});

// ── Constants ─────────────────────────────────────────────────────────────────

const TWO_PI = 2 * Math.PI;
const DEFAULT_IMPEDANCE_OHMS = 1000; // 1 kΩ

// ── Unit conversion helpers ───────────────────────────────────────────────────

/**
 * Convert a Quantity to a numeric value in SI base units.
 * Supports basic metric prefixes for Hz, Ω, and F.
 */
function toSI(qty: Quantity): number {
  const prefixes: Record<string, number> = {
    p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, m: 1e-3,
    k: 1e3, K: 1e3, M: 1e6, G: 1e9,
  };

  const unit = qty.unit.trim();

  // Check for prefix + base unit
  for (const [prefix, factor] of Object.entries(prefixes)) {
    if (unit.startsWith(prefix) && unit.length > prefix.length) {
      return qty.value * factor;
    }
  }

  return qty.value; // already in base unit
}

/**
 * Express a value in Farads with the most natural SI prefix.
 */
function formatCapacitance(farads: number): Quantity {
  if (farads >= 1e-3) return { value: farads * 1e3, unit: "mF" };
  if (farads >= 1e-6) return { value: farads * 1e6, unit: "µF" };
  if (farads >= 1e-9) return { value: farads * 1e9, unit: "nF" };
  return { value: farads * 1e12, unit: "pF" };
}

/**
 * Express a value in Ohms with the most natural SI prefix.
 */
function formatResistance(ohms: number): Quantity {
  if (ohms >= 1e6) return { value: ohms / 1e6, unit: "MΩ" };
  if (ohms >= 1e3) return { value: ohms / 1e3, unit: "kΩ" };
  return { value: ohms, unit: "Ω" };
}

// ── Solver ────────────────────────────────────────────────────────────────────

function solve(p: RCLpfParams, c?: Constraints): { values: RCLpfValues; achieved: Partial<RCLpfParams> } {
  const series = c?.eseries ?? "E24";

  // Convert to SI
  const fcHz = toSI(p.fc);
  const rHint = p.impedance ? toSI(p.impedance) : DEFAULT_IMPEDANCE_OHMS;

  if (fcHz <= 0) throw new RangeError(`fc must be positive, got ${fcHz}`);
  if (rHint <= 0) throw new RangeError(`impedance must be positive, got ${rHint}`);

  // Ideal R = rHint (use it directly as the R value)
  const rIdeal = rHint;

  // Ideal C = 1 / (2π * R * fc)
  const cIdeal = 1 / (TWO_PI * rIdeal * fcHz);

  // Snap R to E-series
  const rSnapped = snapToESeries(rIdeal, series);

  // Snap C to E-series
  const cSnapped = snapToESeries(cIdeal, series);

  // Re-compute actual fc from snapped values
  const fcAchievedHz = 1 / (TWO_PI * rSnapped * cSnapped);

  const R = formatResistance(rSnapped);
  const C = formatCapacitance(cSnapped);
  const fcAchieved: Quantity = { value: fcAchievedHz, unit: "Hz" };

  return {
    values: { R, C, fcAchieved },
    achieved: {
      fc: fcAchieved,
    },
  };
}

// ── Emitter ───────────────────────────────────────────────────────────────────

function emit(values: RCLpfValues): SubcircuitFragment {
  return {
    components: [
      {
        level: 1,
        symbolId: "sym_resistor",
        semanticPorts: [
          { id: "a", role: "terminal" },
          { id: "b", role: "terminal" },
        ],
        params: { R: values.R },
      },
      {
        level: 1,
        symbolId: "sym_capacitor",
        semanticPorts: [
          { id: "a", role: "terminal" },
          { id: "b", role: "terminal" },
        ],
        params: { C: values.C },
      },
    ],
    nets: [
      {
        name: "lpf_mid",
        members: [
          { componentRef: "R", portId: "b" },
          { componentRef: "C", portId: "a" },
        ],
      },
    ],
  };
}

// ── Golden test cases ─────────────────────────────────────────────────────────

// Tolerance: 5% because E24 snapping can introduce up to ~5% error
const TOLERANCE = 5;

// ── Procedure export ──────────────────────────────────────────────────────────

export const rcLpfProcedure: Procedure<RCLpfParams, RCLpfValues> = {
  id: "filter.rc_lpf",
  kind: "synthesizer",
  title: "RC Low-Pass Filter",
  description:
    "Synthesizes a first-order RC low-pass filter. Snaps R and C to E24 preferred values and reports the achieved cutoff frequency.",
  paramSchema: zRCLpfParamsSchema as unknown as import("zod").ZodSchema<RCLpfParams>,
  eseries: "E24",
  solve,
  emit,
  tests: [
    {
      label: "1 kHz cutoff, default impedance (1kΩ)",
      input: {
        fc: { value: 1000, unit: "Hz" },
      },
      // Expected: R=1kΩ (E24), C=160nF (E24 snap of 159nF), fc_achieved ≈ 995Hz
      // Golden runner compares SI magnitudes, so kΩ vs Ω and nF vs µF are fine.
      expected: {
        R: { value: 1, unit: "kΩ" },
        C: { value: 160, unit: "nF" },
        fcAchieved: { value: 994.72, unit: "Hz" },
      },
      tolerancePct: TOLERANCE,
    },
    {
      label: "10 kHz cutoff, default impedance",
      input: {
        fc: { value: 10000, unit: "Hz" },
      },
      // Expected: R=1kΩ, C=16nF (E24 snap of 15.9nF), fc_achieved ≈ 9947Hz
      expected: {
        R: { value: 1, unit: "kΩ" },
        C: { value: 16, unit: "nF" },
        fcAchieved: { value: 9947.18, unit: "Hz" },
      },
      tolerancePct: TOLERANCE,
    },
    {
      label: "1 Hz cutoff (stress test for large C values)",
      input: {
        fc: { value: 1, unit: "Hz" },
      },
      // Expected: R=1kΩ, C=160µF (E24 snap of 159µF), fc_achieved ≈ 0.995Hz
      expected: {
        R: { value: 1, unit: "kΩ" },
        C: { value: 160, unit: "µF" },
        fcAchieved: { value: 0.9947, unit: "Hz" },
      },
      tolerancePct: TOLERANCE,
    },
  ],
};
