# ADR 0002 — Model extensions are `condenser_*` sidecar elements; validate with a superset union

- **Status:** Accepted
- **Date:** 2026-06-05
- **Spike:** [Spike 2 — Circuit JSON extensibility](../spikes/SPIKES.md#spike-2--circuit-json-extensibility-accidental-fork-check)

## Context

Condenser's data model extends tscircuit's Circuit JSON with fidelity-ladder
knowledge (`level`, `semanticPorts`, `interfaces`, `obligations`,
`moduleProvenance`). The risk: if these extensions can't round-trip back to vanilla
Circuit JSON → KiCad/Gerber, we've forked tscircuit by accident.

Spike 2 found Circuit JSON validation is **loose on unknown fields (accept-then-
strip), strict on unknown element types (union rejects), and opt-in** (converters
never run whole-soup union validation). Three extension strategies were tested:

- **(a) extra fields on core elements** — silently stripped by zod strip-mode on any
  `.parse()`. A latent data-loss trap.
- **(b) sidecar elements** (`condenser_*` types referencing core by id) — ignored by
  the KiCad/Gerber converters (no throw), core elements preserved, vanilla output
  is a one-line `type`-prefix filter. Confirmed survives a converter round-trip.
- **(c) parallel id-keyed map** — safe fallback, more plumbing, loses
  single-document ergonomics.

BASE / Strategy-A / Strategy-B all produced byte-identical KiCad output.

## Decision

1. **Use Strategy (b): sidecar elements.** All Condenser extensions are distinct
   element types **namespaced `condenser_`** that reference core elements by
   foreign-key id (e.g. `{ type: "condenser_component_meta", source_component_id,
   level, semantic_ports, interfaces, obligations, module_provenance }`).
2. **Never use Strategy (a).** Do not write extension data as extra fields on core
   Circuit JSON elements — it is silently dropped by any zod `.parse()`.
3. **Validate against a superset union.** Condenser's own validation uses
   `any_circuit_element.or(condenserUnion)`, never the stock union over the soup.
4. **Strip-filter at the boundary.** Before handing data to any vanilla tscircuit
   tool (KiCad/Gerber/DSN), drop extensions with
   `soup.filter(e => !e.type.startsWith("condenser_"))`.
5. Strategy (c) remains the fallback only for extensions that must never touch a
   Circuit JSON consumer.

## Consequences

- Core electrical elements stay 100% vanilla → no format fork; manufacturing output
  (KiCad/Gerber via `circuit-json-to-gerber`) is clean and unaffected.
- The only fork vector is running the stock union over the soup; the superset-union
  rule (decision 3) neutralizes it.
- `core-model` must define the `condenser_*` element schemas and the superset union;
  the netlist/export layer must apply the strip-filter (decision 4).
- Gerber export is a separate package (`circuit-json-to-gerber`), not in
  `circuit-json` or `kicad-converter` — plan that dependency for the manufacturing
  milestone.

## Note on the current `core-model`

The Milestone-0 `core-model` uses a bespoke `CircuitState` shape, not the
tscircuit soup. This ADR governs the **integration boundary** with Circuit JSON:
when we adopt Circuit JSON as the interchange format (export path, KiCad/Gerber,
DSN), extensions cross that boundary as `condenser_*` sidecars. Until then the rule
binds any code that emits or consumes Circuit JSON.
