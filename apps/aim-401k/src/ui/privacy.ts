// Settings → Privacy & data (what's stored, where data goes, wipe).
// OWNER: Privacy agent. Rendered into #privacy-panel on the options page.
//
// Deliberately plain: this is the part of the app people need to trust.
import { api } from "../shared/api";
import { copy, type CopyKey } from "../shared/copy";
import { normalizeSettings, STORAGE_KEYS } from "../shared/defaults";
import type { StorageReport, WipeResult } from "../shared/messages";
import { isLocalAi, preset } from "../shared/providers";
import type { Settings } from "../shared/types";
import { h, send } from "./common";

const FLASH = "aim401k.privacy.flash";

/** Friendly names for storage keys in the inventory. */
const KEY_LABEL: Record<string, string> = {
  profile: "Profile (incl. resume file)",
  answers: "Saved answers",
  jobs: "Tracked jobs",
  needs: "Open prompts",
  ops: "Activity log",
  intel: "Inbox intel",
  settings: "Settings and API keys",
  aiUsage: "AI requests today (counter)",
};

const COUNT_OF: Record<string, keyof StorageReport["counts"]> = { answers: "answers", jobs: "jobs", ops: "ops", intel: "intel" };

export function kb(bytes: number): string {
  if (!bytes) return "0 KB";
  if (bytes < 103) return "<0.1 KB";
  const v = bytes / 1024;
  return `${v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString()} KB`;
}

let mirrorListening = false;

export function renderPrivacy(box: HTMLElement): void {
  void draw(box);
}

