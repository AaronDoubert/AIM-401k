// Spreadsheet import (CSV / TSV / XLSX / pasted cells / a published Google
// Sheet link) with a column-mapping preview, plus .xlsx export. Opened from
// the tracker's #import-sheet button.
//
// Everything is parsed on this device. The only network request is the
// optional "Fetch" of a sheet link the user pastes, made when they click.
// Cell contents are only ever rendered with textContent.

import {
  autoMap,
  columnLabel,
  detectHeaderRow,
  distinctStatuses,
  exportJobsXlsx,
  FIELDS,
  type Field,
  type ImportPlan,
  type JobPatch,
  looksLikeZip,
  type Mapping,
  parseCsv,
  readXlsx,
  rowsToJobs,
  type SheetData,
  sheetCsvUrl,
  sheetWidth,
} from "../core/sheet";
import { api } from "../shared/api";
import { copy, type CopyKey } from "../shared/copy";
import { normalizeSettings, STORAGE_KEYS } from "../shared/defaults";
import type { Job, JobStatus, Settings } from "../shared/types";
import { truncate } from "../shared/util";
import { h, send, toast } from "./common";

const ID = "sheet-import";
const PREVIEW_ROWS = 8;
const MAX_PREVIEW_COLS = 40;
const MAX_STATUS_VALUES = 40;
const MEMORY_KEY = "aim401k.sheetImport.v1";
const STATUS_CHOICES: JobStatus[] = ["saved", "queued", "submitted", "interviewing", "offer", "rejected", "skipped"];

interface Source {
  /** Display name (file name, "pasted cells", link host). */
  name: string;
  /** Key for the remembered mapping (file name, "pasted", the link). */
  key: string;
  sheets: SheetData[];
}

interface View extends Source {
  sheetIdx: number;
  /** -1 = the sheet has no header row. */
  headerRow: number;
  mapping: Mapping;
  statusMap: Record<string, JobStatus>;
  queueSaved: boolean;
  existing: Job[];
}

interface Memory {
  sheet: string;
  headerRow: number;
  fields: Partial<Record<Field, { col: number; header: string }>>;
  statusMap: Record<string, JobStatus>;
  queueSaved: boolean;
  t: number;
}

let settings: Settings = normalizeSettings(undefined);
let root: HTMLElement | null = null;
let body: HTMLElement;
let foot: HTMLElement;
let view: View | null = null;
let returnFocus: HTMLElement | null = null;

const t = (key: CopyKey, vars?: Record<string, string | number>) => copy(settings, key, vars);
const statusName = (s: JobStatus) => copy(false, `status.${s}` as CopyKey);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// --- entry -------------------------------------------------------------------

export function openSheetImport(): void {
  if (root) {
    root.querySelector<HTMLElement>("input, textarea, select, button")?.focus();
    return;
  }
  returnFocus = document.activeElement as HTMLElement | null;
  injectStyle();
  root = h("div", { id: ID });
  document.body.append(root);
  document.addEventListener("keydown", onKey);
  void (async () => {
    settings = await loadSettings();
    const title = h("h2", { id: `${ID}-title`, textContent: t("sheet.title") });
    const close = h("button", { type: "button", className: "si-x", textContent: "×", title: t("sheet.btn.close") });
    close.setAttribute("aria-label", t("sheet.btn.close"));
    close.addEventListener("click", closeSheetImport);
    body = h("div", { className: "si-body" });
    foot = h("div", { className: "si-foot" });
    const panel = h("div", { className: "si-panel", role: "dialog" }, h("div", { className: "si-head" }, title, close), body, foot);
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", title.id);
    root?.append(panel);
    showSource();
  })();
}

export function closeSheetImport(): void {
  root?.remove();
  root = null;
  view = null;
  document.removeEventListener("keydown", onKey);
  returnFocus?.focus?.();
}

function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape" && root) {
    e.preventDefault();
    closeSheetImport();
  }
}

async function loadSettings(): Promise<Settings> {
  try {
    const raw = (await api.storage.local.get(STORAGE_KEYS.settings)) as { settings?: unknown };
    return normalizeSettings(raw.settings);
  } catch {
    return normalizeSettings(undefined);
  }
}

