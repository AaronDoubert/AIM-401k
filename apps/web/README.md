# @condenser/web — visual prototype

Browser-based prototype for Condenser. It renders the deterministic core
(`@condenser/core-model`, `@condenser/commands`, `@condenser/procedures`) as an
interactive schematic with an AI design copilot.

## Run

```bash
# from the repo root
pnpm install
pnpm build        # builds the workspace packages this app imports
pnpm dev          # Vite dev server on http://localhost:5173
pnpm preview      # or serve the production build on http://localhost:4173
```

## Layout

```
src/
  state/        EngineController (wraps CommandEngine) + React external store
  lib/          schematic layout, level-aware symbol geometry, formatting, fixtures
  components/   Toolbar, SchematicView (SVG canvas), Inspector, CommandLog,
                ProceduresPanel, AgentPanel, TokenSettings
  agent/        providers registry, token store, multi-wire LLM client,
                tool dispatcher (commands/procedures), offline local agent, runtime
scripts/
  render-snapshot.ts   headless SVG snapshot of a circuit (no browser needed)
```

## Agent & tokens

The agent never does arithmetic: it calls **procedures** for component values and
issues **validated commands** for every mutation. Two execution modes share one
tool dispatcher (`agent/tools.ts`):

- **Offline agent** — deterministic intent parser, works with no token.
- **LLM agent** — pick a provider in the *Tokens* tab and paste a key. Providers
  map onto three wire formats (Anthropic Messages / OpenAI Chat Completions /
  Gemini generateContent), each with tool-calling. Tokens are stored only in the
  browser's `localStorage` and sent solely to the provider you select. Some hosted
  APIs block direct browser calls (CORS) and may need a proxy in production.

## Test

```bash
pnpm --filter @condenser/web test    # agent/runtime/tool behavior
```
