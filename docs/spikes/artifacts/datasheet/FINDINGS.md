# SPIKE FINDINGS: Datasheet ingestion accuracy + the deterministic "best pins" back-end

Throwaway verification in `/tmp/spike-datasheet`. SLOP repo untouched.
No LLM API key is exposed in this environment, so the **vision front-end** was
assessed from literature; the **deterministic back-end** (the load-bearing half)
was prototyped and proven.

## The two halves of the pipeline

1. **Messy front (vision LLM):** datasheet PDF + pinout diagram → structured
   pin-function table (each physical pin → primary + alternate functions, max
   ratings, recommended decoupling, layout notes). Inherently noisy.
2. **Deterministic back (no LLM):** given that table + a circuit's required
   semantic ports, assign ports → physical pins by constraint satisfaction.
   **No hallucinated connections possible — it's pure CSP.**

## Front-end accuracy (from literature, June 2026)

Vision LLMs on structured table/field extraction land around **F1 0.96–0.97**
(GPT-4o / Claude on medical-record and invoice table extraction). Strong, but
**not zero-error** — and a pin table is less forgiving than an invoice: a single
swapped alternate-function cell produces a plausible-looking wrong pinout.

Implication: **the front-end output MUST be human-verified per MPN and cached.**
This matches the plan's "registry is a content problem, human-in-the-loop"
stance. Budget curation effort; do not treat ingestion as fire-and-forget.

## Back-end prototype (built + proven) — `bestpins.mjs`

A backtracking CSP that assigns required semantic ports (SPI.{SCK,MOSI,MISO,CS},
I2C.{SDA,SCL}, GPIO×N) to physical pins of an ATmega328P-like pin table,
enforcing:
- **fixed pins** (power/ground/crystal/reset) are never reassigned,
- **hardware-peripheral capability** (SPI only on SPI-capable pads),
- **bus-instance coherence** (a whole bus lands on ONE peripheral instance),
- **distinct-pin** assignment.

Results:
- Full request **solves correctly + deterministically** (two solves byte-identical):
  SPI→PB2–PB5 (the actual hardware-SPI pads), I2C→PC4/PC5, GPIO→spare pins.
- Over-ask (40 GPIO on an 18-GPIO part) → **structured INFEASIBLE**, never invents
  a pin. CAN request on a part with no CAN → **structured INFEASIBLE** with reason.
- Assertions confirm SPI binds to hardware-SPI pads only (no arbitrary GPIO).

## Lesson surfaced by the spike

Naive backtracking blows up **exponentially when proving infeasibility**
(40 GPIO over 18 pins explored permutations until killed). Fix applied: a
**cardinality / Hall-style precheck** (per required signal, demand ≤ capable
pins) fails infeasible cases instantly. Production "best pins" solver should
gate the CSP with a **bipartite-matching feasibility check** before search.

## VERDICT

**Architecture is sound: strong LLM on the messy front, deterministic solver on
the back → no hallucinated connections.** The load-bearing back-end is proven and
cheap. The risk is entirely on the front-end's accuracy, which is real but
**managed by human-in-the-loop verification + per-MPN caching**, not by trusting
the model. The deterministic back-end means even a wrong LLM extraction can only
ever produce a *verifiable* wrong table, never a silently-wrong wiring decision.

Remaining unknown (needs a key to close): measure real pin-table extraction error
rate on ~5 actual datasheets with a frontier vision model before scaling curation.

Artifact: `/tmp/spike-datasheet/bestpins.mjs` (`node bestpins.mjs`).
