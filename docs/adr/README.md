# Architecture Decision Records

Each ADR captures one load-bearing decision: its context, the decision, and the
consequences that bind future work. Decisions here are **Accepted** unless marked
otherwise; superseding an ADR means writing a new one that references it.

ADRs 0001–0004 record the four design locks that came out of the pre-roadmap
de-risking spikes (`../spikes/SPIKES.md`). Open follow-ups surfaced by the spikes
are tracked in [`../FOLLOW_UPS.md`](../FOLLOW_UPS.md).

| # | Decision | Status |
|---|----------|--------|
| [0001](0001-simulation-in-prewarmed-worker.md) | SPICE runs in a pre-warmed Web Worker; ship a real `.wasm` | Accepted |
| [0002](0002-circuit-json-sidecar-extensions.md) | Model extensions are `condenser_*` sidecar elements; superset-union validation | Accepted |
| [0003](0003-part-fetch-mit-ports.md) | Part fetch uses MIT TS ports, never the AGPL `.py` | Accepted |
| [0004](0004-best-pins-csp-with-precheck.md) | "Best pins" is a CSP gated by a cardinality/matching precheck | Accepted |

## Invariant cross-reference

These ADRs operationalize the anti-Flux invariants:
- 0002 enforces **#4** (connectivity level-agnostic, symbols level-invariant) at the
  serialization boundary.
- 0004 enforces **#1** (AI never does arithmetic) — pin assignment is deterministic CSP.
