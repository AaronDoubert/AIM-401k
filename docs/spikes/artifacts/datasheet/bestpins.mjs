// SPIKE #4 — Deterministic "best pins" constraint solver.
//
// Thesis: a vision LLM does the MESSY FRONT (read a datasheet pinout diagram +
// table → emit a structured pin-function table). That output is noisy and must be
// human-verified. But the LOAD-BEARING BACK — assigning a circuit's required
// semantic ports (SPI.SCK, I2C.SDA, ...) to physical pins — is a DETERMINISTIC
// constraint-satisfaction problem with NO LLM in the loop and therefore NO
// hallucinated connections. This file proves that half works.
//
// Input shape = exactly what the vision pipeline would emit per MPN (cached).
// Output = a verified pin assignment, or a structured "infeasible" with a reason.

/**
 * A physical pin as extracted from a datasheet by the vision model.
 *   pad:        physical pad id (package pin number / BGA ball)
 *   name:       primary name (e.g. "PB3")
 *   functions:  every alternate function this pin can serve, as peripheral.signal
 *               e.g. ["spi0.mosi", "gpio", "pwm2.a"]
 *   fixed:      true if this pin has a dedicated, non-reassignable role
 *               (power, ground, crystal, reset) — solver must keep it clear.
 */
const ATMEGA328P_LIKE = [
  { pad: "1",  name: "PC6", functions: ["reset", "gpio"], fixed: true,  note: "RESET" },
  { pad: "2",  name: "PD0", functions: ["uart0.rx", "gpio"] },
  { pad: "3",  name: "PD1", functions: ["uart0.tx", "gpio"] },
  { pad: "4",  name: "PD2", functions: ["gpio", "int0"] },
  { pad: "5",  name: "PD3", functions: ["gpio", "pwm2.b", "int1"] },
  { pad: "6",  name: "PD4", functions: ["gpio"] },
  { pad: "7",  name: "VCC", functions: ["power"], fixed: true },
  { pad: "8",  name: "GND", functions: ["ground"], fixed: true },
  { pad: "9",  name: "PB6", functions: ["xtal1"], fixed: true, note: "crystal" },
  { pad: "10", name: "PB7", functions: ["xtal2"], fixed: true, note: "crystal" },
  { pad: "11", name: "PD5", functions: ["gpio", "pwm0.b"] },
  { pad: "12", name: "PD6", functions: ["gpio", "pwm0.a"] },
  { pad: "13", name: "PD7", functions: ["gpio"] },
  { pad: "14", name: "PB0", functions: ["gpio"] },
  { pad: "15", name: "PB1", functions: ["gpio", "pwm1.a"] },
  { pad: "16", name: "PB2", functions: ["gpio", "pwm1.b", "spi0.ss"] },
  { pad: "17", name: "PB3", functions: ["gpio", "spi0.mosi", "pwm2.a"] },
  { pad: "18", name: "PB4", functions: ["gpio", "spi0.miso"] },
  { pad: "19", name: "PB5", functions: ["gpio", "spi0.sck"] },
  { pad: "23", name: "PC0", functions: ["gpio", "adc0"] },
  { pad: "24", name: "PC1", functions: ["gpio", "adc1"] },
  { pad: "27", name: "PC4", functions: ["gpio", "i2c0.sda", "adc4"] },
  { pad: "28", name: "PC5", functions: ["gpio", "i2c0.scl", "adc5"] },
];

/**
 * A request = the semantic ports the circuit needs, grouped by interface.
 * Each required signal names the peripheral.signal family it must bind to.
 * "sameInstanceAs" enforces that a whole bus lands on ONE peripheral instance
 * (you can't split SCK on spi0 and MOSI on spi1) — a real datasheet constraint.
 */
const request = {
  ports: [
    { id: "SCK",  need: "spi.sck",  bus: "spi"  },
    { id: "MOSI", need: "spi.mosi", bus: "spi"  },
    { id: "MISO", need: "spi.miso", bus: "spi"  },
    { id: "CS",   need: "spi.ss",   bus: "spi"  },
    { id: "SDA",  need: "i2c.sda",  bus: "i2c"  },
    { id: "SCL",  need: "i2c.scl",  bus: "i2c"  },
    { id: "LED",  need: "gpio",     bus: null   },
    { id: "BTN",  need: "gpio",     bus: null   },
  ],
};

// ---- Solver -----------------------------------------------------------------

// Expand a pin's functions into (peripheralFamily, instance, signal) triples.
function pinCapabilities(pin) {
  if (pin.fixed) return [];
  return pin.functions.map((f) => {
    const m = f.match(/^(.*?)(\d+)\.(.+)$/); // e.g. spi0.mosi, i2c0.sda (peripheral name may contain digits)
    if (m) return { family: m[1], instance: `${m[1]}${m[2]}`, signal: `${m[1]}.${m[3]}` };
    return { family: f, instance: null, signal: f }; // e.g. plain "gpio"
  });
}

function canServe(pin, need) {
  return pinCapabilities(pin).some((c) => c.signal === need);
}

