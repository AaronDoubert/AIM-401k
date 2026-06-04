import { describe, it, expect } from "vitest";
import {
  zQuantitySchema,
  zSemanticPortSchema,
  zObligationSchema,
  zPhysicalPinSchema,
  zModuleProvenanceSchema,
  zComponentSchema,
  zNetSchema,
  zViolationSchema,
  zInterfaceSchema,
  zCircuitStateSchema,
  validateCircuitState,
} from "../schemas.js";

describe("Zod schema round-trips", () => {
  it("Quantity schema", () => {
    const q = { value: 1000, unit: "Ω" };
    expect(zQuantitySchema.parse(q)).toEqual(q);
  });

  it("SemanticPort schema", () => {
    const port = { id: "p1", role: "data", fromInterface: "i2c" };
    expect(zSemanticPortSchema.parse(port)).toEqual(port);
  });

  it("SemanticPort schema minimal", () => {
    const port = { id: "p1", role: "data" };
    expect(zSemanticPortSchema.parse(port)).toEqual(port);
  });

  it("Obligation schema", () => {
    const ob = {
      id: "ob1",
      kind: "decouple" as const,
      description: "Add 100nF decoupling cap",
      satisfied: false,
    };
    expect(zObligationSchema.parse(ob)).toEqual(ob);
  });

  it("PhysicalPin schema", () => {
    const pin = { padId: "1", name: "VDD", semanticPortId: "vcc" };
    expect(zPhysicalPinSchema.parse(pin)).toEqual(pin);
  });

  it("ModuleProvenance schema", () => {
    const mp = {
      procedureId: "filter.rc_lpf",
      params: { fc: { value: 1000, unit: "Hz" } },
      version: 1,
    };
    expect(zModuleProvenanceSchema.parse(mp)).toEqual(mp);
  });

  it("Component schema minimal (L0)", () => {
    const comp = {
      id: "c1",
      level: 0 as const,
      symbolId: "sym_generic",
      semanticPorts: [],
    };
    expect(zComponentSchema.parse(comp)).toEqual(comp);
  });

  it("Component schema full (L3)", () => {
    const comp = {
      id: "c1",
      level: 3 as const,
      symbolId: "sym_resistor",
      semanticPorts: [{ id: "a", role: "terminal" }, { id: "b", role: "terminal" }],
      interfaces: [],
      params: { R: { value: 1000, unit: "Ω" } },
      part: {
        mpn: "CRCW040210K0FKED",
        footprintId: "R_0402",
        sourcing: { lcscPartNumber: "C25744", manufacturer: "Vishay" },
      },
      physicalPins: [
        { padId: "1", name: "~", semanticPortId: "a" },
        { padId: "2", name: "~", semanticPortId: "b" },
      ],
      obligations: [],
      moduleProvenance: {
        procedureId: "filter.rc_lpf",
        params: { fc: { value: 1000, unit: "Hz" } },
        version: 1,
      },
    };
    expect(zComponentSchema.parse(comp)).toEqual(comp);
  });

  it("Net schema", () => {
    const net = {
      id: "n1",
      name: "vmid",
      members: [
        { componentId: "c1", portId: "b" },
        { componentId: "c2", portId: "a" },
      ],
    };
    expect(zNetSchema.parse(net)).toEqual(net);
  });

  it("Violation schema", () => {
    const v = {
      code: "ERC001",
      severity: "error" as const,
      message: "Unconnected pin",
      componentIds: ["c1"],
    };
    expect(zViolationSchema.parse(v)).toEqual(v);
  });

  it("Interface schema", () => {
    const iface = {
      id: "i2c",
      ports: [{ id: "SDA", role: "data" }, { id: "SCL", role: "clock" }],
    };
    expect(zInterfaceSchema.parse(iface)).toEqual(iface);
  });

  it("CircuitState schema round-trip", () => {
    const state = {
      components: [
        {
          id: "c1",
          level: 1 as const,
          symbolId: "sym_resistor",
          semanticPorts: [{ id: "a", role: "terminal" }, { id: "b", role: "terminal" }],
        },
      ],
      nets: [
        {
          id: "n1",
          members: [{ componentId: "c1", portId: "a" }],
        },
      ],
      interfaces: [],
      schemaVersion: "0.0.1",
    };
    expect(zCircuitStateSchema.parse(state)).toEqual(state);
  });

  it("validateCircuitState returns parsed state", () => {
    const state = {
      components: [],
      nets: [],
      interfaces: [],
      schemaVersion: "0.0.1",
    };
    const result = validateCircuitState(state);
    expect(result.schemaVersion).toBe("0.0.1");
  });

  it("validateCircuitState throws on invalid input", () => {
    expect(() => validateCircuitState({ invalid: true })).toThrow();
  });
});
