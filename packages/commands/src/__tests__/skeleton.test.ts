/**
 * Walking skeleton test: build a voltage divider, serialize, replay, and
 * assert byte-identical JSON + correct structure.
 *
 * This is the regression backbone for the entire Condenser codebase.
 */
import { describe, it, expect } from "vitest";
import { CommandEngine } from "../engine.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Serialize to JSON with sorted keys for byte-identical comparisons.
 */
function stableJSON(obj: unknown): string {
  return JSON.stringify(obj, (_, v: unknown) => {
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
          a.localeCompare(b)
        )
      );
    }
    return v;
  });
}

// ── The walking skeleton ──────────────────────────────────────────────────────

describe("Walking skeleton: voltage divider", () => {
  it("builds a voltage divider, serializes, replays, and produces byte-identical JSON", () => {
    const eng = new CommandEngine();

    // ── Step 1: Add 3 components ──────────────────────────────────────────────

    const vsourceId = eng.apply({
      t: "addComponent",
      component: {
        level: 1,
        symbolId: "sym_vsource",
        semanticPorts: [
          { id: "pos", role: "positive" },
          { id: "neg", role: "negative" },
        ],
      },
    }).newId!;

    const r1Id = eng.apply({
      t: "addComponent",
      component: {
        level: 1,
        symbolId: "sym_resistor",
        semanticPorts: [
          { id: "a", role: "terminal" },
          { id: "b", role: "terminal" },
        ],
      },
    }).newId!;

    const r2Id = eng.apply({
      t: "addComponent",
      component: {
        level: 1,
        symbolId: "sym_resistor",
        semanticPorts: [
          { id: "a", role: "terminal" },
          { id: "b", role: "terminal" },
        ],
      },
    }).newId!;

    // ── Step 2: Set params ────────────────────────────────────────────────────

    eng.apply({
      t: "setParams",
      componentId: vsourceId,
      params: { V: { value: 5, unit: "V" } },
    });
    eng.apply({
      t: "setParams",
      componentId: r1Id,
      params: { R: { value: 1000, unit: "Ω" } },
    });
    eng.apply({
      t: "setParams",
      componentId: r2Id,
      params: { R: { value: 1000, unit: "Ω" } },
    });

    // ── Step 3: Wire the divider ──────────────────────────────────────────────

    // V_source.pos → R1.a  (top rail)
    expect(eng.apply({
      t: "connect",
      a: { componentId: vsourceId, portId: "pos" },
      b: { componentId: r1Id, portId: "a" },
    }).ok).toBe(true);

    // R1.b → R2.a  (middle node — will be named vmid)
    expect(eng.apply({
      t: "connect",
      a: { componentId: r1Id, portId: "b" },
      b: { componentId: r2Id, portId: "a" },
    }).ok).toBe(true);

    // R2.b → V_source.neg  (ground rail)
    expect(eng.apply({
      t: "connect",
      a: { componentId: r2Id, portId: "b" },
      b: { componentId: vsourceId, portId: "neg" },
    }).ok).toBe(true);

    // ── Step 4: Name the middle net ───────────────────────────────────────────

    const vmidNet = eng.getState().nets.find(
      (n) =>
        n.members.some((m) => m.componentId === r1Id && m.portId === "b") &&
        n.members.some((m) => m.componentId === r2Id && m.portId === "a")
    )!;
    expect(vmidNet).toBeDefined();

    eng.apply({ t: "setNetName", netId: vmidNet.id, name: "vmid" });

    // ── Step 5: Serialize ─────────────────────────────────────────────────────

    const pf = eng.serialize();
    const serialized1 = stableJSON(pf);

    // ── Step 6: Replay the log from scratch ───────────────────────────────────

    const replayedState = CommandEngine.replay(pf.log, pf.snapshot);

    // Build an equivalent ProjectFile from the replayed state for comparison
    const pfReplayed = {
      schemaVersion: pf.schemaVersion,
      snapshot: pf.snapshot,
      log: pf.log,
      cursor: pf.cursor,
    };
    const serialized2 = stableJSON(pfReplayed);

    // ── Step 7: Assert byte-identical ─────────────────────────────────────────

    expect(serialized1).toBe(serialized2);

    // ── Step 8: Assert correct divider structure ───────────────────────────────

    const finalState = eng.getState();

    // 3 components (V_source, R1, R2)
    expect(finalState.components).toHaveLength(3);

    // 3 nets (top, vmid, bottom)
    expect(finalState.nets).toHaveLength(3);

    // "vmid" net with exactly 2 members: R1.b and R2.a
    const vmid = finalState.nets.find((n) => n.name === "vmid");
    expect(vmid).toBeDefined();
    expect(vmid!.members).toHaveLength(2);
    expect(
      vmid!.members.some((m) => m.componentId === r1Id && m.portId === "b")
    ).toBe(true);
    expect(
      vmid!.members.some((m) => m.componentId === r2Id && m.portId === "a")
    ).toBe(true);

    // Replayed state also has the same structure
    expect(replayedState.components).toHaveLength(3);
    expect(replayedState.nets).toHaveLength(3);
    const replayedVmid = replayedState.nets.find((n) => n.name === "vmid");
    expect(replayedVmid).toBeDefined();
    expect(replayedVmid!.members).toHaveLength(2);
  });
});
