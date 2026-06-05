# Condenser — De-risking Spikes (Pre-Roadmap Verification)

**Date:** 2026-06-05 · Run before committing to the build roadmap, per the plan's
"run these before committing the roadmap — any one could force a stack change."

Five load-bearing assumptions were verified against the **actual 2026 state** of
the libraries the architecture depends on. Each spike was throwaway verification
(run in `/tmp`, repo untouched); the runnable artifacts are preserved under
`docs/spikes/artifacts/` and the per-spike findings under each subfolder.

## TL;DR — all five clear; the roadmap stands

| # | Spike | Verdict | Roadmap impact |
|---|-------|---------|----------------|
| 1 | ngspice-WASM perf | ✅ **Live-sim feasible (debounced)** | Pre-warm a Worker; ship a real `.wasm` |
| 2 | Circuit JSON extensibility | ✅ **Extend without forking** (sidecar elements) | Lock Strategy (b); superset-union validation |
| 3 | DSN round-trip | ✅ **Freerouting path viable** | Not manual-only; bookkeeping gaps to close |
| 4 | Datasheet ingestion | ✅ **Architecture sound** (deterministic back proven) | Human-in-the-loop front; cache per MPN |
| 5 | AGPL isolation | ✅ **Concern dissolves** (MIT ports exist) | Use MIT TS ports; avoid the AGPL `.py` |

No spike forces a stack change. Two yield concrete design locks (sidecar
extensions; pre-warmed sim worker), one downgrades a flagged legal risk to a
non-issue, and one (datasheet) leaves a single measurable unknown that needs an
API key to close.

---

## Spike 1 — ngspice-WASM performance (EXISTENTIAL for live sim)

**Package:** `eecircuit-engine@1.7.0` (ngspice→WASM, tscircuit family).

- **Correctness:** DC op on a 5V/1k/1k divider returns **V(mid) = 2.5 V exactly** —
  the engine genuinely computes, ran **unmodified in Node** (no browser-only deps).
- **Cold-start:** ~**582 ms** (import + WASM compile + ngspice init), one-time per
  Worker spawn.
- **Warm run:** RC LPF (2 nodes) **~5.4 ms**; 31-node RC ladder **~16.4 ms**.
  Scaling ~linear in nodes for this class.
- **Marshalling:** result JSON 34 KB (small) / 344 KB (large); serialize+parse
  **0.4–5 ms** — cheap, and near-zero-copy with transferable `Float64Array`.
- **Full warm cycle:** small **~6 ms**, medium **~21 ms** — well under the ~100 ms
  live-sim target.

**Gotcha:** the engine bundle is a **20 MB ESM with the WASM base64-inlined** (no
separate `.wasm`) → no `instantiateStreaming`, no granular HTTP caching, ~1–3 s
first load in-browser on a cold cache.

**VERDICT:** Live-sim-on-edit is **feasible, debounced (~200 ms), in a dedicated
Worker**. Two production actions: **(a) pre-warm the Worker** at editor load to
hide the ~0.6 s init; **(b) rebuild eecircuit-engine to emit a real `.wasm`**
(disable Emscripten SINGLE_FILE) to fix bundle size + first-load. Show a one-time
"initializing simulator…" state; never promise instant *first* sim.

Artifacts: `artifacts/ngspice/bench.mjs`, `artifacts/ngspice/FINDINGS.md`.

---

## Spike 2 — Circuit JSON extensibility ("accidental fork" check)

**Packages:** `circuit-json@0.0.426`, `kicad-converter@0.0.17`,
Gerber via `circuit-json-to-gerber` (separate tscircuit-official package).

Circuit JSON is a flat "soup" of typed elements with zod schemas. Validation
posture: **loose on unknown fields (accept-then-strip), strict on unknown element
types (union rejects), and opt-in** (there is no monolithic whole-soup gatekeeper;
the converters never run union validation).

Extension strategies tested:
- **(a) extra fields on core elements** — survives the converter by luck but is
  **silently stripped** by zod strip-mode on any `.parse()`. **Data-loss trap — do
  not use.**
- **(b) sidecar elements** (`condenser_*` types referencing core by id) — **WINNER.**
  Ignored by the KiCad/Gerber converters (no throw), core electrical elements
  preserved, vanilla output is a one-line `type`-prefix filter. Confirmed
  `level/semantic_ports/obligations/module_provenance` survive a converter
  round-trip and are retrievable by foreign-key id.
- **(c) parallel id-keyed map** — safe fallback, more plumbing, loses
  single-document ergonomics.

Round-trip: BASE / Strategy-A / Strategy-B all produced **byte-identical KiCad
s-expr** (2 footprints, 1 segment); extensions cleanly stripped from manufacturing
output; full KiCad→back round-trip exists.

**VERDICT:** **We can extend Circuit JSON without forking it.** Lock **Strategy (b)
sidecar elements**, namespaced `condenser_`. Guardrail: for Condenser's *own*
validation, validate against a **superset union** (`any_circuit_element.or(condenserUnion)`),
and strip-filter before handing data to any vanilla tscircuit tool. Accidental-fork
risk: **LOW** — core elements stay 100% vanilla; the only fork vector is running
the stock union over the soup, which the superset-union guardrail neutralizes.

Artifacts: `artifacts/circuit-json/survive.mjs`, `artifacts/circuit-json/runtest.mjs`.

---

## Spike 3 — DSN round-trip (freerouting autoroute path, later phase)

**Packages:** `dsn-converter@0.0.87`, `circuit-json@0.0.433`.

Both directions are first-class API: `convertCircuitJsonToDsnString` /
`parseDsnToCircuitJson`, plus the **session pair**
`convertCircuitJsonToDsnSession` / `convertDsnSessionToCircuitJson` — exactly the
freerouting hand-off (freerouting consumes `.dsn`, emits `.ses`).

