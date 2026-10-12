// Privacy & data: AI redaction, the Settings → Privacy panel, clearing history,
// forgetting keys, and the local-AI / usage helpers. Runs last (it wipes job
// history) and leaves the profile, answers and settings in place.
import { join } from "node:path";

export default async function (t) {
  const { ctx, ext, extId, base, msg, store, waitFor, check, sleep, shots, aiCalls } = t;

  // --- AI privacy guard: contact details never reach the AI -----------------
  await ext.evaluate(async (baseUrl) => {
    const { settings = {}, profile = {} } = await chrome.storage.local.get(["settings", "profile"]);
    await chrome.storage.local.set({
      settings: {
        ...settings,
        llmMode: "draft",
        aiProvider: "custom",
        customBaseUrl: baseUrl,
        models: { ...(settings.models ?? {}), custom: "mock-model" },
        // Earlier suites may have left tabs open; make room for ours.
        maxOpenTabs: 20,
        concurrency: 2,
      },
      profile: {
        ...profile,
        street: "12 Byron Lane",
        postalCode: "78701",
        resumeText: "Ada Lovelace\nAustin, TX 78701 | ada@example.com | (512) 555-0100\n\nEXPERIENCE\nAnalytical Engines: rebuilt the billing pipeline in Go.",
      },
    });
  }, `${base}/v1`);
  let s = await store();
  check(s.settings.aiRedact !== false, "privacy guard is on by default");

  const before = aiCalls.length;
  const url = `${base}/ai.html?privacy=1`;
  await msg({ type: "addJobs", urls: [url], start: true });
  s = await waitFor("privacy AI job ready", (s) => s.jobs?.find((j) => j.url === url)?.status === "ready_to_submit", 30000);
  const draft = aiCalls.slice(before).find((c) => /Describe a project/.test(JSON.stringify(c.messages)));
  const sent = JSON.stringify(draft?.messages ?? "");
  check(!!draft && s.jobs.find((j) => j.url === url).aiDrafted === 1, "AI drafted an answer with the guard on");
  check(!sent.includes("ada@example.com"), "AI prompt has no email address");
  check(!sent.includes("555-0100") && !sent.includes("12 Byron Lane") && !sent.includes("78701"), "AI prompt has no phone, street or postal code");
  check(sent.includes("[email]") && sent.includes("[phone]") && /Analytical Engines/.test(sent), "AI prompt still has the (scrubbed) resume and work history");

  // --- requests today + local model detection --------------------------------
  const usage = await msg({ type: "getAiUsage" });
  check((usage?.counts?.custom ?? 0) >= 1, `requests today counted (custom: ${usage?.counts?.custom})`);
  const t0 = Date.now();
  const local = await msg({ type: "detectLocalAi" });
  check(typeof local?.ollama?.reachable === "boolean" && typeof local?.lmstudio?.reachable === "boolean" && Date.now() - t0 < 4000, `local AI probe answered in ${Date.now() - t0} ms (ollama: ${local?.ollama?.reachable}, lmstudio: ${local?.lmstudio?.reachable})`);

  // --- AI setup helpers on the options page (separate tab, closed unsaved) ---
  {
    const page = await ctx.newPage();
    await page.goto(`chrome-extension://${extId}/options.html#ai`);
    await page.waitForSelector("#ai-setup .provider");
    const badges = await page.locator("#ai-setup .provider .pill").allInnerTexts();
    check(badges.join("|") === "Easiest free start|Most private|Best quality (paid)", `recommended-path badges (${badges.join(", ")})`);
    check(await page.locator("#ai-redact").isChecked(), "AI section shows the privacy guard, checked");
    await page.click('#ai-setup [data-provider="gemini"]');
    await page.fill("#ai-setup input[type=password]", '  "gsk_abcdefghijklmnopqrstuvwxyz0123456789"\n');
    const key = await page.inputValue("#ai-setup input[type=password]");
    const hint = await page.locator("#ai-key-hint").innerText();
    check(key === "gsk_abcdefghijklmnopqrstuvwxyz0123456789", "pasted key was stripped of spaces and quotes");
    check(/looks like a Groq key/.test(hint), `key shape warning (${hint})`);
    check(/Requests today: \d+/.test(await page.locator("#ai-usage").innerText()), "requests-today counter shown");
    await page.locator("#ai").screenshot({ path: join(shots, "ai-setup.png") }).catch(() => {});
    await page.close(); // unsaved: nothing above was written
  }

  // --- Privacy panel ----------------------------------------------------------
  const page = await ctx.newPage();
  let promptAnswer = "nope";
  page.on("dialog", (d) => void (d.type() === "prompt" ? d.accept(promptAnswer) : d.accept()).catch(() => {}));
  await page.goto(`chrome-extension://${extId}/options.html#privacy`);
  await page.waitForSelector('#privacy-panel [data-count="jobs"]');
  const num = async (k) => Number(await page.locator(`#privacy-panel [data-count="${k}"]`).innerText());
  const jobsShown = await num("jobs");
  s = await store();
  check(jobsShown > 0 && jobsShown === s.jobs.length, `inventory counts jobs (${jobsShown})`);
  check((await num("answers")) > 0 && (await num("ops")) > 0, "inventory counts saved answers and activity log");
  check((await page.locator("#privacy-inventory tr").count()) >= 5, "inventory lists stored items with sizes");
  check(!/^0 KB$/.test(await page.locator('#privacy-panel [data-count="bytes"]').innerText()), "inventory shows a total size");
  const aiLine = await page.locator("#privacy-ai").innerText();
  check(/Other \(OpenAI-compatible\)/.test(aiLine) && /removed first/.test(aiLine), `"where your data lives" names the AI provider and the guard (${aiLine.slice(0, 80)}…)`);
  check((await page.locator("#privacy-redact").isChecked()) === true, "privacy panel mirrors the guard setting");
  await page.locator("#privacy").screenshot({ path: join(shots, "privacy-panel.png") }).catch(() => {});

  // Clear application history: jobs/needs/ops/intel go, profile/answers/settings stay.
  await page.click("#privacy-clear-history");
  s = await waitFor("history cleared", (s) => !s.jobs?.length && !s.needs?.length && !s.ops?.length && !s.intel?.length, 10000);
  check(s.profile?.firstName === "Ada" && s.profile?.email === "ada@example.com", "profile survived clearing history");
  check(s.answers?.length > 0 && s.settings?.llmMode === "draft" && s.settings?.onboarded === true, "saved answers and settings survived");
  await page.waitForFunction(() => /history cleared/i.test(document.getElementById("privacy-result")?.textContent ?? ""), null, { timeout: 5000 }).catch(() => {});
  check(/history cleared/i.test(await page.locator("#privacy-result").innerText()), "panel reported the result");
  await page.waitForFunction(() => document.querySelector('#privacy-panel [data-count="jobs"]')?.textContent === "0", null, { timeout: 5000 }).catch(() => {});
  check((await num("jobs")) === 0, "inventory refreshed to 0 jobs");
  await sleep(500);
  check(!ctx.pages().some((p) => p.url().includes("privacy=1")), "job tabs the extension opened were closed");

  // Forget AI keys: keys go, everything else stays.
  await ext.evaluate(async () => {
    const { settings } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: { ...settings, apiKeys: { gemini: "AIzaSyD-1234567890abcdefghijklmnopqrstu" } } });
  });
  await page.click("#privacy-forget-keys");
  s = await waitFor("keys forgotten", (s) => Object.keys(s.settings?.apiKeys ?? {}).length === 0, 10000);
  check(s.settings.aiProvider === "custom" && s.profile?.firstName === "Ada", "forgetting keys kept provider choice and profile");
  await page.waitForSelector('#privacy-panel [data-count="jobs"]', { timeout: 10000 });
  await page.waitForFunction(() => /Removed 1 AI key/.test(document.getElementById("privacy-result")?.textContent ?? ""), null, { timeout: 5000 }).catch(() => {});
  check(/Removed 1 AI key/.test(await page.locator("#privacy-result").innerText()), "page reloaded and reported the removed key");

  // Erase everything needs ERASE typed: a wrong answer erases nothing.
  promptAnswer = "nope";
  await page.click("#privacy-erase");
  await page.waitForFunction(() => /Nothing erased/.test(document.getElementById("privacy-result")?.textContent ?? ""), null, { timeout: 5000 }).catch(() => {});
  s = await store();
  check(/Nothing erased/.test(await page.locator("#privacy-result").innerText()) && s.profile?.firstName === "Ada", "erase without typing ERASE does nothing");
  await page.close();
}
