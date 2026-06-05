// Spike benchmark for eecircuit-engine (ngspice-WASM)
import { performance } from 'node:perf_hooks';

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const fmt = (n) => n.toFixed(2);

// ---- 1. COLD START: time from import to engine-ready ----
const tImportStart = performance.now();
const { Simulation } = await import('eecircuit-engine');
const tImportEnd = performance.now();

const sim = new Simulation();
const tStart = performance.now();
await sim.start();
const tReady = performance.now();

const importMs = tImportEnd - tImportStart;
const startMs = tReady - tStart;
const coldTotalMs = tReady - tImportStart;
console.log(`COLD-START: import=${fmt(importMs)}ms  start()=${fmt(startMs)}ms  total=${fmt(coldTotalMs)}ms`);

// helper to run a netlist and return {result, ms}
async function run(netlist) {
  sim.setNetList(netlist);
  const t0 = performance.now();
  const result = await sim.runSim();
  const t1 = performance.now();
  return { result, ms: t1 - t0 };
}

// pull a node voltage from a .op result
function nodeVoltage(result, name) {
  const idx = result.variableNames.findIndex(
    (v) => v.toLowerCase() === name.toLowerCase() || v.toLowerCase() === `v(${name})`.toLowerCase()
  );
  if (idx < 0) return null;
  const d = result.data[idx];
  const vals = d.values;
  const v = vals[vals.length - 1];
  return typeof v === 'number' ? v : v.real;
}

// ---- 2. DC OP: voltage divider, 5V over two 1k -> mid node ~2.5V ----
const divider = `Voltage divider
V1 in 0 DC 5
R1 in mid 1k
R2 mid 0 1k
.op
.end`;
const dc = await run(divider);
const vmid = nodeVoltage(dc.result, 'mid');
console.log(`DC-OP: vars=${JSON.stringify(dc.result.variableNames)} V(mid)=${vmid} (expect ~2.5)  run=${fmt(dc.ms)}ms`);
const dcOk = vmid !== null && Math.abs(vmid - 2.5) < 0.01;
console.log(`DC-OP correctness: ${dcOk ? 'PASS' : 'FAIL'}`);

// ---- 3. TRANSIENT: RC low-pass, R=1k C=1uF, pulse input, tau=1ms ----
const rc = `RC lowpass
V1 in 0 PULSE(0 5 0 1n 1n 10m 20m)
R1 in out 1k
C1 out 0 1u
.tran 10u 5m
.end`;
const N = 7;
const rcTimes = [];
let rcResult;
for (let i = 0; i < N; i++) {
  const r = await run(rc);
  rcTimes.push(r.ms);
  rcResult = r.result;
}
console.log(`TRANSIENT small (RC): points=${rcResult.numPoints} median=${fmt(median(rcTimes))}ms times=[${rcTimes.map(fmt).join(', ')}]`);

// ---- 4. LARGER: RC ladder with ~30 nodes ----
function buildLadder(stages) {
  let s = `RC ladder ${stages} stages\nV1 n0 0 PULSE(0 5 0 1n 1n 10m 20m)\n`;
  for (let i = 0; i < stages; i++) {
    s += `R${i} n${i} n${i + 1} 1k\n`;
    s += `C${i} n${i + 1} 0 100n\n`;
  }
  s += `.tran 10u 5m\n.end`;
  return s;
}
const STAGES = 30;
const ladder = buildLadder(STAGES);
const ladTimes = [];
let ladResult;
for (let i = 0; i < N; i++) {
  const r = await run(ladder);
  ladTimes.push(r.ms);
  ladResult = r.result;
}
console.log(`TRANSIENT large (${STAGES}-stage ladder, ${STAGES + 1} nodes): vars=${ladResult.numVariables} points=${ladResult.numPoints} median=${fmt(median(ladTimes))}ms times=[${ladTimes.map(fmt).join(', ')}]`);

// ---- 5. MARSHALLING: size + JSON-serialize cost of a result ----
function marshalCost(result, label) {
  const json = JSON.stringify(result);
  const bytes = Buffer.byteLength(json, 'utf8');
  const sTimes = [];
  for (let i = 0; i < 11; i++) {
    const t0 = performance.now();
    const j = JSON.stringify(result);
    JSON.parse(j); // round-trip ~ structured clone proxy
    const t1 = performance.now();
    sTimes.push(t1 - t0);
  }
  console.log(`MARSHALL ${label}: jsonBytes=${bytes} (${fmt(bytes / 1024)}KB) serialize+parse median=${fmt(median(sTimes))}ms`);
  return { bytes, ms: median(sTimes) };
}
marshalCost(rcResult, 'RC-small');
marshalCost(ladResult, 'ladder-large');

console.log('DONE');
