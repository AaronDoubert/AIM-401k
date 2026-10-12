# AIM-401k: night build plan

AIM-401k is a Firefox extension that fills and tracks job applications in background tabs. It only interrupts the human when needed: questions it can't answer, consent, signatures, CAPTCHAs, and final submit. The style is **Defense Prime with a chudcore skin**, "Palantir Maven meets Workday". It should be clearly a joke, but **the tool stays genuinely usable**.

## Principles (every workstream)

1. **Local-first.** All user data lives in `browser.storage.local`. There are no servers of ours, no analytics, no telemetry and no remote code (no CDNs). Data leaves the browser only:
   - to job sites the user applies to,
   - to the AI provider the user configured (BYO key, or local Ollama),
   - to the Gmail API if the user connected their own OAuth client.
2. **BYO AI, with a little help.** Everything works with AI off. AI is opt-in, uses the provider and key the user picked, and the UI helps them set it up. Free tiers and local models are first-class.
3. **The joke is skin, not plumbing.** Internals use plain names (`needs_you`, `submitted`, `rejected`). All themed wording lives in `src/shared/copy.ts` plus `src/shared/copy/<area>.ts`, read through `copy(settings, key, vars)`. Each key has a CHUD and a PLAIN variant, and `settings.ui.chud` switches between them ("Plain mode").
4. **Chud copy is short.**
   - It appears where a notification or label would normally be: a callsign-style lead, then the facts.
   - Examples: `CONTACT. Globex wants to talk.`, `DELIVERED. TGT-0042 Acme`.
   - It is not used on form labels the user has to understand (settings, profile fields).
5. **The terminal (ops log) is for ops events only:** launch, needs, interventions, release, delivered, lost, intel, AFK. It never logs per-field fills. Those are animations on unit tiles and lock-on reticles in the page.
6. **Adaptable integrations.** Inbox via an open Gmail/Outlook tab (zero setup) or the Gmail API (BYO client). Applications imported from the user's own spreadsheet (CSV/XLSX). Each piece is optional.

## Architecture contracts (already in place, built in the foundation pass)

- **Types** (`src/shared/types.ts`):
  - `Settings.ui {chud, sound}`, `Settings.afk`, `Settings.intel {...}`.
  - `UnitState`, `UnitPhase`.
  - `OpsEvent`, `OpsKind`.
  - `RawMail`, `IntelItem`, `IntelKind`, `IntelSource`.
- **Messages** (`src/shared/messages.ts`): new `ToBackground` messages for the War Room, Intel and Data areas, a `ToPages` broadcast union, and `StorageReport`.
- **Background** (`src/background/`):
  - `index.ts` handles the core job/needs messages and falls back to `dispatch()` for everything else.
  - `core.ts` provides:
    - shared helpers (`log`, `pump`, `broadcast`, `notify`, `replaceNeeds`, …),
    - `register(handlers)` for feature modules,
    - a job event bus: `on(event, fn)` / `emit(event, payload)` with events `launched`, `needs`, `intervened`, `released`, `delivered`, `lost`, `status`, `progress`,
    - `opsLog(kind, text, jobId?)`, which persists to `state.ops` (capped at 300) and broadcasts `{type:"opsEvent"}` to pages,
    - `toPages(msg)` and `desktopNotify(id, title, message)`.
  - `feed.ts` turns job events into ops lines and the few notifications worth sending (ready to submit, delivered). It respects AFK (no desktop pings).
  - Feature modules `units.ts`, `intel.ts` and `data.ts` are imported by `index.ts` and call `register({...})`.
  - `store.ts` `State` now includes `ops: OpsEvent[]` and `intel: IntelItem[]`.
- **Build:**
  - `mail.js` is a content script for Gmail/Outlook (manifest entry present).
  - `warroom.html` / `warroom.js` is a new page.
  - `tracker.js`, `options.js`, `onboarding.js` and `warroom.js` are ES modules sharing chunks.
  - The manifest has the `identity` permission.
- **UI hooks:**
  - tracker: `#import-sheet` → `openSheetImport()`, and `#intel-feed` → `renderIntelFeed()`;
  - options: `#intel-settings` → `renderIntelSettings()`, and `#privacy-panel` → `renderPrivacy()`;
  - popup: a War Room button;
  - `src/ui/aiSetup.ts` holds the AI provider picker.
- **e2e:** `scripts/e2e.mjs` runs the core flow, then every `scripts/e2e.d/*.mjs` suite (see that folder's README). Run one suite with `E2E_ONLY=<name>`.

## Workstreams and file ownership

Only edit files you own. Shared files (`types.ts`, `messages.ts`, `manifest.json`, `package.json`, `background/index.ts`, `core.ts`) are append-only and only if truly needed; say so in your report.

| Area | Branch | Owns |
|---|---|---|
| **Theme & copy** | `night/theme` | `static/styles.css`, all `static/*.html` except `warroom.html`, `src/shared/copy.ts` (base keys), `src/shared/copy/theme.ts`, `src/ui/{popup,tracker,options,onboarding,profileForm,common}.ts`, `src/content/overlay.ts`, the highlight CSS in `src/content/index.ts`, `static/icons/*`, font assets |
| **War Room** | `night/warroom` | `static/warroom.html`, `src/ui/warroom.ts` (+ `src/ui/warroom/*`), `src/background/units.ts`, `src/shared/copy/warroom.ts`, unit-state emission in `src/content/autopilot.ts`, `scripts/e2e.d/20-warroom.mjs` |
| **Inbox intel** | `night/intel` | `src/content/mail.ts`, `src/background/intel.ts` (+ `src/background/gmail.ts`), `src/core/intel.ts`, `src/ui/intelSettings.ts`, `src/ui/intelFeed.ts`, `src/shared/copy/intel.ts`, `test/intel*.test.ts`, `test/fixtures/mail/*`, `scripts/e2e.d/30-intel.mjs` |
| **Spreadsheet import** | `night/sheet` | `src/core/sheet.ts`, `src/ui/sheetImport.ts`, `src/shared/copy/sheet.ts`, `test/sheet*.test.ts`, `test/fixtures/sheets/*`, `scripts/e2e.d/40-sheet.mjs` |
| **Privacy, AI help, Firefox packaging** | `night/privacy` | `src/background/data.ts`, `src/background/ai.ts`, `src/background/tasks.ts`, `src/ui/privacy.ts`, `src/ui/aiSetup.ts`, `src/shared/providers.ts`, `src/shared/copy/privacy.ts`, `scripts/package.mjs`, `test/privacy*.test.ts`, `test/ai*.test.ts`, `scripts/e2e.d/50-privacy.mjs` |

## Definition of done (each workstream)

- The following all pass from `apps/aim-401k`: `pnpm typecheck`, `pnpm test`, `pnpm build`, `node scripts/e2e.mjs`.
- New pure logic has unit tests, and there is an e2e suite for the feature's main path.
- No new runtime dependencies, except that the theme area may add OFL font packages for local font files.
- Commit on your branch with a clear message. Do not push. Report what's done, what's not, and any shared-file edits.
