// Screenshot kit: loads the built extension into Chromium, seeds ONE fixed dataset
// (scripts/demo-data.mjs) and captures every view from it, so War Room, Tracker, popup
// and the on-page overlay all show the same numbers.
//
//   pnpm build && pnpm demo            (or: node scripts/demo.mjs)
//
//   DEMO_SHOTS=/some/dir   output directory (default: demo-shots/, gitignored)
//   DEMO_FULL=1            full-page Tracker/War Room shots instead of the 1440x900 viewport
//   DEMO_DEBUG=1           print service worker console output
//
// Shots (2x device scale):
//   01-warroom.png        War Room, CHUD wording        1440x900
//   02-warroom-map.png    War Room with the MAP layer   1440x900
//   03-warroom-plain.png  War Room, plain mode          1440x900
//   04-tracker-table.png  Tracker, table view           1440x900
//   05-tracker-board.png  Tracker, board view           1440x900
//   06-popup.png          toolbar popup, 360px wide, full height
//   07-overlay.png        on-page overlay on a neutral local page
//
// How the seed reaches the background: the service worker caches storage in memory, but it
// folds in outside writes through storage.onChanged (src/background/store.ts), so an extension
// page can simply write chrome.storage.local. The script then asks the background for its
// overlay state and waits until that matches the seed before going on. Engaged and on-hold jobs
// get a real tab each (an extension page): the watchdog fails active jobs without a live tab,
// and the background only accepts live `unit` telemetry from the job's own tab. Those tabs send
// the field checklists, so the War Room shows real unit state, not a mock.
//
// Requires Playwright (global install, like scripts/e2e.mjs). Never runs `playwright install`.
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { buildDataset, LIVE_KEYS, stageCounts, unitFor } from "./demo-data.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const out = process.env.DEMO_SHOTS ?? join(root, "demo-shots");
const full = !!process.env.DEMO_FULL;

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require(join(process.execPath, "../../lib/node_modules/playwright")));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VIEW = { width: 1440, height: 900 };
const results = [];

/** Run one capture; a failure is reported and never stops the others. */
async function step(label, fn) {
  const t = Date.now();
  try {
    await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error("timed out after 45s")), 45_000))]);
    results.push([label, true]);
    console.log(`ok   ${label} (${Date.now() - t}ms)`);
  } catch (e) {
    results.push([label, false]);
    console.log(`FAIL ${label}: ${String(e?.message ?? e).split("\n")[0]}`);
  }
}

