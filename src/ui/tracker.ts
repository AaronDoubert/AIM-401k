import { extractUrls, jobsToCsv } from "../core/csv";
import { api } from "../shared/api";
import { copy, type CopyKey } from "../shared/copy";
import { normalizeSettings, STORAGE_KEYS } from "../shared/defaults";
import type { Job, JobStatus, Settings } from "../shared/types";
import { BOARD_COLUMNS, type BoardColumn, callsigns, dropStatus, groupForBoard } from "./board";
import { $, applyCopy, download, h, JOB_STATUSES, pad, send, statusLabel, toast } from "./common";
import { renderIntelFeed } from "./intelFeed";
import { appliedCount, stageCounts, stageStrip, STAGES } from "./stages";
import { companyName } from "../shared/display";
import { openSheetImport } from "./sheetImport";

let jobs: Job[] = [];
let settings: Settings = normalizeSettings(undefined);
let editing = false;
let dragging: string | null = null;
let signs = new Map<string, number>();

const c = (key: CopyKey, vars?: Record<string, string | number>) => copy(settings, key, vars);
const fmt = (t: number | null) => (t ? new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—");
const tgt = (j: Job) => c("theme.tgt", { n: pad(signs.get(j.id) ?? 0, 4) });

// Per-viewer conveniences only; the page works the same without storage.
const pref = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode etc. */
    }
  },
};
let view: "table" | "board" = pref.get("aim.tracker.view") === "board" ? "board" : "table";
let lostOpen = pref.get("aim.board.lostOpen") === "1";

function renderStats(): void {
  const weekAgo = Date.now() - 7 * 86400_000;
  const strip = stageStrip(stageCounts(jobs), (k) => c(k));
  const week = appliedCount(jobs, weekAgo);
  strip.append(h("div", { className: "stage-aside", textContent: c("theme.tracker.week", { n: week }) }));
  $("#stats").replaceChildren(strip);
}

function statusSelect(j: Job): HTMLSelectElement {
  const status = h("select", { className: `pill s-${j.status}` });
  status.setAttribute("aria-label", "Status");
  for (const s of JOB_STATUSES) status.append(h("option", { value: s, textContent: statusLabel(settings, s) }));
  status.value = j.status;
  status.addEventListener("change", () => void send({ type: "updateJob", jobId: j.id, patch: { status: status.value as JobStatus } }));
  return status;
}

