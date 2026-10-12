// Inbox intel e2e: the Gmail and Outlook tab readers (pages served by Playwright
// routes, no network), direct ingest, manual assignment in the tracker, and the
// settings panel. The Gmail API path needs Google, so it's unit-tested instead.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const key = (c) => String(c ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export default async function ({ ctx, ext, extId, base, msg, store, waitFor, check, sleep, shots, fixtures }) {
  /**
   * A submitted job this suite owns. Suites share one browser profile, so we
   * never borrow another suite's job (moving it to "interviewing" would break
   * the suites that run after us).
   */
  async function pickTarget(_exclude, fallbackCompany) {
    const url = `${base}/posting.html?intel=${key(fallbackCompany)}`;
    await msg({ type: "addJobs", urls: [url], start: false });
    const made = (await store()).jobs.find((j) => j.url === url);
    await msg({ type: "updateJob", jobId: made.id, patch: { company: fallbackCompany, title: "Platform Engineer", status: "submitted" } });
    return (await store()).jobs.find((j) => j.id === made.id);
  }

  const now = new Date();
  const pages = [];

  // --- 1. Gmail tab: an interview request from a company we applied to -------
  const target = await pickTarget([], "Vault-Tec Industries");
  console.log(`   target job: ${target.company} · ${target.title} (${target.status})`);
  const gmailTitle = now.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const gmailTime = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const subject = "Next steps for your application";
  const row = `
    <tr class="zA zE" id=":e2e" role="row" tabindex="-1" draggable="false" jscontroller="ZdOxDb">
      <td class="PF xY PE"></td>
      <td class="oZ-x3 xY"><div class="oZ-jc T-Jo J-J5-Ji" role="checkbox" tabindex="-1"></div></td>
      <td class="apU xY"><span class="aXw T-KT" title="Not starred" role="button"></span></td>
      <td class="WA xY"><div class="pG" role="img" aria-label="Not important"></div></td>
      <td class="yX xY "><div class="yW"><span class="bA4"><span class="zF" email="no-reply@us.greenhouse-mail.io" name="${esc(target.company)}">${esc(target.company)}</span></span></div></td>
      <td tabindex="-1" class="xY a4W"><div class="xS" role="link"><div class="xT"><div class="y6"><span class="bog"><span data-thread-id="#thread-f:1780550000000000001" data-legacy-thread-id="e2e0000000000001" data-legacy-last-message-id="e2e0000000000001" class="bqe">${esc(subject)}</span></span></div><span class="y2"><span class="Zt">&nbsp;-&nbsp;</span>Hi Ada, thanks for applying to ${esc(target.company)}! We'd love to schedule a 30-minute phone screen for the ${esc(target.title || "open")} role. Please share your availability.</span></div></div></td>
      <td class="yf xY ">&nbsp;</td>
      <td class="xW xY "><span title="${esc(gmailTitle)}" aria-label="${esc(gmailTime)}"><span>${esc(gmailTime)}</span></span></td>
    </tr>`;
  const gmailHtml = readFileSync(join(fixtures, "mail/gmail-inbox.html"), "utf8").replace("<tbody>", `<tbody>${row}`);
  await ctx.route("https://mail.google.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: gmailHtml }));
  const gmail = await ctx.newPage();
  pages.push(gmail);
  await gmail.goto("https://mail.google.com/mail/u/0/#inbox");

  let s = await waitFor(
    "Gmail tab email moved the job to interviewing",
    (s) => s.jobs.find((j) => j.id === target.id)?.status === "interviewing" && s.ops?.some((o) => o.kind === "intel" && o.jobId === target.id),
    25000,
  );
  const item = s.intel.find((i) => i.messageId === "e2e0000000000001");
  check(item?.source === "gmail-tab" && item.kind === "interview" && item.jobId === target.id, `Gmail tab: interview email matched to ${target.company} (${JSON.stringify(item && { kind: item.kind, jobId: item.jobId, company: item.company })})`);
  check(s.jobs.find((j) => j.id === target.id).status === "interviewing", "Gmail tab: job status → interviewing");
  const opsLine = s.ops.find((o) => o.kind === "intel" && o.jobId === target.id);
  check(!!opsLine && opsLine.text.includes(target.company), `ops line of kind intel: ${opsLine?.text}`);
  s = await waitFor("CONTACT ops line", (s) => s.ops?.some((o) => o.kind === "contact" && o.jobId === target.id), 5000).catch(() => s);
  check(s.ops.some((o) => o.kind === "contact" && o.jobId === target.id), "feed turned the status change into a CONTACT line");
  check(!s.intel.some((i) => /sourdough/i.test(i.subject)), "newsletter in the inbox was ignored");
  check(!s.intel.some((i) => i.from === "Initrode"), "mail older than 60 days was ignored");

  // The tracker's intel feed lists it (live).
  await ext.bringToFront();
  const feedHas = await ext
    .waitForFunction((c) => document.querySelector("#intel-feed")?.textContent?.includes(c), target.company, { timeout: 10000 })
    .then(() => true, () => false);
  const feedText = await ext.locator("#intel-feed").innerText();
  check(feedHas && feedText.includes(subject), `tracker #intel-feed lists the email (${feedText.split("\n").slice(0, 3).join(" | ")})`);

  // --- 2. Outlook tab: an interview invite from a company we don't track ------
  const mdy = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;
  const outlookItem = `
        <div class="hcptT" data-focusable-row="true">
          <div role="option" aria-selected="false" draggable="true" tabindex="-1" id="AQAAAE2E" data-convid="AAQkE2E-bluth" class="EeHm8 jGG6V">
            <div class="persona" role="img" aria-label="Bluth Company Recruiting"><span>BC</span></div>
            <div class="XG5Jd TszOG">
              <div class="JBWmn gy2aJ"><span title="recruiting@bluthcompany.com" class="OZZZK">Bluth Company Recruiting</span></div>
              <div class="IjzWp XG5Jd gy2aJ"><span class="TtcXM" title="Interview invitation – Bluth Company">Interview invitation – Bluth Company</span><span class="_rWRU" title="${now.toLocaleDateString("en-US", { weekday: "short" })} ${mdy} ${esc(gmailTime)}">${esc(gmailTime)}</span></div>
              <div class="yaJ5r"><span class="FqgPc">Hi Ada, we'd like to invite you to a video interview. Please book a time that works: https://calendly.com/bluth/interview</span></div>
            </div>
          </div>
        </div>`;
  const outlookHtml = readFileSync(join(fixtures, "mail/outlook-inbox.html"), "utf8").replace(
    '<span class="sfTOX">Today</span></div>',
    `<span class="sfTOX">Today</span></div>${outlookItem}`,
  );
  await ctx.route("https://outlook.live.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: outlookHtml }));
  const outlook = await ctx.newPage();
  pages.push(outlook);
  await outlook.goto("https://outlook.live.com/mail/0/inbox");
  s = await waitFor("Outlook tab email stored", (s) => s.intel?.some((i) => i.fromEmail === "recruiting@bluthcompany.com"), 25000);
  const bluth = s.intel.find((i) => i.fromEmail === "recruiting@bluthcompany.com");
  check(bluth.source === "outlook-tab" && bluth.kind === "interview" && bluth.jobId === null && bluth.company === "Bluth Company", `Outlook tab: unmatched interview kept for assignment (${bluth.company}, ${bluth.kind})`);

  // --- 3. Assign it to a job from the tracker feed -------------------------------
  const url = `${base}/posting.html?intel=assign`;
  await msg({ type: "addJobs", urls: [url], start: false });
  const saved = (await store()).jobs.find((j) => j.url === url);
  await msg({ type: "updateJob", jobId: saved.id, patch: { company: "Sitwell Enterprises", title: "Model Home Analyst" } });
  await ext.bringToFront();
  const sel = `[data-intel-id="${bluth.id}"] select`;
  await ext.waitForSelector(`${sel} option[value="${saved.id}"]`, { state: "attached", timeout: 10000 });
  await ext.selectOption(sel, saved.id);
  s = await waitFor("assigned job moved to interviewing", (s) => s.jobs.find((j) => j.id === saved.id)?.status === "interviewing", 10000);
  const assigned = s.intel.find((i) => i.id === bluth.id);
  check(assigned.jobId === saved.id && assigned.applied, "tracker: 'Assign to…' linked the email and applied the status");
  await ext.locator("#intel-feed").screenshot({ path: join(shots, "intel-feed.png") }).catch(() => {});

  // --- 4. Direct ingest: a rejection, then the same mail again -----------------
  const target2 = await pickTarget([key(target.company)], "Nakatomi Trading");
  const rejection = {
    messageId: "e2e-rejection-1",
    from: `${target2.company} Talent`,
    fromEmail: "no-reply@us.greenhouse-mail.io",
    subject: `Your application to ${target2.company}`,
    snippet: `Thank you for applying to ${target2.company}. Unfortunately, we have decided to move forward with other candidates.`,
    receivedAt: Date.now(),
  };
  const r1 = await msg({ type: "intelIngest", source: "outlook-tab", mails: [rejection] });
  check(r1?.added === 1 && r1.matched === 1 && r1.updated === 1, `intelIngest: rejection matched and applied (${JSON.stringify(r1)})`);
  s = await waitFor("rejection ops line", (s) => s.ops?.some((o) => o.kind === "intel" && o.jobId === target2.id), 5000);
  check(s.jobs.find((j) => j.id === target2.id)?.status === "rejected", `${target2.company} → rejected`);
  check(s.ops.some((o) => o.kind === "intel" && o.jobId === target2.id), "rejection wrote an intel ops line");
  const r2 = await msg({ type: "intelIngest", source: "outlook-tab", mails: [rejection] });
  check(r2?.added === 0, "same email again is de-duplicated");
  const items = await msg({ type: "getIntel" });
  check(Array.isArray(items) && items.length === s.intel.length && items[0].receivedAt >= items[items.length - 1].receivedAt, `getIntel returns ${items?.length} items, newest first`);

  // --- 5. Switches: a reader that's off ingests nothing --------------------------
  await ext.evaluate(async () => {
    const { settings } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: { ...settings, intel: { ...settings.intel, gmailTab: false } } });
  });
  await sleep(300);
  const off = await msg({ type: "intelIngest", source: "gmail-tab", mails: [{ ...rejection, messageId: "e2e-off-1", subject: "Offer letter", snippet: "We are pleased to offer you the role." }] });
  check(off?.enabled === false && off.added === 0, "Gmail reader switched off: nothing ingested");
  await ext.evaluate(async () => {
    const { settings } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: { ...settings, intel: { ...settings.intel, gmailTab: true } } });
  });

  // --- 6. Settings panel: toggles, BYO Gmail API guide with the redirect URI ----
  const opts = await ctx.newPage();
  pages.push(opts);
  await opts.goto(`chrome-extension://${extId}/options.html#intel`);
  await opts.waitForSelector("#intel-settings [data-intel=gmailTab]", { state: "attached" });
  const panel = (await opts.locator("#intel-settings").textContent()) ?? "";
  check(/Connect Gmail API \(advanced, BYO\)/.test(panel), "settings: BYO Gmail API section present");
  check(panel.includes(`https://${extId}.chromiumapp.org/`), "settings: shows the exact redirect URI to register");
  check(await opts.locator("#intel-settings [data-intel=gmailTab]").isChecked(), "settings: Gmail tab reader on by default");
  await opts.locator("#intel-settings details summary").click().catch(() => {});
  await opts.fill("#intel-client-id", "not-a-client-id");
  await opts.click("#intel-connect");
  const err = await opts.locator("#intel-settings .status.bad").innerText().catch(() => "");
  check(/client ID/i.test(err), `settings: rejects a malformed client ID before opening Google (${err.slice(0, 60)})`);
  await opts.locator("#intel").screenshot({ path: join(shots, "intel-settings.png") }).catch(() => {});

  for (const p of pages) await p.close().catch(() => {});
  await ctx.unroute("https://mail.google.com/**").catch(() => {});
  await ctx.unroute("https://outlook.live.com/**").catch(() => {});
}
