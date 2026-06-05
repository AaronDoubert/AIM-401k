# CLAUDE.md — Condenser project orientation & handoff

Read this first when opening a new session. It's the running state of the project:
what's built, what's decided, what's next, and the gotchas. Architecture details
live in [`README.md`](README.md); decisions in [`docs/adr/`](docs/adr/); verified
assumptions in [`docs/spikes/SPIKES.md`](docs/spikes/SPIKES.md); open work in
[`docs/FOLLOW_UPS.md`](docs/FOLLOW_UPS.md).

## What this is

**Condenser** — a browser-based, AI-assisted schematic + PCB (EDA) tool. Codename
chosen for the obsolete term for a capacitor; "condensation" = formless vapor →
one definite droplet = the L0→L3 fidelity ladder. The thesis: AI-EDA tools are
sloppy because an LLM mutates a loose model with weak validation. Condenser inverts
that — a strict typed model + a library of deterministic procedures + a validation
loop, with the LLM confined to three jobs: capture intent, retrieve knowledge,
route to the right deterministic engine. **The AI never does arithmetic and never
writes raw model state.** See README §invariants.

This is meant to be a **close-to-full-featured EDA tool** (capture → ERC →
simulate → bind/source → place → route → DRC → fabricate), not a demo. Don't let
the AI/ladder framing seduce the work into a toy — the manufacturing outputs
(Gerber/BOM/P&P) are load-bearing and pulled early in the roadmap.

## Current state (as of 2026-06-05)

- **Milestone 0 — DONE & merged (PR #1).** Monorepo scaffold + the three contract
  packages, 56 tests green, CI enforcing them.
- **De-risking spikes — DONE.** All five stack assumptions verified against the
  real 2026 libraries; no stack change forced. Four decisions recorded as ADRs.
- Everything since PR #1 (spikes + ADRs) is on branch
  `claude/vibrant-goldberg-oyWBg`, **ahead of `main`, not yet in an open PR.**

### Build / test
```bash
pnpm install
pnpm test        # turbo: 56 tests across core-model, commands, procedures
pnpm typecheck
```
Node 22, pnpm 10 (pinned via `packageManager`). The walking-skeleton test in
`packages/commands/src/__tests__/skeleton.test.ts` is the regression backbone:
divider → serialize → replay → assert byte-identical. Keep it green.

### Packages (the three contracts + fixtures)
- `core-model/` — Circuit JSON+ types, `Quantity` (never bare floats), Zod schemas,
  STANDARD_INTERFACES.
- `commands/` — `Command` union, `CommandEngine` (apply/undo/redo/serialize/replay).
  Note: `LoggedCommand.resultMeta` stores apply-time nanoid ids so replay is
  byte-identical (without it, ids regenerate and break determinism).
- `procedures/` — `Procedure<P,D>` DSL, E-series snapping, golden-test harness, the
  `filter.rc_lpf` family. Author **families**, not one-off functions.
- `fixtures/` — shared golden circuits.

## Decisions already locked (ADRs — don't relitigate without a new ADR)

1. **0001** — SPICE (`eecircuit-engine`, ngspice-WASM) runs in a **pre-warmed Web
   Worker**; live-sim is feasible debounced (~6 ms warm); rebuild it to emit a real
   `.wasm` (currently a 20 MB base64-inlined bundle).
2. **0002** — Extend Circuit JSON via **`condenser_*` sidecar elements** (reference
   core by id), validate against a **superset union**, strip-filter at the vanilla
   boundary. Do NOT add extra fields to core elements (zod strip-mode silently
   drops them). This avoids forking tscircuit's Circuit JSON.
3. **0003** — Part fetch uses **MIT TS ports** (tscircuit `easyeda`/`easyeda-converter`
   preferred, wokwi `easyeda2kicad` backup). Never the AGPL Python `easyeda2kicad.py`.
4. **0004** — "Best pins" (semantic port → physical pin at L3) is a **deterministic
   CSP gated by a cardinality/matching precheck**. Fails loud (structured
   INFEASIBLE), never hallucinates a pin.

## What's next (pick up here)

The canonical roadmap is the v2 build spec (in session history / the original
message). Foundation + verification are done, so the next build step is:

- **Milestone 1 — Schematic editor (L0/L1).** Custom Canvas2D/WebGL scene graph:
  drop components, attach an Interface (the L0→L1 promotion), draw wires on
  semantic ports, color by level. Exit criterion: a **property test that level-up
  never changes `symbolId` and never rewires an existing net** (invariant #4 — the
  thing that sells the concept).

Alternatively, before more features, two spike follow-ups need external access we
didn't have (see FOLLOW_UPS): a real **freerouting `.ses`** ingestion test, and a
**vision pin-table error-rate** measurement on ~5 datasheets.

## Working agreements / gotchas

- **Branch:** develop on `claude/vibrant-goldberg-oyWBg`. PR #1 is already merged,
  so new commits sit ahead of `main` — ask before opening a new PR.
- **GitHub:** session scope is `aarondoubert/slop` only; use the `mcp__github__*`
  tools (no `gh` CLI). Don't open PRs unless asked.
- **Keep the invariants executable** — golden tests, replay determinism, no bare
  floats, AI-boundary (LLM output validates to `Command[]` only), level-invariance.
  These five CI guards ARE the product's moat.
- **`Quantity` everywhere** — `{value, unit}`, never a bare number in model state.
- Spike artifacts under `docs/spikes/artifacts/` are runnable (`node bench.mjs`,
  `node bestpins.mjs`, etc.) but are throwaway references, not packages.
