# ADR 0003 — Part fetch uses MIT TypeScript ports, never the AGPL `easyeda2kicad.py`

- **Status:** Accepted
- **Date:** 2026-06-05
- **Spike:** [Spike 5 — AGPL isolation](../spikes/SPIKES.md#spike-5--agpl-isolation-legal-watch-item)

## Context

The LCSC/JLC part-fetch path (LCSC part number → symbol + footprint + 3D) was
flagged as a FOSS-distribution risk because `easyeda2kicad.py` (uPesy) is
**AGPL-3.0** (viral over network use). The plan's mitigation options were: isolate
it out-of-process, find a permissive port, or roll the fetch ourselves.

Spike 5 verified licenses on npm + GitHub and found the AGPL applies **only to the
Python package**. Permissive alternatives that perform the same EasyEDA/LCSC fetch
already exist:

- `easyeda@0.0.269` + `easyeda-converter` — **tscircuit, MIT** — fetches EasyEDA
  JSON and converts directly to Circuit JSON / KiCad (native to our stack).
- `easyeda2kicad@1.9.5` on npm — **wokwi's TS port, MIT** (not the AGPL `.py`).
- `JLC2KiCad_lib` (TousstNicolas) — **MIT**.

## Decision

1. **Use the MIT TypeScript ports.** Prefer tscircuit's `easyeda` /
   `easyeda-converter` (same ecosystem, outputs Circuit JSON); wokwi's
   `easyeda2kicad` as backup.
2. **Do not depend on the AGPL Python `easyeda2kicad.py`** in any form — no
   bundling, no out-of-process shim. The dependency is simply avoided.
3. **No isolation machinery required** — the original "isolate AGPL out-of-process"
   contingency is dropped.

## Consequences

- The FOSS-distribution risk for the part-fetch path is removed; the backend can be
  freely licensed.
- The `parts` package depends on tscircuit `easyeda`/`easyeda-converter` (MIT);
  this also keeps part data in Circuit JSON, consistent with ADR 0002.
- **Residual diligence (binding):** pin exact dependency versions and re-confirm
  each license (including transitive deps) at adoption; an upstream relicense or a
  new transitive AGPL dep would reopen this. LCSC/EasyEDA data is fetched from
  EasyEDA's API — respect their terms for any shared deployment.

## Follow-up

- License-audit the `parts` dependency tree at adoption time (tracked in FOLLOW_UPS).
