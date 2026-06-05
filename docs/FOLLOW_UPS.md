# Follow-ups

Open items surfaced by the de-risking spikes (`spikes/SPIKES.md`). Each links the
spike/ADR it came from and the milestone where it must be resolved. Closed items
stay listed with a strike and a commit ref.

## Needs external access (couldn't close in the spike environment)

- [ ] **Real freerouting `.ses` ingestion test.** Spike 3 fed `dsn-converter` its
  *own* session, not a real freerouting output. Run the freerouting binary on the
  spike's `out.dsn`, take the real `.ses`, and confirm
  `convertDsnSessionToCircuitJson` ingests it. — *Spike 3 · before the autoroute phase.*
- [ ] **Vision pin-table error-rate measurement.** Measure extraction error on ~5
  real datasheets with a frontier vision model before scaling registry curation.
  No LLM key was available in the spike env. — *Spike 4 / ADR 0004 · before part-profile bootstrap.*

## Engineering work (tracked to milestones)

- [ ] **Rebuild eecircuit-engine to emit a standalone `.wasm`** (Emscripten,
  `SINGLE_FILE` off) for streaming instantiation + HTTP caching; cuts ~20 MB
  inlined bundle. — *ADR 0001 · SPICE-loop milestone.*
- [ ] **`sim-worker`: pre-warm + transferable results.** Spawn the worker and
  `start()` at editor load; marshal result vectors as transferable
  `Float64Array`/`ArrayBuffer`. — *ADR 0001 · SPICE-loop milestone.*
- [ ] **`condenser_*` sidecar schemas + superset union in `core-model`**, and a
  `type`-prefix strip-filter in the export/netlist layer. — *ADR 0002 · Circuit JSON adoption.*
- [ ] **Add `circuit-json-to-gerber`** for the manufacturing bundle (not in
  `circuit-json`/`kicad-converter`). — *ADR 0002 · tape-out milestone.*
- [ ] **DSN import bookkeeping gaps** (later-phase, non-blocking): regenerate/track
  `pcb_component` on import; de-duplicate nets/traces (1 connection → 3 traces);
  carry functional metadata (refdes/ftype/value) separately and re-attach by stable
  id (DSN mangles names, drops these). — *Spike 3 · autoroute phase.*
- [ ] **`parts` best-pins solver**: cardinality/bipartite-matching precheck + CSP +
  property tests (deterministic, correct hardware-pad binding, loud infeasibility).
  — *ADR 0004 · L3 binding milestone.*
- [ ] **License-audit the `parts` dependency tree** at adoption (pin versions,
  re-confirm transitive licenses; respect EasyEDA API terms for shared deploys). —
  *ADR 0003 · part-fetch integration.*