- **CircuitJson → DSN:** valid Specctra DSN tagged `host_cad "KiCad's Pcbnew"` (the
  dialect freerouting expects). Components, padstacks, nets, board outline, and
  existing wiring all present; **mm→um exact** (−5 mm → −5000, 0.6 mm pad → 600).
- **DSN → CircuitJson:** pad geometry **zero drift**; trace geometry exact;
  connectivity preserved.
- **Session (`.ses`) path:** exercised in-process end-to-end; route re-imports at
  exact mm (note `.ses` wire paths are in 10× um session-space — importer scales).

**Bounded gaps (bookkeeping, not show-stoppers):** `pcb_component` elements aren't
regenerated on import (coords still in the DSN); identifier mangling
(`R1`→`R1_src_R1`, `simple_resistor`→`simple_chip`, resistance not carried — DSN
holds no functional metadata); the exporter emits a duplicate net → re-import
yields 3 traces for 1 connection (needs de-dup).

**VERDICT:** Freerouting autoroute path is **viable — do NOT plan manual-routing-only.**
Geometry/connectivity (what routing depends on) round-trips faithfully. Close the
three bookkeeping gaps when the autoroute phase lands, and carry functional
metadata (refdes/ftype/value) separately, re-attaching by stable id.
**One unclosed unknown:** this fed dsn-converter its *own* session, not a real
freerouting `.ses` — run the actual freerouting binary on `out.dsn` and confirm
ingestion before committing the phase.

Artifacts: `artifacts/dsn/fixture.js`, `artifacts/dsn/test.js`.

---

## Spike 4 — Datasheet ingestion accuracy + deterministic "best pins"

**No LLM key in env** → vision front-end assessed from literature; the
load-bearing **deterministic back-end was prototyped and proven**.

- **Front (vision LLM):** structured table/field extraction lands ~**F1 0.96–0.97**
  in 2026 literature — strong but **not zero-error**, and a pin table is less
  forgiving than an invoice. ⇒ **human-verify per MPN, cache the result.**
- **Back (deterministic CSP, built):** `bestpins.mjs` assigns required semantic
  ports → physical pins under fixed-pin, hardware-capability, bus-instance-coherence
  and distinct-pin constraints. Full SPI+I2C+GPIO request **solves correctly and
  deterministically** (SPI→hardware-SPI pads PB2–PB5, I2C→PC4/PC5). Over-ask (40
  GPIO / 18 pins) and an unsupported signal (CAN) return **structured INFEASIBLE
  with a reason — never a hallucinated pin.**
- **Lesson:** naive backtracking blows up proving infeasibility; gate the CSP with
  a **cardinality / bipartite-matching precheck** (applied — infeasible now instant).

**VERDICT:** Architecture is **sound** — strong LLM on the messy front,
deterministic solver on the back ⇒ no hallucinated connections. Risk lives entirely
on the front-end accuracy, **managed by human-in-the-loop + per-MPN caching**, not
by trusting the model. **Unclosed unknown:** measure real pin-table error rate on
~5 actual datasheets with a frontier vision model (needs a key) before scaling
registry curation.

Artifacts: `artifacts/datasheet/bestpins.mjs`, `artifacts/datasheet/FINDINGS.md`.

---

## Spike 5 — AGPL isolation (legal watch-item)

The plan flagged `easyeda2kicad.py` (uPesy) as **AGPL-3.0** (viral over network
use) — a FOSS-distribution risk for the LCSC/JLC part-fetch path.

Findings (npm + GitHub license verification):
- The **AGPL is only on the Python `easyeda2kicad.py`**.
- **MIT-licensed alternatives that do the same LCSC fetch already exist:**
  - `easyeda2kicad@1.9.5` on npm = **wokwi's TypeScript port, MIT** (not the AGPL `.py`).
  - `easyeda@0.0.269` + `easyeda-converter` = **tscircuit's, MIT** — fetches EasyEDA
    JSON and converts to Circuit JSON / KiCad directly (native to our stack).
  - `JLC2KiCad_lib` (TousstNicolas) = **MIT**.

**VERDICT:** The AGPL concern **dissolves**. Use the **MIT TS ports** (tscircuit
`easyeda`/`easyeda-converter` preferred — same ecosystem, outputs Circuit JSON;
wokwi's `easyeda2kicad` as backup) and **do not depend on the AGPL Python package.**
No out-of-process isolation needed. Residual diligence: pin exact versions and
re-confirm each dependency's license at adoption (transitive deps), and note LCSC
data is fetched from EasyEDA's API — respect their terms for a shared deployment.

---

## Net effect on the roadmap

- **No stack change required.** All four core libraries (eecircuit-engine,
  circuit-json, kicad-converter/circuit-json-to-gerber, dsn-converter) behave as
  the architecture assumes, at their current 2026 versions.
- **Design locks recorded as ADRs:** [0001](../adr/0001-simulation-in-prewarmed-worker.md)
  sim in a pre-warmed Worker + real `.wasm`; [0002](../adr/0002-circuit-json-sidecar-extensions.md)
  `condenser_*` sidecar elements + superset-union validation;
  [0003](../adr/0003-part-fetch-mit-ports.md) MIT TS part-fetch ports, never the
  AGPL `.py`; [0004](../adr/0004-best-pins-csp-with-precheck.md) best-pins CSP gated
  by a cardinality/matching precheck.
- **Open follow-ups tracked in [`../FOLLOW_UPS.md`](../FOLLOW_UPS.md)**, including the
  two unknowns that need external access: a real freerouting `.ses` ingestion test,
  and a real vision-model pin-table error-rate measurement on ~5 datasheets.
