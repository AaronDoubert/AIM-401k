import { describe, it, expect } from "vitest";
import { CommandEngine } from "../engine.js";
import type { Command } from "../types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function sortedJSON(obj: unknown): string {
  return JSON.stringify(obj, (_, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      );
    }
    return v;
  });
}

function makeResistor(params?: Record<string, { value: number; unit: string }>) {
  return {
    level: 1 as const,
    symbolId: "sym_resistor",
    semanticPorts: [
      { id: "a", role: "terminal" },
      { id: "b", role: "terminal" },
    ],
    ...(params ? { params } : {}),
  };
}

// ── addComponent ──────────────────────────────────────────────────────────────

describe("addComponent", () => {
  it("adds a component and returns its id", () => {
    const eng = new CommandEngine();
    const result = eng.apply({ t: "addComponent", component: makeResistor() });
    expect(result.ok).toBe(true);
    expect(result.newId).toBeTruthy();
    const state = eng.getState();
    expect(state.components).toHaveLength(1);
    expect(state.components[0]!.id).toBe(result.newId);
  });

  it("auto-assigns unique ids for multiple components", () => {
    const eng = new CommandEngine();
    const r1 = eng.apply({ t: "addComponent", component: makeResistor() });
    const r2 = eng.apply({ t: "addComponent", component: makeResistor() });
    expect(r1.newId).not.toBe(r2.newId);
    expect(eng.getState().components).toHaveLength(2);
  });
});

// ── attachInterface ───────────────────────────────────────────────────────────

describe("attachInterface", () => {
  it("promotes L0 component to L1 and adds ports", () => {
    const eng = new CommandEngine();
    const addResult = eng.apply({
      t: "addComponent",
      component: {
        level: 0,
        symbolId: "sym_ic",
        semanticPorts: [],
      },
    });
    const id = addResult.newId!;

    const attachResult = eng.apply({
      t: "attachInterface",
      componentId: id,
      interfaceId: "i2c",
    });
    expect(attachResult.ok).toBe(true);

    const comp = eng.getState().components.find((c) => c.id === id)!;
    expect(comp.level).toBe(1);
    expect(comp.interfaces).toContain("i2c");
    expect(comp.semanticPorts.map((p) => p.id)).toContain("SDA");
    expect(comp.semanticPorts.map((p) => p.id)).toContain("SCL");
  });

  it("never changes symbolId", () => {
    const eng = new CommandEngine();
    const { newId: id } = eng.apply({
      t: "addComponent",
      component: { level: 0, symbolId: "my_symbol", semanticPorts: [] },
    });
    eng.apply({ t: "attachInterface", componentId: id!, interfaceId: "spi" });
    const comp = eng.getState().components.find((c) => c.id === id)!;
    expect(comp.symbolId).toBe("my_symbol");
  });

  it("returns error for unknown interface", () => {
    const eng = new CommandEngine();
    const { newId: id } = eng.apply({
      t: "addComponent",
      component: { level: 0, symbolId: "sym", semanticPorts: [] },
    });
    const result = eng.apply({
      t: "attachInterface",
      componentId: id!,
      interfaceId: "unknown_iface_xyz",
    });
    expect(result.ok).toBe(false);
    expect(result.violations?.[0]?.code).toBe("CMD002");
  });

  it("returns error for unknown component", () => {
    const eng = new CommandEngine();
    const result = eng.apply({
      t: "attachInterface",
      componentId: "no_such_id",
      interfaceId: "i2c",
    });
    expect(result.ok).toBe(false);
    expect(result.violations?.[0]?.code).toBe("CMD001");
  });

  it("does not add duplicate ports on re-attach", () => {
    const eng = new CommandEngine();
    const { newId: id } = eng.apply({
      t: "addComponent",
      component: { level: 0, symbolId: "sym", semanticPorts: [] },
    });
    eng.apply({ t: "attachInterface", componentId: id!, interfaceId: "i2c" });
    eng.apply({ t: "attachInterface", componentId: id!, interfaceId: "i2c" });
    const comp = eng.getState().components.find((c) => c.id === id)!;
    const sdaPorts = comp.semanticPorts.filter((p) => p.id === "SDA");
    expect(sdaPorts).toHaveLength(1);
  });
});

