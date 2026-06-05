import { describe, it, expect, beforeEach } from "vitest";
import { EngineController } from "../../state/EngineController";
import { executeTool } from "../tools";
import { runAgentTurn } from "../runtime";
import { kindForSymbolId } from "../../lib/symbols";

describe("offline agent + tool dispatcher", () => {
  let ctrl: EngineController;
  beforeEach(() => {
    ctrl = new EngineController();
  });

  it("builds an RC low-pass filter end-to-end (procedure → components → wires)", async () => {
    const { events } = await runAgentTurn("design a low-pass filter at 2 kHz", {
      ctrl,
      mode: "local",
      history: [],
    });

    const state = ctrl.getState();
    expect(state.components).toHaveLength(2);
    const kinds = state.components.map((c) => kindForSymbolId(c.symbolId)).sort();
    expect(kinds).toEqual(["capacitor", "resistor"]);

    // R and C are wired together on one net.
    expect(state.nets).toHaveLength(1);
    expect(state.nets[0]!.members).toHaveLength(2);

    // The agent reported a successful tool execution.
    const toolResults = events.filter((e) => e.type === "tool_result");
    expect(toolResults.some((e) => e.type === "tool_result" && e.ok)).toBe(true);
  });

  it("run_procedure computes E-series values WITHOUT mutating the circuit", () => {
    const res = executeTool(ctrl, "run_procedure", {
      procedureId: "filter.rc_lpf",
      params: { fc: { value: 1000, unit: "Hz" } },
    });
    expect(res.ok).toBe(true);
    const data = res.data as { values: { R: { value: number }; C: { value: number } } };
    expect(data.values.R.value).toBeGreaterThan(0);
    expect(data.values.C.value).toBeGreaterThan(0);
    // pure: no components were added
    expect(ctrl.getState().components).toHaveLength(0);
  });

  it("load_fixture and new_circuit reshape the circuit", () => {
    expect(executeTool(ctrl, "load_fixture", { name: "divider" }).ok).toBe(true);
    expect(ctrl.getState().components).toHaveLength(3);
    expect(executeTool(ctrl, "new_circuit", {}).ok).toBe(true);
    expect(ctrl.getState().components).toHaveLength(0);
  });

  it("add_component is undoable", () => {
    const res = executeTool(ctrl, "add_component", { symbolId: "sym_resistor", level: 2, params: { R: { value: 10, unit: "kΩ" } } });
    expect(res.ok).toBe(true);
    expect(ctrl.getState().components).toHaveLength(1);
    ctrl.undo();
    expect(ctrl.getState().components).toHaveLength(0);
    ctrl.redo();
    expect(ctrl.getState().components).toHaveLength(1);
  });

  it("attach_interface promotes a component up the fidelity ladder", () => {
    const add = executeTool(ctrl, "add_component", { symbolId: "sym_ic", level: 0, ports: [] });
    const id = (add.data as { id: string }).id;
    expect(ctrl.getState().components[0]!.level).toBe(0);
    const res = executeTool(ctrl, "attach_interface", { componentId: id, interfaceId: "i2c" });
    expect(res.ok).toBe(true);
    const comp = ctrl.getState().components.find((c) => c.id === id)!;
    expect(comp.level).toBe(1);
    expect(comp.semanticPorts.map((p) => p.id)).toContain("SDA");
  });

  it("reports a helpful message when the offline agent has no matching intent", async () => {
    const { events } = await runAgentTurn("explain quantum chromodynamics", {
      ctrl,
      mode: "local",
      history: [],
    });
    const text = events.find((e) => e.type === "assistant_text");
    expect(text && text.type === "assistant_text" && text.text.length > 0).toBe(true);
    expect(ctrl.getState().components).toHaveLength(0);
  });
});
