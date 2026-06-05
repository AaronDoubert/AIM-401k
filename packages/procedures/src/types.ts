import type { z } from "zod";
import type { Component } from "@condenser/core-model";

// ── Procedure types ───────────────────────────────────────────────────────────

export interface GoldenCase<P, D> {
  label: string;
  input: P;
  expected: D;
  tolerancePct?: number; // default 0.1% for E-series snapped values
}

export interface SubcircuitFragment {
  components: Omit<Component, "id">[];
  nets: Array<{
    name?: string;
    members: Array<{ componentRef: string; portId: string }>;
  }>;
}

export interface Constraints {
  eseries?: "E12" | "E24" | "E96";
  preferLower?: boolean;
}

export interface Procedure<P, D> {
  id: string;
  kind: "synthesizer" | "calculator";
  composite?: boolean;
  title: string;
  description: string;
  paramSchema: z.ZodSchema<P>;
  modes?: string[];
  solve(p: P, c?: Constraints): { values: D; achieved: Partial<P> };
  emit?(values: D): SubcircuitFragment;
  eseries?: "E12" | "E24" | "E96";
  tests: GoldenCase<P, D>[];
}
