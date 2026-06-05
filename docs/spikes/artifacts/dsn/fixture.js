// Minimal 2-resistor PCB Circuit JSON.
// R1 at (-5,0), R2 at (5,0). Each 0402: two SMT pads 1mm apart.
// One trace connects R1.pin2 -> R2.pin1 on net NET1.
// Coordinates in mm (circuit-json convention).

const mkRes = (refdes, sourceCompId, cx) => {
  const c = [];
  // source_component
  c.push({
    type: "source_component",
    source_component_id: sourceCompId,
    name: refdes,
    ftype: "simple_resistor",
    resistance: 1000,
  });
  // pcb_component
  c.push({
    type: "pcb_component",
    pcb_component_id: `pcb_${sourceCompId}`,
    source_component_id: sourceCompId,
    center: { x: cx, y: 0 },
    width: 1.6,
    height: 0.8,
    layer: "top",
    rotation: 0,
  });
  // two pins
  const pads = [];
  for (const pin of [1, 2]) {
    const sourcePortId = `${sourceCompId}_port${pin}`;
    const px = cx + (pin === 1 ? -0.5 : 0.5);
    c.push({
      type: "source_port",
      source_port_id: sourcePortId,
      source_component_id: sourceCompId,
      name: `pin${pin}`,
      pin_number: pin,
      port_hints: [String(pin)],
    });
    const pcbPortId = `pcbport_${sourcePortId}`;
    c.push({
      type: "pcb_port",
      pcb_port_id: pcbPortId,
      source_port_id: sourcePortId,
      pcb_component_id: `pcb_${sourceCompId}`,
      x: px,
      y: 0,
      layers: ["top"],
    });
    c.push({
      type: "pcb_smtpad",
      pcb_smtpad_id: `smtpad_${sourcePortId}`,
      pcb_component_id: `pcb_${sourceCompId}`,
      pcb_port_id: pcbPortId,
      source_port_id: sourcePortId,
      shape: "rect",
      x: px,
      y: 0,
      width: 0.6,
      height: 0.6,
      layer: "top",
    });
    pads.push({ sourcePortId });
  }
  return { c, pads };
};

const r1 = mkRes("R1", "src_R1", -5);
const r2 = mkRes("R2", "src_R2", 5);

const circuitJson = [
  {
    type: "pcb_board",
    pcb_board_id: "board1",
    center: { x: 0, y: 0 },
    width: 20,
    height: 10,
    thickness: 1.4,
    num_layers: 2,
  },
  ...r1.c,
  ...r2.c,
  // net connecting R1.pin2 and R2.pin1
  {
    type: "source_net",
    source_net_id: "net_NET1",
    name: "NET1",
    member_source_group_ids: [],
  },
  {
    type: "source_trace",
    source_trace_id: "strace1",
    connected_source_port_ids: ["src_R1_port2", "src_R2_port1"],
    connected_source_net_ids: ["net_NET1"],
  },
  {
    type: "pcb_trace",
    pcb_trace_id: "ptrace1",
    source_trace_id: "strace1",
    route: [
      { route_type: "wire", x: -4.5, y: 0, width: 0.2, layer: "top" },
      { route_type: "wire", x: 4.5, y: 0, width: 0.2, layer: "top" },
    ],
  },
];

export default circuitJson;
