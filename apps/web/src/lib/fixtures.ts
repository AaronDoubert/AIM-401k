import type { CircuitState } from "@condenser/core-model";

// Demo circuits mirrored from packages/fixtures so the prototype can load
// known-good schematics with one click. Kept inline to avoid cross-package
// JSON import wiring; these match the golden fixtures used by the test suite.

export const dividerFixture: CircuitState = {
  schemaVersion: "0.0.1",
  interfaces: [],
  components: [
    {
      id: "vsource_1",
      level: 1,
      symbolId: "sym_vsource",
      semanticPorts: [
        { id: "pos", role: "positive" },
        { id: "neg", role: "negative" },
      ],
      params: { V: { value: 5, unit: "V" } },
    },
    {
      id: "r1",
      level: 2,
      symbolId: "sym_resistor",
      semanticPorts: [
        { id: "a", role: "terminal" },
        { id: "b", role: "terminal" },
      ],
      params: { R: { value: 1000, unit: "Ω" } },
    },
    {
      id: "r2",
      level: 2,
      symbolId: "sym_resistor",
      semanticPorts: [
        { id: "a", role: "terminal" },
        { id: "b", role: "terminal" },
      ],
      params: { R: { value: 1000, unit: "Ω" } },
    },
  ],
  nets: [
    {
      id: "net_vdd",
      name: "VDD",
      members: [
        { componentId: "vsource_1", portId: "pos" },
        { componentId: "r1", portId: "a" },
      ],
    },
    {
      id: "net_vmid",
      name: "vmid",
      members: [
        { componentId: "r1", portId: "b" },
        { componentId: "r2", portId: "a" },
      ],
    },
    {
      id: "net_gnd",
      name: "GND",
      members: [
        { componentId: "r2", portId: "b" },
        { componentId: "vsource_1", portId: "neg" },
      ],
    },
  ],
};

export const rcLpfFixture: CircuitState = {
  schemaVersion: "0.0.1",
  interfaces: [],
  components: [
    {
      id: "R1",
      level: 2,
      symbolId: "sym_resistor",
      semanticPorts: [
        { id: "a", role: "terminal" },
        { id: "b", role: "terminal" },
      ],
      params: { R: { value: 1.6, unit: "kΩ" } },
    },
    {
      id: "C1",
      level: 2,
      symbolId: "sym_capacitor",
      semanticPorts: [
        { id: "a", role: "terminal" },
        { id: "b", role: "terminal" },
      ],
      params: { C: { value: 100, unit: "nF" } },
    },
  ],
  nets: [
    {
      id: "net_in",
      name: "lpf_in",
      members: [{ componentId: "R1", portId: "a" }],
    },
    {
      id: "net_mid",
      name: "lpf_mid",
      members: [
        { componentId: "R1", portId: "b" },
        { componentId: "C1", portId: "a" },
      ],
    },
    {
      id: "net_gnd",
      name: "GND",
      members: [{ componentId: "C1", portId: "b" }],
    },
  ],
};

export const FIXTURES: Record<string, { label: string; circuit: CircuitState }> =
  {
    divider: { label: "Voltage divider (5V, 1k/1k)", circuit: dividerFixture },
    rc_lpf: { label: "RC low-pass filter (~995 Hz)", circuit: rcLpfFixture },
  };