async function loadJobs(): Promise<Job[]> {
  const raw = (await api.storage.local.get(STORAGE_KEYS.jobs)) as { jobs?: Job[] };
  return raw.jobs ?? [];
}

// --- step 1: source --------------------------------------------------------------

let errorBox: HTMLElement;

function setError(msg: string): void {
  if (errorBox) errorBox.textContent = msg;
  setBusy(false);
}

function setBusy(on: boolean): void {
  root?.classList.toggle("busy", on);
  root?.querySelectorAll<HTMLButtonElement>(".si-source button").forEach((b) => (b.disabled = on));
  const status = root?.querySelector<HTMLElement>(".si-reading");
  if (status) status.textContent = on ? t("sheet.loading") : "";
}

function showSource(error = ""): void {
  view = null;
  errorBox = h("div", { id: `${ID}-error`, className: "si-error", role: "alert", textContent: error });

  const file = h("input", {
    type: "file",
    id: `${ID}-file`,
    className: "si-file",
    accept: ".csv,.tsv,.txt,.xlsx,.xlsm,text/csv,text/tab-separated-values,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  file.addEventListener("change", () => {
    const f = file.files?.[0];
    if (f) void readFile(f);
    file.value = "";
  });
  const pick = h("button", { type: "button", className: "primary", textContent: t("sheet.source.file") });
  pick.addEventListener("click", () => file.click());
  const drop = h(
    "div",
    { id: `${ID}-drop`, className: "si-drop si-source" },
    h("div", { className: "si-drop-title", textContent: t("sheet.source.drop") }),
    pick,
    file,
    h("div", { className: "si-reading si-muted" }),
    h("div", { className: "si-muted", textContent: t("sheet.source.fileHint") }),
  );
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    const f = e.dataTransfer?.files?.[0];
    if (f) void readFile(f);
  });

  const paste = h("textarea", { id: `${ID}-paste`, rows: 4, placeholder: "Company\tRole\tStatus\tDate applied\nAcme\tEngineer\tApplied\t9/14/2026" });
  const pasteGo = h("button", { type: "button", id: `${ID}-paste-go`, textContent: t("sheet.source.pasteBtn") });
  pasteGo.addEventListener("click", () => {
    const rows = parseCsv(paste.value);
    if (!rows.some((r) => r.some((c) => c.trim()))) return setError(t("sheet.err.empty"));
    void loaded({ name: "pasted cells", key: "pasted", sheets: [{ name: "Pasted", rows }] });
  });

  const url = h("input", { type: "url", id: `${ID}-url`, placeholder: "https://docs.google.com/spreadsheets/d/e/…/pub?output=csv" });
  const fetchBtn = h("button", { type: "button", id: `${ID}-fetch`, textContent: t("sheet.source.linkBtn") });
  fetchBtn.addEventListener("click", () => void fetchLink(url.value));
  url.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void fetchLink(url.value);
  });

  body.replaceChildren(
    h("div", { className: "si-muted", textContent: t("sheet.intro") }),
    errorBox,
    drop,
    h(
      "div",
      { className: "si-sources" },
      h(
        "div",
        { className: "si-card si-source" },
        h("h3", { textContent: t("sheet.source.paste") }),
        h("div", { className: "si-muted", textContent: t("sheet.source.pasteHint") }),
        paste,
        h("div", {}, pasteGo),
      ),
      h(
        "div",
        { className: "si-card si-source" },
        h("h3", { textContent: t("sheet.source.link") }),
        h("div", { className: "si-muted", textContent: t("sheet.source.linkHint") }),
        h("div", { className: "si-inline" }, url, fetchBtn),
        h("div", { className: "si-muted", textContent: t("sheet.source.linkNote") }),
      ),
    ),
  );

  const exportBtn = h("button", { type: "button", id: `${ID}-export`, textContent: t("sheet.btn.export") });
  exportBtn.addEventListener("click", () => void exportXlsx());
  const close = h("button", { type: "button", id: `${ID}-close`, textContent: t("sheet.btn.close") });
  close.addEventListener("click", closeSheetImport);
  foot.replaceChildren(exportBtn, h("div", { className: "si-grow" }), close);
  pick.focus();
}

function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes); // Excel "Unicode text"
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes); // older Excel CSV on Windows
  }
}

