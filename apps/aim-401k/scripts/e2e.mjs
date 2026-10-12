// End-to-end smoke test: loads the built extension into Chromium (the manifest
// is cross-browser), serves mock job forms, and walks the whole loop:
// queue -> open tab -> fill -> ask human -> answer from overlay msgs -> submit -> tracked.
//
//   pnpm build && pnpm e2e
//
// Requires Playwright (not a dependency of this package; uses a global install).
import { createServer } from "node:http";
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
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

// A mock OpenAI-compatible AI provider, to exercise the "custom" provider path.
const aiCalls = [];
function mockAi(req, res) {
  const json = (o) => {
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify(o));
  };
  if (req.url.endsWith("/models")) return json({ data: [{ id: "mock-model" }, { id: "mock-model-2" }] });
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    aiCalls.push(body);
    const user = body.messages?.find((m) => m.role === "user")?.content ?? "";
    const reply = /Reply with \{"ok": true\}/.test(user)
      ? { ok: true }
      : { answer: "I rebuilt our billing pipeline in Go, cutting failures by 90%.", needs_human: false, reason: "From the resume" };
    // Fenced like many chat models do, to exercise the JSON extraction.
    json({ choices: [{ message: { role: "assistant", content: "```json\n" + JSON.stringify(reply) + "\n```" }, finish_reason: "stop" }] });
  });
}

