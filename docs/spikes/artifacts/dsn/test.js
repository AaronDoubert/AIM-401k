import {
  convertCircuitJsonToDsnString,
  parseDsnToCircuitJson,
} from "dsn-converter";
import circuitJson from "./fixture.js";
import fs from "node:fs";

// ---- ROUND TRIP A: CircuitJson -> DSN ----
let dsn;
try {
  dsn = convertCircuitJsonToDsnString(circuitJson);
} catch (e) {
  console.error("A FAILED to produce DSN:", e.stack);
  process.exit(1);
}
fs.writeFileSync("/tmp/spike-dsn/out.dsn", dsn);
console.log("=== DSN LENGTH ===", dsn.length);
console.log("=== DSN (full) ===");
console.log(dsn);

const has = (re) => re.test(dsn);
console.log("\n=== A CHECKS ===");
console.log("has resolution/unit:", /\(resolution\s+(\w+)/.exec(dsn)?.[1]);
console.log("has R1 placement:", has(/R1/));
console.log("has R2 placement:", has(/R2/));
console.log("has (placement", has(/\(placement/));
console.log("has (library/image:", has(/\(image/));
console.log("has (padstack:", has(/\(padstack/));
console.log("has (network:", has(/\(network/));
console.log("has NET1 net:", has(/NET1/));
console.log("has (boundary/outline:", has(/\(boundary|\(outline/));

// extract placement coords
const placeRe = /\(place\s+(\S+)\s+(-?[\d.]+)\s+(-?[\d.]+)/g;
let m;
console.log("\nplacements found:");
while ((m = placeRe.exec(dsn))) console.log("  ", m[1], "x=", m[2], "y=", m[3]);

// ---- ROUND TRIP B: DSN -> CircuitJson ----
let back;
try {
  back = parseDsnToCircuitJson(dsn);
} catch (e) {
  console.error("B FAILED to parse DSN:", e.stack);
  process.exit(1);
}
fs.writeFileSync(
  "/tmp/spike-dsn/back.json",
  JSON.stringify(back, null, 2)
);

const tally = (arr) => {
  const t = {};
  for (const e of arr) t[e.type] = (t[e.type] || 0) + 1;
  return t;
};
console.log("\n=== B: element tallies ===");
console.log("ORIGINAL:", JSON.stringify(tally(circuitJson)));
console.log("ROUNDTRIP:", JSON.stringify(tally(back)));

// component positions
console.log("\n=== B: pcb_component centers ===");
const origC = circuitJson.filter((e) => e.type === "pcb_component");
const backC = back.filter((e) => e.type === "pcb_component");
for (const oc of origC) {
  const name = circuitJson.find(
    (e) => e.type === "source_component" && e.source_component_id === oc.source_component_id
  )?.name;
  const bc = backC.find((b) => {
    const bn = back.find(
      (e) => e.type === "source_component" && e.source_component_id === b.source_component_id
    )?.name;
    return bn === name;
  });
  console.log(
    `  ${name}: orig=(${oc.center.x},${oc.center.y}) back=${
      bc ? `(${bc.center.x},${bc.center.y})` : "MISSING"
    }`
  );
}

// pad positions
console.log("\n=== B: pad (pcb_smtpad) positions ===");
const origP = circuitJson.filter((e) => e.type === "pcb_smtpad");
const backP = back.filter((e) => e.type === "pcb_smtpad");
console.log(`  orig pads: ${origP.length}, back pads: ${backP.length}`);
const round = (n) => Math.round(n * 1000) / 1000;
for (const op of origP) {
  // match by nearest coordinate
  const near = backP
    .map((b) => ({ b, d: Math.hypot(b.x - op.x, b.y - op.y) }))
    .sort((a, b) => a.d - b.d)[0];
  console.log(
    `  orig(${op.x},${op.y}) w=${op.width} h=${op.height} -> nearest back(${round(
      near?.b.x
    )},${round(near?.b.y)}) w=${near?.b.width} h=${near?.b.height} drift=${round(near?.d)}`
  );
}

// nets / connectivity
console.log("\n=== B: nets ===");
console.log(
  "orig source_net names:",
  circuitJson.filter((e) => e.type === "source_net").map((e) => e.name)
);
console.log(
  "back source_net names:",
  back.filter((e) => e.type === "source_net").map((e) => e.name)
);
console.log(
  "orig source_trace count:",
  circuitJson.filter((e) => e.type === "source_trace").length,
  "back:",
  back.filter((e) => e.type === "source_trace").length
);

// connectivity check: does the trace still connect the same 2 ports (by net)?
const backTraces = back.filter((e) => e.type === "source_trace");
console.log("\n=== B: trace connectivity ===");
for (const t of backTraces) {
  console.log(
    "  trace connected_source_port_ids:",
    JSON.stringify(t.connected_source_port_ids),
    "nets:",
    JSON.stringify(t.connected_source_net_ids)
  );
}
const backPcbTraces = back.filter((e) => e.type === "pcb_trace");
console.log("back pcb_trace count:", backPcbTraces.length);
if (backPcbTraces[0])
  console.log(
    "  first pcb_trace route pts:",
    backPcbTraces[0].route?.length,
    JSON.stringify(backPcbTraces[0].route?.map((r) => [round(r.x), round(r.y)]))
  );
