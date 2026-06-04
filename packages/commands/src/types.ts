import type { Component, Quantity, CircuitState, Violation } from "@condenser/core-model";

// ── Port and geometry primitives ──────────────────────────────────────────────

export type PortRef = { componentId: string; portId: string };
export type Point = { x: number; y: number };

// ── Command union ─────────────────────────────────────────────────────────────

export type Command =
  | { t: "addComponent"; component: Omit<Component, "id"> }
  | { t: "attachInterface"; componentId: string; interfaceId: string }
  | { t: "setParams"; componentId: string; params: Record<string, Quantity> }
  | { t: "bindRealPart"; componentId: string; mpn: string; footprintId: string }
  | { t: "connect"; a: PortRef; b: PortRef }
  | { t: "disconnect"; netId: string; member: PortRef }
  | { t: "setNetName"; netId: string; name: string }
  | { t: "insertModule"; procedureId: string; params: Record<string, Quantity> }
  | { t: "reparametrize"; targetId: string; params: Record<string, Quantity> }
  | { t: "satisfyObligation"; obligationId: string }
  | { t: "place"; componentId: string; xy: Point; layer: string }
  | { t: "route"; netId: string; path: Point[] };

// ── Result types ──────────────────────────────────────────────────────────────

export interface CircuitDelta {
  added?: Partial<CircuitState>;
  modified?: Partial<CircuitState>;
  removed?: { componentIds?: string[]; netIds?: string[] };
}

export interface CommandResult {
  ok: boolean;
  delta?: CircuitDelta;
  violations?: Violation[];
  newId?: string; // for addComponent
}

// ── Log / project file ────────────────────────────────────────────────────────

export interface LoggedCommand {
  id: string;       // nanoid
  timestamp: number; // Date.now()
  command: Command;
  dependsOn?: string[];
  label?: string;
  /**
   * Stored result metadata for deterministic replay.
   * addComponent stores the assigned component id here.
   * connect stores the new net id when one was created.
   */
  resultMeta?: {
    newComponentId?: string;
    newNetId?: string;
  };
}

export interface ProjectFile {
  schemaVersion: string;
  snapshot: CircuitState;
  log: LoggedCommand[];
  cursor: number; // index into log; undo moves cursor back
}
