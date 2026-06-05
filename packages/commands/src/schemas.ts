import { z } from "zod";
import {
  zQuantitySchema,
  zComponentSchema,
  zCircuitStateSchema,
  zViolationSchema,
} from "@condenser/core-model";

// ── Primitives ────────────────────────────────────────────────────────────────

export const zPortRefSchema = z.object({
  componentId: z.string(),
  portId: z.string(),
});

export const zPointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

// ── Command union ─────────────────────────────────────────────────────────────

const zComponentWithoutId = zComponentSchema.omit({ id: true });

export const zCommandSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("addComponent"), component: zComponentWithoutId }),
  z.object({ t: z.literal("attachInterface"), componentId: z.string(), interfaceId: z.string() }),
  z.object({ t: z.literal("setParams"), componentId: z.string(), params: z.record(z.string(), zQuantitySchema) }),
  z.object({ t: z.literal("bindRealPart"), componentId: z.string(), mpn: z.string(), footprintId: z.string() }),
  z.object({ t: z.literal("connect"), a: zPortRefSchema, b: zPortRefSchema }),
  z.object({ t: z.literal("disconnect"), netId: z.string(), member: zPortRefSchema }),
  z.object({ t: z.literal("setNetName"), netId: z.string(), name: z.string() }),
  z.object({ t: z.literal("insertModule"), procedureId: z.string(), params: z.record(z.string(), zQuantitySchema) }),
  z.object({ t: z.literal("reparametrize"), targetId: z.string(), params: z.record(z.string(), zQuantitySchema) }),
  z.object({ t: z.literal("satisfyObligation"), obligationId: z.string() }),
  z.object({ t: z.literal("place"), componentId: z.string(), xy: zPointSchema, layer: z.string() }),
  z.object({ t: z.literal("route"), netId: z.string(), path: z.array(zPointSchema) }),
]);

// ── CircuitDelta ──────────────────────────────────────────────────────────────

export const zCircuitDeltaSchema = z.object({
  added: zCircuitStateSchema.partial().optional(),
  modified: zCircuitStateSchema.partial().optional(),
  removed: z.object({
    componentIds: z.array(z.string()).optional(),
    netIds: z.array(z.string()).optional(),
  }).optional(),
});

// ── CommandResult ─────────────────────────────────────────────────────────────

export const zCommandResultSchema = z.object({
  ok: z.boolean(),
  delta: zCircuitDeltaSchema.optional(),
  violations: z.array(zViolationSchema).optional(),
  newId: z.string().optional(),
});

// ── LoggedCommand ─────────────────────────────────────────────────────────────

export const zLoggedCommandSchema = z.object({
  id: z.string(),
  timestamp: z.number(),
  command: zCommandSchema,
  dependsOn: z.array(z.string()).optional(),
  label: z.string().optional(),
  resultMeta: z.object({
    newComponentId: z.string().optional(),
    newNetId: z.string().optional(),
  }).optional(),
});

// ── ProjectFile ───────────────────────────────────────────────────────────────

export const zProjectFileSchema = z.object({
  schemaVersion: z.string(),
  snapshot: zCircuitStateSchema,
  log: z.array(zLoggedCommandSchema),
  cursor: z.number().int().nonnegative(),
});
