// Procedures package: Procedure interface, DSL, golden-test harness, RC LPF family

export type {
  GoldenCase,
  SubcircuitFragment,
  Constraints,
  Procedure,
} from "./types.js";

export { snapToESeries } from "./eseries.js";
export { runGoldenTests } from "./golden.js";
export { rcLpfProcedure } from "./filter.rc_lpf.js";
export type { RCLpfParams, RCLpfValues } from "./filter.rc_lpf.js";
