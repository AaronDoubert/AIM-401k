// Spotter: a job posting opened by hand gets a corner card ("target acquired");
// holding the switch starts filling in that tab. Unrelated pages, and every page
// while the Spotter is off, get nothing.
import { join } from "node:path";

/** The overlay lives in a closed shadow root; CDP's pierced DOM can still see it. */
async function shadow(page, cls) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    let hit = null;
    const walk = (n) => {
      if (hit) return;
      const a = n.attributes ?? [];
      for (let i = 0; i < a.length; i += 2) if (a[i] === "class" && a[i + 1].split(/\s+/).includes(cls)) hit = n;
      for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) walk(c);
    };
    walk(root);
    if (!hit) return null;
    const { outerHTML } = await cdp.send("DOM.getOuterHTML", { nodeId: hit.nodeId });
    let box = null;
    try {
      const { model } = await cdp.send("DOM.getBoxModel", { nodeId: hit.nodeId });
      const q = model.border;
      box = { x: (q[0] + q[4]) / 2, y: (q[1] + q[5]) / 2 };
    } catch {
      /* not rendered */
    }
    return { html: outerHTML, box };
  } finally {
    await cdp.detach().catch(() => {});
  }
}

export default async function (t) {
  const { ctx, base, msg, store, waitFor, check, sleep, shots } = t;
  const setSpotter = async (on) => {
    const ext = t.ext;
    await ext.evaluate(async (on) => {
      const { settings = {} } = await chrome.storage.local.get("settings");
      await chrome.storage.local.set({ settings: { ...settings, spotter: on } });
    }, on);
  };
  const findCard = async (page, ms) => {
    for (let i = 0; i < ms / 250; i++) {
      const card = await shadow(page, "spot");
      if (card) return card;
      await sleep(250);
    }
    return null;
  };

  check((await store()).settings.spotter !== false, "Spotter is on by default");

  // --- a posting opened by hand: card with role and company ----------------------------
  const url = `${base}/posting.html?spotter=1`;
  const page = await ctx.newPage();
  await page.goto(url);
  const card = await findCard(page, 10000);
  check(!!card, "Spotter card shows on a job posting");
  check(/TARGET ACQUIRED|Job found/.test(card?.html ?? ""), "card is headed as a find");
  check(/Senior Platform Engineer/.test(card?.html ?? "") && /Acme Robotics/.test(card?.html ?? "") && /Austin, TX/.test(card?.html ?? ""), "card names the role, company and location");
  await page.screenshot({ path: join(shots, "spotter-card.png") }).catch(() => {});
  check(!(await store()).jobs.some((j) => j.url === url), "nothing is tracked until you act");

  // --- hold to engage: the job starts in this tab ------------------------------------
  const sw = await shadow(page, "guard-switch");
  check(!!sw?.box, "hold switch is on screen");
  if (sw?.box) {
    await page.mouse.move(sw.box.x, sw.box.y);
    await page.mouse.down();
    await sleep(300);
    await page.mouse.up(); // a short press does nothing
    await sleep(400);
    check(!(await store()).jobs.some((j) => j.url === url), "a short press does not engage");
    await page.mouse.down();
    await sleep(1600);
    await page.mouse.up();
  }
  const s = await waitFor("spotted job engaged", (s) => {
    const j = s.jobs?.find((j) => j.url === url);
    return j && j.tabId != null && ["running", "needs_you", "ready_to_submit"].includes(j.status);
  }, 15000);
  const job = s.jobs.find((j) => j.url === url);
  check(job?.title === "Senior Platform Engineer" && job?.company === "Acme Robotics", `engaged job keeps the page's names (${job?.company} / ${job?.title})`);
  await sleep(500);
  const after = await shadow(page, "spot");
  check(!after || /Open your next/.test(after.html), "card confirms and points you to the next tab");
  await page.screenshot({ path: join(shots, "spotter-engaged.png") }).catch(() => {});
  if (job) await msg({ type: "skipJob", jobId: job.id });
  await page.close();

  // --- unrelated page: no card ---------------------------------------------------------
  const news = await ctx.newPage();
  await news.goto(`${base}/other.html?spotter=1`);
  check(!(await findCard(news, 3500)), "no card on a page that isn't a job posting");
  await news.close();

  // --- Spotter off: postings are ignored -------------------------------------------------
  await setSpotter(false);
  const quiet = await ctx.newPage();
  await quiet.goto(`${base}/posting.html?spotter=2`);
  check(!(await findCard(quiet, 3500)), "no card while the Spotter is off");
  await quiet.close();
  await setSpotter(true);
}
