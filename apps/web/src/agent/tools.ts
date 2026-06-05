import type { Command } from "@condenser/commands";
import type {
  Component,
  Quantity,
  SemanticPort,
  Level,
} from "@condenser/core-model";
import type { EngineController } from "../state/EngineController";
import { PROCEDURES, insertFragment, listProcedures } from "./procedures";
import { FIXTURES } from "../lib/fixtures";
import { kindForSymbolId } from "../lib/symbols";

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema (object)
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

// ── JSON-schema fragments reused across tools ─────────────────────────────────

const quantitySchema = {
  type: "object",
  properties: {
    value: { type: "number" },
    unit: { type: "string", description: "SI unit, may carry a metric prefix (Hz, kΩ, nF, V, …)" },
  },
  required: ["value", "unit"],
} as const;

const portRefSchema = {
  type: "object",
  properties: {
    componentId: { type: "string" },
    portId: { type: "string" },
  },
  required: ["componentId", "portId"],
} as const;

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "get_circuit",
    description:
      "Return the current circuit: components (id, symbol, level, ports, params) and nets (id, name, members). Call this before editing so you reference real ids.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "list_procedures",
    description:
      "List the deterministic design procedures available. Use a procedure for any component-value math — never compute R/C/L values yourself.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "run_procedure",
    description:
      "Run a design procedure to compute real component values (E-series snapped) WITHOUT modifying the circuit. Returns the achieved values. This is how you do arithmetic.",
    parameters: {
      type: "object",
      properties: {
        procedureId: { type: "string", description: "e.g. filter.rc_lpf" },
        params: {
          type: "object",
          description: "Procedure parameters, e.g. { fc: { value: 1000, unit: 'Hz' } }",
          additionalProperties: true,
        },
        constraints: {
          type: "object",
          properties: {
            eseries: { type: "string", enum: ["E12", "E24", "E96"] },
            preferLower: { type: "boolean" },
          },
        },
      },
      required: ["procedureId", "params"],
    },
  },
  {
    name: "insert_module",
    description:
      "Run a procedure AND materialize its resulting subcircuit into the schematic (adds components, wires nets). Use this to actually build a filter/divider/etc.",
    parameters: {
      type: "object",
      properties: {
        procedureId: { type: "string" },
        params: { type: "object", additionalProperties: true },
        constraints: {
          type: "object",
          properties: {
            eseries: { type: "string", enum: ["E12", "E24", "E96"] },
            preferLower: { type: "boolean" },
          },
        },
      },
      required: ["procedureId", "params"],
    },
  },
  {
    name: "add_component",
    description:
      "Add a single component. symbolId examples: sym_resistor, sym_capacitor, sym_inductor, sym_vsource, sym_diode, sym_ic. Ports default sensibly for known symbols.",
    parameters: {
      type: "object",
      properties: {
        symbolId: { type: "string" },
        level: { type: "integer", enum: [0, 1, 2, 3] },
        ports: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "string" }, role: { type: "string" } },
            required: ["id", "role"],
          },
        },
        params: {
          type: "object",
          description: "named Quantities, e.g. { R: { value: 10, unit: 'kΩ' } }",
          additionalProperties: quantitySchema,
        },
      },
      required: ["symbolId"],
    },
  },
  {
    name: "connect",
    description: "Wire two ports together (creates or extends a net).",
    parameters: {
      type: "object",
      properties: { a: portRefSchema, b: portRefSchema },
      required: ["a", "b"],
    },
  },
  {
    name: "set_params",
    description: "Set/merge behavioral parameters on a component (promotes it to L2).",
    parameters: {
      type: "object",
      properties: {
        componentId: { type: "string" },
        params: { type: "object", additionalProperties: quantitySchema },
      },
      required: ["componentId", "params"],
    },
  },
  {
    name: "attach_interface",
    description:
      "Attach a standard interface (i2c, spi, uart, power_rail, analog_diff) to a component, adding its semantic ports (promotes to L1).",
    parameters: {
      type: "object",
      properties: {
        componentId: { type: "string" },
        interfaceId: { type: "string" },
      },
      required: ["componentId", "interfaceId"],
    },
  },
  {
    name: "bind_real_part",
    description: "Bind a real MPN + footprint to a component (promotes to L3).",
    parameters: {
      type: "object",
      properties: {
        componentId: { type: "string" },
        mpn: { type: "string" },
        footprintId: { type: "string" },
      },
      required: ["componentId", "mpn", "footprintId"],
    },
  },
  {
    name: "set_net_name",
    description: "Rename a net.",
    parameters: {
      type: "object",
      properties: { netId: { type: "string" }, name: { type: "string" } },
      required: ["netId", "name"],
    },
  },
  {
    name: "load_fixture",
    description: "Replace the circuit with a built-in demo: 'divider' or 'rc_lpf'.",
    parameters: {
      type: "object",
      properties: { name: { type: "string", enum: ["divider", "rc_lpf"] } },
      required: ["name"],
    },
  },
  {
    name: "new_circuit",
    description: "Clear the schematic and start an empty circuit.",
    parameters: { type: "object", properties: {} },
  },
];

// ── default ports for known symbols ───────────────────────────────────────────

function defaultPorts(symbolId: string): SemanticPort[] {
  const kind = kindForSymbolId(symbolId);
  if (kind === "vsource" || kind === "isource") {
    return [
      { id: "pos", role: "positive" },
      { id: "neg", role: "negative" },
    ];
  }
  if (kind === "ic" || kind === "generic") return [];
  return [
    { id: "a", role: "terminal" },
    { id: "b", role: "terminal" },
  ];
}

