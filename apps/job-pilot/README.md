# JobPilot: Firefox job-application copilot

JobPilot fills job applications for you in background tabs and keeps a tracker of every application. When it needs you, a small floating box appears on whatever tab you're on. That happens when it has to:

- answer a question it has no answer for,
- get your agreement to a certification or consent checkbox,
- get a signature,
- wait while you solve a CAPTCHA or sign in,
- hand over a finished application for your review before submit.

You answer in the box (or jump to the tab) and it carries on. Answers you give are remembered, so the same question doesn't come back.

## Install (development)

```bash
pnpm install
pnpm --filter job-pilot build      # → apps/job-pilot/dist
```

In Firefox, open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and pick `apps/job-pilot/dist/manifest.json`.
Temporary add-ons last until Firefox restarts. For a permanent install, either sign it as an unlisted add-on
(`npx web-ext sign --channel=unlisted --source-dir dist` with AMO API keys), or use Firefox Developer Edition/Nightly
with `xpinstall.signatures.required = false` and install a zip of `dist/`.

`pnpm --filter job-pilot watch` rebuilds on change. Click **Reload** in about:debugging after a rebuild.

## First run

When the extension is installed, a **setup wizard** opens. You can also open it from the popup or from Settings with *Run setup wizard*.

1. **Resume:** drop in a PDF, Word (.docx), text or [JSON Resume](https://jsonresume.org) file. It is read locally, and nothing is uploaded. JobPilot pre-fills:
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

### AI providers

All of these are optional. Without AI, JobPilot still fills everything your profile and saved answers cover, and asks you for the rest.

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

Free-tier limits change often. *Test & load models* checks the key and lists the models available to it. On free tiers, providers may use your prompts to improve their models; prompts include your profile and resume text.

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
- **Dates.** JobPilot handles native date pickers, typed formats (it reads the `MM/DD/YYYY`-style hint from the placeholder or label), Month/Day/Year dropdown sets, Workday-style split date boxes, and read-only calendar inputs. Start dates come from your earliest start date or notice period. "Date" fields next to a signature get today's date. Date of birth always goes to you.
- **Highlighting.** Green outline means filled from your profile or saved answers. Amber means AI-drafted (review these). Red means it needs you.
- **Privacy.** Everything is stored locally in the extension. The API key is only read by the background script, and only calls to `api.anthropic.com` carry it.

### Supported sites

The engine is generic (labels, ARIA, autocomplete hints), with specific handling for Greenhouse, Lever, Ashby,
Workday, SmartRecruiters, iCIMS, Jobvite, Workable and BambooHR-style flows. It also handles forms embedded in an iframe on a company careers page.
Workday and some others require an account per company. JobPilot pings you to sign in, then continues.

LinkedIn Easy Apply and Indeed aren't targeted. Their terms prohibit automation and accounts get restricted.

## Layout

```
src/core/        pure logic (unit-tested): question → profile matching, dates, resume parsing, option picking, answer bank, CSV
src/content/     scanner, filler, page detection, autopilot loop, floating overlay
src/background/  storage, queue runner, needs/notifications, AI providers (ai.ts) and AI tasks (tasks.ts)
src/ui/          onboarding wizard, popup, options, tracker, resume extraction (pdf.js / docx), shared profile editor
static/          manifest + HTML/CSS + icons (copied into dist/)
test/            vitest unit + DOM tests; fixtures used by the e2e run
scripts/e2e.mjs  loads dist/ into Chromium via Playwright and runs the full loop against mock ATS forms
```

```bash
pnpm --filter job-pilot test        # unit + DOM tests
pnpm --filter job-pilot typecheck
pnpm --filter job-pilot build && pnpm --filter job-pilot e2e   # needs Playwright + Chromium installed
```

The manifest declares both `background.scripts` (used by Firefox) and `background.service_worker` (used by Chromium). That lets the same build run in Chromium for automated end-to-end testing.

## Roadmap ideas

- Gmail integration: watch for "we received your application" / rejection / interview emails and update statuses.
- Per-site adapters for Workday's account flow and multi-page iCIMS.
- Job discovery: pull postings from saved searches into the queue.
- Follow-up reminders and a weekly summary.
