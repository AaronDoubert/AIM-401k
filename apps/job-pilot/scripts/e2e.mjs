// End-to-end smoke test: loads the built extension into Chromium (the manifest
// is cross-browser), serves mock job forms, and walks the whole loop:
// queue -> open tab -> fill -> ask human -> answer from overlay msgs -> submit -> tracked.
//
//   pnpm build && pnpm e2e
//
// Requires Playwright (not a dependency of this package; uses a global install).
import { createServer } from "node:http";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const fixtures = join(root, "test/fixtures");
const shots = process.env.E2E_SHOTS ?? join(root, "e2e-shots");

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require(join(process.execPath, "../../lib/node_modules/playwright")));
}

const server = createServer((req, res) => {
  const file = (req.url ?? "/").split("?")[0].replace(/^\/+/, "") || "posting.html";
  let body;
  try {
    body = readFileSync(join(fixtures, file));
  } catch {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const userDir = mkdtempSync(join(tmpdir(), "jobpilot-e2e-"));
const ctx = await chromium.launchPersistentContext(userDir, {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  viewport: { width: 1200, height: 800 },
});

let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent("serviceworker");
  const extId = new URL(sw.url()).host;
  if (process.env.E2E_DEBUG) sw.on("console", (m) => console.log("[sw]", m.text()));

  // An extension page gives us a runtime.sendMessage channel to the background.
  const ext = await ctx.newPage();
  await ext.goto(`chrome-extension://${extId}/tracker.html`);
  const msg = (m) => ext.evaluate((m) => chrome.runtime.sendMessage(m), m);
  const store = () => ext.evaluate(() => chrome.storage.local.get(null));
  const waitFor = async (label, pred, timeout = 20000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const s = await store();
      if (pred(s)) return s;
      await sleep(300);
    }
    const s = await store();
    console.log(JSON.stringify({ jobs: s.jobs?.map((j) => ({ s: j.status, log: j.log.slice(-5) })), needs: s.needs }, null, 1));
    throw new Error(`timeout: ${label}`);
  };

  await ext.evaluate(() =>
    chrome.storage.local.set({
      profile: {
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
        phone: "555-0100",
        city: "Austin",
        state: "Texas",
        country: "United States",
        linkedin: "https://linkedin.com/in/ada",
        workAuthorized: "yes",
        requiresSponsorship: "no",
        over18: "yes",
        howDidYouHear: "Company website",
        gender: "Decline to self-identify",
        resume: { name: "ada.pdf", type: "application/pdf", data: btoa("%PDF-1.4 fake") },
      },
      settings: { notifications: false, autoAdvance: true, autoSubmit: false, stallMinutes: 5 },
    }),
  );

  // The user is "somewhere else".
  const other = await ctx.newPage();
  await other.goto(`${base}/other.html`);

  // --- Job 1: posting page -> Apply -> form with unknowns --------------------
  check((await msg({ type: "addJobs", urls: [`${base}/posting.html`], start: true })) === 1, "queued 1 job");

  let s = await waitFor("job 1 needs human", (s) => s.needs?.length >= 2);
  const job1 = s.jobs[0];
  check(job1.status === "needs_you", `job status needs_you (got ${job1.status})`);
  check(job1.company === "Acme Robotics" && job1.title === "Senior Platform Engineer", `meta extracted: ${job1.company} / ${job1.title}`);
  const why = s.needs.find((n) => n.kind === "question");
  const cert = s.needs.find((n) => n.kind === "consent");
  check(!!why && /why do you want/i.test(why.prompt), `asks "${why?.prompt}"`);
  check(!!cert && /certify/i.test(cert.prompt), `asks consent "${cert?.prompt}"`);
  check(s.needs.length === 2, `exactly 2 needs (got ${s.needs.map((n) => n.prompt).join(" | ")})`);

  // Overlay shows up on the unrelated tab.
  await sleep(500);
  check((await other.locator("#jobpilot-root").count()) === 1, "overlay mounted on other tab");
  await other.screenshot({ path: join(shots, "overlay-needs.png") }).catch(() => {});

  // Answer from "the box".
  await msg({ type: "answerNeed", needId: why.id, value: "I love robots and reliable platforms.", remember: true });
  await msg({ type: "answerNeed", needId: cert.id, value: "checked", remember: true });

  s = await waitFor("job 1 ready to submit", (s) => s.jobs[0].status === "ready_to_submit");
  check(s.needs.length === 1 && s.needs[0].kind === "review_submit", "single review_submit need");
  check(s.answers.some((a) => /why do you want/i.test(a.question)), "answer saved to bank");

  // Inspect the job tab before submit.
  const jobPage = ctx.pages().find((p) => p.url().includes("/apply.html"));
  check(!!jobPage, "job tab navigated to apply page");
  if (jobPage) {
    const vals = await jobPage.evaluate(() => ({
      fn: document.getElementById("first_name").value,
      email: document.getElementById("email").value,
      auth: document.getElementById("auth").selectedOptions[0]?.text,
      sponsor: document.querySelector("input[name=sponsor]:checked")?.value,
      gender: document.getElementById("gender").selectedOptions[0]?.text,
      resume: document.getElementById("resume").files.length,
      li: document.getElementById("li").value,
      cert: document.getElementById("cert").checked,
    }));
    check(vals.fn === "Ada" && vals.email === "ada@example.com", "identity filled");
    check(vals.auth === "Yes" && vals.sponsor === "n", `eligibility filled (auth=${vals.auth}, sponsor=${vals.sponsor})`);
    check(vals.gender === "Decline To Self Identify", `EEO declined (${vals.gender})`);
    check(vals.resume === 1, "resume attached");
    check(vals.li === "https://linkedin.com/in/ada", "linkedin filled");
    check(vals.cert === true, "consent checked after approval");
    await jobPage.screenshot({ path: join(shots, "filled-form.png"), fullPage: true }).catch(() => {});
  }

  await msg({ type: "submitJob", jobId: job1.id });
  s = await waitFor("job 1 submitted", (s) => s.jobs[0].status === "submitted");
  check(!!s.jobs[0].appliedAt && s.needs.length === 0, "job 1 tracked as applied, no needs left");

  // --- Job 2: multi-step SPA, auto-advance + auto-submit ---------------------
  await ext.evaluate(async () => {
    const { settings } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: { ...settings, autoSubmit: true } });
  });
  await msg({ type: "addJobs", urls: [`${base}/multistep.html`], start: true });
  s = await waitFor("job 2 submitted", (s) => s.jobs[1]?.status === "submitted", 30000);
  const log2 = s.jobs[1].log.map((l) => l.msg);
  console.log("   job 2 log:", log2.join(" → "));
  check(log2.some((m) => /clicking next/i.test(m)) && log2.some((m) => /submitting/i.test(m)), "multi-step job advanced a step and auto-submitted");
  const done = ctx.pages().find((p) => p.url().includes("/multistep.html"));
  if (done) {
    const text = await done.evaluate(() => document.body.innerText);
    check(/"country":"United States of America"/.test(text) && /"age":"yes"/.test(text), `multi-step data correct: ${text.slice(0, 160)}`);
  }

  // --- Same question on a new form is answered from memory --------------------
  await ext.evaluate(async () => {
    const { settings } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: { ...settings, autoSubmit: false } });
  });
  await msg({ type: "addJobs", urls: [`${base}/apply.html?again=1`], start: true });
  s = await waitFor("job 3 ready", (s) => s.jobs[2]?.status === "ready_to_submit");
  check(s.needs.every((n) => n.kind === "review_submit"), "repeat questions answered from saved answers");
} catch (e) {
  failures++;
  console.error(e);
} finally {
  await ctx.close();
  server.close();
  rmSync(userDir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall e2e checks passed");
process.exit(failures ? 1 : 0);
