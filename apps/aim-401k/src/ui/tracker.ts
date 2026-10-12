import { extractUrls, jobsToCsv } from "../core/csv";
import { api } from "../shared/api";
import { DEFAULT_SETTINGS, STORAGE_KEYS } from "../shared/defaults";
import type { Job, JobStatus, Settings } from "../shared/types";
import { $, download, h, send, STATUS_LABEL, toast } from "./common";
import { renderIntelFeed } from "./intelFeed";
import { openSheetImport } from "./sheetImport";

const STATUSES = Object.keys(STATUS_LABEL) as JobStatus[];
let jobs: Job[] = [];
let editing = false;

const fmt = (t: number | null) => (t ? new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—");

function renderStats(): void {
  const count = (pred: (j: Job) => boolean) => jobs.filter(pred).length;
  const weekAgo = Date.now() - 7 * 86400_000;
  const items: [string, number][] = [
    ["Applied", count((j) => ["submitted", "interviewing", "offer", "rejected"].includes(j.status))],
    ["This week", count((j) => !!j.appliedAt && j.appliedAt > weekAgo)],
    ["Need you", count((j) => j.status === "needs_you" || j.status === "ready_to_submit")],
    ["In progress", count((j) => j.status === "running")],
    ["Queued", count((j) => j.status === "queued")],
    ["Interviewing", count((j) => j.status === "interviewing")],
    ["Offers", count((j) => j.status === "offer")],
  ];
  $("#stats").replaceChildren(...items.map(([k, v]) => h("div", { className: "stat" }, h("b", { textContent: String(v) }), h("span", { textContent: k }))));
}

function row(j: Job): HTMLTableRowElement {
  const status = h("select");
  for (const s of STATUSES) status.append(h("option", { value: s, textContent: STATUS_LABEL[s] }));
  status.value = j.status;
  status.className = `pill s-${j.status}`;
  status.addEventListener("change", () => void send({ type: "updateJob", jobId: j.id, patch: { status: status.value as JobStatus } }));

  const notes = h("textarea", { value: j.notes, placeholder: "Notes…" });
  notes.addEventListener("focus", () => (editing = true));
  notes.addEventListener("blur", () => {
    editing = false;
    if (notes.value !== j.notes) void send({ type: "updateJob", jobId: j.id, patch: { notes: notes.value } });
  });

  const last = j.log[j.log.length - 1];
  const activity = h("details", {}, h("summary", { textContent: last ? last.msg.slice(0, 60) : "—" }));
  for (const e of [...j.log].reverse().slice(0, 15)) activity.append(h("div", { className: "log", textContent: `${new Date(e.t).toLocaleString()} — ${e.msg}` }));

  const actions = h("div", { className: "row" });
  const act = (label: string, fn: () => void, cls = "") => {
    const b = h("button", { textContent: label, className: cls });
    b.addEventListener("click", fn);
    actions.append(b);
  };
  if (["running", "needs_you", "ready_to_submit"].includes(j.status)) act("Go to tab", () => void send({ type: "focusJob", jobId: j.id }));
  if (["saved", "failed", "skipped"].includes(j.status)) act(j.status === "saved" ? "Start" : "Retry", () => void send({ type: "retryJob", jobId: j.id }));
  act("Delete", () => confirm("Delete this job?") && void send({ type: "deleteJobs", jobIds: [j.id] }), "danger");

  return h(
    "tr",
    {},
    h(
      "td",
      {},
      h("div", { className: "title" }, h("a", { href: j.url, target: "_blank", rel: "noopener", textContent: j.title || j.url.replace(/^https?:\/\//, "").slice(0, 60) })),
      h("div", { className: "muted", textContent: [j.company, j.location].filter(Boolean).join(" · ") }),
    ),
    h("td", {}, status, j.aiDrafted ? h("div", { className: "muted", textContent: `${j.aiDrafted} AI answer(s)` }) : ""),
    h("td", { textContent: fmt(j.appliedAt) }),
    h("td", { className: "muted", textContent: j.ats }),
    h("td", { style: "min-width:180px" }, notes),
    h("td", {}, activity),
    h("td", {}, actions),
  );
}

function renderRows(): void {
  const q = $<HTMLInputElement>("#q").value.toLowerCase();
  const f = $<HTMLSelectElement>("#filter").value;
  const list = jobs
    .filter((j) => (f === "all" ? true : f === "active" ? ["running", "needs_you", "ready_to_submit", "queued"].includes(j.status) : j.status === f))
    .filter((j) => !q || `${j.company} ${j.title} ${j.notes} ${j.url}`.toLowerCase().includes(q))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const body = $("#rows");
  body.replaceChildren(...list.map(row));
  if (!list.length) body.append(h("tr", {}, h("td", { colSpan: 7, className: "muted", textContent: "No jobs yet. Paste some URLs above." })));
}

async function load(): Promise<void> {
  const raw = (await api.storage.local.get([STORAGE_KEYS.jobs, STORAGE_KEYS.settings])) as { jobs?: Job[]; settings?: Settings };
  jobs = raw.jobs ?? [];
  $("#pause").textContent = { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) }.paused ? "Resume" : "Pause";
  renderStats();
  if (!editing) renderRows();
}

const filter = $<HTMLSelectElement>("#filter");
filter.append(h("option", { value: "all", textContent: "All statuses" }), h("option", { value: "active", textContent: "Active" }));
for (const s of STATUSES) filter.append(h("option", { value: s, textContent: STATUS_LABEL[s] }));
filter.addEventListener("change", renderRows);
$("#q").addEventListener("input", renderRows);

async function add(start: boolean): Promise<void> {
  const urls = extractUrls($<HTMLTextAreaElement>("#urls").value);
  if (!urls.length) return toast("No URLs found");
  const n = await send<number>({ type: "addJobs", urls, start });
  $<HTMLTextAreaElement>("#urls").value = "";
  toast(`${start ? "Queued" : "Saved"} ${n} new job${n === 1 ? "" : "s"}${n < urls.length ? ` (${urls.length - n} already tracked)` : ""}`);
}
$("#queue").addEventListener("click", () => void add(true));
$("#save").addEventListener("click", () => void add(false));
$("#start-saved").addEventListener("click", async () => {
  for (const j of jobs.filter((x) => x.status === "saved")) await send({ type: "retryJob", jobId: j.id });
});
$("#clear-done").addEventListener("click", () => {
  const ids = jobs.filter((j) => j.status === "skipped" || j.status === "failed").map((j) => j.id);
  if (ids.length && confirm(`Remove ${ids.length} skipped/failed jobs?`)) void send({ type: "deleteJobs", jobIds: ids });
});
$("#import-sheet").addEventListener("click", () => openSheetImport());
$("#csv").addEventListener("click", () => download(`applications-${new Date().toISOString().slice(0, 10)}.csv`, jobsToCsv(jobs), "text/csv"));
$("#settings").addEventListener("click", () => void api.runtime.openOptionsPage());
$("#pause").addEventListener("click", async () => {
  const raw = (await api.storage.local.get(STORAGE_KEYS.settings)) as { settings?: Settings };
  await send({ type: "setPaused", paused: !{ ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) }.paused });
});

api.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.jobs || changes.settings)) renderIntelFeed($("#intel-feed"));
void load();
});
renderIntelFeed($("#intel-feed"));
void load();
