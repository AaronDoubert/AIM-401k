# ADR 0004 — "Best pins" is a deterministic CSP gated by a cardinality/matching precheck

- **Status:** Accepted
- **Date:** 2026-06-05
- **Spike:** [Spike 4 — Datasheet ingestion + best-pins](../spikes/SPIKES.md#spike-4--datasheet-ingestion-accuracy--deterministic-best-pins)

## Context

At L3 binding, a circuit's required semantic ports (SPI.{SCK,MOSI,MISO,CS},
I2C.{SDA,SCL}, GPIO×N, …) must be mapped to a real part's physical pins. This must
honor hardware-peripheral capability (SPI only on SPI-capable pads), fixed pins
(power/ground/crystal/reset kept clear), and bus-instance coherence (a whole bus on
one peripheral instance). Per invariant #1, the AI must not make this assignment —
it is arithmetic/constraint reasoning that belongs in deterministic code.

Spike 4 prototyped the assignment as a backtracking CSP (`bestpins.mjs`). It solved
the full SPI+I2C+GPIO case correctly and deterministically, and failed loud
(structured INFEASIBLE, never a hallucinated pin) on over-ask and unsupported
signals. It also surfaced a real failure mode: **naive backtracking blows up
exponentially when proving infeasibility** (40 GPIO over 18 pins explored
permutations until killed).

## Decision

1. **Pin assignment is a deterministic constraint-satisfaction problem**, not an AI
   judgment. The vision pipeline (front-end) only produces the candidate
   pin-function table; the assignment is pure code.
2. **Gate the CSP with a cardinality / bipartite-matching precheck** before search:
   for each required signal, demand ≤ count of capable non-fixed pins; reject
   infeasible cases immediately with a structured reason. This makes the
   pathological over-ask case instant instead of exponential.
3. **Fail loud, never invent.** When no assignment exists, return a structured
   `INFEASIBLE` with the blocking signal(s) — never a fabricated pin binding.
4. **Determinism is a tested property** — solving the same request twice must yield
   byte-identical assignments (consistent candidate ordering).

## Consequences

- The `parts` package owns the best-pins solver: the precheck, the CSP, and the
  golden/property tests (deterministic output; correct hardware-pad binding;
  loud infeasibility).
- The vision front-end's accuracy (spike measured literature ~F1 0.96–0.97) is a
  separate, human-in-the-loop concern (verify per MPN, cache the table). The
  deterministic back-end guarantees that even a wrong extraction can only produce a
  *verifiable* wrong table, never a silently-wrong wiring decision.
- For large parts, the precheck should grow into a full bipartite-matching
  feasibility test (Hall's condition) before invoking backtracking.

## Follow-up

- Measure real pin-table extraction error rate on ~5 datasheets with a frontier
  vision model before scaling registry curation (tracked in FOLLOW_UPS).