async function draw(box: HTMLElement): Promise<void> {
  const raw = (await api.storage.local.get(STORAGE_KEYS.settings)) as { settings?: unknown };
  const settings = normalizeSettings(raw.settings);
  const t = (key: CopyKey, vars?: Record<string, string | number>) => copy(settings, key, vars);

  const result = h("div", { className: "muted status", id: "privacy-result", style: "margin-top:8px" });
  const showResult = (text: string, ok = true) => {
    result.textContent = text;
    result.className = `status ${ok ? "ok" : "bad"}`;
  };

  // --- where your data lives ------------------------------------------------
  const where = h(
    "div",
    { className: "card", id: "privacy-where" },
    h("h3", { textContent: t("privacy.heading"), style: "margin-top:0" }),
    h("p", {
      textContent:
        "Everything AIM-401k knows (your profile, resume file, saved answers, tracked jobs, settings and API keys) is stored in this browser's extension storage, on this computer.",
    }),
    h("p", { textContent: "AIM-401k has no servers, no accounts, no analytics and no telemetry. Data leaves this browser only in these cases:" }),
    h(
      "ol",
      { style: "margin:0;padding-left:20px;display:grid;gap:8px" },
      h("li", {}, h("b", { textContent: "Job sites, when you apply. " }), "What gets typed into their forms, and your resume file when a form asks for one. Nothing is submitted without your OK unless you turn on automatic submit."),
      aiItem(settings),
      h(
        "li",
        {},
        h("b", { textContent: "Google's Gmail API, " }),
        "only if you connected your own Google OAuth client under Inbox intel. Access is read-only. ",
        h("span", { className: "muted", textContent: settings.intel.gmailApi && settings.intel.gmailClientId ? "(Connected.)" : "(Not connected.)" }),
      ),
      h("li", {}, h("b", { textContent: "A published Google Sheet, " }), "fetched from the URL you give only when you click import."),
    ),
  );

  // --- AI privacy guard (mirrors the checkbox in the AI section) ------------
  const guard = h("input", { type: "checkbox", id: "privacy-redact", checked: settings.aiRedact });
  const guardNote = h("div", { className: "muted", id: "privacy-guard-note", style: "margin-top:4px", textContent: guardText(settings.aiRedact) });
  guard.addEventListener("change", async () => {
    guardNote.textContent = guardText(guard.checked);
    const twin = document.getElementById("ai-redact") as HTMLInputElement | null;
    if (twin) {
      // The AI section owns the setting on this page; flip it there so Save picks it up.
      if (twin.checked !== guard.checked) twin.click();
      showResult("Click Save to apply.", true);
      return;
    }
    const cur = normalizeSettings(((await api.storage.local.get(STORAGE_KEYS.settings)) as { settings?: unknown }).settings);
    await api.storage.local.set({ settings: { ...cur, aiRedact: guard.checked } as Settings });
    showResult("Saved.", true);
  });
  if (!mirrorListening) {
    mirrorListening = true;
    document.addEventListener("aim401k:ai-redact", (e) => {
      const on = !!(e as CustomEvent<boolean>).detail;
      const mine = document.getElementById("privacy-redact") as HTMLInputElement | null;
      if (mine) mine.checked = on;
      const note = document.getElementById("privacy-guard-note");
      if (note) note.textContent = guardText(on);
    });
  }
  const guardCard = h(
    "div",
    { className: "card", style: "margin-top:12px" },
    h("h3", { textContent: t("privacy.guard.heading"), style: "margin-top:0" }),
    h("label", { className: "f check" }, guard, "Redact contact details before sending to AI"),
    guardNote,
  );

  // --- inventory -------------------------------------------------------------
  const table = h("tbody", { id: "privacy-inventory" });
  const summary = h("div", { className: "row", style: "margin:8px 0;gap:16px" });
  const refresh = h("button", { type: "button", textContent: t("privacy.btn.refresh") });
  const loadReport = async () => {
    refresh.disabled = true;
    try {
      const rep = await send<StorageReport>({ type: "getStorageReport" });
      fillInventory(table, summary, rep);
    } catch (e) {
      table.replaceChildren(h("tr", {}, h("td", { className: "muted", textContent: `Couldn't read storage: ${String(e)}` })));
    }
    refresh.disabled = false;
  };
  refresh.addEventListener("click", () => void loadReport());
  const inventory = h(
    "div",
    { className: "card", style: "margin-top:12px" },
    h("div", { className: "row spread" }, h("h3", { textContent: t("privacy.inventory.heading"), style: "margin:0" }), refresh),
    summary,
    h("table", {}, table),
    h("div", { className: "muted", style: "margin-top:6px", textContent: "Sizes are approximate (the size of each item as JSON)." }),
  );

  // --- export / erase -------------------------------------------------------
  const exportBtn = h("button", { type: "button", id: "privacy-export", textContent: t("privacy.btn.export") });
  exportBtn.addEventListener("click", () => {
    const btn = document.getElementById("export");
    if (btn) btn.click();
    else showResult("Use Backup → Export on this page.", false);
  });

  const clearBtn = h("button", { type: "button", id: "privacy-clear-history", textContent: t("privacy.btn.clearHistory") });
  clearBtn.addEventListener("click", async () => {
    if (!confirm(t("privacy.confirm.clearHistory"))) return;
    clearBtn.disabled = true;
    try {
      const res = await send<WipeResult>({ type: "wipeAll", keep: ["profile", "answers", "settings"] });
      showResult(t("privacy.done.clearHistory", { tabs: res.closedTabs }));
    } catch (e) {
      showResult(t("privacy.done.failed", { error: String(e) }), false);
    }
    clearBtn.disabled = false;
    await loadReport();
  });

  const forgetBtn = h("button", { type: "button", id: "privacy-forget-keys", className: "danger", textContent: t("privacy.btn.forgetKeys") });
  forgetBtn.addEventListener("click", async () => {
    if (!confirm(t("privacy.confirm.forgetKeys"))) return;
    try {
      const res = await send<{ removed: number }>({ type: "forgetAiKeys" });
      reloadWith(t("privacy.done.forgetKeys", { n: res.removed }));
    } catch (e) {
      showResult(t("privacy.done.failed", { error: String(e) }), false);
    }
  });

  const eraseBtn = h("button", { type: "button", id: "privacy-erase", className: "danger", textContent: t("privacy.btn.erase") });
  eraseBtn.addEventListener("click", async () => {
    if (!confirm(t("privacy.confirm.erase"))) return;
    const typed = prompt(t("privacy.confirm.eraseType"), "");
    if (typed == null) return;
    if (typed.trim() !== "ERASE") return showResult(t("privacy.done.eraseCancelled"), false);
    try {
      await send<WipeResult>({ type: "wipeAll", keep: [] });
      // Page-side memory too (spreadsheet mappings + published-sheet links, view prefs).
      // Extension pages share one origin, so this clears it for every page.
      try {
        localStorage.clear();
      } catch {
        /* storage blocked: nothing stored there either */
      }
      reloadWith(t("privacy.done.erase"));
    } catch (e) {
      showResult(t("privacy.done.failed", { error: String(e) }), false);
    }
  });

  const actions = h(
    "div",
    { className: "card", style: "margin-top:12px" },
    h("h3", { textContent: t("privacy.actions.heading"), style: "margin-top:0" }),
    h("div", { className: "row" }, exportBtn, clearBtn, forgetBtn, eraseBtn),
    h("div", {
      className: "muted",
      style: "margin-top:6px",
      textContent:
        "Clearing history keeps your profile, saved answers and settings. Forgetting AI keys keeps everything else. Erasing everything also removes your profile, resume, answers and settings. Removing the add-on from Firefox deletes all of it too.",
    }),
    result,
  );

  box.replaceChildren(where, guardCard, inventory, actions);
  showFlash(result);
  await loadReport();
}

