# ADR 0001 — Simulation runs in a pre-warmed Web Worker; ship a real `.wasm`

- **Status:** Accepted
- **Date:** 2026-06-05
- **Spike:** [Spike 1 — ngspice-WASM perf](../spikes/SPIKES.md#spike-1--ngspice-wasm-performance-existential-for-live-sim)

## Context

Live simulation is existential to the tool's value: the SPICE loop must re-run on
debounced schematic edits and feel responsive. Spike 1 measured `eecircuit-engine`
(ngspice→WASM) at its current version (1.7.0):

- Warm runs are fast: ~6 ms for a small circuit, ~21 ms for 31 nodes — well under
  the ~100 ms live-sim budget.
- **Cold-start is the cost:** ~582 ms to instantiate the engine (Node), plus a
  ~20 MB ESM bundle to download and parse in-browser because the WASM is
  **base64-inlined** (no separate `.wasm`), which precludes
  `WebAssembly.instantiateStreaming` and granular HTTP caching → 1–3 s first load
  on a cold cache.
- The engine ran unmodified in Node with no browser-only assumptions, so it will
  run in a Worker.

## Decision

1. **Run SPICE in a dedicated Web Worker**, never on the UI thread. `start()`
   blocks ~0.5 s and `runSim` runs synchronously; both must be off-main-thread.
2. **Pre-warm the Worker** — spawn it and call `start()` at editor load, hiding the
   ~0.6 s init so sims after that feel synchronous.
3. **Debounce live sim (~200 ms)** on edits; tier by device capability per the
   plan's feature levels.
4. **Reuse one `Simulation` instance** — `setNetList` + `runSim` is the per-edit hot
   path; never re-`start()` per edit.
5. **Ship a real `.wasm`:** maintain a rebuilt eecircuit-engine (Emscripten with
   `SINGLE_FILE` disabled) emitting a standalone `.wasm`, to enable streaming
   instantiation + caching and cut wire bytes (~8.2 MB base64 → ~6 MB).
6. **Transfer results, don't copy:** marshal result vectors as transferable
   `Float64Array`/`ArrayBuffer` across `postMessage`.

## Consequences

- First sim after page load is not instant; surface a one-time "initializing
  simulator…" state. Do not promise instant first-sim in UX copy.
- The `sim-worker` package owns: worker lifecycle, pre-warm, netlist marshalling,
  result transfer, and the rebuilt-wasm artifact.
- Result shape is parallel arrays (`data[i].values` aligned by index; time/freq
  axis is one of `variableNames`); map node→`v(<node>)` case-insensitively.
- Report sim timings as medians (first `runSim` is slower due to JIT warmup).

## Follow-up

- Rebuild eecircuit-engine to emit a standalone `.wasm` (tracked in FOLLOW_UPS).