// Backtracking CSP: assign every requested port to a distinct physical pin,
// honoring fixed pins (never used) and bus-instance coherence.
function solve(pins, req) {
  const ports = req.ports;

  // Cardinality pre-check (Hall-style necessary condition): for each required
  // signal, count distinct non-fixed pins that can serve it. If any signal is
  // requested more times than there are capable pins, it's infeasible IMMEDIATELY.
  // Without this, naive backtracking blows up exponentially trying to PROVE
  // infeasibility (e.g. asking for 40 GPIO on a 17-GPIO part). Real production
  // lesson: gate the CSP with a bipartite-matching / cardinality precheck.
  const demand = {};
  for (const p of ports) demand[p.need] = (demand[p.need] || 0) + 1;
  for (const [need, count] of Object.entries(demand)) {
    const capable = pins.filter((pin) => !pin.fixed && canServe(pin, need)).length;
    if (count > capable) {
      return { ok: false, reason:
        `Need ${count}× "${need}" but only ${capable} pin(s) can serve it` };
    }
  }

  const assignment = {};            // portId -> pad
  const busInstance = {};           // bus -> chosen peripheral instance
  const usedPads = new Set();

  function instanceFor(pin, need) {
    const cap = pinCapabilities(pin).find((c) => c.signal === need);
    return cap ? cap.instance : null;
  }

  function backtrack(i) {
    if (i === ports.length) return true;
    const port = ports[i];
    const candidates = pins.filter(
      (p) => !usedPads.has(p.pad) && !p.fixed && canServe(p, port.need)
    );
    for (const pin of candidates) {
      const inst = instanceFor(pin, port.need);
      // Bus coherence: all ports on the same bus must share one peripheral instance.
      if (port.bus && inst) {
        if (busInstance[port.bus] && busInstance[port.bus] !== inst) continue;
      }
      assignment[port.id] = pin.pad;
      usedPads.add(pin.pad);
      const setBus = port.bus && inst && !busInstance[port.bus];
      if (setBus) busInstance[port.bus] = inst;

      if (backtrack(i + 1)) return true;

      // undo
      delete assignment[port.id];
      usedPads.delete(pin.pad);
      if (setBus) delete busInstance[port.bus];
    }
    return false;
  }

  const ok = backtrack(0);
  if (!ok) {
    // Produce a structured reason: which port had no feasible pin?
    const blockers = ports
      .filter((p) => !pins.some((pin) => !pin.fixed && canServe(pin, p.need)))
      .map((p) => p.id);
    return { ok: false, reason: blockers.length
      ? `No pin can serve required signal(s): ${blockers.join(", ")}`
      : "No simultaneous assignment satisfies bus-instance coherence" };
  }
  return { ok: true, assignment, busInstance };
}

// ---- Run + report -----------------------------------------------------------

function report(title, pins, req) {
  console.log(`\n=== ${title} ===`);
  const r = solve(pins, req);
  if (!r.ok) { console.log("INFEASIBLE:", r.reason); return r; }
  console.log("Bus instances:", r.busInstance);
  for (const port of req.ports) {
    const pad = r.assignment[port.id];
    const pin = pins.find((p) => p.pad === pad);
    console.log(`  ${port.id.padEnd(5)} (${port.need.padEnd(9)}) -> pad ${pad.padStart(2)} ${pin.name}`);
  }
  // Determinism check: solve twice, assert identical.
  const r2 = solve(pins, req);
  const identical = JSON.stringify(r.assignment) === JSON.stringify(r2.assignment);
  console.log("Deterministic (two solves identical):", identical);
  return r;
}

// Case A: the full request — should succeed, SPI on spi0, I2C on i2c0.
const good = report("ATmega328P-like, full SPI+I2C+2 GPIO", ATMEGA328P_LIKE, request);

// Case B: over-ask GPIOs until infeasible — proves it FAILS LOUDLY, never invents a pin.
const greedy = { ports: [...Array(40)].map((_, i) => ({ id: `G${i}`, need: "gpio", bus: null })) };
report("Over-ask 40 GPIO (must be infeasible, not hallucinated)", ATMEGA328P_LIKE, greedy);

// Case C: ask for a signal the part physically lacks (CAN) — structured refusal.
report("Ask for CAN (part has none)", ATMEGA328P_LIKE, {
  ports: [{ id: "CANH", need: "can.tx", bus: "can" }],
});

// Assertions for the spike verdict.
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } };
assert(good.ok, "full request should be feasible");
assert(good.busInstance.spi === "spi0", "SPI must land on one instance");
assert(good.busInstance.i2c === "i2c0", "I2C must land on one instance");
// SPI signals must be on the hardware-SPI pins (PB2..PB5), not arbitrary GPIO.
const spiPads = ["SCK", "MOSI", "MISO", "CS"].map((id) => good.assignment[id]);
assert(spiPads.every((p) => ["16", "17", "18", "19"].includes(p)),
  "SPI must bind to hardware-SPI pads only — no hallucinated assignment");
console.log("\nALL ASSERTIONS PASSED — deterministic best-pins solver works.");
