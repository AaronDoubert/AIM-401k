# Condenser

Browser-based AI-assisted schematic + PCB tool with a strict fidelity ladder, deterministic math core, and command-sourced feature history.

## Architecture

Condenser is built on six invariants:

1. **AI never does arithmetic** — all math lives in deterministic procedures
2. **AI never mutates model directly** — only via validated Commands
3. **Every mutation is validated** — schema always, ERC/DRC where applicable
4. **Connectivity is level-agnostic** — symbols are level-invariant
5. **Source of truth = snapshot + command log** — deterministic, replayable
6. **Procedures are pure and tested** — golden-value unit tests required

### The Fidelity Ladder (L0–L3)

Components sit at one of four levels, upgrading monotonically and additively:

- **L0 — Formless**: name/role only, no ports
- **L1 — Interface-defined**: semantic ports from attached Interface (I2C→SDA/SCL/VCC/GND) or inherent kind
- **L2 — Parameterized generic**: L1 + real behavioral params (GBW, slew, Vf...)
- **L3 — Specific real part**: MPN, semantic ports mapped to physical pins, full pinout

Upgrading never changes `symbolId`, never removes or rewires existing nets.

### Commands

All model mutations go through the `CommandEngine` which validates, applies, and logs every command. The log + an initial snapshot are sufficient to deterministically replay the full circuit state.

### Procedures

Procedures are pure functions from parameters to derived values (and optionally subcircuit fragments). They do all arithmetic, snap to E-series preferred values, and report what was actually achieved. The AI calls procedures; it never does the math itself.

## Monorepo Structure

```
packages/
  core-model/   CONTRACT 1: types, Quantity, Zod schemas
  commands/     CONTRACT 2: Command union, CommandResult, log format, replay
  procedures/   CONTRACT 3: Procedure interface, DSL, golden-test harness, RC LPF family
  fixtures/     golden circuits shared across packages
```

## Getting Started

```bash
pnpm install
pnpm test
```

## Build Phases

- **Phase 0 (current)**: Monorepo scaffold, contract types, CommandEngine, RC LPF procedure, walking skeleton test
- **Phase 1**: SPICE-lite simulation engine (OP, AC, TRAN solvers)
- **Phase 2**: ERC/DRC rule engine with violation surfacing
- **Phase 3**: Schematic renderer (canvas-based, level-aware symbols)
- **Phase 4**: PCB layout engine with autorouter integration
- **Phase 5**: AI orchestration layer (LLM calls procedures, issues commands, never does math)