// ── setParams ─────────────────────────────────────────────────────────────────

describe("setParams", () => {
  it("promotes to L2 and sets params", () => {
    const eng = new CommandEngine();
    const { newId: id } = eng.apply({
      t: "addComponent",
      component: makeResistor(),
    });
    const result = eng.apply({
      t: "setParams",
      componentId: id!,
      params: { R: { value: 1000, unit: "Ω" } },
    });
    expect(result.ok).toBe(true);
    const comp = eng.getState().components.find((c) => c.id === id)!;
    expect(comp.level).toBe(2);
    expect(comp.params?.["R"]?.value).toBe(1000);
  });

  it("never changes symbolId", () => {
    const eng = new CommandEngine();
    const { newId: id } = eng.apply({
      t: "addComponent",
      component: makeResistor(),
    });
    eng.apply({
      t: "setParams",
      componentId: id!,
      params: { R: { value: 100, unit: "Ω" } },
    });
    const comp = eng.getState().components.find((c) => c.id === id)!;
    expect(comp.symbolId).toBe("sym_resistor");
  });

  it("merges params (does not remove existing)", () => {
    const eng = new CommandEngine();
    const { newId: id } = eng.apply({
      t: "addComponent",
      component: makeResistor({ R: { value: 100, unit: "Ω" } }),
    });
    eng.apply({
      t: "setParams",
      componentId: id!,
      params: { tolerance: { value: 1, unit: "%" } },
    });
    const comp = eng.getState().components.find((c) => c.id === id)!;
    expect(comp.params?.["R"]?.value).toBe(100);
    expect(comp.params?.["tolerance"]?.value).toBe(1);
  });
});

// ── bindRealPart ──────────────────────────────────────────────────────────────

describe("bindRealPart", () => {
  it("promotes to L3 and sets part info", () => {
    const eng = new CommandEngine();
    const { newId: id } = eng.apply({
      t: "addComponent",
      component: makeResistor(),
    });
    const result = eng.apply({
      t: "bindRealPart",
      componentId: id!,
      mpn: "RC0402FR-071KL",
      footprintId: "R_0402",
    });
    expect(result.ok).toBe(true);
    const comp = eng.getState().components.find((c) => c.id === id)!;
    expect(comp.level).toBe(3);
    expect(comp.part?.mpn).toBe("RC0402FR-071KL");
  });

  it("never changes symbolId", () => {
    const eng = new CommandEngine();
    const { newId: id } = eng.apply({
      t: "addComponent",
      component: makeResistor(),
    });
    eng.apply({
      t: "bindRealPart",
      componentId: id!,
      mpn: "RC0402FR-071KL",
      footprintId: "R_0402",
    });
    const comp = eng.getState().components.find((c) => c.id === id)!;
    expect(comp.symbolId).toBe("sym_resistor");
  });

  it("surfaces a decouple obligation", () => {
    const eng = new CommandEngine();
    const { newId: id } = eng.apply({
      t: "addComponent",
      component: makeResistor(),
    });
    eng.apply({
      t: "bindRealPart",
      componentId: id!,
      mpn: "LM358",
      footprintId: "DIP8",
    });
    const comp = eng.getState().components.find((c) => c.id === id)!;
    expect(comp.obligations?.some((o) => o.kind === "decouple")).toBe(true);
  });
});

// ── connect ───────────────────────────────────────────────────────────────────

