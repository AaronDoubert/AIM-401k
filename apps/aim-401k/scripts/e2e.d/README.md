Feature e2e suites. Each `*.mjs` file exports `default async function (t)` where
`t = { ctx, ext, extId, base, msg, store, waitFor, check, sleep, shots, root, fixtures, aiCalls, userDir }`:

- `ctx` – Playwright persistent context with the extension loaded
- `ext` – an extension page (tracker.html) usable for `chrome.*` calls
- `msg(m)` – `runtime.sendMessage(m)` to the background, returns the reply
- `store()` – full `storage.local` snapshot
- `waitFor(label, pred, timeoutMs)` – poll storage until `pred(state)`
- `check(cond, label)` – record a pass/fail line
- `base` – fixture server origin; files under `test/fixtures/**` are served at `${base}/<path>`

The core flow in `e2e.mjs` runs first; find your jobs by URL, not array index.