async function readFile(f: File): Promise<void> {
  setError("");
  setBusy(true);
  try {
    const ext = (f.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
    const bytes = new Uint8Array(await f.arrayBuffer());
    const oleBinary = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0; // legacy .xls
    if (oleBinary || ["xls", "xlsb", "numbers", "ods"].includes(ext)) return setError(t("sheet.err.type"));
    let sheets: SheetData[];
    if (looksLikeZip(bytes)) sheets = (await readXlsx(bytes)).sheets;
    else sheets = [{ name: f.name, rows: parseCsv(decodeText(bytes), ext === "tsv" ? "\t" : undefined) }];
    await loaded({ name: f.name, key: f.name, sheets });
  } catch (e) {
    setError(t("sheet.err.read", { why: message(e) }));
  }
}

async function fetchLink(raw: string): Promise<void> {
  setError("");
  const url = sheetCsvUrl(raw);
  if (!url) return setError(t("sheet.err.link"));
  setBusy(true);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { credentials: "omit", cache: "no-store", signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (/^\s*<(!doctype|html|head|body|\?xml)/i.test(text)) return setError(t("sheet.err.private"));
    const u = new URL(url);
    const name = u.hostname === "docs.google.com" ? "Google Sheet" : decodeURIComponent(u.pathname.split("/").pop() || u.hostname);
    await loaded({ name, key: url, sheets: [{ name, rows: parseCsv(text) }] });
  } catch (e) {
    setError(t("sheet.err.fetch", { why: ctrl.signal.aborted ? "timed out" : message(e) }));
  } finally {
    clearTimeout(timer);
  }
}

async function exportXlsx(): Promise<void> {
  const jobs = await loadJobs();
  const url = URL.createObjectURL(exportJobsXlsx(jobs, statusName));
  const a = h("a", { href: url, download: `applications-${new Date().toISOString().slice(0, 10)}.xlsx` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(t("sheet.toast.exported", { n: jobs.length }));
}

// --- remembered mappings (per file name, this browser only) ---------------------

function readMemory(): Record<string, Memory> {
  try {
    const raw = JSON.parse(localStorage.getItem(MEMORY_KEY) ?? "{}") as unknown;
    return raw && typeof raw === "object" ? (raw as Record<string, Memory>) : {};
  } catch {
    return {};
  }
}

function remember(v: View): void {
  try {
    const all = readMemory();
    const headers = headerCells(v);
    const fields: Memory["fields"] = {};
    for (const f of FIELDS) if (v.mapping[f] != null) fields[f] = { col: v.mapping[f]!, header: (headers[v.mapping[f]!] ?? "").trim() };
    all[v.key] = { sheet: v.sheets[v.sheetIdx]!.name, headerRow: v.headerRow, fields, statusMap: v.statusMap, queueSaved: v.queueSaved, t: Date.now() };
    const keep = Object.entries(all)
      .sort(([, a], [, b]) => b.t - a.t)
      .slice(0, 25);
    localStorage.setItem(MEMORY_KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch {
    /* storage unavailable: just don't remember */
  }
}

/** Saved mapping for this sheet, applied only where the header names still match. */
function recall(v: View, mem: Memory | undefined): void {
  if (!mem || mem.sheet !== v.sheets[v.sheetIdx]!.name) return;
  const rows = v.sheets[v.sheetIdx]!.rows;
  if (mem.headerRow < rows.length) v.headerRow = mem.headerRow;
  const headers = headerCells(v);
  const width = sheetWidth(rows);
  const mapping: Mapping = {};
  for (const f of FIELDS) {
    const saved = mem.fields?.[f];
    if (!saved) continue;
    const col = v.headerRow < 0 ? saved.col : headers.findIndex((x) => (x ?? "").trim() === saved.header);
    if (col >= 0 && col < width) mapping[f] = col;
  }
  if (Object.keys(mapping).length) v.mapping = mapping;
  v.statusMap = { ...(mem.statusMap ?? {}) };
  v.queueSaved = !!mem.queueSaved;
}

// --- step 2: preview & mapping ------------------------------------------------------

const rowsOf = (v: View) => v.sheets[v.sheetIdx]!.rows;
const headerCells = (v: View): string[] => (v.headerRow < 0 ? [] : (rowsOf(v)[v.headerRow] ?? []));
const dataRows = (v: View) => rowsOf(v).slice(v.headerRow + 1);
const isBlank = (r: string[]) => r.every((c) => !c.trim());

function selectSheet(v: View, idx: number): void {
  v.sheetIdx = idx;
  const rows = rowsOf(v);
  v.headerRow = detectHeaderRow(rows);
  v.mapping = autoMap(headerCells(v));
  v.statusMap = {};
}

async function loaded(src: Source): Promise<void> {
  const nonEmpty = src.sheets.findIndex((s) => !s.hidden && s.rows.some((r) => !isBlank(r)));
  if (nonEmpty < 0) return setError(t("sheet.err.empty"));
  const mem = readMemory()[src.key];
  const remembered = mem ? src.sheets.findIndex((s) => s.name === mem.sheet) : -1;
  const v: View = { ...src, sheetIdx: 0, headerRow: 0, mapping: {}, statusMap: {}, queueSaved: false, existing: await loadJobs() };
  selectSheet(v, remembered >= 0 ? remembered : nonEmpty);
  recall(v, mem);
  view = v;
  setBusy(false);
  showPreview();
}

let secTable: HTMLElement;
let secMap: HTMLElement;
let secStatus: HTMLElement;
let secReport: HTMLElement;
let summary: HTMLElement;
let importBtn: HTMLButtonElement;

function showPreview(): void {
  const v = view!;
  const controls = h("div", { className: "si-row" });

  if (v.sheets.length > 1) {
    const sheetSel = h("select", { id: `${ID}-sheet` });
    v.sheets.forEach((s, i) => sheetSel.append(h("option", { value: String(i), textContent: s.hidden ? t("sheet.preview.hidden", { name: s.name }) : s.name })));
    sheetSel.value = String(v.sheetIdx);
    sheetSel.addEventListener("change", () => {
      selectSheet(v, Number(sheetSel.value));
      recall(v, readMemory()[v.key]);
      showPreview();
    });
    controls.append(h("label", { className: "si-f" }, t("sheet.preview.sheet"), sheetSel));
  }

  const headerSel = h("select", { id: `${ID}-header` });
  headerSel.append(h("option", { value: "-1", textContent: t("sheet.preview.noHeader") }));
  rowsOf(v)
    .slice(0, 10)
    .forEach((r, i) => {
      const text = truncate(r.filter((c) => c.trim()).slice(0, 4).join(" · ") || "—", 70);
      headerSel.append(h("option", { value: String(i), textContent: t("sheet.preview.row", { n: i + 1, text }) }));
    });
  headerSel.value = String(v.headerRow);
  headerSel.addEventListener("change", () => {
    v.headerRow = Number(headerSel.value);
    v.mapping = autoMap(headerCells(v));
    renderAll();
  });
  controls.append(h("label", { className: "si-f si-wide" }, t("sheet.preview.header"), headerSel));

  secTable = h("div", { className: "si-section" });
  secMap = h("div", { className: "si-section" });
  secStatus = h("div", { className: "si-section" });
  secReport = h("div", { className: "si-section" });

  const queue = h("input", { type: "checkbox", id: `${ID}-queue`, checked: v.queueSaved });
  queue.addEventListener("change", () => {
    v.queueSaved = queue.checked;
    renderSummary();
  });

  body.replaceChildren(
    h("div", { className: "si-muted", textContent: t("sheet.preview.file", { name: v.name }) }),
    (errorBox = h("div", { id: `${ID}-error`, className: "si-error", role: "alert" })),
    controls,
    secTable,
    secMap,
    secStatus,
    h("label", { className: "si-check", htmlFor: queue.id }, queue, t("sheet.preview.queue")),
    secReport,
  );

  const back = h("button", { type: "button", id: `${ID}-back`, textContent: t("sheet.btn.back") });
  back.addEventListener("click", () => showSource());
  summary = h("div", { id: `${ID}-summary`, className: "si-summary", role: "status" });
  importBtn = h("button", { type: "button", id: `${ID}-go`, className: "primary" });
  importBtn.addEventListener("click", () => void doImport());
  foot.replaceChildren(summary, h("div", { className: "si-grow" }), back, importBtn);
  renderAll();
}

function renderAll(): void {
  renderTable();
  renderMapping();
  renderStatuses();
  renderSummary();
}

function columnName(v: View, i: number): string {
  const head = (headerCells(v)[i] ?? "").trim();
  return head || t("sheet.preview.column", { col: columnLabel(i) });
}

function renderTable(): void {
  const v = view!;
  const fieldAt = new Map<number, Field>();
  for (const f of FIELDS) if (v.mapping[f] != null) fieldAt.set(v.mapping[f]!, f);
  const rows = dataRows(v).filter((r) => !isBlank(r));
  const width = Math.min(MAX_PREVIEW_COLS, Math.max(1, sheetWidth(rowsOf(v))));
  const head = h("tr");
  for (let c = 0; c < width; c++) {
    const f = fieldAt.get(c);
    head.append(
      h(
        "th",
        { className: f ? "on" : "", title: columnName(v, c) },
        h("div", { className: "si-colref", textContent: columnLabel(c) }),
        h("div", { className: "si-fieldtag", textContent: f ? t(`sheet.field.${f}` as CopyKey) : " " }),
        h("div", { textContent: truncate(columnName(v, c), 40) }),
      ),
    );
  }
  const tbody = h("tbody");
  for (const r of rows.slice(0, PREVIEW_ROWS)) {
    const tr = h("tr");
    for (let c = 0; c < width; c++) {
      const cell = r[c] ?? "";
      tr.append(h("td", { className: fieldAt.has(c) ? "on" : "", textContent: truncate(cell.replace(/\s+/g, " "), 80), title: cell }));
    }
    tbody.append(tr);
  }
  secTable.replaceChildren(
    h("div", { className: "si-muted", textContent: t("sheet.preview.rows", { n: Math.min(PREVIEW_ROWS, rows.length), total: rows.length }) }),
    h("div", { className: "si-table-wrap" }, h("table", { id: `${ID}-preview` }, h("thead", {}, head), tbody)),
  );
}

function renderMapping(): void {
  const v = view!;
  const width = sheetWidth(rowsOf(v));
  const sample = dataRows(v).find((r) => !isBlank(r)) ?? [];
  const grid = h("div", { className: "si-map" });
  for (const f of FIELDS) {
    const sel = h("select", { id: `${ID}-map-${f}` });
    sel.append(h("option", { value: "", textContent: t("sheet.preview.unmapped") }));
    for (let c = 0; c < width; c++) {
      const hint = v.headerRow < 0 ? (sample[c] ?? "").trim() : columnName(v, c);
      sel.append(h("option", { value: String(c), textContent: `${columnLabel(c)} · ${truncate(hint || "—", 40)}` }));
    }
    sel.value = v.mapping[f] == null ? "" : String(v.mapping[f]);
    sel.addEventListener("change", () => {
      if (sel.value === "") delete v.mapping[f];
      else {
        const col = Number(sel.value);
        for (const other of FIELDS) if (other !== f && v.mapping[other] === col) delete v.mapping[other];
        v.mapping[f] = col;
      }
      renderAll();
    });
    grid.append(h("label", { className: "si-f", htmlFor: sel.id }, t(`sheet.field.${f}` as CopyKey), sel));
  }
  secMap.replaceChildren(h("h3", { textContent: t("sheet.preview.columns") }), h("div", { className: "si-muted", textContent: t("sheet.preview.columnsHint") }), grid);
}

function renderStatuses(): void {
  const v = view!;
  const head = h("h3", { textContent: t("sheet.preview.statuses") });
  if (v.mapping.status == null) {
    secStatus.replaceChildren(head, h("div", { className: "si-muted", textContent: t("sheet.preview.noStatus") }));
    return;
  }
  const values = distinctStatuses(dataRows(v), v.mapping.status, v.mapping.appliedAt).sort((a, b) => b.count - a.count);
  const grid = h("div", { id: `${ID}-status`, className: "si-status" });
  for (const s of values.slice(0, MAX_STATUS_VALUES)) {
    v.statusMap[s.key] ??= s.suggested;
    const sel = h("select");
    sel.dataset.statusKey = s.key;
    sel.setAttribute("aria-label", s.raw);
    for (const st of STATUS_CHOICES) sel.append(h("option", { value: st, textContent: statusName(st) }));
    sel.value = v.statusMap[s.key]!;
    sel.addEventListener("change", () => {
      v.statusMap[s.key] = sel.value as JobStatus;
      renderSummary();
    });
    grid.append(h("div", { className: "si-raw", textContent: s.raw, title: s.raw }), h("div", { className: "si-muted", textContent: `×${s.count}` }), sel);
  }
  secStatus.replaceChildren(head, h("div", { className: "si-muted", textContent: t("sheet.preview.statusesHint") }), grid);
}

function plan(v: View): ImportPlan {
  const data = dataRows(v);
  const links = v.sheets[v.sheetIdx]!.links;
  return rowsToJobs(data, v.mapping, v.statusMap, v.existing, {
    source: v.name,
    queueSaved: v.queueSaved,
    firstRow: v.headerRow + 2,
    ...(links ? { links: data.map((_r, i) => links[v.headerRow + 1 + i]) } : {}),
  });
}

function describePatch(p: JobPatch): string {
  const parts: string[] = [];
  if (p.status) parts.push(t("sheet.patch.status", { status: statusName(p.status) }));
  if (p.notes != null) parts.push(t("sheet.patch.notes"));
  if (p.appliedAt != null) parts.push(t("sheet.patch.appliedAt"));
  if (p.company != null || p.title != null || p.location != null) parts.push(t("sheet.patch.details"));
  return parts.join(", ");
}

function renderSummary(): void {
  const v = view!;
  const p = plan(v);
  const n = p.create.length + p.update.length;
  summary.textContent = t("sheet.summary", { create: p.create.length, update: p.update.length, skip: p.skipped.length });
  importBtn.textContent = t("sheet.btn.import", { n });
  importBtn.disabled = n === 0;

  const report: HTMLElement[] = [];
  if (p.update.length) {
    const list = h("ul");
    for (const u of p.update.slice(0, 100)) list.append(h("li", { textContent: `${u.label}: ${describePatch(u.patch)}` }));
    report.push(h("details", { id: `${ID}-updates` }, h("summary", { textContent: `${t("sheet.summary.updates")} (${p.update.length})` }), list));
  }
  if (p.skipped.length) {
    const list = h("ul");
    for (const s of p.skipped.slice(0, 100)) {
      list.append(h("li", { textContent: t("sheet.summary.row", { row: s.row, label: s.label, why: t(`sheet.skip.${s.reason}` as CopyKey) }) }));
    }
    report.push(h("details", { id: `${ID}-skipped` }, h("summary", { textContent: `${t("sheet.summary.skipped")} (${p.skipped.length})` }), list));
  }
  secReport.replaceChildren(...report);
}

// --- step 3: import ------------------------------------------------------------------

async function doImport(): Promise<void> {
  const v = view;
  if (!v) return;
  importBtn.disabled = true;
  importBtn.textContent = t("sheet.importing");
  try {
    v.existing = await loadJobs(); // the tracker may have changed since the preview
    const p = plan(v);
    if (!p.create.length && !p.update.length) {
      toast(t("sheet.toast.nothing"));
      return renderSummary();
    }
    if (p.create.length) await send({ type: "importJobs", jobs: p.create });
    // JobPatch may carry appliedAt (from the sheet); updateJob assigns patch fields as given.
    for (const u of p.update) await send({ type: "updateJob", jobId: u.jobId, patch: u.patch });
    if (p.create.some((j) => j.status === "queued") || p.update.some((u) => u.patch.status === "queued")) await send({ type: "kick" });
    remember(v);
    toast(t("sheet.toast.done", { create: p.create.length, update: p.update.length }));
    closeSheetImport();
  } catch (e) {
    setError(message(e));
    renderSummary();
  }
}

// --- styles (scoped to #sheet-import; uses the page's theme variables) -----------------

function injectStyle(): void {
  if (document.getElementById(`${ID}-style`)) return;
  const css = `
#${ID} { position: fixed; inset: 0; z-index: 2147483000; background: rgba(2, 6, 23, .55); display: flex; align-items: flex-start; justify-content: center; padding: 4vh 16px; overflow: auto; }
#${ID} .si-panel { background: var(--bg, #fff); color: var(--fg, #0f172a); border: 1px solid var(--line, #e2e8f0); border-radius: 12px; width: min(1000px, 100%); max-height: 92vh; display: flex; flex-direction: column; box-shadow: 0 24px 64px rgba(0, 0, 0, .35); }
#${ID} .si-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; border-bottom: 1px solid var(--line, #e2e8f0); }
#${ID} .si-head h2 { margin: 0; font-size: 16px; letter-spacing: .02em; }
#${ID} .si-x { border: 0; background: transparent; color: inherit; font-size: 22px; line-height: 1; padding: 0 6px; cursor: pointer; }
#${ID} .si-body { padding: 16px 18px; overflow: auto; flex: 1; display: flex; flex-direction: column; gap: 14px; }
#${ID} .si-foot { display: flex; align-items: center; gap: 8px; padding: 12px 18px; border-top: 1px solid var(--line, #e2e8f0); flex-wrap: wrap; }
#${ID} .si-grow { flex: 1; }
#${ID} .si-muted { color: var(--muted, #64748b); font-size: 12px; }
#${ID} .si-error { color: var(--danger, #dc2626); font-size: 13px; }
#${ID} .si-error:empty, #${ID} .si-reading:empty { display: none; }
#${ID} .si-drop { border: 2px dashed var(--line, #cbd5e1); border-radius: 10px; padding: 22px 16px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px; }
#${ID} .si-drop.over { border-color: var(--accent, #2563eb); background: color-mix(in srgb, var(--accent, #2563eb) 8%, transparent); }
#${ID} .si-drop-title { font-weight: 600; }
#${ID} .si-file { display: none; }
#${ID} .si-sources { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
#${ID} .si-card { border: 1px solid var(--line, #e2e8f0); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
#${ID} .si-inline { display: flex; gap: 8px; }
#${ID} .si-inline input { flex: 1; }
#${ID} h3 { font-size: 13px; margin: 0 0 4px; }
#${ID} .si-row { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
#${ID} .si-f { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted, #64748b); min-width: 160px; }
#${ID} .si-f.si-wide { flex: 1; }
#${ID} .si-map { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; margin-top: 8px; }
#${ID} .si-table-wrap { overflow: auto; border: 1px solid var(--line, #e2e8f0); border-radius: 8px; max-height: 320px; margin-top: 6px; }
#${ID} table { border-collapse: collapse; font-size: 12px; min-width: 100%; }
#${ID} th, #${ID} td { border-bottom: 1px solid var(--line, #e2e8f0); padding: 5px 8px; text-align: left; vertical-align: top; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#${ID} th { position: sticky; top: 0; background: var(--soft, #f8fafc); font-weight: 600; }
#${ID} .si-colref { color: var(--muted, #64748b); font-weight: 400; font-size: 10px; }
#${ID} .si-fieldtag { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--accent, #2563eb); min-height: 1em; }
#${ID} th.on, #${ID} td.on { background: color-mix(in srgb, var(--accent, #2563eb) 7%, var(--bg, #fff)); }
#${ID} .si-status { display: grid; grid-template-columns: minmax(120px, 1fr) auto minmax(150px, 220px); gap: 6px 12px; align-items: center; margin-top: 8px; }
#${ID} .si-raw { overflow-wrap: anywhere; }
#${ID} .si-check { display: flex; gap: 8px; align-items: center; font-size: 13px; }
#${ID} .si-check input { width: auto; }
#${ID} details { font-size: 12px; }
#${ID} details summary { cursor: pointer; }
#${ID} details ul { margin: 6px 0 0; padding-left: 18px; color: var(--muted, #64748b); }
#${ID} .si-summary { font-weight: 600; font-variant-numeric: tabular-nums; }
#${ID}.busy .si-panel { cursor: progress; }
@media (max-width: 720px) { #${ID} .si-sources { grid-template-columns: 1fr; } #${ID} .si-status { grid-template-columns: 1fr auto; } #${ID} .si-status select { grid-column: 1 / -1; } }
`;
  document.head.append(h("style", { id: `${ID}-style`, textContent: css }));
}
