// War Room e2e: open the dashboard, arm targets through its UI, watch unit
// tiles progress, answer a holding prompt and hold-to-fire a release from the
// War Room, check the ops log, and round-trip AFK into a sitrep.
// Chromium has no tabs.captureTab, so this covers the schematic fallback.
import { join } from "node:path";

const ACTIVE = ["queued", "running", "needs_you", "ready_to_submit"];

/** Scroll the track table (not the page) so this row is at the top. */
function scrollTileIntoGrid(el) {
  el.scrollIntoView({ block: "start" });
}

export default async function warroom(t) {
  const { ctx, ext, extId, base, msg, store, waitFor, check, sleep, shots } = t;
  const setSettings = (patch) =>
    ext.evaluate(async (patch) => {
      const { settings } = await chrome.storage.local.get("settings");
      await chrome.storage.local.set({ settings: { ...settings, ...patch } });
    }, patch);
  const shot = (page, name, opts = {}) => page.screenshot({ path: join(shots, name), ...opts }).catch((e) => console.log("   (screenshot failed)", e.message));

  const before = (await store()).settings ?? {};
  // AI off so the textarea question comes to the operator instead of the mock model.
  await setSettings({ llmMode: "off", concurrency: 1, notifications: false, afk: false, paused: false });

  const wr = await ctx.newPage();
  await wr.setViewportSize({ width: 1280, height: 800 });
  const errors = [];
  wr.on("pageerror", (e) => errors.push(String(e)));
  wr.on("console", (m) => m.type() === "error" && !/Receiving end does not exist|message port closed/i.test(m.text()) && errors.push(m.text()));
  await wr.goto(`chrome-extension://${extId}/warroom.html`);
  await wr.waitForSelector("body.booted", { timeout: 10000 });

  const urls = [
    `${base}/warroom/apply.html?wr=1&co=Rekall%20Incorporated&role=Staff%20Autonomy%20Engineer&delay=1200`,
    `${base}/warroom/apply.html?wr=2&co=Omni%20Consumer%20Products&role=Synthetic%20Operations%20Lead&delay=1800&consent=1`,
    `${base}/warroom/apply.html?wr=3&co=Gekko%20%26%20Co&role=Replicant%20UX%20Researcher&delay=3400`,
  ];

  try {
    // --- Shell ---------------------------------------------------------------
    check((await wr.locator("#wr-title").innerText()).includes("OPERATION GAINFUL"), "War Room header renders");
    check(/^\d{6}Z[A-Z]{3}\d\d$/.test((await wr.locator("#wr-clock").innerText()).trim()), `clock is a date-time group (${await wr.locator("#wr-clock").innerText()})`);
    check((await wr.locator(".wr-banner").count()) === 2 && /CUI/.test(await wr.locator(".wr-banner").first().innerText()), "CUI banner top and bottom");
    const history = await wr.locator("#wr-log .ln").count();
    check(history > 0, `ops log loaded history via getOps (${history} lines)`);
    check(Number(await wr.locator('#wr-stages .stage[data-stage="splash"] dd').innerText()) >= 1, "stage totals count earlier deliveries");

    // --- Controls --------------------------------------------------------------
    await wr.click("#wr-pause");
    await waitFor("paused from War Room", (s) => s.settings.paused === true, 5000);
    await wr.click("#wr-pause");
    await waitFor("resumed from War Room", (s) => s.settings.paused === false, 5000);
    check(true, "Pause/Resume toggles settings.paused");
    await wr.click("#wr-sound");
    await waitFor("sound on", (s) => s.settings.ui?.sound === true, 5000);
    await wr.click("#wr-sound");
    await waitFor("sound off", (s) => s.settings.ui?.sound === false, 5000);
    check(true, "sound toggle writes settings.ui.sound");
    await wr.click("#wr-units-inc");
    await wr.click("#wr-units-inc");
    await waitFor("concurrency 3", (s) => s.settings.concurrency === 3, 5000);
    check((await wr.locator("#wr-units").innerText()).trim() === "3", "UNITS stepper writes settings.concurrency (3)");

    // --- ARM TARGETS: paste → countdown → addJobs ------------------------------
    await wr.fill("#wr-arm-input", `tonight's targets:\n${urls.join("\n")}\n(that's all)`);
    check(/3/.test(await wr.locator("#wr-arm-count").innerText()), "ARM TARGETS extracts 3 URLs");
    await wr.click("#wr-arm-go");
    let s = await waitFor("War Room targets queued", (s) => urls.every((u) => s.jobs.some((j) => j.url === u)), 10000);
    const [jobA, jobB, jobC] = urls.map((u) => s.jobs.find((j) => j.url === u));

    // --- Unit tile appears and progresses ------------------------------------
    const tileA = wr.locator(`.track[data-job="${jobA.id}"]`);
    await tileA.waitFor({ timeout: 10000 });
    check(true, "track row appears for a launched target");
    const seen = [];
    let midShot = false;
    for (const until = Date.now() + 30000; Date.now() < until; ) {
      const d = await tileA.evaluate((el) => ({ ...el.dataset })).catch(() => null);
      if (d) {
        const key = `${d.phase}:${d.done}/${d.total}:s${d.step}`;
        if (seen[seen.length - 1] !== key) seen.push(key);
        if (!midShot && d.phase === "advancing") {
          midShot = true;
          await tileA.evaluate(scrollTileIntoGrid).catch(() => {});
          await shot(wr, "warroom-engaged.png");
        }
        if (d.phase === "holding" && d.ready === "false" && Number(d.step) >= 2) break;
      }
      await sleep(60);
    }
    console.log("   tile A:", seen.join(" → "));
    const parsed = seen.map((k) => {
      const [phase, frac, step] = k.split(":");
      const [done, total] = frac.split("/").map(Number);
      return { phase, done, total, step: Number(step.slice(1)) };
    });
    check(parsed.some((p) => p.phase === "filling"), "tile showed the filling phase");
    check(
      parsed.some((p, i) => p.total > 0 && parsed.slice(i + 1).some((q) => q.step > p.step || (q.step === p.step && q.done > p.done))),
      "tile progress advances (fields done / step)",
    );
    check(parsed.some((p) => p.step >= 2), "unit reached form step 2 (advancing counted)");
    const units = await msg({ type: "getUnits" });
    const uA = Array.isArray(units) && units.find((u) => u.jobId === jobA.id);
    check(!!uA && uA.fieldsTotal > 0 && uA.step >= 2, `getUnits reports unit state (${uA && `${uA.phase} ${uA.fieldsDone}/${uA.fieldsTotal} step ${uA.step}`})`);
    const checks = await tileA.locator(".checklist li").evaluateAll((els) => els.map((e) => `${e.dataset.state}:${e.querySelector("span")?.textContent}`));
    check(checks.length > 0 && checks.some((c) => c.startsWith("ok:")), `field checklist rendered (${checks.slice(0, 5).join(", ")})`);
    await tileA.locator(".track-row").click();
    check(await tileA.evaluate((e) => e.classList.contains("locked")), "clicking a row locks it (brackets)");
    check((await wr.locator(".track.locked").count()) === 1, "only the locked row has brackets");

    // --- Thumbnails (Firefox captureTab path, simulated) -----------------------
    // Chromium can't capture background tabs, so hand the War Room a units
    // broadcast with thumbs taken by Playwright, as the background would in Firefox.
    const thumbs = {};
    for (const [job, tag] of [[jobA, "wr=1"], [jobC, "wr=3"]]) {
      const page = ctx.pages().find((p) => p.url().includes(tag));
      const buf = page && (await page.screenshot({ type: "jpeg", quality: 40, clip: { x: 0, y: 0, width: 1200, height: 640 } }).catch(() => null));
      if (buf) thumbs[job.id] = `data:image/jpeg;base64,${buf.toString("base64")}`;
    }
    const live = await msg({ type: "getUnits" });
    await ext.evaluate((units) => chrome.runtime.sendMessage({ type: "units", units }).catch(() => undefined), live.map((u) => (thumbs[u.jobId] ? { ...u, thumb: thumbs[u.jobId] } : u)));
    const thumbShown = await tileA
      .locator(".track-detail img.thumb")
      .waitFor({ timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    // Hero shot: earlier suites leave units holding above ours, so bring the fresh ones into view.
    await tileA.evaluate(scrollTileIntoGrid);
    await sleep(300);
    await shot(wr, "warroom.png");
    await sleep(3500); // the thumb must survive the next getUnits poll (which carries none)
    check(thumbShown && (await tileA.locator(".track-detail img.thumb").count()) === 1, "live tab capture shows for the locked unit and persists");

    // --- Holding tile: operator prompt + answer from the War Room ------------
    const opA = tileA.locator(".operator");
    await opA.waitFor({ timeout: 10000 });
    const opText = await opA.innerText();
    check(/chaotic production system/i.test(opText) && !/OPERATOR|QUERY/.test(opText), "holding row shows the question once, without repeated labels");
    check((await tileA.locator(".c-status").innerText()).trim() === "HOLD" && /^\d\d:\d\d$/.test((await tileA.locator(".c-hold").innerText()).trim()), "row carries the HOLD status and mm:ss timer");
    check((await wr.locator("#wr-caution").getAttribute("data-lit")) === "true", "master caution lit while a unit waits");
    await wr.click("#wr-caution");
    check((await wr.locator("#wr-caution").getAttribute("data-lit")) === "false", "pressing master caution acknowledges it (lamp goes dark)");
    check((await wr.locator(".track.locked .operator").count()) === 1, "master caution jumps to a unit on hold");
    const ta = opA.locator("textarea");
    check((await ta.count()) === 1, "textarea control for a textarea question");
    const answer = "Kept a 400-node Kafka fleet alive through a region failover.";
    await ta.fill(answer);
    await opA.locator(".need[data-kind=question] button.primary").click();
    s = await waitFor("A ready after War Room answer", (s) => s.jobs.find((j) => j.id === jobA.id)?.status === "ready_to_submit", 15000);
    check(s.answers.some((a) => /chaotic production system/i.test(a.question) && a.answer === answer), "War Room answer saved to the answer bank (remember)");
    const pageA = ctx.pages().find((p) => p.url().includes("wr=1"));
    check(!!pageA && (await pageA.evaluate(() => document.getElementById("chaos")?.value)) === answer, "answer filled into the job tab");

    // --- Hold-to-fire release --------------------------------------------------
    const fireA = tileA.locator(".guard-switch");
    await tileA.locator(".guard-cover").waitFor({ timeout: 10000 });
    check((await tileA.locator(".c-status").innerText()).trim() === "READY", "ready row shows READY on the row");
    await fireA.hover({ force: true });
    await wr.mouse.down();
    await sleep(1600);
    await wr.mouse.up();
    await sleep(300);
    check((await store()).jobs.find((j) => j.id === jobA.id)?.status === "ready_to_submit", "holding the switch under a closed guard does nothing");
    await tileA.locator(".guard-cover").click();
    check((await tileA.locator(".guarded").getAttribute("data-state")) === "open", "clicking the guard lifts it");
    await fireA.hover();
    await wr.mouse.down();
    await sleep(350);
    await wr.mouse.up();
    await sleep(500);
    s = await store();
    check(s.jobs.find((j) => j.id === jobA.id)?.status === "ready_to_submit", "letting go early cancels the release");
    await fireA.hover();
    await wr.mouse.down();
    await sleep(650);
    await shot(wr, "warroom-release.png");
    await sleep(900);
    await wr.mouse.up();
    s = await waitFor("A submitted via hold-to-fire", (s) => s.jobs.find((j) => j.id === jobA.id)?.status === "submitted", 15000);
    check(!!s.jobs.find((j) => j.id === jobA.id)?.appliedAt, "hold-to-fire RELEASE submitted the application");
    const delivered = await wr
      .waitForSelector(`.track[data-job="${jobA.id}"][data-phase="delivered"]`, { timeout: 6000 })
      .then(() => true)
      .catch(() => false);
    check(delivered, "splashed row lingers in the track table");

    // --- AFK: consent + keyboard release while away, then sitrep --------------
    await wr.click("#wr-afk");
    await waitFor("AFK on", (s) => s.settings.afk === true, 5000);
    await wr.waitForSelector("#wr-afk-strip:not([hidden])", { timeout: 3000 });
    check((await wr.locator("#wr-afk").getAttribute("aria-pressed")) === "true", "AFK toggle on (strip + pressed)");

    const tileB = wr.locator(`.track[data-job="${jobB.id}"]`);
    await waitFor("B holding", (s) => s.needs.some((n) => n.jobId === jobB.id), 20000);
    await tileB.locator(".operator").waitFor({ timeout: 5000 });
    await sleep(300);
    const opB = tileB.locator(".operator");
    if (await opB.locator(".need[data-kind=question] textarea").count()) {
      await opB.locator(".need[data-kind=question] textarea").fill("Same story, different fleet.");
      await opB.locator(".need[data-kind=question] textarea").press("Control+Enter");
    }
    const agree = opB.locator(".need[data-kind=consent] button.primary");
    check((await agree.count()) === 1, "consent need shows I AGREE");
    if (await agree.count()) await agree.click();
    await waitFor("B ready", (s) => s.jobs.find((j) => j.id === jobB.id)?.status === "ready_to_submit", 20000);
    const coverB = tileB.locator(".guard-cover");
    await coverB.waitFor({ timeout: 10000 });
    await coverB.focus();
    await wr.keyboard.press("Enter");
    await sleep(250);
    await wr.keyboard.down("Space");
    await sleep(1500);
    await wr.keyboard.up("Space");
    await waitFor("B submitted via keyboard hold", (s) => s.jobs.find((j) => j.id === jobB.id)?.status === "submitted", 15000);
    check(true, "keyboard: Enter lifts the guard, holding Space releases");

    await wr.click("#wr-afk");
    await wr.waitForSelector("#wr-modal:not([hidden]) .sr-box", { timeout: 5000 });
    const sitrep = await wr.locator("#wr-modal .sr-box").innerText();
    const deliveredN = Number((await wr.locator("#wr-modal .stage dd").first().innerText()).trim());
    check(/SITREP/.test(sitrep) && deliveredN >= 1, `AFK off shows a sitrep (delivered ${deliveredN})`);
    s = await waitFor("AFK off", (s) => s.settings.afk === false, 5000);
    check(s.ops.some((e) => e.kind === "afk" && /SITREP/.test(e.text)), "sitrep line written to the ops log");
    await sleep(300);
    await shot(wr, "warroom-sitrep.png");
    await wr.click("#wr-modal .wr-btn.primary");

    // --- Ops log --------------------------------------------------------------
    const kinds = await wr.locator("#wr-log .ln").evaluateAll((els) => els.map((e) => e.dataset.kind));
    check(["launch", "intervene", "release", "deliver", "afk"].every((k) => kinds.includes(k)), `ops log shows live lines (${[...new Set(kinds)].join(",")})`);
    await wr.click("#wr-chips .chip[data-filter=errors]");
    const errKinds = await wr.locator("#wr-log .ln").evaluateAll((els) => els.map((e) => e.dataset.kind));
    check(errKinds.every((k) => k === "error"), "log filter chips narrow by kind");
    await wr.click("#wr-chips .chip[data-filter=all]");
    const meta = await wr.locator("#wr-log .ln .ln-meta").first().innerText().catch(() => "");
    check(/^\d{6}Z/.test(meta.trim()), `log meta line starts with a DTG (${meta.replace(/\s+/g, " ")})`);

    // --- Map layer (off by default) -------------------------------------------
    check(await wr.locator("#wr-map-panel").isHidden(), "map layer is off by default");
    await wr.click("#wr-layer-map");
    await wr.waitForSelector("#wr-map-panel:not([hidden]) svg", { timeout: 3000 });
    check(true, "MAP toggle shows the map layer");
    await sleep(300);
    await shot(wr, "warroom-map.png");
    await wr.click("#wr-layer-map");
    check(await wr.locator("#wr-map-panel").isHidden(), "MAP toggle hides it again");

    // --- Open tab button focuses the job tab ------------------------------------
    const tileC = wr.locator(`.track[data-job="${jobC.id}"] .c-open`);
    if (await tileC.count()) {
      await tileC.click({ force: true });
      await sleep(500);
      const active = await ext.evaluate(() => chrome.tabs.query({ active: true }).then((t) => t.map((x) => x.url)));
      check(active.some((u) => u.includes("wr=3")), "OPEN TAB focuses that job's tab");
      await wr.bringToFront();
    }

    // --- Layout variants ---------------------------------------------------------
    await wr.setViewportSize({ width: 860, height: 1100 });
    await sleep(400);
    await shot(wr, "warroom-narrow.png", { fullPage: true });
    const overflow = await wr.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(overflow <= 0, `narrow layout has no horizontal scroll (${overflow}px)`);
    await wr.setViewportSize({ width: 1280, height: 800 });
    await setSettings({ ui: { ...(before.ui ?? {}), chud: false, sound: false } });
    await wr.waitForFunction(() => document.getElementById("wr-title")?.textContent?.includes("Dashboard"), null, { timeout: 5000 });
    check(true, "plain mode relabels the War Room");
    await sleep(300);
    await shot(wr, "warroom-plain.png");
    await setSettings({ ui: { ...(before.ui ?? {}), chud: true, sound: false } });

    check(errors.length === 0, `no War Room page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  } finally {
    // Leave the browser as we found it for later suites.
    const st = await store();
    for (const j of st.jobs ?? []) if (urls.includes(j.url) && ACTIVE.includes(j.status)) await msg({ type: "skipJob", jobId: j.id });
    await setSettings({ llmMode: before.llmMode ?? "off", concurrency: before.concurrency ?? 1, afk: false, paused: false, ui: before.ui ?? { chud: true, sound: false } });
    await wr.close().catch(() => {});
  }
}