describe("connect", () => {
  function buildTwoResistors() {
    const eng = new CommandEngine();
    const r1 = eng.apply({ t: "addComponent", component: makeResistor() }).newId!;
    const r2 = eng.apply({ t: "addComponent", component: makeResistor() }).newId!;
    return { eng, r1, r2 };
  }

  it("creates a new net connecting two ports", () => {
    const { eng, r1, r2 } = buildTwoResistors();
    const result = eng.apply({
      t: "connect",
      a: { componentId: r1, portId: "b" },
      b: { componentId: r2, portId: "a" },
    });
    expect(result.ok).toBe(true);
    const state = eng.getState();
    expect(state.nets).toHaveLength(1);
    expect(state.nets[0]!.members).toHaveLength(2);
  });

  it("extends an existing net when one port is already in it", () => {
    const { eng, r1, r2 } = buildTwoResistors();
    const r3 = eng.apply({ t: "addComponent", component: makeResistor() }).newId!;
    eng.apply({
      t: "connect",
      a: { componentId: r1, portId: "b" },
      b: { componentId: r2, portId: "a" },
    });
    eng.apply({
      t: "connect",
      a: { componentId: r2, portId: "a" },
      b: { componentId: r3, portId: "a" },
    });
    const state = eng.getState();
    expect(state.nets).toHaveLength(1);
    expect(state.nets[0]!.members).toHaveLength(3);
  });

  it("fails if component not found", () => {
    const { eng } = buildTwoResistors();
    const result = eng.apply({
      t: "connect",
      a: { componentId: "ghost", portId: "a" },
      b: { componentId: "also_ghost", portId: "b" },
    });
    expect(result.ok).toBe(false);
  });

  it("fails if port not found", () => {
    const { eng, r1, r2 } = buildTwoResistors();
    const result = eng.apply({
      t: "connect",
      a: { componentId: r1, portId: "no_such_port" },
      b: { componentId: r2, portId: "a" },
    });
    expect(result.ok).toBe(false);
    expect(result.violations?.[0]?.code).toBe("CMD003");
  });
});

// ── setNetName ────────────────────────────────────────────────────────────────

describe("setNetName", () => {
  it("names a net", () => {
    const eng = new CommandEngine();
    const r1 = eng.apply({ t: "addComponent", component: makeResistor() }).newId!;
    const r2 = eng.apply({ t: "addComponent", component: makeResistor() }).newId!;
    eng.apply({
      t: "connect",
      a: { componentId: r1, portId: "b" },
      b: { componentId: r2, portId: "a" },
    });
    const netId = eng.getState().nets[0]!.id;
    const result = eng.apply({ t: "setNetName", netId, name: "vmid" });
    expect(result.ok).toBe(true);
    expect(eng.getState().nets[0]!.name).toBe("vmid");
  });

  it("fails for unknown net", () => {
    const eng = new CommandEngine();
    const result = eng.apply({ t: "setNetName", netId: "no_net", name: "x" });
    expect(result.ok).toBe(false);
  });
});

// ── undo/redo ─────────────────────────────────────────────────────────────────

describe("undo/redo", () => {
  it("apply 3, undo 2, redo 1 — correct state at each point", () => {
    const eng = new CommandEngine();

    eng.apply({ t: "addComponent", component: makeResistor() });
    eng.apply({ t: "addComponent", component: makeResistor() });
    eng.apply({ t: "addComponent", component: makeResistor() });
    expect(eng.getState().components).toHaveLength(3);

    eng.undo();
    expect(eng.getState().components).toHaveLength(2);

    eng.undo();
    expect(eng.getState().components).toHaveLength(1);

    eng.redo();
    expect(eng.getState().components).toHaveLength(2);
  });

  it("undo returns false when at beginning", () => {
    const eng = new CommandEngine();
    expect(eng.undo()).toBe(false);
  });

  it("redo returns false when at end", () => {
    const eng = new CommandEngine();
    eng.apply({ t: "addComponent", component: makeResistor() });
    expect(eng.redo()).toBe(false);
  });

  it("applying after undo truncates redo history", () => {
    const eng = new CommandEngine();
    eng.apply({ t: "addComponent", component: makeResistor() });
    eng.apply({ t: "addComponent", component: makeResistor() });
    eng.undo();
    eng.apply({ t: "addComponent", component: makeResistor() }); // new branch
    expect(eng.redo()).toBe(false);
    expect(eng.getState().components).toHaveLength(2);
  });
});

