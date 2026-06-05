import { z } from "zod";

// Zod schemas for all core model types

export const zQuantitySchema = z.object({
  value: z.number(),
  unit: z.string(),
});

export const zSemanticPortSchema = z.object({
  id: z.string(),
  role: z.string(),
  fromInterface: z.string().optional(),
  pinBinding: z.string().optional(),
});

export const zObligationSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "tie_unused",
    "decouple",
    "ground_ep",
    "pullup",
    "set_enable",
    "terminate",
  ]),
  description: z.string(),
  satisfied: z.boolean(),
  suggestedFix: z.array(z.unknown()).optional(),
});

export const zSourcingInfoSchema = z.object({
  lcscPartNumber: z.string().optional(),
  manufacturer: z.string().optional(),
  stock: z.number().optional(),
  priceUsd: z.number().optional(),
});

export const zPhysicalPinSchema = z.object({
  padId: z.string(),
  name: z.string(),
  semanticPortId: z.string().optional(),
});

export const zModuleProvenanceSchema = z.object({
  procedureId: z.string(),
  params: z.record(z.string(), zQuantitySchema),
  version: z.number(),
});

export const zComponentSchema = z.object({
  id: z.string(),
  level: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
  ]),
  symbolId: z.string(),
  semanticPorts: z.array(zSemanticPortSchema),
  interfaces: z.array(z.string()).optional(),
  params: z.record(z.string(), zQuantitySchema).optional(),
  part: z
    .object({
      mpn: z.string(),
      footprintId: z.string(),
      sourcing: zSourcingInfoSchema.optional(),
    })
    .optional(),
  physicalPins: z.array(zPhysicalPinSchema).optional(),
  obligations: z.array(zObligationSchema).optional(),
  moduleProvenance: zModuleProvenanceSchema.optional(),
});

export const zNetSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  members: z.array(
    z.object({
      componentId: z.string(),
      portId: z.string(),
    })
  ),
});

export const zViolationSchema = z.object({
  code: z.string(),
  severity: z.enum(["error", "warning", "info"]),
  message: z.string(),
  componentIds: z.array(z.string()).optional(),
  netIds: z.array(z.string()).optional(),
});

export const zInterfaceSchema = z.object({
  id: z.string(),
  ports: z.array(
    z.object({
      id: z.string(),
      role: z.string(),
    })
  ),
  composes: z.array(z.string()).optional(),
});

export const zCircuitStateSchema = z.object({
  components: z.array(zComponentSchema),
  nets: z.array(zNetSchema),
  interfaces: z.array(zInterfaceSchema),
  schemaVersion: z.string(),
});

export type CircuitState = z.infer<typeof zCircuitStateSchema>;

export function validateCircuitState(state: unknown): CircuitState {
  return zCircuitStateSchema.parse(state);
}