function jobLink(j: Job): HTMLElement {
  const text = j.title || j.url.replace(/^https?:\/\//, "").slice(0, 60) || j.company || "Untitled";
  // Spreadsheet rows may have no link; only real web links become anchors.
  if (!/^https?:\/\//i.test(j.url)) return h("span", { textContent: text });
  return h("a", { href: j.url, target: "_blank", rel: "noopener", textContent: text });
}

function row(j: Job): HTMLTableRowElement {
  const notes = h("textarea", { value: j.notes, placeholder: "Notes…" });
  notes.setAttribute("aria-label", "Notes");
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
  if (["running", "needs_you", "ready_to_submit"].includes(j.status)) act(c("theme.act.go"), () => void send({ type: "focusJob", jobId: j.id }));
  if (["saved", "failed", "skipped"].includes(j.status)) act(j.status === "saved" ? c("theme.act.start") : c("theme.act.retry"), () => void send({ type: "retryJob", jobId: j.id }));
  act(c("theme.act.delete"), () => confirm("Delete this job?") && void send({ type: "deleteJobs", jobIds: [j.id] }), "danger");

  const tr = h(
    "tr",
    {},
    h(
      "td",
      {},
      h("div", { className: "tgt", textContent: tgt(j) }),
      h("div", { className: "title" }, jobLink(j)),
      h("div", { className: "where", textContent: [companyName(j), j.location].filter(Boolean).join(" · ") }),
    ),
    h("td", {}, statusSelect(j), j.aiDrafted ? h("div", { className: "ai", textContent: c("theme.tracker.ai", { n: j.aiDrafted, s: j.aiDrafted === 1 ? "" : "s" }) }) : ""),
    h("td", { className: "date", textContent: fmt(j.appliedAt) }),
    h("td", { className: "src", textContent: j.ats }),
    h("td", { style: "min-width:180px" }, notes),
    h("td", {}, activity),
    h("td", {}, actions),
  );
  tr.dataset.jobId = j.id;
  tr.dataset.status = j.status;
  return tr;
}

function filtered(): Job[] {
  const q = $<HTMLInputElement>("#q").value.toLowerCase();
  const f = $<HTMLSelectElement>("#filter").value;
  return jobs
    .filter((j) => (f === "all" ? true : f === "active" ? ["running", "needs_you", "ready_to_submit", "queued"].includes(j.status) : j.status === f))
    .filter((j) => !q || `${j.company} ${j.title} ${j.notes} ${j.url}`.toLowerCase().includes(q))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function renderRows(): void {
  const list = filtered();
  const body = $("#rows");
  body.replaceChildren(...list.map(row));
  if (!list.length) body.append(h("tr", {}, h("td", { colSpan: 7, className: "muted empty", textContent: c("theme.tracker.empty") })));
}

// --- board view -----------------------------------------------------------------

function boardCard(j: Job): HTMLElement {
  const card = h(
    "article",
    { className: `bcard`, draggable: true, tabIndex: 0 },
    h("div", { className: "top" }, h("span", { className: "tgt", textContent: tgt(j) }), h("span", { textContent: j.ats.replace(/^(boards|jobs|careers)\./, "") })),
    h("div", { className: "co", textContent: companyName(j) || "—" }),
    h("div", { className: "ti" }, jobLink(j)),
    h(
      "div",
      { className: "meta" },
      h("span", { className: `pill s-${j.status}`, textContent: statusLabel(settings, j.status) }),
      h("span", { className: "when", textContent: fmt(j.appliedAt ?? j.updatedAt) }),
    ),
  );
  card.dataset.jobId = j.id;
  card.dataset.status = j.status;
  if (["running", "needs_you", "ready_to_submit"].includes(j.status)) {
    const go = h("button", { className: "go", type: "button", textContent: c("theme.act.go") });
    go.addEventListener("click", () => void send({ type: "focusJob", jobId: j.id }));
    card.append(go);
  }
  card.addEventListener("dragstart", (e) => {
    dragging = j.id;
    e.dataTransfer?.setData("text/plain", j.id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    card.classList.add("dragging");
    document.querySelectorAll(".bcol").forEach((col) => col.classList.add("dragging"));
  });
  card.addEventListener("dragend", () => {
    dragging = null;
    card.classList.remove("dragging");
    document.querySelectorAll(".bcol").forEach((col) => col.classList.remove("dragging", "over"));
  });
  return card;
}

function boardColumn(col: BoardColumn, list: Job[]): HTMLElement {
  // Empty columns, and Lost unless opened, shrink to a thin rail.
  const lostClosed = col.id === "lost" && !lostOpen;
  const rail = !list.length || lostClosed;
  const tone = STAGES.find((s) => s.id === col.id)?.tone ?? "status";
  const header = h("header", {}, h("span", { className: "t", textContent: c(col.title) }), h("span", { className: "n", textContent: String(list.length) }));
  const cards = h("div", { className: "cards" }, ...list.map(boardCard));
  const el = h("section", { className: `bcol ${rail ? "rail" : ""} ${col.id === "lost" && list.length ? "toggle" : ""} ${col.drop ? "" : "nodrop"}` }, header, cards);
  el.dataset.col = col.id;
  el.dataset.tone = tone;
  el.setAttribute("aria-label", `${c(col.title)} (${list.length})`);
  if (col.drop) el.title = c("theme.hint.drop");
  if (col.id === "lost" && list.length) {
    header.addEventListener("click", () => {
      lostOpen = !lostOpen;
      pref.set("aim.board.lostOpen", lostOpen ? "1" : "0");
      renderBoard();
    });
  }
  el.addEventListener("dragover", (e) => {
    const job = jobs.find((x) => x.id === dragging);
    if (!job || !dropStatus(job, col.id)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    el.classList.add("over");
  });
  el.addEventListener("dragleave", (e) => {
    if (!el.contains(e.relatedTarget as Node | null)) el.classList.remove("over");
  });
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    el.classList.remove("over");
    const id = e.dataTransfer?.getData("text/plain") || dragging;
    const job = jobs.find((x) => x.id === id);
    const status = job && dropStatus(job, col.id);
    if (!job || !status) return;
    // Optimistic move; storage.onChanged re-renders with the real state.
    job.status = status;
    renderBoard();
    toast(c("theme.toast.moved", { job: job.company || tgt(job), status: statusLabel(settings, status) }));
    void send({ type: "updateJob", jobId: job.id, patch: { status } });
  });
  return el;
}

function renderBoard(): void {
  const groups = groupForBoard(filtered());
  $("#board").replaceChildren(...BOARD_COLUMNS.map((col) => boardColumn(col, groups[col.id])));
}

function renderView(): void {
  $("#table-view").hidden = view !== "table";
  $("#board").hidden = view !== "board";
  $("#view-table").setAttribute("aria-pressed", String(view === "table"));
  $("#view-board").setAttribute("aria-pressed", String(view === "board"));
  if (view === "table") renderRows();
  else renderBoard();
}

function renderFilter(): void {
  const filter = $<HTMLSelectElement>("#filter");
  const cur = filter.value || "all";
  filter.replaceChildren(h("option", { value: "all", textContent: c("theme.filter.all") }), h("option", { value: "active", textContent: c("theme.filter.active") }));
  for (const s of JOB_STATUSES) filter.append(h("option", { value: s, textContent: statusLabel(settings, s) }));
  filter.value = cur;
}

async function load(): Promise<void> {
  const raw = (await api.storage.local.get([STORAGE_KEYS.jobs, STORAGE_KEYS.settings])) as { jobs?: Job[]; settings?: unknown };
  jobs = raw.jobs ?? [];
  signs = callsigns(jobs);
  const prevChud = settings.ui.chud;
  settings = normalizeSettings(raw.settings);
  applyCopy(settings);
  if (prevChud !== settings.ui.chud || !$<HTMLSelectElement>("#filter").options.length) renderFilter();
  $("#pause").textContent = settings.paused ? c("theme.resume") : c("theme.pause");
  $("#pause").classList.toggle("primary", settings.paused);
  renderStats();
  if (!editing && !dragging) renderView();
}

$("#filter").addEventListener("change", renderView);
$("#q").addEventListener("input", renderView);
$("#view-table").addEventListener("click", () => {
  view = "table";
  pref.set("aim.tracker.view", view);
  renderView();
});
$("#view-board").addEventListener("click", () => {
  view = "board";
  pref.set("aim.tracker.view", view);
  renderView();
});

async function add(start: boolean): Promise<void> {
  const urls = extractUrls($<HTMLTextAreaElement>("#urls").value);
  if (!urls.length) return toast(c("theme.toast.noUrls"));
  const n = await send<number>({ type: "addJobs", urls, start });
  $<HTMLTextAreaElement>("#urls").value = "";
  const k = urls.length - n;
  toast(c(start ? "theme.toast.armed" : "theme.toast.marked", { n, s: n === 1 ? "" : "s", dup: k > 0 ? c("theme.toast.dup", { k }) : "" }));
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
  const raw = (await api.storage.local.get(STORAGE_KEYS.settings)) as { settings?: unknown };
  await send({ type: "setPaused", paused: !normalizeSettings(raw.settings).paused });
});

api.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.jobs || changes.settings || changes.intel) renderIntelFeed($("#intel-feed"));
  void load();
});
renderIntelFeed($("#intel-feed"));
void load();