// ── circuit summary for the model ─────────────────────────────────────────────

function summarize(ctrl: EngineController) {
  const s = ctrl.getState();
  return {
    components: s.components.map((c) => ({
      id: c.id,
      symbolId: c.symbolId,
      level: c.level,
      ports: c.semanticPorts.map((p) => p.id),
      params: c.params ?? {},
      ...(c.part ? { part: c.part } : {}),
    })),
    nets: s.nets.map((n) => ({
      id: n.id,
      name: n.name ?? null,
      members: n.members,
    })),
  };
}

// ── dispatcher ────────────────────────────────────────────────────────────────

/**
 * Execute a single tool call against the engine. Shared by the LLM runtime and
 * the offline local agent so both follow exactly the same rules.
 */
export function executeTool(
  ctrl: EngineController,
  name: string,
  args: Record<string, unknown>
): ToolResult {
  try {
    switch (name) {
      case "get_circuit":
        return { ok: true, data: summarize(ctrl) };

      case "list_procedures":
        return { ok: true, data: listProcedures() };

      case "run_procedure": {
        const procedureId = String(args.procedureId);
        const proc = PROCEDURES[procedureId];
        if (!proc) return { ok: false, error: `Unknown procedure '${procedureId}'` };
        const parsed = proc.paramSchema.safeParse(args.params);
        if (!parsed.success) {
          return { ok: false, error: `Invalid params: ${parsed.error.message}` };
        }
        const out = proc.solve(parsed.data, args.constraints as never);
        return { ok: true, data: out };
      }

      case "insert_module": {
        const procedureId = String(args.procedureId);
        const proc = PROCEDURES[procedureId];
        if (!proc) return { ok: false, error: `Unknown procedure '${procedureId}'` };
        if (!proc.emit) return { ok: false, error: `Procedure '${procedureId}' cannot emit a subcircuit` };
        const parsed = proc.paramSchema.safeParse(args.params);
        if (!parsed.success) {
          return { ok: false, error: `Invalid params: ${parsed.error.message}` };
        }
        const { values } = proc.solve(parsed.data, args.constraints as never);
        const fragment = proc.emit(values);
        const inserted = insertFragment(ctrl, fragment, proc.title);
        return { ok: true, data: { values, ...inserted } };
      }

      case "add_component": {
        const symbolId = String(args.symbolId);
        const ports =
          (args.ports as SemanticPort[] | undefined) ?? defaultPorts(symbolId);
        const component: Omit<Component, "id"> = {
          level: (args.level as Level) ?? 0,
          symbolId,
          semanticPorts: ports,
          ...(args.params ? { params: args.params as Record<string, Quantity> } : {}),
        };
        const res = ctrl.apply({ t: "addComponent", component }, `add ${symbolId}`);
        return res.ok
          ? { ok: true, data: { id: res.newId } }
          : { ok: false, error: res.violations?.map((v) => v.message).join("; ") };
      }

      case "connect": {
        const cmd: Command = {
          t: "connect",
          a: args.a as { componentId: string; portId: string },
          b: args.b as { componentId: string; portId: string },
        };
        const res = ctrl.apply(cmd, "connect");
        return res.ok
          ? { ok: true, data: { netId: res.delta?.added?.nets?.[0]?.id ?? null } }
          : { ok: false, error: res.violations?.map((v) => v.message).join("; ") };
      }

      case "set_params": {
        const res = ctrl.apply(
          {
            t: "setParams",
            componentId: String(args.componentId),
            params: args.params as Record<string, Quantity>,
          },
          "set params"
        );
        return res.ok
          ? { ok: true, data: { ok: true } }
          : { ok: false, error: res.violations?.map((v) => v.message).join("; ") };
      }

      case "attach_interface": {
        const res = ctrl.apply(
          {
            t: "attachInterface",
            componentId: String(args.componentId),
            interfaceId: String(args.interfaceId),
          },
          "attach interface"
        );
        return res.ok
          ? { ok: true, data: { ok: true } }
          : { ok: false, error: res.violations?.map((v) => v.message).join("; ") };
      }

      case "bind_real_part": {
        const res = ctrl.apply(
          {
            t: "bindRealPart",
            componentId: String(args.componentId),
            mpn: String(args.mpn),
            footprintId: String(args.footprintId),
          },
          "bind real part"
        );
        return res.ok
          ? { ok: true, data: { ok: true } }
          : { ok: false, error: res.violations?.map((v) => v.message).join("; ") };
      }

      case "set_net_name": {
        const res = ctrl.apply(
          {
            t: "setNetName",
            netId: String(args.netId),
            name: String(args.name),
          },
          "name net"
        );
        return res.ok
          ? { ok: true, data: { ok: true } }
          : { ok: false, error: res.violations?.map((v) => v.message).join("; ") };
      }

      case "load_fixture": {
        const fx = FIXTURES[String(args.name)];
        if (!fx) return { ok: false, error: `Unknown fixture '${String(args.name)}'` };
        ctrl.loadCircuit(fx.circuit);
        return { ok: true, data: { loaded: String(args.name) } };
      }

      case "new_circuit":
        ctrl.newCircuit();
        return { ok: true, data: { ok: true } };

      default:
        return { ok: false, error: `Unknown tool '${name}'` };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
