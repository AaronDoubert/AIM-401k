import { rcLpfProcedure, type Procedure } from "@condenser/procedures";
import type { SubcircuitFragment, Constraints } from "@condenser/procedures";
import type { Component } from "@condenser/core-model";
import type { EngineController } from "../state/EngineController";
import { kindForSymbolId, refLetterForKind } from "../lib/symbols";

/**
 * Registry of design procedures the agent / procedures-panel can invoke.
 * Adding a procedure here makes it available to both the UI and the LLM tools.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PROCEDURES: Record<string, Procedure<any, any>> = {
  [rcLpfProcedure.id]: rcLpfProcedure,
};

export function listProcedures() {
  return Object.values(PROCEDURES).map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description,
    kind: p.kind,
    eseries: p.eseries,
  }));
}

export interface InsertResult {
  insertedComponentIds: string[];
  netIds: string[];
}

/**
 * Materialize a SubcircuitFragment into the live circuit via commands:
 * add each component, then wire the fragment's nets. Fragment net members
 * reference components by a designator string (e.g. "R", "C"); we resolve
 * those to freshly-assigned component ids by matching reference-designator
 * families (R→resistor, C→capacitor, …).
 */
export function insertFragment(
  ctrl: EngineController,
  fragment: SubcircuitFragment,
  label?: string
): InsertResult {
  const added: { id: string; family: string }[] = [];
  const insertedComponentIds: string[] = [];

  for (const comp of fragment.components) {
    const res = ctrl.apply(
      { t: "addComponent", component: comp as Omit<Component, "id"> },
      label ? `${label}: add ${comp.symbolId}` : undefined
    );
    if (res.ok && res.newId) {
      added.push({
        id: res.newId,
        family: refLetterForKind(kindForSymbolId(comp.symbolId)),
      });
      insertedComponentIds.push(res.newId);
    }
  }

  // Map fragment refs → concrete ids, consistently across all nets.
  const refToId = new Map<string, string>();
  const usedIds = new Set<string>();
  const familyOfRef = (ref: string): string => {
    const m = ref.match(/^[A-Za-z]+/);
    return (m ? m[0] : ref).charAt(0).toUpperCase();
  };
  const resolve = (ref: string): string | undefined => {
    const cached = refToId.get(ref);
    if (cached) return cached;
    const fam = familyOfRef(ref);
    const candidate =
      added.find((a) => a.family === fam && !usedIds.has(a.id)) ??
      added.find((a) => !usedIds.has(a.id));
    if (!candidate) return undefined;
    refToId.set(ref, candidate.id);
    usedIds.add(candidate.id);
    return candidate.id;
  };

  const netIds: string[] = [];
  for (const net of fragment.nets) {
    const memberIds = net.members
      .map((m) => ({ id: resolve(m.componentRef), portId: m.portId }))
      .filter((m): m is { id: string; portId: string } => Boolean(m.id));
    // Chain-connect all members onto a single net.
    let firstNetId: string | undefined;
    for (let i = 1; i < memberIds.length; i++) {
      const a = memberIds[0];
      const b = memberIds[i];
      if (!a || !b) continue;
      const res = ctrl.apply(
        {
          t: "connect",
          a: { componentId: a.id, portId: a.portId },
          b: { componentId: b.id, portId: b.portId },
        },
        net.name ? `wire ${net.name}` : "wire net"
      );
      const newNet = res.delta?.added?.nets?.[0];
      if (newNet) firstNetId = newNet.id;
    }
    if (firstNetId && net.name) {
      ctrl.apply({ t: "setNetName", netId: firstNetId, name: net.name });
      netIds.push(firstNetId);
    }
  }

  return { insertedComponentIds, netIds };
}

export type { Constraints };
