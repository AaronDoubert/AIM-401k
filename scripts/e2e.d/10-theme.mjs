// Theme & copy: plain-mode switch, board view, overlay host, bundled fonts.
import { join } from "node:path";

export default async function ({ ctx, ext, extId, base, msg, store, check, sleep, shots }) {
  const setUi = (ui) =>
    ext.evaluate(async (ui) => {
      const { settings } = await chrome.storage.local.get("settings");
      await chrome.storage.local.set({ settings: { ...(settings ?? {}), ui: { chud: true, sound: false, ...(settings?.ui ?? {}), ...ui } } });
    }, ui);

  // A submitted job from the core flow (find it by URL, not index).
  const s0 = await store();
  const done = s0.jobs.find((j) => j.status === "submitted" && j.url.includes("/posting.html"));
  check(!!done, "theme: core flow left a submitted job to look at");
  if (!done) return;

  const page = await ctx.newPage();
  const label = () => page.evaluate((id) => document.querySelector(`tr[data-job-id="${id}"] select.pill`)?.selectedOptions[0]?.textContent ?? null, done.id);

  // --- plain mode switches labels -----------------------------------------------
  await setUi({ chud: false });
  await page.goto(`chrome-extension://${extId}/tracker.html`);
  await page.waitForSelector(`tr[data-job-id="${done.id}"]`);
  check((await label()) === "Applied", `plain mode: tracker status label "Applied" (got ${await label()})`);
  check((await page.locator("h1").innerText()).trim().toLowerCase() === "tracker", "plain mode: tracker title");
  check(await page.locator(".shell-banner").first().isHidden(), "plain mode: no CUI banner on the tracker");
  check(/^\d\d:\d\d$/.test((await page.locator("#clock").innerText()).trim()), `plain mode: tracker clock is local HH:MM (${await page.locator("#clock").innerText()})`);
  check((await page.locator("#caution .c-name").innerText()).trim() === "Needs you", "plain mode: master caution says Needs you");
  check(await page.locator("#table-view").isVisible() && (await page.locator("#view-table").getAttribute("aria-pressed")) === "true", "tracker opens on the table view");
  check(await page.locator("#add").isHidden(), "add targets starts collapsed");
  await page.screenshot({ path: join(shots, "theme-tracker-plain.png"), fullPage: true, timeout: 10000 }).catch(() => {});

  await setUi({ chud: true });
  await sleep(400); // storage.onChanged → re-render
  check((await label()) === "SPLASH", `chud mode: tracker status label "SPLASH" (got ${await label()})`);
  check((await page.evaluate(() => document.documentElement.dataset.chud)) === "1", "chud flag on <html>");
  check((await page.locator(".shell-banner").first().isVisible()) && /CUI/.test(await page.locator(".shell-banner").first().innerText()), "chud mode: CUI banner on the tracker");
  check(/^\d{6}Z[A-Z]{3}\d\d$/.test((await page.locator("#clock").innerText()).trim()), `chud mode: tracker clock is a DTG (${await page.locator("#clock").innerText()})`);
  check((await page.locator("#clear-done").innerText()).trim() === "CLEAR FAULTS", "chud mode: CLEAR FAULTS");
  await page.screenshot({ path: join(shots, "theme-tracker-table.png"), fullPage: true, timeout: 10000 }).catch(() => {});
  const ov = await msg({ type: "getOverlayState" });
  check(ov.chud === true, "overlay state carries chud flag");

  // --- board view -------------------------------------------------------------------
  await page.click("#view-board");
  await page.waitForSelector("#board .bcol");
  const cols = await page.$$eval("#board .bcol", (els) => els.map((e) => e.getAttribute("data-col")));
  check(cols.join(",") === "targets,engaged,hold,splash,contact,secured,lost", `board columns (${cols.join(",")})`);
  check((await page.locator(`#board .bcol[data-col="splash"] .bcard[data-job-id="${done.id}"]`).count()) === 1, "submitted job sits in SPLASH");
  check(await page.locator(`#board .bcol[data-col="lost"]`).evaluate((e) => e.classList.contains("rail")), "LOST column starts as a rail");
  check(await page.locator(`#board .bcol[data-col="secured"]`).evaluate((e) => e.classList.contains("rail")), "empty column collapses to a rail");
  const stageNames = await page.$$eval("#stats .stage dt", (els) => els.map((e) => e.textContent));
  const colNames = await page.$$eval("#board .bcol header .t", (els) => els.map((e) => e.textContent));
  check(stageNames.join() === colNames.join(), `totals and board use the same stage names (${stageNames.join(" · ")})`);
  check((await page.locator(`#board .bcard[data-job-id="${done.id}"] .pill`).count()) === 0, "a card in SPLASH carries no SPLASH badge");
  check((await page.locator("#table-view").isHidden()) && (await page.locator("#import-sheet").count()) === 1 && (await page.locator("#intel-feed").count()) === 1, "board hides table; import + intel hooks kept");
  await page.bringToFront(); // a background tab never paints, so screenshots and drags would stall
  await page.screenshot({ path: join(shots, "theme-board.png"), fullPage: true, timeout: 10000 }).catch(() => {});

  // Drag a delivered card to CONTACT → updateJob(status: interviewing).
  // (Stepped mouse moves: Chromium needs intermediate moves to start an HTML5 drag.)
  // Put the whole board on screen first: a drag that ends outside the viewport never completes.
  await page.locator("#board").evaluate((e) => e.scrollIntoView({ block: "start" }));
  const drag = async () => {
    const from = await page.locator(`.bcard[data-job-id="${done.id}"] .top`).boundingBox();
    await page.mouse.move(from.x + 5, from.y + 5);
    await page.mouse.down();
    await page.mouse.move(from.x + 30, from.y + 30, { steps: 5 });
    // Rails widen into drop targets once a drag starts: measure the target after that.
    const to = await page.locator(`.bcol[data-col="contact"]`).boundingBox({ timeout: 3000 });
    await page.mouse.move(to.x + to.width / 2, to.y + Math.min(60, to.height / 2), { steps: 10 });
    await page.mouse.up();
  };
  // Never let a stuck drag stall the whole run.
  await Promise.race([drag(), sleep(15000).then(() => console.log("   (drag timed out)"))]).catch((e) => console.log("   (drag failed)", e.message));
  let moved = false;
  for (let i = 0; i < 20 && !moved; i++) {
    await sleep(200);
    moved = (await store()).jobs.find((j) => j.id === done.id)?.status === "interviewing";
  }
  check(moved, "drag to CONTACT sets status interviewing");
  const pop0 = await ctx.newPage();
  await pop0.goto(`chrome-extension://${extId}/popup.html`);
  await sleep(500);
  const popNames = await pop0.$$eval("#stages .stage dt", (els) => els.map((e) => e.textContent));
  check(popNames.join() === stageNames.slice(0, 4).join(), `popup shows the first four stages in the same order (${popNames.join(" · ")})`);
  await pop0.close();
  await msg({ type: "updateJob", jobId: done.id, patch: { status: "submitted" } }); // put it back for later suites
  await page.click("#view-table");
  await page.close();

  // --- popup copy ------------------------------------------------------------------
  const pop = await ctx.newPage();
  await pop.goto(`chrome-extension://${extId}/popup.html`);
  await sleep(500);
  check((await pop.locator("#fill").textContent()) === "ENGAGE THIS TAB", "popup chud: ENGAGE THIS TAB");
  check((await pop.locator("#warroom").count()) === 1, "popup War Room button present");
  await pop.locator("#ui-plain").check();
  await sleep(400);
  check((await pop.locator("#fill").textContent()) === "Autofill this tab", "popup plain toggle: Autofill this tab");
  check((await store()).settings.ui.chud === false, "popup toggle writes settings.ui.chud");
  await pop.locator("#ui-plain").uncheck();
  await sleep(300);
  await pop.close();

  // --- options: interface toggles + intact hooks ---------------------------------------
  const opt = await ctx.newPage();
  await opt.goto(`chrome-extension://${extId}/options.html`);
  await opt.waitForSelector("#opt-plain");
  const hooks = await opt.evaluate(() => ["#intel-settings", "#privacy-panel", "#ai-setup", "#ai-mode", "#automation-fields"].filter((s) => !document.querySelector(s)));
  check(hooks.length === 0, `options hooks intact (${hooks.join(",") || "all"})`);
  check((await opt.locator("#automation h2 span[data-copy]").textContent()) === "RULES OF ENGAGEMENT", "options section header in chud");
  await opt.locator("#opt-plain").check();
  await sleep(300);
  check((await opt.locator("#automation h2 span[data-copy]").textContent()) === "Automation" && (await store()).settings.ui.chud === false, "options plain toggle applies + saves");
  await opt.locator("#opt-plain").uncheck();
  await sleep(300);

  // Fonts are bundled (no network).
  const fonts = await opt.evaluate(async () => {
    const files = ["geist-latin-wght-normal.woff2", "geist-mono-latin-wght-normal.woff2"];
    const ok = await Promise.all(files.map((f) => fetch(`fonts/${f}`).then((r) => r.ok).catch(() => false)));
    const loaded = async (spec) => (await document.fonts.load(spec, "AIM")).some((f) => f.status === "loaded");
    return { ok: ok.every(Boolean), mono: await loaded('12px "Geist Mono AIM"'), sans: await loaded('600 12px "Geist AIM"') };
  });
  check(fonts.ok && fonts.mono && fonts.sans, `bundled fonts load (${JSON.stringify(fonts)})`);
  const logo = await opt.evaluate(async () => {
    const img = document.querySelector("header img.wordmark");
    if (!img) return { found: false };
    await img.decode().catch(() => {});
    return { found: true, w: img.naturalWidth, alt: img.alt };
  });
  check(logo.found && logo.w > 0 && logo.alt === "AIM-401k", `wordmark artwork renders (${JSON.stringify(logo)})`);
  await opt.close();

  // --- overlay host on a fixture page --------------------------------------------------
  const other = await ctx.newPage();
  await other.goto(`${base}/other.html`);
  let host = 0;
  for (let i = 0; i < 40 && !host; i++) {
    await sleep(250);
    host = await other.locator("#aim401k-root").count();
  }
  check(host === 1, "overlay host mounted on fixture page");
  await other.close();
}
