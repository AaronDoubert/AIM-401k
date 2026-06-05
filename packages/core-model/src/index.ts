// Core model: types, schemas, quantities, standard interfaces

export type {
  Level,
  Quantity,
  Interface,
  SemanticPort,
  Obligation,
  Component,
  PhysicalPin,
  SourcingInfo,
  ModuleProvenance,
  Net,
  Violation,
  CircuitState,
} from "./types.js";

export {
  zQuantitySchema,
  zSemanticPortSchema,
  zObligationSchema,
  zSourcingInfoSchema,
  zPhysicalPinSchema,
  zModuleProvenanceSchema,
  zComponentSchema,
  zNetSchema,
  zViolationSchema,
  zInterfaceSchema,
  zCircuitStateSchema,
  validateCircuitState,
} from "./schemas.js";

export { q, qEquals, qConvert } from "./quantities.js";

export { STANDARD_INTERFACES } from "./interfaces.js";
