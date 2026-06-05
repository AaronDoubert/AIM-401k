import { describe, it, expect } from "vitest";
import { rcLpfProcedure } from "../filter.rc_lpf.js";
import { runGoldenTests } from "../golden.js";
import { snapToESeries } from "../eseries.js";

// ── snapToESeries ─────────────────────────────────────────────────────────────

describe("snapToESeries", () => {
  it("snaps to nearest E12 value", () => {
    // 1000 is exactly 1.0 × 10^3 — E12 has 1.0
    expect(snapToESeries(1000, "E12")).toBe(1000);
    // 1200 is exactly 1.2 × 10^3 — E12 has 1.2
    expect(snapToESeries(1200, "E12")).toBe(1200);
    // 1050 is closer to 1.0k than 1.2k
    expect(snapToESeries(1050, "E12")).toBe(1000);
    // 1180 is closer to 1.2k than 1.0k
    expect(snapToESeries(1180, "E12")).toBe(1200);
  });

  it("snaps to nearest E24 value", () => {
    expect(snapToESeries(10000, "E24")).toBe(10000);
    // 15000 = 1.5 × 10^4 — E24 has 1.5
    expect(snapToESeries(15000, "E24")).toBe(15000);
  });

  it("snaps to nearest E96 value", () => {
    expect(snapToESeries(10000, "E96")).toBe(10000);
  });

  it("works for small values (picofarad range)", () => {
    // 150e-12 = 1.5 × 10^-10, E24 should snap to 1.5
    const snapped = snapToESeries(150e-12, "E24");
    expect(snapped).toBeCloseTo(150e-12, 15);
  });

  it("works for large values (megaohm range)", () => {
    const snapped = snapToESeries(2.2e6, "E24");
    expect(snapped).toBeCloseTo(2.2e6, 3);
  });

  it("throws for non-positive values", () => {
    expect(() => snapToESeries(0, "E24")).toThrow();
    expect(() => snapToESeries(-100, "E24")).toThrow();
  });
});

// ── RC LPF procedure ──────────────────────────────────────────────────────────

describe("RC LPF procedure", () => {
  it("has correct metadata", () => {
    expect(rcLpfProcedure.id).toBe("filter.rc_lpf");
    expect(rcLpfProcedure.kind).toBe("synthesizer");
  });

  it("solves for 1kHz cutoff", () => {
    const { values, achieved } = rcLpfProcedure.solve({
      fc: { value: 1000, unit: "Hz" },
    });
    expect(values.R).toBeDefined();
    expect(values.C).toBeDefined();
    expect(values.fcAchieved).toBeDefined();
    expect(achieved.fc).toBeDefined();

    // R should be close to 1kΩ (the default impedance hint)
    const rHz = values.R.unit === "kΩ" ? values.R.value * 1000 : values.R.value;
    expect(rHz).toBeGreaterThan(500);
    expect(rHz).toBeLessThan(5000);

    // fc achieved should be within 10% of 1kHz
    expect(Math.abs(values.fcAchieved.value - 1000) / 1000).toBeLessThan(0.1);
  });

  it("solves for 10kHz cutoff", () => {
    const { values } = rcLpfProcedure.solve({
      fc: { value: 10000, unit: "Hz" },
    });
    expect(Math.abs(values.fcAchieved.value - 10000) / 10000).toBeLessThan(0.1);
  });

  it("solves for 1Hz cutoff (large C stress test)", () => {
    const { values } = rcLpfProcedure.solve({
      fc: { value: 1, unit: "Hz" },
    });
    expect(Math.abs(values.fcAchieved.value - 1) / 1).toBeLessThan(0.1);
    // C should be in µF or mF range
    expect(["µF", "mF", "nF"].some((u) => values.C.unit === u)).toBe(true);
  });

  it("emits a 2-component subcircuit", () => {
    const { values } = rcLpfProcedure.solve({
      fc: { value: 1000, unit: "Hz" },
    });
    const fragment = rcLpfProcedure.emit!(values);
    expect(fragment.components).toHaveLength(2);
    expect(fragment.nets).toHaveLength(1);
    const R = fragment.components.find((c) => c.symbolId === "sym_resistor");
    const C = fragment.components.find((c) => c.symbolId === "sym_capacitor");
    expect(R).toBeDefined();
    expect(C).toBeDefined();
  });

  it("param schema validates correctly", () => {
    const good = { fc: { value: 1000, unit: "Hz" } };
    expect(() => rcLpfProcedure.paramSchema.parse(good)).not.toThrow();

    const bad = { fc: "not a quantity" };
    expect(() => rcLpfProcedure.paramSchema.parse(bad)).toThrow();
  });
});

// ── Golden tests ──────────────────────────────────────────────────────────────

describe("RC LPF golden tests via runGoldenTests", () => {
  it("all golden cases pass", () => {
    // This calls vitest's expect internally, so any failure becomes a test failure
    runGoldenTests(rcLpfProcedure);
  });
});
