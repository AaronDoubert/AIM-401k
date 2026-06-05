# SPIKE FINDINGS: ngspice-WASM (eecircuit-engine) for Condenser live-sim

Package: eecircuit-engine 1.7.0 (ngspice-WASM)
WASM payload: ~6.16 MB decoded (8.21 MB base64, INLINED into a 20.4 MB ESM bundle; no standalone .wasm)
API: new Simulation() -> await sim.start() -> sim.setNetList(str) -> await sim.runSim()

COLD-START (Node, fresh process x4): import ~85ms + start() ~500ms = TOTAL ~582ms (one-time, stable 580-593ms)
DC-OP correctness: voltage divider 5V over two 1k => V(mid)=2.5V EXACTLY => PASS
TRANSIENT small (RC 1k/1uF, .tran 10u 5m, 527 pts): median ~5.4ms
TRANSIENT large (30-stage ladder, 31 nodes, 533 pts): median ~16.4ms
MARSHALL (JSON serialize+parse): small 34KB ~0.4ms; large 344KB ~5.0ms

Full warm cycle small ~6ms, medium ~21ms -> well under 100ms target.

VERDICT: Live-sim-on-edit FEASIBLE, debounced, in a Web Worker. Warm compute is excellent.
Caveat: cold-start ~582ms init + ~20MB bundle download/parse in browser. So warm=live, first-run=not instant.
Recommend: debounced (~200ms) sim in a pre-warmed dedicated worker; show one-time init state on first sim. NOT background-only.

GOTCHAS:
1. No separate .wasm (base64-inlined in 20MB JS) -> lose instantiateStreaming + granular caching. #1 prod fix: rebuild to emit real .wasm.
2. Worker isolation essential (start() blocks ~0.5s, runSim 5-20ms sync). Runs unmodified in Node, no browser-only deps -> fine in Worker.
3. Result = parallel arrays; data[i].values aligned by index; map node->v(<node>) case-insensitive. Use Float64Array+transfer for postMessage.
4. Reuse one Simulation instance; setNetList+runSim is the hot path, never re-start() per edit.
5. ngspice netlist format worked as documented (.op/.tran/.end, PULSE()).
6. First runSim slightly slower (JIT warmup) -> report medians.

Artifacts: /tmp/spike-ngspice/bench.mjs (re-runnable), this file.
