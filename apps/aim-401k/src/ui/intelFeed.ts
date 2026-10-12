// Tracker → Intel feed (recent inbox/sheet signals, manual assignment).
// OWNER: Intel agent. Rendered into #intel-feed on the tracker page.
import { api } from "../shared/api";
import { copy, type CopyKey } from "../shared/copy";
import { normalizeSettings, STORAGE_KEYS } from "../shared/defaults";
import type { ToPages } from "../shared/messages";
import type { IntelItem, IntelKind, IntelSource, Job, JobStatus, Settings } from "../shared/types";
import { h, send, toast } from "./common";

const SHOW = 8;
const KIND_COLOR: Record<IntelKind, string> = {
  received: "var(--muted)",
  interview: "var(--accent)",
  assessment: "var(--warn)",
  offer: "var(--ok)",
  rejection: "var(--danger)",
  other: "var(--muted)",
};
const SOURCE_LABEL: Record<IntelSource, string> = { "gmail-tab": "Gmail", "outlook-tab": "Outlook", "gmail-api": "Gmail API", sheet: "Sheet" };

let box: HTMLElement | null = null;
let items: IntelItem[] = [];
let jobs: Job[] = [];
let settings: Settings = normalizeSettings(undefined);
let expanded = false;
let wired = false;
let pending: ReturnType<typeof setTimeout> | null = null;
/** Row whose job picker is open, so live updates don't close it mid-choice. */
let picking: string | null = null;

const t = (key: CopyKey, vars?: Record<string, string | number>) => copy(settings, key, vars);
const day = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const jobLabel = (j: Job) => [j.company, j.title].filter(Boolean).join(" · ") || j.url.replace(/^https?:\/\//, "").slice(0, 50);

function jobPicker(item: IntelItem): HTMLSelectElement {
  const sel = h("select", { style: "width:auto;max-width:260px;font-size:12px;padding:2px 4px" });
  sel.append(h("option", { value: "", textContent: t("intel.feed.assign"), disabled: true, selected: !item.jobId }));
  const sorted = [...jobs].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const j of sorted) sel.append(h("option", { value: j.id, textContent: jobLabel(j).slice(0, 70), selected: j.id === item.jobId }));
  if (item.jobId) sel.append(h("option", { value: "__none", textContent: t("intel.feed.unassign") }));
  sel.addEventListener("focus", () => (picking = item.id));
  sel.addEventListener("blur", () => {
    picking = null;
    schedule(); // catch up on updates skipped while the picker was open
  });
  sel.addEventListener("change", async () => {
    picking = null;
    const jobId = sel.value === "__none" ? null : sel.value;
    const res = await send<{ ok: boolean; item?: IntelItem; status?: JobStatus }>({ type: "intelAssign", intelId: item.id, jobId });
    if (!res?.ok) return toast("Couldn't assign that email");
    const job = jobs.find((j) => j.id === jobId);
    toast(job ? `${t("intel.feed.assigned", { company: job.company || jobLabel(job) })}${res.status ? ` · ${t("intel.feed.statusApplied")}` : ""}` : "Unassigned");
  });
  return sel;
}

function row(item: IntelItem): HTMLElement {
  const job = item.jobId ? jobs.find((j) => j.id === item.jobId) : undefined;
  const kind = h("span", { className: "pill", textContent: t(`intel.kind.${item.kind}` as CopyKey), style: `color:${KIND_COLOR[item.kind]};border-color:currentColor` });
  const who = item.company || item.from || item.fromEmail || "?";
  const text = h(
    "span",
    { style: "flex:1;min-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", title: `${item.from}${item.fromEmail ? ` <${item.fromEmail}>` : ""}\n${item.subject}\n${item.snippet}` },
    h("b", { textContent: who }),
    ` · ${item.subject || item.snippet || "(no subject)"}`,
  );
  const target = h("span", { className: "row", style: "gap:6px;flex-wrap:nowrap" });
  if (job && picking !== item.id) {
    const change = h("button", { type: "button", textContent: t("intel.feed.change"), style: "font-size:11px;padding:1px 6px" });
    change.addEventListener("click", () => {
      picking = item.id;
      const sel = jobPicker(item);
      target.replaceChildren(sel);
      sel.focus();
    });
    target.append(h("span", { className: "muted", textContent: `→ ${jobLabel(job)}`, style: "max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }), change);
  } else {
    target.append(jobPicker(item));
  }
  const el = h(
    "div",
    { className: "intel-row", style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 0;border-top:1px solid var(--line);font-size:13px" },
    h("span", { className: "muted", textContent: day(item.receivedAt), style: "width:48px;flex:none" }),
    kind,
    text,
    target,
    h("span", { className: "muted", textContent: SOURCE_LABEL[item.source] ?? item.source, style: "flex:none" }),
  );
  el.dataset.intelId = item.id;
  el.dataset.kind = item.kind;
  if (item.jobId) el.dataset.jobId = item.jobId;
  return el;
}

function draw(): void {
  if (!box) return;
  if (!items.length) {
    const off = !settings.intel.gmailTab && !settings.intel.outlookTab && !settings.intel.gmailApi;
    const settingsLink = h("a", { href: "#", textContent: "Settings" });
    settingsLink.addEventListener("click", (e) => {
      e.preventDefault();
      void api.tabs.create({ url: `${api.runtime.getURL("options.html")}#intel` });
    });
    box.replaceChildren(h("div", { className: "muted", style: "margin:0 0 12px" }, t(off ? "intel.feed.off" : "intel.feed.empty"), " ", settingsLink));
    return;
  }
  const unassigned = items.filter((i) => !i.jobId).length;
  const shown = expanded ? items : items.slice(0, SHOW);
  const list = h("div", {}, ...shown.map(row));
  const more = items.length > SHOW ? h("button", { type: "button", textContent: expanded ? t("intel.feed.less") : t("intel.feed.more", { n: items.length - SHOW }), style: "margin-top:6px" }) : "";
  if (more)
    more.addEventListener("click", () => {
      expanded = !expanded;
      draw();
    });
  box.replaceChildren(
    h(
      "div",
      { className: "card", style: "margin-bottom:16px;padding:12px 16px" },
      h("div", { className: "row spread" }, h("b", { textContent: t("intel.feed.title") }), h("span", { className: "muted", textContent: t("intel.feed.count", { n: items.length, u: unassigned }) })),
      list,
      more,
    ),
  );
}

async function reload(): Promise<void> {
  const raw = (await api.storage.local.get([STORAGE_KEYS.intel, STORAGE_KEYS.jobs, STORAGE_KEYS.settings])) as { intel?: IntelItem[]; jobs?: Job[]; settings?: unknown };
  items = raw.intel ?? [];
  jobs = raw.jobs ?? [];
  settings = normalizeSettings(raw.settings);
  if (!picking) draw();
}

function schedule(): void {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    void reload();
  }, 60);
}

export function renderIntelFeed(el: HTMLElement): void {
  box = el;
  if (!wired) {
    wired = true;
    // Live: the background broadcasts new items; storage covers jobs/settings edits.
    api.runtime.onMessage.addListener((raw: unknown) => {
      const msg = raw as ToPages;
      if (msg?.type === "intel" && Array.isArray(msg.items)) {
        items = msg.items;
        if (!picking) draw();
      }
      return undefined; // never answer: other pages' messages are meant for the background
    });
    api.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && (changes[STORAGE_KEYS.intel] || changes[STORAGE_KEYS.jobs] || changes[STORAGE_KEYS.settings])) schedule();
    });
  }
  schedule();
}
