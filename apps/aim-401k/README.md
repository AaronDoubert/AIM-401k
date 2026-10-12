# AIM-401k: Autonomous Employment Acquisition System

*Operation GAINFUL. Human in the loop for weapons release.*

AIM-401k is a Firefox extension that fills job applications for you in background tabs and keeps a tracker of every application. It's styled as an over-the-top defense-tech HUD. The joke is the paint job; underneath it's a practical tool, and **Plain mode** swaps every themed label for normal wording.

When it needs you, a small floating box appears on whatever tab you're on. That happens when it has to:

- answer a question it has no answer for,
- get your agreement to a certification or consent checkbox,
- get a signature,
- wait while you solve a CAPTCHA or sign in,
- hand over a finished application for your review before submit.

You answer in the box (or jump to the tab) and it carries on. Answers you give are remembered, so the same question doesn't come back.

**Local-first.** There are no AIM-401k servers, accounts or analytics. Your profile, resume and tracker live in Firefox's extension storage. AI is bring-your-own, or runs locally. Inbox and spreadsheet integrations are optional, and processing happens in your browser.

### What's in the box

| Surface | What it does |
|---|---|
| **Popup** | A mini HUD with counts and holding items. Buttons: **Engage this tab** (autofill), queue URLs, mark applied, War Room, Plain mode/Sound toggles. |
| **Operator box** | Shown on every page. Answer questions, agree to consents, sign. **Hold to release** submits a finished application. |
| **War Room** | Full-screen ops view for when you're AFK. Radar sweep, a live tile per application (step, field being filled, progress), the operator panel, an ops log terminal, a kill sheet with ranks, and an AFK mode that collects prompts and gives you a sitrep when you're back. |
| **Theater** (tracker) | Table and kanban Board views (Targeted → Engaged → Operator req. → Delivered → Contact → Secured, plus Lost). Also: search, notes, CSV export, spreadsheet import, and the inbox intel feed. |
| **Settings** | Your profile (the "loadout"), experience, saved answers, automation, AI provider, inbox intel, privacy and backup. |

## Install

Requires **Firefox 140+** (desktop).

```bash
pnpm install
pnpm --filter aim-401k package    # → apps/aim-401k/release/aim-401k-<version>.zip (also builds dist/)
```

In Firefox, open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and pick the zip (or `apps/aim-401k/dist/manifest.json`).
Temporary add-ons last until Firefox restarts; use **Settings → Backup → Export** before restarting.
For permanent installs, see [docs/FIREFOX.md](docs/FIREFOX.md): unlisted signing with `web-ext sign`, or Developer Edition with signatures off. It also has the lint results and the list of network endpoints.

`pnpm --filter aim-401k watch` rebuilds on change. Click **Reload** in about:debugging after a rebuild.

## First run

When the extension is installed, a **setup wizard** opens. You can also open it from the popup or from Settings with *Run setup wizard*.

