import { describe, it, expect } from "vitest";
import { q, qEquals, qConvert } from "../quantities.js";
import {
  zComponentSchema,
  zModuleProvenanceSchema,
} from "../schemas.js";

describe("Quantity helpers", () => {
  describe("q()", () => {
    it("constructs a Quantity", () => {
      const qty = q(1000, "Ω");
      expect(qty.value).toBe(1000);
      expect(qty.unit).toBe("Ω");
    });
  });

  describe("qEquals()", () => {
    it("returns true for identical quantities", () => {
      expect(qEquals(q(1000, "Ω"), q(1000, "Ω"))).toBe(true);
    });

    it("returns true for equivalent quantities in different units", () => {
      // 1 kΩ = 1000 Ω (mathjs knows kohm and ohm)
      expect(qEquals(q(1, "kohm"), q(1000, "ohm"))).toBe(true);
    });

    it("returns false for different magnitudes", () => {
      expect(qEquals(q(1000, "Ω"), q(2000, "Ω"))).toBe(false);
    });

    it("returns false for different units that can't be compared (fallback)", () => {
      // Hz vs Ω — incompatible; falls back to exact match which fails
      expect(qEquals(q(1000, "Hz"), q(1000, "Ω"))).toBe(false);
    });
  });

  describe("qConvert()", () => {
    it("converts ohm to kohm", () => {
      const result = qConvert(q(1000, "ohm"), "kohm");
      expect(result.value).toBeCloseTo(1, 10);
      expect(result.unit).toBe("kohm");
    });

    it("converts kohm to ohm", () => {
      const result = qConvert(q(4.7, "kohm"), "ohm");
      expect(result.value).toBeCloseTo(4700, 5);
      expect(result.unit).toBe("ohm");
    });
  });
});

describe("Bare-float lint: no numeric values in model outside Quantity.value", () => {
  it("Component params with bare number (not Quantity) fails Zod schema", () => {
    const invalidComponent = {
      id: "c1",
      level: 1 as const,
      symbolId: "sym_r",
      semanticPorts: [],
      params: {
        R: 1000,  // bare number — not a Quantity
      },
    };
    expect(() => zComponentSchema.parse(invalidComponent)).toThrow();
  });

  it("ModuleProvenance params with bare number fails Zod schema", () => {
    const invalidProvenance = {
      procedureId: "filter.rc_lpf",
      params: {
        fc: 1000,  // bare number — not a Quantity
      },
      version: 1,
    };
    expect(() => zModuleProvenanceSchema.parse(invalidProvenance)).toThrow();
  });

  it("Valid Quantity params pass schema", () => {
    const validComponent = {
      id: "c1",
      level: 1 as const,
      symbolId: "sym_r",
      semanticPorts: [],
      params: {
        R: { value: 1000, unit: "Ω" },  // proper Quantity
      },
    };
    expect(() => zComponentSchema.parse(validComponent)).not.toThrow();
  });
});
