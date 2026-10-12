# AIM-401k on Firefox: packaging, install, signing, lint

## Requirements

- **Firefox 140 or newer, desktop** (`strict_min_version: 140.0`). 140 is the first version with Firefox's built-in data consent, which the manifest uses (see [Data consent](#data-consent)). Firefox 140 ESR works.
- Firefox for Android isn't targeted. The extension manages background tabs, which Android doesn't really have.

## Build and package

```bash
pnpm build      # → dist/
pnpm package    # build + zip → release/aim-401k-<version>.zip
pnpm package --no-build   # zip the existing dist/
```

`scripts/package.mjs` has no dependencies: it zips `dist/` with `node:zlib` and its own CRC-32. `manifest.json` sits at the root of the archive and every entry has a fixed timestamp, so the same `dist/` always gives the same zip. The zip works as a temporary add-on and as input to `web-ext sign`. Renaming it to `.xpi` is optional. `release/` is git-ignored.

## Install for a session (temporary)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Pick `release/aim-401k-<version>.zip`, or `dist/manifest.json`.

The add-on stays until Firefox restarts. After a rebuild, click **Reload** on the same page.

## Install permanently

Release and Beta Firefox only install signed add-ons. There are two routes.

### A. Sign it yourself as an unlisted add-on (any Firefox)

Unlisted add-ons are signed by Mozilla but not published on addons.mozilla.org (AMO). Only people you give the file to can install it.

1. Sign in at addons.mozilla.org and create API credentials at <https://addons.mozilla.org/developers/addon/api/key/>. The "JWT issuer" is the key and the "JWT secret" is the secret.
2. Sign:

   ```bash
   pnpm build
   npx web-ext sign --channel=unlisted --source-dir dist \
     --api-key="$AMO_JWT_ISSUER" --api-secret="$AMO_JWT_SECRET"
   ```

   The signed `.xpi` lands in `web-ext-artifacts/`. Automatic signing usually takes a few minutes. AMO may ask for source code because the bundle is built with esbuild. If it does, pass a zip of the repository (without `node_modules`, `dist`, `release`) with `--upload-source-code <file>`.
3. Install it from `about:addons` → gear menu → **Install Add-on From File…**.

The add-on ID is `aim-401k@slop.local` (`browser_specific_settings.gecko.id`). AMO ties an ID to the first account that signs it, so if signing fails with an "ID already in use" error, change the ID to something of your own (e.g. `aim-401k@yourname.example`). Bump `version` in both `package.json` and `static/manifest.json` for every new signed build, because AMO rejects a version it has already seen.

### B. Developer Edition, Nightly or ESR without signing

Only these builds honor the pref:

1. Open `about:config`, set `xpinstall.signatures.required` to `false`.
2. `pnpm package`, then go to `about:addons` → gear menu → **Install Add-on From File…** and pick the zip (or the zip renamed to `.xpi`).

## Data consent

Firefox 140+ asks users about data an extension transmits ("built-in data consent"). The manifest declares:

```json
"data_collection_permissions": {
  "required": ["none"],
  "optional": ["personallyIdentifyingInfo", "websiteContent", "personalCommunications"]
}
```

- **Required: none.** AIM-401k has no servers, accounts, analytics or telemetry, so installing it shares nothing. Filling a job form puts your details into the page you're applying on. You then submit it, or AIM-401k does if you turned on automatic submit. We treat that as the user acting on that site, not as the extension collecting data.
- **Optional: `personallyIdentifyingInfo` + `websiteContent`.** These cover AI drafting and resume reading with an online AI provider: profile facts and resume text go to the provider, and so does the job description. Before the first request, the **Test & load models** button in the AI setup asks Firefox for both permissions (`requestAiConsent` in `src/ui/aiSetup.ts`). The background checks them again before every request to an online provider (`aiConsentGranted` in `src/background/ai.ts`). Without them, the request isn't sent and the user is told how to allow it. Local servers (Ollama, LM Studio on localhost) don't need either permission. Browsers without built-in consent (Chromium, used for the e2e run) aren't gated: there, turning AI on is the opt-in.
- **Optional: `personalCommunications`.** This is for letting AI classify inbox emails (the Intel feature). The Intel UI should request it when that toggle is switched on, by calling `requestAiConsent(provider, baseUrl, ["personalCommunications"])` from the click handler.