// --- A neutral page for the overlay shot (the overlay only injects on http(s) pages) ------
const FIXTURE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Field Notes</title><style>
body{margin:0;font:16px/1.65 Georgia,serif;color:#222;background:#f6f4ef}
header{padding:18px 48px;border-bottom:1px solid #ddd8cc;font:600 15px system-ui,sans-serif;letter-spacing:.04em;display:flex;gap:28px;background:#fff}
header span:first-child{font-weight:700}header span{color:#666}
main{max-width:680px;margin:56px auto;padding:0 24px}
h1{font-size:38px;line-height:1.15;margin:0 0 6px}
.by{color:#777;font:14px system-ui,sans-serif;margin-bottom:28px}
p{margin:0 0 18px}
blockquote{margin:28px 0;padding:4px 0 4px 20px;border-left:3px solid #c9b98f;color:#555;font-style:italic}
</style></head><body>
<header><span>Field Notes</span><span>Essays</span><span>Archive</span><span>About</span></header>
<main><h1>The quiet craft of boring infrastructure</h1><div class="by">By Maren Okafor · 9 min read</div>
<p>Most of the systems we depend on were never meant to be interesting. They were meant to be there on a Tuesday afternoon, doing the same small thing they did yesterday.</p>
<p>The teams that keep them alive tend to share a habit: they write down why a decision was made, not just what was decided. Months later, the why is the only part anyone needs.</p>
<blockquote>Reliability is mostly the accumulation of small, unglamorous refusals.</blockquote>
<p>When a queue backs up at three in the morning, nobody asks whether the architecture was elegant. They ask whether the runbook was true, and whether the person holding the pager had slept.</p>
<p>That is the craft: leaving the next person a system that explains itself, and a clear head to read it with.</p></main></body></html>`;
const server = createServer((_req, res) => res.writeHead(200, { "content-type": "text/html" }).end(FIXTURE));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const fixtureUrl = `http://127.0.0.1:${server.address().port}/`;

mkdirSync(out, { recursive: true });
const userDir = mkdtempSync(join(tmpdir(), "aim-401k-demo-"));
let ctx;

try {
  ctx = await chromium.launchPersistentContext(userDir, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    viewport: VIEW,
    deviceScaleFactor: 2,
  });

  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent("serviceworker", { timeout: 15_000 });
  const extId = new URL(sw.url()).host;
  if (process.env.DEMO_DEBUG) sw.on("console", (m) => console.log("[sw]", m.text()));
  const ext = (file) => `chrome-extension://${extId}/${file}`;

  /** Open an extension page with a sane timeout. */
  const open = async (file, viewport) => {
    const page = await ctx.newPage();
    page.setDefaultTimeout(10_000);
    if (viewport) await page.setViewportSize(viewport);
    await page.goto(ext(file), { waitUntil: "load" });
    return page;
  };

  // The install opens the onboarding wizard in a tab; we don't want it.
  for (let i = 0; i < 12; i++) {
    const wizard = ctx.pages().filter((p) => p.url().includes("onboarding.html"));
    for (const p of wizard) await p.close().catch(() => undefined);
    if (wizard.length) break;
    await sleep(250);
  }

  // --- Seed -----------------------------------------------------------------------------
  // One extension tab per live job (engaged + on hold), so the background has a real tab to track.
  const home = await open("tracker.html");
  const liveTabs = {};
  const tabIds = {};
  for (const key of LIVE_KEYS) {
    liveTabs[key] = await open("popup.html");
    tabIds[key] = await liveTabs[key].evaluate(() => chrome.tabs.getCurrent().then((t) => t.id));
  }
  const now = Date.now();
  const data = buildDataset(now, tabIds, true);
  await home.evaluate(async (d) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set(d);
  }, data);

  // Wait until the background's in-memory cache has picked the seed up.
  const bgState = () => home.evaluate(() => chrome.runtime.sendMessage({ type: "getOverlayState" }));
  let st;
  for (let i = 0; i < 40; i++) {
    st = await bgState().catch(() => undefined);
    if (st && st.needs?.length === data.needs.length && Object.keys(st.jobs ?? {}).length >= data.jobs.filter((j) => j.tabId != null).length) break;
    await sleep(250);
  }
  if (!st || st.needs?.length !== data.needs.length) throw new Error(`background did not pick up the seeded state (needs: ${st?.needs?.length})`);

  // Live unit telemetry, sent from each job's own tab (the only sender the background accepts).
  for (const key of LIVE_KEYS) {
    const { fields, ...unit } = unitFor(key);
    const ok = await liveTabs[key].evaluate((m) => chrome.runtime.sendMessage(m), { type: "unit", jobId: `job_demo_${key}`, state: { ...unit, fields } });
    if (ok !== true) console.log(`warn unit telemetry for ${key} was not accepted`);
  }

  const counts = stageCounts(data.jobs);
  const summary = Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(" · ");
  console.log(`dataset: ${data.jobs.length} jobs · ${summary} · ${data.needs.length} needs · ${data.ops.length} ops`);

  // --- Helpers ----------------------------------------------------------------------------
  const settle = async (page, ms = 1000) => {
    await page.bringToFront();
    await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
    await sleep(ms);
  };
  const shot = (page, name, opts = {}) => page.screenshot({ path: join(out, name), fullPage: full && !opts.viewportOnly, ...opts.shot });
  const stageNumbers = (page) =>
    page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".stages [data-stage]")].map((e) => [e.dataset.stage, Number(e.querySelector("dd")?.textContent)])));
  /** Compare what a view actually rendered with the dataset (first N stages for the popup). */
  const verify = async (label, page, only) => {
    const got = await stageNumbers(page);
    const bad = Object.keys(got).filter((k) => got[k] !== counts[k]);
    const stages = Object.keys(got).slice(0, only ?? Infinity);
    const wrong = bad.filter((k) => stages.includes(k));
    if (!Object.keys(got).length) console.log(`warn ${label}: stage strip not found, numbers not verified`);
    else if (wrong.length) console.log(`warn ${label}: stage numbers differ from the dataset: ${wrong.map((k) => `${k} ${got[k]}≠${counts[k]}`).join(", ")}`);
    else console.log(`     ${label}: stage numbers match (${stages.map((k) => `${k} ${got[k]}`).join(" · ")})`);
  };

  const warRoom = async () => {
    const page = await open("warroom.html");
    await page.waitForSelector("body.booted");
    // The map layer is remembered between loads: set it explicitly.
    return page;
  };
  const setMap = async (page, on) => {
    const btn = page.locator("#wr-layer-map");
    const pressed = (await btn.getAttribute("aria-pressed")) === "true";
    if (pressed !== on) await btn.click();
    if (on) await page.waitForSelector("#wr-map-panel:not([hidden])");
  };

  await step("01-warroom", async () => {
    const page = await warRoom();
    await setMap(page, false);
    await settle(page);
    await verify("War Room", page);
    await shot(page, "01-warroom.png");
    await page.close();
  });

  await step("02-warroom-map", async () => {
    const page = await warRoom();
    await setMap(page, true);
    await settle(page, 1500);
    await shot(page, "02-warroom-map.png");
    await setMap(page, false);
    await page.close();
  });

  await step("03-warroom-plain", async () => {
    // Plain wording is a setting; the ops log text is stored, so re-seed it in plain wording too.
    const plain = buildDataset(now, tabIds, false);
    await home.evaluate((d) => chrome.storage.local.set({ settings: d.settings, ops: d.ops }), plain);
    await sleep(500);
    const page = await warRoom();
    await setMap(page, false);
    await settle(page);
    await shot(page, "03-warroom-plain.png");
    await page.close();
    await home.evaluate((d) => chrome.storage.local.set({ settings: d.settings, ops: d.ops }), data);
    await sleep(500);
  });

  const tracker = async (view) => {
    const page = await open("tracker.html");
    await page.waitForSelector(`#view-${view}`);
    await page.waitForSelector(".stages [data-stage]");
    const btn = page.locator(`#view-${view}`);
    if ((await btn.getAttribute("aria-pressed")) !== "true") await btn.click();
    return page;
  };

  await step("04-tracker-table", async () => {
    const page = await tracker("table");
    await page.waitForSelector("#rows tr");
    await settle(page);
    await verify("Tracker", page);
    await shot(page, "04-tracker-table.png");
    await page.close();
  });

  await step("05-tracker-board", async () => {
    const page = await tracker("board");
    await page.waitForSelector("#board:not([hidden])");
    await settle(page);
    await shot(page, "05-tracker-board.png");
    await page.close();
  });

  await step("06-popup", async () => {
    const page = await open("popup.html", { width: 360, height: 900 });
    await page.waitForSelector("#stages .stage");
    await settle(page);
    await verify("Popup", page, 4);
    // Full height of the popup itself (not the 900px tab around it).
    const height = await page.evaluate(() => Math.ceil(Math.max(document.body.scrollHeight, (document.querySelector(".foot") ?? document.body).getBoundingClientRect().bottom)));
    await page.screenshot({ path: join(out, "06-popup.png"), clip: { x: 0, y: 0, width: 360, height: Math.min(height, 900) } });
    await page.close();
  });

  await step("07-overlay", async () => {
    const page = await ctx.newPage();
    page.setDefaultTimeout(10_000);
    await page.goto(fixtureUrl, { waitUntil: "load" });
    await page.bringToFront();
    // The overlay mounts once the content script has asked the background for its state.
    await page.waitForSelector("#aim401k-root", { state: "attached", timeout: 15_000 });
    await settle(page, 1500);
    await shot(page, "07-overlay.png", { viewportOnly: true });
    await page.close();
  });

  const failed = results.filter(([, ok]) => !ok).map(([l]) => l);
  console.log(`\nstages: ${summary}`);
  console.log(`shots: ${results.length - failed.length}/${results.length} written to ${out}${failed.length ? ` (failed: ${failed.join(", ")})` : ""}`);
  if (failed.length) process.exitCode = 1;
} catch (e) {
  console.error("demo failed:", e?.stack ?? e);
  process.exitCode = 1;
} finally {
  await ctx?.close().catch(() => undefined);
  server.close();
  rmSync(userDir, { recursive: true, force: true });
}