function guardText(on: boolean): string {
  return on
    ? "On: your email, phone, street address and postal code are left out, and email addresses and phone numbers in your resume text and saved answers are replaced with [email] and [phone]. The resume file itself is never sent to AI."
    : "Off: contact details are sent to the AI along with the rest of your profile. The resume file itself is never sent to AI.";
}

/** The "your AI provider" line, with the provider's name and exactly what's sent. */
function aiItem(s: Settings): HTMLLIElement {
  const p = preset(s.aiProvider);
  const off = s.llmMode === "off" && !s.intel.useAi;
  const local = isLocalAi(s.aiProvider, s.customBaseUrl);
  const where = off ? "AI is off, so nothing is sent to any AI provider. If you turn it on:" : local ? `${p.name}, which runs on this computer:` : `${p.name}:`;
  const sent =
    "your profile facts, your resume text, your saved answers, the job description and the question being answered. Reading a resume with AI sends the resume text. Email classification sends the sender, subject and preview of job emails the keyword rules couldn't place.";
  const guard = s.aiRedact
    ? " Contact details (email, phone, street address, postal code) are removed first (privacy guard on)."
    : " Contact details are included (privacy guard off).";
  const after = local
    ? " Nothing leaves this computer."
    : " Free tiers may use your prompts to train or improve their models; check the provider's terms.";
  return h(
    "li",
    { id: "privacy-ai" },
    h("b", { textContent: "Your AI provider, " }),
    "only when AI drafting, resume reading or email classification is on. ",
    h("b", { textContent: where }),
    ` ${sent}${guard}${off ? "" : after}`,
  );
}

function fillInventory(table: HTMLElement, summary: HTMLElement, rep: StorageReport): void {
  const total = Object.values(rep.bytes).reduce((a, b) => a + b, 0);
  const keys = Object.keys(rep.bytes).sort((a, b) => (rep.bytes[b] ?? 0) - (rep.bytes[a] ?? 0));
  table.replaceChildren(
    ...keys.map((k) => {
      const countKey = COUNT_OF[k];
      const n = countKey ? rep.counts[countKey] : null;
      const extra = k === "profile" ? (rep.hasResume ? " · resume file saved" : " · no resume file") : n != null ? ` · ${n}` : "";
      const tr = h("tr", {}, h("td", { textContent: `${KEY_LABEL[k] ?? k}${extra}` }), h("td", { textContent: kb(rep.bytes[k] ?? 0), style: "text-align:right;white-space:nowrap" }));
      tr.dataset.key = k;
      return tr;
    }),
  );
  if (!keys.length) table.append(h("tr", {}, h("td", { className: "muted", textContent: "Nothing stored." })));
  const stat = (label: string, key: string, value: number | string) => {
    const b = h("b", { textContent: String(value) });
    b.dataset.count = key;
    return h("span", {}, `${label}: `, b);
  };
  summary.replaceChildren(
    stat("Total", "bytes", kb(total)),
    stat("Jobs", "jobs", rep.counts.jobs),
    stat("Saved answers", "answers", rep.counts.answers),
    stat("Activity log", "ops", rep.counts.ops),
    stat("Inbox intel", "intel", rep.counts.intel),
    stat("Resume file", "resume", rep.hasResume ? "yes" : "no"),
    stat("AI provider", "ai", rep.aiProvider ?? "off"),
  );
}

/** Reload so the options page drops its in-memory copy of what was just deleted. */
function reloadWith(message: string): void {
  try {
    sessionStorage.setItem(FLASH, message);
  } catch {
    /* fine: no message after reload */
  }
  location.hash = "#privacy";
  location.reload();
}

function showFlash(result: HTMLElement): void {
  let msg: string | null = null;
  try {
    msg = sessionStorage.getItem(FLASH);
    sessionStorage.removeItem(FLASH);
  } catch {
    /* ignore */
  }
  if (!msg) return;
  result.textContent = msg;
  result.className = "status ok";
  result.closest("section")?.scrollIntoView();
}