// ── Replay determinism ─────────────────────────────────────────────────────────

describe("Replay determinism", () => {
  it("serialize(replay(log)) === serialize(replay(log)) byte-identical", () => {
    const eng = new CommandEngine();
    eng.apply({ t: "addComponent", component: makeResistor() });
    eng.apply({ t: "addComponent", component: makeResistor() });
    const pf = eng.serialize();

    const state1 = CommandEngine.replay(pf.log, pf.snapshot);
    const state2 = CommandEngine.replay(pf.log, pf.snapshot);

    expect(sortedJSON(state1)).toBe(sortedJSON(state2));
  });
});

// ── Level-invariance property ─────────────────────────────────────────────────

describe("Level-invariance property", () => {
  it("symbolId never changes through attachInterface/setParams/bindRealPart", () => {
    const eng = new CommandEngine();
    const { newId: id } = eng.apply({
      t: "addComponent",
      component: {
        level: 0,
        symbolId: "invariant_symbol",
        semanticPorts: [],
      },
    });

    eng.apply({ t: "attachInterface", componentId: id!, interfaceId: "i2c" });
    eng.apply({
      t: "setParams",
      componentId: id!,
      params: { freq: { value: 400, unit: "kHz" } },
    });
    eng.apply({
      t: "bindRealPart",
      componentId: id!,
      mpn: "PCF8574",
      footprintId: "DIP16",
    });

    const comp = eng.getState().components.find((c) => c.id === id)!;
    expect(comp.symbolId).toBe("invariant_symbol");
    expect(comp.level).toBe(3);
  });

  it("existing net members not removed when component is upgraded", () => {
    const eng = new CommandEngine();

    // Add two components and connect them
    const { newId: id1 } = eng.apply({
      t: "addComponent",
      component: { level: 0, symbolId: "sym_a", semanticPorts: [{ id: "out", role: "output" }] },
    });
    const { newId: id2 } = eng.apply({
      t: "addComponent",
      component: { level: 0, symbolId: "sym_b", semanticPorts: [{ id: "in", role: "input" }] },
    });

    eng.apply({
      t: "connect",
      a: { componentId: id1!, portId: "out" },
      b: { componentId: id2!, portId: "in" },
    });

    const netBefore = eng.getState().nets[0]!;
    expect(netBefore.members).toHaveLength(2);

    // Now upgrade component 1
    eng.apply({
      t: "setParams",
      componentId: id1!,
      params: { gain: { value: 10, unit: "dB" } },
    });

    // Net must still have same members
    const netAfter = eng.getState().nets[0]!;
    expect(netAfter.members).toHaveLength(2);
    expect(netAfter.members.some((m) => m.componentId === id1 && m.portId === "out")).toBe(true);
    expect(netAfter.members.some((m) => m.componentId === id2 && m.portId === "in")).toBe(true);
  });
});

// ── Command schemas ───────────────────────────────────────────────────────────

describe("Command schemas", () => {
  it("zCommandSchema parses addComponent command", async () => {
    const { zCommandSchema } = await import("../schemas.js");
    const cmd: Command = {
      t: "addComponent",
      component: {
        level: 1,
        symbolId: "sym_r",
        semanticPorts: [{ id: "a", role: "terminal" }],
      },
    };
    expect(zCommandSchema.parse(cmd)).toEqual(cmd);
  });

  it("zProjectFileSchema validates a serialized engine", async () => {
    const { zProjectFileSchema } = await import("../schemas.js");
    const eng = new CommandEngine();
    eng.apply({ t: "addComponent", component: makeResistor() });
    const pf = eng.serialize();
    expect(() => zProjectFileSchema.parse(pf)).not.toThrow();
  });
});