1. **Resume:** drop in a PDF, Word (.docx), text or [JSON Resume](https://jsonresume.org) file. It is read locally, and nothing is uploaded. AIM-401k pre-fills:
   - contact details and links,
   - every job (title, company, location, dates, bullet points),
   - education, skills, certifications and summary.

   The file is also saved for upload to applications.
2. **About you / Experience:** review what was imported. Jobs and schools are editable lists, so "Work Experience 2" on a form gets your second job.
3. **Eligibility & preferences:**
   - work authorization, sponsorship, citizenship, license, clearance,
   - target roles and locations, workplace type, salary,
   - earliest start date or notice period.
4. **EEO:** defaults to "Decline to self-identify".
5. **AI helper (optional):** pick a provider and paste a key. You can then *Re-read my resume with AI* for a more accurate import (see the providers below).

### Inbox intel (optional): keep statuses current from your email

- **Mail tab reader (zero setup, on by default).** While a Gmail or Outlook web tab is open, AIM-401k reads the inbox *list* (sender, subject, preview), never opening or changing anything. It recognizes "application received", rejections, interview and assessment invitations, and offers. Each email is matched to a tracked job by company and sender domain (ATS senders like Greenhouse/Lever/Workday included), and statuses update automatically. Unmatched hiring emails appear in the Theater's intel feed for one-click assignment.
- **Gmail API (advanced, bring your own Google OAuth client).** Works with the tab closed. Settings → Inbox intel has a step-by-step guide. It uses a read-only scope, the token is kept in memory/session only, and everything is processed locally.
- **Optional AI sorting** for emails the rules aren't sure about. It uses your AI provider, after Firefox's data-consent prompt.

### Spreadsheets: bring your own tracker

**Theater → Import spreadsheet** reads `.csv`/`.tsv`, Excel `.xlsx` (any sheet), cells pasted from Google Sheets/Excel, or a *published* Google Sheet link.
- Columns are auto-mapped (company, role, link, status, date applied, location, notes, salary, contact). Each distinct status value is mapped and shown for you to override.
- Rows already tracked are updated rather than duplicated, and a status is never moved backwards.
- You can export the tracker back to `.xlsx` or CSV.

### Privacy & data

Settings → Privacy shows exactly where data goes, a storage inventory, and controls: export, clear application history, forget AI keys, erase everything.
- **Privacy guard (on by default)** strips your email, phone and street address from anything sent to an AI provider.
- Firefox's built-in data-consent prompt is requested before any online AI provider is used. Local models don't need it.

### AI providers

All of these are optional. Without AI, AIM-401k still fills everything your profile and saved answers cover, and asks you for the rest.

| Provider | Sign in with | Cost | Get a key |
|---|---|---|---|
| Google Gemini | Google account | Free tier, rate-limited, no card | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| Groq | Google, GitHub or email | Free tier, rate-limited, no card | [console.groq.com/keys](https://console.groq.com/keys) |
| OpenRouter | Google, GitHub or email | `:free` models: 20/min, 50/day (1,000/day after a one-time $10 top-up) | [openrouter.ai/keys](https://openrouter.ai/keys) |
| GitHub Models | GitHub account | Free for prototyping, low daily limits | fine-grained token with *Models: read* |
| Mistral | Email or Google, plus phone verification | Free "Experiment" plan; requests may be used for training | [console.mistral.ai](https://console.mistral.ai/api-keys) |
| Ollama | No account | Free and private, runs on your machine | start Ollama with `OLLAMA_ORIGINS=moz-extension://*` |
| Anthropic Claude | Email or Google | Paid | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| Other | — | — | any OpenAI-compatible `/chat/completions` server |

Free-tier limits change often. *Test & load models* checks the key and lists the models available to it. On free tiers, providers may use your prompts to improve their models; prompts include your profile and resume text, with contact details redacted by the privacy guard.

AIM-401k helps with setup:
- It detects Ollama or LM Studio running on your computer and offers one-click setup.
- It warns when a key doesn't look like that provider's.
- It explains errors in plain words (bad key, rate limit and when to retry, model not found).
- It shows requests made today against the free-tier limits.

## How it works

```
 tracker / popup ──addJobs──▶ background (queue runner, single source of truth in storage.local)
                                 │ opens inactive tab per job (concurrency + max-open-tabs caps)
                                 ▼
                       content script in job tab (all frames)
                         1. confirmation page?  → mark Applied, close tab
                         2. no form?            → click "Apply" / detect sign-in wall
                         3. scan fields → resolve each:
                              section entry (Work Experience N) ▸ saved answer ▸ profile rule ▸ (AI draft) ▸ ask you
                         4. fill (React-safe events, file upload, custom dropdowns, dates in any format)
                         5. all filled → click Next … → final step:
                              autoSubmit off (default) → "Ready – review & submit" ping
                         reports needs ─▶ background ─▶ overlay on every tab + badge + notification
 you answer in the overlay ─▶ background saves answer ─▶ content fills that field, continues
```

- **Dependability.** State lives in `storage.local`, and writes go through one serialized writer in the background. Every pass of the content script is idempotent and re-runs when the DOM changes. A step guard stops it from clicking Next forever, and a watchdog alarm flags jobs that stop making progress ("Stuck" in the box). Closed or lost tabs are marked *Failed* and can be retried. After a browser restart, in-flight jobs are re-queued.
- **What is never automatic.** Signatures, attestations and consent checkboxes always come to you first. Once you approve a consent with "always" ticked, the same wording is auto-approved later. Signatures are never remembered by default. CAPTCHAs and logins are always yours. Final submit is yours unless you turn on *Submit automatically*. Even then, it won't auto-submit when a CAPTCHA is showing or when AI-drafted answers are on the page (unless the AI mode is `auto`).
- **Dates.** AIM-401k handles native date pickers, typed formats (it reads the `MM/DD/YYYY`-style hint from the placeholder or label), Month/Day/Year dropdown sets, Workday-style split date boxes, and read-only calendar inputs. Start dates come from your earliest start date or notice period. "Date" fields next to a signature get today's date. Date of birth always goes to you.
- **Highlighting (lock-on reticles).** Green brackets mean filled from your profile or saved answers. Amber dashed means AI-drafted (review these). Red pulsing means it needs you.
- **Keys.** API keys are only read by the background script and sent only to the provider you chose.
- **Copy.** Every themed string has a plain variant (`src/shared/copy.ts`, `src/shared/copy/*.ts`). Internals keep plain names (`needs_you`, `submitted`…).

### Supported sites

The engine is generic (labels, ARIA, autocomplete hints), with specific handling for Greenhouse, Lever, Ashby,
Workday, SmartRecruiters, iCIMS, Jobvite, Workable and BambooHR-style flows. It also handles forms embedded in an iframe on a company careers page.
Workday and some others require an account per company. AIM-401k pings you to sign in, then continues.

LinkedIn Easy Apply and Indeed aren't targeted. Their terms prohibit automation and accounts get restricted.

## Layout

```
src/core/        pure logic (unit-tested): matching, dates, resume parsing, email intel, spreadsheets, zip, answer bank
src/content/     scanner, filler, page detection, autopilot loop + unit telemetry, operator overlay, mail tab reader
src/background/  store, core (registry, job event bus, ops log), feed (ops lines/notifications), units (War Room, AFK),
                 intel + gmail, data (privacy), ai (providers) + tasks (drafting, resume reading)
src/ui/          onboarding, popup, options, tracker (+ board, sheet import, intel feed), War Room, AI setup, privacy
src/shared/      types, messages, defaults/migrations, providers, copy (chud/plain)
docs/            NIGHT-PLAN.md (architecture & principles), FIREFOX.md (signing, lint, endpoints)
static/          manifest + HTML/CSS + icons (copied into dist/)
test/            vitest unit + DOM tests; fixtures used by the e2e run
scripts/e2e.mjs  loads dist/ into Chromium via Playwright: core flow, then the suites in scripts/e2e.d/
                 (theme, War Room, intel, spreadsheets, privacy) against mock ATS/mail/AI servers
```

```bash
pnpm --filter aim-401k test        # unit + DOM tests
pnpm --filter aim-401k typecheck
pnpm --filter aim-401k build && pnpm --filter aim-401k e2e   # needs Playwright + Chromium installed
```

The manifest declares both `background.scripts` (used by Firefox) and `background.service_worker` (used by Chromium). That lets the same build run in Chromium for automated end-to-end testing.

## Roadmap ideas

- Per-site adapters for Workday's account flow and multi-page iCIMS.
- "Add another" automation for repeated Work Experience sections.
- Job discovery: pull postings from saved searches into the queue.
- Follow-up reminders and a weekly summary.