const server = createServer((req, res) => {
  if ((req.url ?? "").startsWith("/v1/")) return mockAi(req, res);
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

const userDir = mkdtempSync(join(tmpdir(), "aim-401k-e2e-"));
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

  // --- Onboarding: opens on install and imports a PDF resume ----------------
  let onboard = ctx.pages().find((p) => p.url().includes("onboarding.html"));
  for (let i = 0; !onboard && i < 20; i++) {
    await sleep(250);
    onboard = ctx.pages().find((p) => p.url().includes("onboarding.html"));
  }
  check(!!onboard, "onboarding wizard opened on install");
  {
    const { SAMPLE } = await import(join(root, "test/fixtures/sample-resume.mjs"));
    const pdfPage = await ctx.newPage();
    await pdfPage.setContent(`<html><body style="font:12px Helvetica, Arial, sans-serif; white-space:pre-wrap">${SAMPLE.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</body></html>`);
    const pdfPath = join(userDir, "Ada-Lovelace-Resume.pdf");
    await pdfPage.pdf({ path: pdfPath, format: "Letter" });
    await pdfPage.close();
    onboard ??= await ctx.newPage();
    if (!onboard.url().includes("onboarding.html")) await onboard.goto(`chrome-extension://${extId}/onboarding.html`);
    await onboard.waitForSelector("#file", { state: "attached" });
    await onboard.setInputFiles("#file", pdfPath);
    await onboard.waitForSelector("#found .card", { timeout: 15000 }).catch(() => {});
    const found = await onboard.locator("#found").innerText();
    console.log("   import summary:", found.replace(/\n+/g, " · "));
    const p = (await onboard.evaluate(() => chrome.storage.local.get("profile"))).profile ?? {};
    check(p.firstName === "Ada" && p.lastName === "Lovelace" && p.email === "ada@example.com", `PDF import: name/email (${p.firstName} ${p.lastName}, ${p.email})`);
    check(p.workHistory?.length === 2 && p.workHistory[0].company === "Analytical Engines Inc" && p.workHistory[0].current, `PDF import: work history (${JSON.stringify(p.workHistory?.map((w) => [w.title, w.company, w.startDate]))})`);
    check(p.education?.[0]?.school === "University of London", `PDF import: education (${p.education?.[0]?.school})`);
    check(p.resume?.name === "Ada-Lovelace-Resume.pdf", "PDF import: resume file attached for uploads");
    await onboard.click("#next");
    await onboard.screenshot({ path: join(shots, "onboarding-about.png"), fullPage: true }).catch(() => {});
    await onboard.click("#next");
    await onboard.screenshot({ path: join(shots, "onboarding-experience.png"), fullPage: true }).catch(() => {});
    await onboard.close();
  }

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
        workHistory: [
          { company: "Analytical Engines", title: "Engineer", location: "London", startDate: "2019-03", endDate: "", current: true, description: "" },
          { company: "Babbage & Co", title: "Junior Engineer", location: "London", startDate: "2016-06", endDate: "2019-02", current: false, description: "" },
        ],
        education: [{ school: "University of London", degree: "Bachelor of Science", field: "Mathematics", startDate: "2012-09", endDate: "2016-05", gpa: "" }],
        noticePeriod: "2 weeks",
      },
      settings: { notifications: false, autoAdvance: true, autoSubmit: false, stallMinutes: 5, onboarded: true },
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
  // The overlay mounts on the next broadcast; poll rather than guess a delay (slow under load).
  let mounted = 0;
  for (let i = 0; i < 40 && !mounted; i++) {
    mounted = await other.locator("#aim401k-root").count();
    if (!mounted) await sleep(250);
  }
  check(mounted === 1, "overlay mounted on other tab");
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

  // --- Dates: native, typed, Workday-style split boxes, month/year selects ----
  await msg({ type: "addJobs", urls: [`${base}/dates.html`], start: true });
  await waitFor("dates job filled", (s) => s.jobs[3]?.status === "needs_you");
  const datePage = ctx.pages().find((p) => p.url().includes("/dates.html"));
  if (datePage) {
    const v = await datePage.evaluate(() => {
      const val = (id) => document.getElementById(id).value;
      const [m, y] = [...document.querySelectorAll("[data-automation-id^=dateSection]")].map((e) => e.value);
      return {
        avail: val("avail"),
        signed: val("signed"),
        dob: val("dob"),
        pick: val("pick"),
        wd: `${m}/${y}`,
        cur: document.getElementById("w1cur").checked,
        w2: `${val("w2t")} @ ${val("w2c")} ${val("w2from")}–${val("w2to")}`,
        grad: `${document.querySelector("select[name=grad_month]").value}/${document.querySelector("select[name=grad_year]").value}`,
      };
    });
    const d = new Date(Date.now() + 14 * 86400000);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const t = new Date();
    const us = `${String(t.getMonth() + 1).padStart(2, "0")}/${String(t.getDate()).padStart(2, "0")}/${t.getFullYear()}`;
    check(v.avail === iso, `native date picker = notice period (${v.avail})`);
    check(v.signed === us, `MM/DD/YYYY text date = today (${v.signed})`);
    check(v.dob === "", "date of birth left for the human");
    check(!!v.pick, `read-only calendar input filled (${v.pick})`);
    check(v.wd === "03/2019" && v.cur, `Workday-style split date + "currently work here" (${v.wd}, ${v.cur})`);
    check(v.w2 === "Junior Engineer @ Babbage & Co 06/2016–02/2019", `2nd work entry (${v.w2})`);
    check(v.grad === "5/2016", `month/year selects (${v.grad})`);
    await datePage.screenshot({ path: join(shots, "dates-filled.png"), fullPage: true }).catch(() => {});
  }

  // --- AI drafting through an OpenAI-compatible provider ----------------------
  await ext.evaluate(async (baseUrl) => {
    const { settings } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: { ...settings, llmMode: "draft", aiProvider: "custom", customBaseUrl: baseUrl, models: { custom: "mock-model" } } });
  }, `${base}/v1`);
  const t = await msg({ type: "testAi" });
  check(t.ok && t.models.includes("mock-model"), `AI connection test (${t.message})`);
  await msg({ type: "addJobs", urls: [`${base}/ai.html`], start: true });
  s = await waitFor("AI job ready", (s) => s.jobs[4]?.status === "ready_to_submit");
  const aiPage = ctx.pages().find((p) => p.url().includes("/ai.html"));
  const drafted = aiPage ? await aiPage.evaluate(() => document.getElementById("proj").value) : "";
  check(/billing pipeline/.test(drafted) && s.jobs[4].aiDrafted === 1, `AI-drafted answer filled and flagged (${drafted.slice(0, 40)}…)`);
  const draftCall = aiCalls.find((c) => /Describe a project/.test(JSON.stringify(c.messages)));
  check(!!draftCall && /Analytical Engines/.test(JSON.stringify(draftCall.messages)) && /Initech/.test(JSON.stringify(draftCall.messages)), "AI prompt carried profile + job description");

  // --- Feature suites: scripts/e2e.d/*.mjs, run in name order ---------------
  // Each exports `default async function (t)` and uses the helpers below.
  // Jobs from earlier suites exist; find yours by URL, not by index.
  const only = process.env.E2E_ONLY; // e.g. E2E_ONLY=warroom to run just that suite after the core flow
  const suites = readdirSync(join(root, "scripts/e2e.d")).filter((f) => f.endsWith(".mjs") && (!only || f.includes(only))).sort();
  for (const f of suites) {
    console.log(`\n— ${f}`);
    const mod = await import(join(root, "scripts/e2e.d", f));
    try {
      await mod.default({ ctx, ext, extId, base, msg, store, waitFor, check, sleep, shots, root, fixtures, aiCalls, userDir });
    } catch (e) {
      failures++;
      console.error(`✗ ${f} threw:`, e);
    }
  }
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
