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

  await setUi({ chud: true });
  await sleep(400); // storage.onChanged → re-render
  check((await label()) === "DELIVERED", `chud mode: tracker status label "DELIVERED" (got ${await label()})`);
  check((await page.evaluate(() => document.documentElement.dataset.chud)) === "1", "chud flag on <html>");
  const ov = await msg({ type: "getOverlayState" });
  check(ov.chud === true, "overlay state carries chud flag");

  // --- board view -------------------------------------------------------------------
  await page.click("#view-board");
  await page.waitForSelector("#board .bcol");
  const cols = await page.$$eval("#board .bcol", (els) => els.map((e) => e.getAttribute("data-col")));
  check(cols.join(",") === "targeted,engaged,holding,delivered,contact,secured,lost", `board columns (${cols.join(",")})`);
  check((await page.locator(`#board .bcol[data-col="delivered"] .bcard[data-job-id="${done.id}"]`).count()) === 1, "submitted job sits in DELIVERED");
  check(await page.locator(`#board .bcol[data-col="lost"]`).evaluate((e) => e.classList.contains("collapsed")), "LOST column starts collapsed");
  check((await page.locator("#table-view").isHidden()) && (await page.locator("#import-sheet").count()) === 1 && (await page.locator("#intel-feed").count()) === 1, "board hides table; import + intel hooks kept");
  await page.screenshot({ path: join(shots, "theme-board.png"), fullPage: true }).catch(() => {});

  // Drag a delivered card to CONTACT → updateJob(status: interviewing).
  // (Stepped mouse moves: Chromium needs intermediate moves to start an HTML5 drag.)
  await page.locator(`.bcard[data-job-id="${done.id}"]`).scrollIntoViewIfNeeded();
  const from = await page.locator(`.bcard[data-job-id="${done.id}"] .top`).boundingBox();
  const to = await page.locator(`.bcol[data-col="contact"] .cards`).boundingBox();
  await page.mouse.move(from.x + 5, from.y + 5);
  await page.mouse.down();
  await page.mouse.move(from.x + 30, from.y + 30, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 10 });
  await page.mouse.up();
  let moved = false;
  for (let i = 0; i < 20 && !moved; i++) {
    await sleep(200);
    moved = (await store()).jobs.find((j) => j.id === done.id)?.status === "interviewing";
  }
  check(moved, "drag to CONTACT sets status interviewing");
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
    const files = ["archivo-latin-wdth-normal.woff2", "jetbrains-mono-latin-400-normal.woff2"];
    const ok = await Promise.all(files.map((f) => fetch(`fonts/${f}`).then((r) => r.ok).catch(() => false)));
    const loaded = async (spec) => (await document.fonts.load(spec, "AIM")).some((f) => f.status === "loaded");
    return { ok: ok.every(Boolean), mono: await loaded('12px "JetBrains Mono AIM"'), sans: await loaded('800 12px "Archivo AIM"') };
  });
  check(fonts.ok && fonts.mono && fonts.sans, `bundled fonts load (${JSON.stringify(fonts)})`);
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