Users can also change these under `about:addons` → AIM-401k → **Permissions and data**.

## `web-ext lint` results

Run with `npx --yes web-ext@latest lint --source-dir dist` (web-ext 10.7.0) on the 0.2.0 build: **0 errors, 0 notices, 5 warnings**, all expected:

| Warning | Where | Why it's acceptable |
|---|---|---|
| `BACKGROUND_SERVICE_WORKER_IGNORED` | manifest.json | `background.service_worker` is kept next to `background.scripts` so the same build loads in Chromium for the automated e2e run. Firefox uses `background.scripts` and ignores the other key. |
| `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION` | manifest.json | `data_collection_permissions` needs Firefox for Android 142. The extension doesn't target Android. |
| `UNSAFE_VAR_ASSIGNMENT` (dynamic `import()`) | `chunks/chunk-*.js` (pdf.js) | pdf.js's fake-worker fallback does `import(this.workerSrc)`. `workerSrc` is set to the bundled `pdf.worker.min.mjs` inside the extension, never a remote URL. |
| `UNSAFE_VAR_ASSIGNMENT` ×2 | `pdf.worker.min.mjs` | The same pattern inside Mozilla's own pdf.js worker, shipped unmodified from `pdfjs-dist`. |

Before this pass the linter also reported `MISSING_DATA_COLLECTION_PERMISSIONS`, which AMO requires for new add-ons. Adding the key on top of the old `strict_min_version` of 128 then raised `KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION`. Both are fixed by the two manifest changes above: the consent key, and the minimum version raised to 140.

## Network endpoints in the bundle

Checked with `grep -o "https\?://[a-zA-Z0-9.-]*" dist/*.js dist/chunks/*.js | sort -u` and reviewed by hand. AIM-401k has no endpoint of its own. The hosts below are contacted only when you use the matching feature:

| Host | When |
|---|---|
| `generativelanguage.googleapis.com` | AI provider: Google Gemini (your key) |
| `api.groq.com` | AI provider: Groq (your key) |
| `openrouter.ai` | AI provider: OpenRouter (your key) |
| `models.github.ai` | AI provider: GitHub Models (your token) |
| `api.mistral.ai` | AI provider: Mistral (your key) |
| `api.anthropic.com` | AI provider: Anthropic Claude (your key, through the Anthropic SDK) |
| `http://localhost:11434` | Ollama on this computer: AI calls, plus a 1.5 s probe (`/api/tags`) when the AI setup screen opens |
| `http://localhost:1234` | LM Studio on this computer: a 1.5 s probe (`/v1/models`) when the AI setup screen opens |
| any base URL you enter | AI provider: "Other (OpenAI-compatible)" |
| job sites | the job URLs you queue (opened as normal tabs; content scripts fill the forms) |
| `gmail.googleapis.com`, `accounts.google.com` | Inbox intel with the Gmail API, only if you connect your own OAuth client (added by the Intel feature) |
| `docs.google.com` | Spreadsheet import, only when you import a published Google Sheet URL (added by the Sheet feature) |

Strings in the bundle that are never requested:

- **Links shown to you** (never fetched): `aistudio.google.com`, `console.groq.com`, `console.mistral.ai`, `console.anthropic.com`, `github.com/settings/...`, `ollama.com`, `jsonresume.org`. Example job URLs in a placeholder: `boards.greenhouse.io`, `jobs.lever.co`.
- **OpenRouter attribution header:** `HTTP-Referer: https://github.com/AaronDoubert/SLOP` is a header value sent to OpenRouter, not a request to GitHub.
- **Anthropic SDK internals** (doc links, error messages and JSDoc examples): `platform.claude.com`, `docs.anthropic.com`, `docs.expo.dev`, `github.com/anthropics/...`, `example-server.modelcontextprotocol.io`.
- **pdf.js internals:** XML namespaces (`www.w3.org`, `ns.adobe.com`, `www.xfa.org`, `www.apache.org`) and base URLs used only to parse relative links (`foo.bar`, `example.com`).
- **zod:** JSON-schema `$schema` identifiers (`json-schema.org`).
