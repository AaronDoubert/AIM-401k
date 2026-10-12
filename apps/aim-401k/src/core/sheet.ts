// Spreadsheet import/export, all local: CSV/TSV parsing with delimiter
// sniffing, a small XLSX reader (ZIP + SpreadsheetML), header detection,
// column auto-mapping, status mapping and merging rows into the tracker.
// Pure functions only; the modal lives in src/ui/sheetImport.ts.

import type { Job, JobStatus } from "../shared/types";
import { uid } from "../shared/util";
import { parseDate } from "./dates";
import { unzipEntry, zipEntries, zipStore } from "./zip";

export type Field = "company" | "title" | "url" | "status" | "appliedAt" | "location" | "notes" | "salary" | "contact";
export const FIELDS: Field[] = ["company", "title", "url", "status", "appliedAt", "location", "notes", "salary", "contact"];
/** Field -> column index. */
export type Mapping = Partial<Record<Field, number>>;

export interface SheetData {
  name: string;
  rows: string[][];
  hidden?: boolean;
  /** Row index -> first http(s) hyperlink found on that row (XLSX cell links / HYPERLINK()). */
  links?: Record<number, string>;
}

export interface Workbook {
  sheets: SheetData[];
}

const clean = (s: string | undefined): string => (s ?? "").replace(/ /g, " ").trim();

/** "A", "B", … "Z", "AA" for a 0-based column index. */
export function columnLabel(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** "B12" / "AA3" / "c" -> 0-based column index. */
export function columnIndex(ref: string): number {
  const letters = (ref.match(/^[A-Za-z]+/)?.[0] ?? "").toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function sheetWidth(rows: string[][]): number {
  return rows.reduce((w, r) => Math.max(w, r.length), 0);
}

const isBlankRow = (r: string[] | undefined) => !r || r.every((c) => !clean(c));

// --- CSV / TSV ---------------------------------------------------------------

function countOutside(line: string, d: string): number {
  let n = 0;
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === d && !q) n++;
  }
  return n;
}

/** Pick tab, semicolon or comma: the one with the most consistent per-line count. */
export function sniffDelimiter(text: string): string {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim()).slice(0, 25);
  let best = ",";
  let bestScore = 0;
  for (const d of ["\t", ";", ","]) {
    const counts = lines.map((l) => countOutside(l, d));
    const freq = new Map<number, number>();
    for (const c of counts) if (c > 0) freq.set(c, (freq.get(c) ?? 0) + 1);
    if (!freq.size) continue;
    let mode = 0;
    let modeN = 0;
    for (const [c, n] of freq) if (n > modeN || (n === modeN && c > mode)) [mode, modeN] = [c, n];
    const score = modeN * 100 + Math.min(mode, 99);
    if (score > bestScore) [best, bestScore] = [d, score];
  }
  return best;
}

/**
 * RFC 4180 parser: quoted fields with embedded delimiters/newlines and "" escapes,
 * CRLF/LF/CR line ends, a leading BOM, ragged rows. Lenient with stray quotes.
 */
export function parseCsv(text: string, delimiter?: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const d = delimiter ?? sniffDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let wasQuoted = false;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"' && !wasQuoted && field.trim() === "") {
      inQuotes = true;
      wasQuoted = true;
      field = "";
    } else if (c === d) {
      row.push(field);
      field = "";
      wasQuoted = false;
    } else if (c === "\n" || c === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      wasQuoted = false;
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else field += c;
  }
  if (field !== "" || wasQuoted || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// --- XLSX --------------------------------------------------------------------

const MAX_ROWS = 20000;
const MAX_COLS = 200;
const P = "(?:[\\w.-]+:)?"; // optional namespace prefix on element names

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, e: string) => {
    const k = e.toLowerCase();
    if (k[0] === "#") {
      const code = k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[k] ?? "";
  });
}

/** OOXML escapes control characters as _xHHHH_ (e.g. _x000D_ for CR). */
const decodeOoxml = (s: string) => s.replace(/_x([0-9a-fA-F]{4})_/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]!] = decodeXml(m[2] ?? m[3] ?? "");
  return out;
}

const relId = (a: Record<string, string>) => Object.entries(a).find(([k]) => /(^|:)id$/i.test(k) && k.includes(":"))?.[1] ?? a.id ?? "";

function inner(xml: string, tag: string): string | undefined {
  return xml.match(new RegExp(`<${P}${tag}\\b[^>]*>([\\s\\S]*?)</${P}${tag}>`))?.[1];
}

/** Text of a string item (<si>, <is>): all <t> runs, minus phonetic hints. */
function richText(xml: string): string {
  const body = xml.replace(new RegExp(`<${P}rPh\\b[\\s\\S]*?</${P}rPh>`, "g"), "");
  let s = "";
  for (const t of body.matchAll(new RegExp(`<${P}t\\b[^>]*?(?:/>|>([\\s\\S]*?)</${P}t>)`, "g"))) s += t[1] ?? "";
  return decodeOoxml(decodeXml(s));
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(new RegExp(`<${P}si\\b[^>]*?(?:/>|>([\\s\\S]*?)</${P}si>)`, "g"))) out.push(m[1] ? richText(m[1]) : "");
  return out;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 57, 58]);

function isDateFormat(id: number, code: string | undefined): boolean {
  if (BUILTIN_DATE_FORMATS.has(id)) return true;
  if (!code) return false;
  const bare = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
  return /[dy]/i.test(bare) && !/^general$/i.test(bare.trim());
}

/** Indexes into cellXfs whose number format is a date. */
function dateStyles(xml: string): Set<number> {
  const custom = new Map<number, string>();
  for (const m of xml.matchAll(new RegExp(`<${P}numFmt\\b([^>]*?)/?>`, "g"))) {
    const a = attrs(m[1]!);
    custom.set(Number(a.numFmtId), a.formatCode ?? "");
  }
  const out = new Set<number>();
  const xfs = inner(xml, "cellXfs") ?? "";
  let i = 0;
  for (const m of xfs.matchAll(new RegExp(`<${P}xf\\b([^>]*?)/?>`, "g"))) {
    const id = Number(attrs(m[1]!).numFmtId ?? 0);
    if (isDateFormat(id, custom.get(id))) out.add(i);
    i++;
  }
  return out;
}

/** Excel serial day number -> "YYYY-MM-DD" (1900 or 1904 date system). */
export function excelSerialToIso(serial: number, date1904 = false): string {
  const days = Math.floor(serial) + (date1904 ? 1462 : 0);
  // Day 60 is Excel's fictional 1900-02-29; serials before it are one day off. Irrelevant for job dates.
  return new Date(Date.UTC(1899, 11, 30) + days * 86400000).toISOString().slice(0, 10);
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(15)));
}

const HYPERLINK_FN = /HYPERLINK\(\s*"([^"]+)"/i;

interface CellCtx {
  shared: string[];
  dates: Set<number>;
  date1904: boolean;
}

function cellValue(a: Record<string, string>, body: string, ctx: CellCtx): string {
  const t = a.t ?? "n";
  const vRaw = inner(body, "v");
  const v = vRaw == null ? "" : decodeXml(vRaw);
  if (t === "inlineStr" || (t === "n" && !vRaw && /<(?:[\w.-]+:)?is\b/.test(body))) return richText(inner(body, "is") ?? "");
  switch (t) {
    case "s":
      return ctx.shared[Number(v)] ?? "";
    case "str":
      return decodeOoxml(v);
    case "b":
      return v === "1" ? "TRUE" : v === "0" ? "FALSE" : v;
    case "e":
      return v;
    case "d":
      return /T00:00(:00)?(\.0+)?Z?$/.test(v) ? v.slice(0, 10) : v;
    default: {
      if (v === "") return "";
      const n = Number(v);
      if (!Number.isFinite(n)) return v;
      if (a.s && ctx.dates.has(Number(a.s)) && n >= 1 && n < 2958466) return excelSerialToIso(n, ctx.date1904);
      return formatNumber(n);
    }
  }
}

function parseWorksheet(xml: string, ctx: CellCtx): { rows: string[][]; formulaLinks: Record<number, string> } {
  const data = inner(xml, "sheetData") ?? "";
  const rows: string[][] = [];
  const formulaLinks: Record<number, string> = {};
  let nextRow = 0;
  for (const rm of data.matchAll(new RegExp(`<${P}row\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${P}row>)`, "g"))) {
    const ra = attrs(rm[1]!);
    const r = ra.r ? Number(ra.r) - 1 : nextRow;
    nextRow = r + 1;
    if (!(r >= 0) || r >= MAX_ROWS) continue;
    const cells: string[] = [];
    let nextCol = 0;
    for (const cm of (rm[2] ?? "").matchAll(new RegExp(`<${P}c\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${P}c>)`, "g"))) {
      const ca = attrs(cm[1]!);
      const col = ca.r ? columnIndex(ca.r) : nextCol;
      nextCol = col + 1;
      if (col < 0 || col >= MAX_COLS) continue;
      const body = cm[2] ?? "";
      const value = cellValue(ca, body, ctx);
      if (value !== "") cells[col] = value;
      const link = decodeXml(inner(body, "f") ?? "").match(HYPERLINK_FN)?.[1];
      if (link && /^https?:\/\//i.test(link)) formulaLinks[r] ??= link;
    }
    rows[r] = Array.from(cells, (c) => c ?? "");
  }
  return { rows: Array.from(rows, (r) => r ?? []), formulaLinks };
}

function parseRels(xml: string | null): Map<string, { target: string; type: string; external: boolean }> {
  const out = new Map<string, { target: string; type: string; external: boolean }>();
  if (!xml) return out;
  for (const m of xml.matchAll(new RegExp(`<${P}Relationship\\b([^>]*?)/?>`, "g"))) {
    const a = attrs(m[1]!);
    if (a.Id) out.set(a.Id, { target: a.Target ?? "", type: a.Type ?? "", external: /external/i.test(a.TargetMode ?? "") });
  }
  return out;
}

/** Resolve a relationship target against the folder of the part that owns it. */
function resolvePart(baseDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = `${baseDir}/${target}`.split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p && p !== ".") out.push(p);
  }
  return out.join("/");
}

/** Read every worksheet of an .xlsx file into string rows. Throws on non-XLSX input. */
export async function readXlsx(input: ArrayBuffer | Uint8Array): Promise<Workbook> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const entries = zipEntries(bytes);
  if (!entries) throw new Error("Not an .xlsx file (no ZIP directory found)");
  const dec = new TextDecoder();
  const text = async (name: string): Promise<string | null> => {
    const b = await unzipEntry(bytes, name, entries);
    return b ? dec.decode(b) : null;
  };

  const wb = await text("xl/workbook.xml");
  const rels = parseRels(await text("xl/_rels/workbook.xml.rels"));
  const ctx: CellCtx = {
    shared: parseSharedStrings((await text("xl/sharedStrings.xml")) ?? ""),
    dates: dateStyles((await text("xl/styles.xml")) ?? ""),
    date1904: /date1904\s*=\s*["'](1|true)["']/i.test(wb ?? ""),
  };

  let list: { name: string; path: string; hidden: boolean }[] = [];
  for (const m of (wb ?? "").matchAll(new RegExp(`<${P}sheet\\b([^>]*?)/?>`, "g"))) {
    const a = attrs(m[1]!);
    const rel = rels.get(relId(a));
    if (rel && rel.type && !/\/worksheet$/i.test(rel.type)) continue; // chartsheets, dialogs
    const path = rel ? resolvePart("xl", rel.target) : `xl/worksheets/sheet${a.sheetId ?? list.length + 1}.xml`;
    list.push({ name: a.name ?? `Sheet${list.length + 1}`, path, hidden: !!a.state && a.state !== "visible" });
  }
  if (!list.length) {
    list = entries
      .map((e) => e.name)
      .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(n))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
      .map((path, i) => ({ name: `Sheet${i + 1}`, path, hidden: false }));
  }
  if (!list.length) throw new Error("No worksheets found in this .xlsx file");

  const sheets: SheetData[] = [];
  for (const s of list) {
    const xml = await text(s.path);
    if (xml == null) continue;
    const { rows, formulaLinks } = parseWorksheet(xml, ctx);
    const links: Record<number, string> = { ...formulaLinks };
    // Cell hyperlinks: <hyperlink ref="C2" r:id="rId1"/> -> sheet rels (external targets).
    const hl = [...xml.matchAll(new RegExp(`<${P}hyperlink\\b([^>]*?)/?>`, "g"))];
    if (hl.length) {
      const dir = s.path.replace(/\/[^/]*$/, "");
      const file = s.path.slice(dir.length + 1);
      const srels = parseRels(await text(`${dir}/_rels/${file}.rels`));
      for (const m of hl) {
        const a = attrs(m[1]!);
        const target = srels.get(relId(a))?.target ?? "";
        const row = Number(a.ref?.match(/\d+/)?.[0] ?? 0) - 1;
        if (row >= 0 && /^https?:\/\//i.test(target)) links[row] ??= target;
      }
    }
    sheets.push({ name: s.name, rows, ...(s.hidden ? { hidden: true } : {}), ...(Object.keys(links).length ? { links } : {}) });
  }
  return { sheets };
}

/** True when the bytes start like a ZIP (an .xlsx regardless of its file name). */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

// --- headers & mapping -------------------------------------------------------

/** [synonym, exactOnly]. Earlier synonyms win ties within a field. */
const SYNONYMS: Record<Field, [string, boolean?][]> = {
  company: [["company"], ["company name"], ["employer"], ["organization"], ["organisation"], ["org", true], ["business", true], ["firm", true], ["agency", true]],
  title: [["job title"], ["title"], ["role"], ["position"], ["job", true], ["position title"], ["job role"], ["opening", true], ["job name", true]],
  url: [["url"], ["link"], ["job link"], ["application link"], ["posting"], ["job posting"], ["job url"], ["listing", true], ["href", true], ["website", true]],
  status: [["status"], ["stage"], ["application status"], ["state", true], ["outcome"], ["result", true], ["list", true], ["pipeline", true], ["progress", true], ["response", true]],
  appliedAt: [["date applied"], ["applied"], ["application date"], ["applied on"], ["applied date"], ["date of application"], ["date", true], ["date submitted"], ["submitted", true], ["applied at"], ["submission date"]],
  location: [["location"], ["city"], ["remote"], ["where", true], ["office", true], ["place", true]],
  notes: [["notes"], ["note"], ["comments"], ["comment"], ["next steps"], ["next step"], ["details", true], ["remarks"], ["description", true]],
  salary: [["salary"], ["compensation"], ["pay", true], ["comp", true], ["salary range"], ["pay range"], ["base salary"], ["wage"], ["rate", true]],
  contact: [["contact"], ["recruiter"], ["email"], ["hiring manager"], ["point of contact"], ["contact person"], ["referral"], ["referrer"]],
};

const normHeader = (h: string) =>
  clean(h)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Match header cells to fields by synonym; each field and each column is used at most once. */
export function autoMap(headers: string[]): Mapping {
  const cands: { col: number; field: Field; score: number }[] = [];
  headers.forEach((raw, col) => {
    const h = normHeader(raw ?? "");
    if (!h || h.length > 60) return;
    for (const field of FIELDS) {
      let best = 0;
      SYNONYMS[field].forEach(([syn, exactOnly], i) => {
        let score = 0;
        if (h === syn) score = 1000 - i;
        else if (!exactOnly && ` ${h} `.includes(` ${syn} `)) score = 500 + syn.length * 10 - i;
        best = Math.max(best, score);
      });
      if (best) cands.push({ col, field, score: best });
    }
  });
  cands.sort((a, b) => b.score - a.score || a.col - b.col);
  const out: Mapping = {};
  const used = new Set<number>();
  for (const c of cands) {
    if (out[c.field] != null || used.has(c.col)) continue;
    out[c.field] = c.col;
    used.add(c.col);
  }
  return out;
}

const looksLikeData = (c: string) => /^https?:\/\//i.test(c) || /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(c) || /^\d{5,}(\.\d+)?$/.test(c);

/** First row (within the first 10) with at least 2 recognizable header names; else the first non-blank row. */
export function detectHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const r = (rows[i] ?? []).map(clean);
    if (r.some(looksLikeData)) continue;
    if (Object.keys(autoMap(r)).length >= 2) return i;
  }
  return Math.max(0, rows.findIndex((r) => !isBlankRow(r)));
}

// --- statuses ----------------------------------------------------------------

const normStatus = (s: string) =>
  clean(s)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9✓✔]+/g, " ")
    .trim();

/** Key used in status maps: trimmed, lower-cased, single-spaced. */
export const statusKey = (raw: string) => clean(raw).toLowerCase().replace(/\s+/g, " ");

const GHOSTED = /\b(ghost(ed|ing)?|no (response|reply|answer|word)|never heard( back)?|radio silence|silence)\b/;

/** Applied but never heard back. Kept as "submitted"; the sheet wording goes into notes. */
export const isGhosted = (raw: string) => GHOSTED.test(normStatus(raw));

const STATUS_RULES: [RegExp, JobStatus][] = [
  [/^(no|n|false)$/, "rejected"],
  [/\b(not (yet )?(applied|submitted|sent|started)|havent applied|to apply|to be applied|need to apply|want to apply|will apply)\b/, "saved"],
  [GHOSTED, "submitted"],
  [/\b(skip(ped)?|not interested|passed on|stood down|stand down)\b/, "skipped"],
  [
    /\b(reject(ed|ion)?|declined?|turned down|not (selected|moving forward|a (good )?fit|proceeding|chosen|progressing)|no longer|position (closed|filled)|closed|filled|unsuccessful|denied|withdr[ae]wn?|withdraw|dead|lost|cancell?ed|no offer|did ?nt (get|move)|did not (get|move)|rescinded|archived)\b/,
    "rejected",
  ],
  [/\b(offers?|offered|accepted|hired|signed|got (the )?job)\b/, "offer"],
  [
    /\b(interview(s|ing|ed)?|phone screen(ed|ing)?|screen(ed|ing|er)?|onsite|on site|technical|tech screen|final round|(1st|2nd|3rd|first|second|third|next) round|round \d|assessments?|take ?home|coding (challenge|test)|hirevue|recruiter (call|chat)|hr (call|screen)|call scheduled|super ?day|panel)\b/,
    "interviewing",
  ],
  [/\b(applied|submitted|sent|application (sent|submitted|received)|under review|in review|reviewing|awaiting|waiting|pending)\b|^(yes|y|true|✓|✔)$/, "submitted"],
  [/\b(wish ?list|saved?|bookmark(ed)?|interested|todo|to do|draft(ing)?|planned|planning|plan to|research(ing)?|considering|maybe|later|prospect(ive)?|in progress|applying|queued?|starred|favou?rite|lead)\b/, "saved"],
];

/**
 * Map a free-text status from a sheet to a tracker status, or null when it's
 * unrecognized (the caller then defaults to "submitted" if the row has an
 * applied date, else "saved"). Order matters: negatives win over positives
 * ("rejected after interview" -> rejected, "not applied" -> saved).
 * "Ghosted" / "no response" -> submitted (see isGhosted).
 */
export function mapStatus(text: string): JobStatus | null {
  const t = normStatus(text);
  if (!t) return null;
  for (const [re, status] of STATUS_RULES) if (re.test(t)) return status;
  return null;
}

export interface StatusValue {
  key: string;
  raw: string;
  count: number;
  suggested: JobStatus;
}

/** Distinct status values in a column, with a suggested mapping for each. */
export function distinctStatuses(rows: string[][], statusCol: number | undefined, appliedCol?: number): StatusValue[] {
  if (statusCol == null) return [];
  const out = new Map<string, StatusValue & { dated: number }>();
  for (const r of rows) {
    const raw = clean(r[statusCol]);
    if (!raw) continue;
    const key = statusKey(raw);
    const v = out.get(key) ?? { key, raw, count: 0, suggested: "saved" as JobStatus, dated: 0 };
    v.count++;
    if (appliedCol != null && clean(r[appliedCol])) v.dated++;
    out.set(key, v);
  }
  return [...out.values()].map(({ dated, ...v }) => ({ ...v, suggested: mapStatus(v.raw) ?? (dated ? "submitted" : "saved") }));
}

// --- dates -------------------------------------------------------------------

const DMY = /^(\d{1,2})([-/.])(\d{1,2})\2(\d{2,4})$/;

/** Decide day-first vs month-first for a column of a/b/yyyy dates. */
export function detectDayFirst(values: string[]): boolean {
  let dotted = 0;
  for (const raw of values) {
    const m = stripTime(clean(raw)).match(DMY);
    if (!m) continue;
    if (Number(m[1]) > 12) return true;
    if (Number(m[3]) > 12) return false;
    if (m[2] === ".") dotted++;
  }
  return dotted > 0; // 05.01.2026 is a European spelling
}

function stripTime(s: string): string {
  return s
    .replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i, "")
    .replace(/^(\d{4}-\d{1,2}-\d{1,2})[ T].*$/, "$1")
    .replace(/^(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})[ ,T].*$/, "$1")
    .replace(/^(.*\d{4}),?\s+(at\s+)?\d{1,2}:\d{2}.*$/i, "$1");
}

/** Excel serials within this range are treated as dates (~1954 to ~2119). */
export const SERIAL_MIN = 20000;
export const SERIAL_MAX = 80000;

/** A sheet date cell -> ms epoch (local noon), or null. Handles ISO, US/EU, month names, Excel serials. */
export function parseSheetDate(raw: string, opts: { dayFirst?: boolean; now?: number } = {}): number | null {
  let s = clean(raw);
  if (!s) return null;
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/); // 20260105
  if (compact) s = `${compact[1]}-${compact[2]}-${compact[3]}`;
  else if (/^\d+(\.\d+)?$/.test(s) && !/^\d{4}$/.test(s)) {
    const n = Number(s);
    if (n < SERIAL_MIN || n > SERIAL_MAX) return null;
    s = excelSerialToIso(n);
  }
  s = stripTime(s);
  const m = s.match(DMY);
  if (m && opts.dayFirst && Number(m[1]) <= 12) s = `${m[3]}/${m[1]}/${m[4]}`;
  const now = opts.now ?? Date.now();
  const p = parseDate(s, new Date(now));
  if (!p) return null;
  const t = new Date(p.y, (p.m ?? 1) - 1, p.d ?? 1, 12).getTime();
  return t > now + 2 * 86400000 ? null : t; // an "applied" date in the future is a misread
}

const APPLIED_FLAG = /^(yes|y|true|x|✓|✔|done|applied|submitted)$/i;

/** A "Remote?" yes/no column mapped to location: yes -> "Remote", no -> "". */
function locationValue(raw: string): string {
  if (/^(true|yes|y|x|✓|✔|remote)$/i.test(raw)) return "Remote";
  if (/^(false|no|n|-|—|n\/a)$/i.test(raw)) return "";
  return raw;
}

// --- rows -> jobs ------------------------------------------------------------

export type JobPatch = Partial<Pick<Job, "status" | "notes" | "company" | "title" | "location" | "appliedAt">>;
export type SkipReason = "missing" | "duplicate" | "unchanged";

export interface ImportPlan {
  create: Job[];
  update: { jobId: string; patch: JobPatch; label: string }[];
  skipped: { row: number; reason: SkipReason; label: string }[];
}

export interface ImportOptions {
  /** File name, for the job log line. */
  source?: string;
  now?: number;
  /** Rows with a link and status "saved" become "queued" (auto-apply). */
  queueSaved?: boolean;
  /** 1-based sheet row number of rows[0], for messages. Default 1. */
  firstRow?: number;
  /** Hyperlink per data row (aligned with rows), used when the link column is empty. */
  links?: (string | undefined)[];
  /** Force day-first (EU) or month-first (US) dates; auto-detected when omitted. */
  dayFirst?: boolean;
}

const TRACKING = /^(utm_.*|gclid|fbclid|mc_[a-z]+|ref|refs|referrer|source|src|gh_src|lever-source|lever-origin|trk|trackingid|_hs[a-z]+)$/i;

/** Normalize a link for matching: no scheme/www/hash/trailing slash/tracking params. */
export function urlKey(raw: string): string {
  try {
    const u = new URL(raw.trim());
    const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
    const q = params.length ? `?${new URLSearchParams(params).toString()}` : "";
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${q}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

/** A link cell -> an http(s) URL, or "" when it's not a link (e.g. "LinkedIn"). */
export function cleanUrl(raw: string): string {
  let s = clean(raw).replace(/^<|>$/g, "");
  if (!s || /\s/.test(s)) return "";
  if (!/^https?:\/\//i.test(s)) {
    if (!/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?([/?#]\S*)?$/i.test(s)) return "";
    s = `https://${s}`;
  }
  try {
    const u = new URL(s);
    return /^https?:$/.test(u.protocol) && u.hostname.includes(".") ? s : "";
  } catch {
    return "";
  }
}

const SUFFIX = /\s+(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|gmbh|plc|sa|ag|bv|pty|pvt)$/;

/** Company/title normalization for matching ("Acme Robotics, Inc." == "acme robotics"). */
export function nameKey(s: string): string {
  let k = clean(s)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  while (SUFFIX.test(k)) k = k.replace(SUFFIX, "");
  return k;
}

const RANK: Record<JobStatus, number> = {
  saved: 0,
  queued: 0,
  failed: 0,
  skipped: 0,
  running: 0,
  needs_you: 0,
  ready_to_submit: 0,
  submitted: 1,
  interviewing: 2,
  rejected: 3,
  offer: 4,
};
const IN_FLIGHT: JobStatus[] = ["running", "needs_you", "ready_to_submit"];

/**
 * Turn mapped sheet rows into new jobs and patches for jobs already tracked.
 * Matching: normalized link first, else company + title (both present).
 * Patches only add information: they fill empty fields, append new notes and
 * move status forward (saved < applied < interviewing < rejected < offer);
 * an offer or interview is never moved back to "applied", and jobs that are
 * mid-application are left alone.
 */
export function rowsToJobs(
  rows: string[][],
  mapping: Mapping,
  statusMap: Record<string, JobStatus>,
  existing: Job[],
  opts: ImportOptions = {},
): ImportPlan {
  const now = opts.now ?? Date.now();
  const firstRow = opts.firstRow ?? 1;
  const source = opts.source || "spreadsheet";
  const get = (r: string[], f: Field) => (mapping[f] == null ? "" : clean(r[mapping[f]!]));
  const dayFirst = opts.dayFirst ?? (mapping.appliedAt == null ? false : detectDayFirst(rows.map((r) => r[mapping.appliedAt!] ?? "")));

  const byUrl = new Map<string, Job>();
  const byName = new Map<string, Job>();
  for (const j of existing) {
    if (j.url) byUrl.set(urlKey(j.url), j);
    if (j.company && j.title) byName.set(`${nameKey(j.company)}|${nameKey(j.title)}`, j);
  }
  const seen = new Map<string, number>();
  const plan: ImportPlan = { create: [], update: [], skipped: [] };
  const matched = new Map<string, number>(); // tracked job id -> sheet row that matched it

  rows.forEach((r, i) => {
    if (isBlankRow(r)) return;
    const rowNo = firstRow + i;
    const company = get(r, "company");
    const title = get(r, "title");
    const linkCell = get(r, "url");
    const url = cleanUrl(linkCell) || cleanUrl(opts.links?.[i] ?? "");
    const label = [company, title].filter(Boolean).join(" · ") || url || `#${rowNo}`;
    if (!company && !title && !url) {
      plan.skipped.push({ row: rowNo, reason: "missing", label });
      return;
    }

    const location = locationValue(get(r, "location"));
    const appliedRaw = get(r, "appliedAt");
    const appliedAt = parseSheetDate(appliedRaw, { dayFirst, now });
    const appliedFlag = !appliedAt && APPLIED_FLAG.test(appliedRaw);
    const rawStatus = get(r, "status");
    let status: JobStatus = (rawStatus && (statusMap[statusKey(rawStatus)] ?? mapStatus(rawStatus))) || (appliedAt || appliedFlag ? "submitted" : "saved");
    if (status === "saved" && opts.queueSaved && url) status = "queued";
    if (status === "queued" && !url) status = "saved";
    if (IN_FLIGHT.includes(status)) status = "queued";

    const notes = [
      get(r, "notes"),
      get(r, "salary") && `Salary: ${get(r, "salary")}`,
      get(r, "contact") && `Contact: ${get(r, "contact")}`,
      rawStatus && isGhosted(rawStatus) && `Sheet status: ${rawStatus}`,
      linkCell && !cleanUrl(linkCell) && `Link: ${linkCell}`,
      appliedRaw && !appliedAt && !appliedFlag && `Applied: ${appliedRaw}`,
    ]
      .filter(Boolean)
      .join("\n");

    const uKey = url ? `u:${urlKey(url)}` : "";
    const nKey = company && title ? `n:${nameKey(company)}|${nameKey(title)}` : "";
    const dupOf = (uKey && seen.get(uKey)) || (nKey && seen.get(nKey));
    if (dupOf) {
      plan.skipped.push({ row: rowNo, reason: "duplicate", label: `${label} (= row ${dupOf})` });
      return;
    }
    if (uKey) seen.set(uKey, rowNo);
    if (nKey) seen.set(nKey, rowNo);

    const match = (url && byUrl.get(urlKey(url))) || (nKey && byName.get(nKey.slice(2))) || undefined;
    if (match) {
      const prev = matched.get(match.id);
      if (prev) {
        plan.skipped.push({ row: rowNo, reason: "duplicate", label: `${label} (= row ${prev})` });
        return;
      }
      matched.set(match.id, rowNo);
      const had = match.notes ?? "";
      const patch: JobPatch = {};
      if (!match.company && company) patch.company = company;
      if (!match.title && title) patch.title = title;
      if (!match.location && location) patch.location = location;
      if (notes && !had.includes(notes)) patch.notes = had ? `${had}\n${notes}` : notes;
      if (!IN_FLIGHT.includes(match.status) && (RANK[status] > RANK[match.status] || (status === "queued" && match.status === "saved"))) {
        patch.status = status;
      }
      if (!match.appliedAt && appliedAt && (patch.status ? RANK[patch.status] : RANK[match.status]) >= 1) patch.appliedAt = appliedAt;
      if (Object.keys(patch).length) {
        plan.update.push({ jobId: match.id, patch, label });
      } else plan.skipped.push({ row: rowNo, reason: "unchanged", label });
      return;
    }

    let ats = "sheet";
    try {
      if (url) ats = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      /* keep "sheet" */
    }
    plan.create.push({
      id: uid("job_"),
      url,
      company,
      title,
      location,
      ats,
      status,
      createdAt: now,
      // Keeps the sheet's order in the tracker (sorted by updatedAt, newest first).
      updatedAt: now - i,
      appliedAt: appliedAt ?? null,
      lastProgressAt: now,
      notes,
      tabId: null,
      autoTab: false,
      aiDrafted: 0,
      log: [{ t: now, msg: `Imported from ${source}` }],
    });
  });
  return plan;
}

// --- published Google Sheets -------------------------------------------------

/**
 * Turn a Google Sheets link into its CSV download URL:
 * published links (…/d/e/<id>/pubhtml or /pub) -> /pub?output=csv,
 * regular links (…/d/<id>/edit#gid=N) -> /export?format=csv&gid=N.
 * Other http(s) URLs are returned unchanged (any CSV link works). Null if not a URL.
 */
export function sheetCsvUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  if (u.hostname !== "docs.google.com" || !u.pathname.startsWith("/spreadsheets/")) return u.href;
  u.pathname = u.pathname.replace(/^\/spreadsheets\/u\/\d+\//, "/spreadsheets/"); // multi-account links
  const gid = u.searchParams.get("gid") ?? u.hash.match(/gid=(\d+)/)?.[1] ?? null;
  const pub = u.pathname.match(/^\/spreadsheets\/d\/e\/([\w-]+)\/(pubhtml|pub)(\/.*)?$/);
  if (pub) {
    const out = new URL(`https://docs.google.com/spreadsheets/d/e/${pub[1]}/pub`);
    for (const [k, v] of u.searchParams) if (k !== "output") out.searchParams.set(k, v);
    if (gid) out.searchParams.set("gid", gid);
    out.searchParams.set("output", "csv");
    return out.href;
  }
  const doc = u.pathname.match(/^\/spreadsheets\/d\/([\w-]+)(\/.*)?$/);
  if (!doc) return u.href;
  if (doc[2]?.startsWith("/gviz/")) {
    u.searchParams.set("tqx", "out:csv");
    return u.href;
  }
  const out = new URL(`https://docs.google.com/spreadsheets/d/${doc[1]}/export`);
  out.searchParams.set("format", "csv");
  if (gid) out.searchParams.set("gid", gid);
  return out.href;
}

// --- XLSX export ---------------------------------------------------------------

const xmlEsc = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function serialOf(t: number): number {
  const d = new Date(t);
  return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000;
}

/** One-sheet .xlsx of the tracker (stored ZIP). `statusLabel` turns status ids into display names. */
export function jobsToXlsx(jobs: Job[], statusLabel: (s: JobStatus) => string = (s) => s): Uint8Array {
  const header = ["Company", "Title", "Location", "Status", "Applied", "Added", "Source", "Link", "Notes"];
  const widths = [24, 34, 18, 14, 12, 12, 20, 44, 60];
  const str = (ref: string, v: string, style = 0) =>
    v ? `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${xmlEsc(v.slice(0, 32000))}</t></is></c>` : "";
  const date = (ref: string, t: number | null) => (t ? `<c r="${ref}" s="1"><v>${serialOf(t)}</v></c>` : "");
  const rows = [`<row r="1">${header.map((h, c) => str(`${columnLabel(c)}1`, h, 2)).join("")}</row>`];
  jobs.forEach((j, i) => {
    const n = i + 2;
    const cells = [
      str(`A${n}`, j.company),
      str(`B${n}`, j.title),
      str(`C${n}`, j.location),
      str(`D${n}`, statusLabel(j.status)),
      date(`E${n}`, j.appliedAt),
      date(`F${n}`, j.createdAt),
      str(`G${n}`, j.ats),
      str(`H${n}`, j.url),
      str(`I${n}`, j.notes),
    ];
    rows.push(`<row r="${n}">${cells.join("")}</row>`);
  });
  const sheet =
    XML_HEAD +
    `<worksheet xmlns="${NS}" xmlns:r="${RNS}">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` +
    `<sheetData>${rows.join("")}</sheetData>` +
    (jobs.length ? `<autoFilter ref="A1:I${jobs.length + 1}"/>` : "") +
    `</worksheet>`;
  const styles =
    XML_HEAD +
    `<styleSheet xmlns="${NS}">` +
    `<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`;
  return zipStore([
    {
      name: "[Content_Types].xml",
      data:
        XML_HEAD +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `</Types>`,
    },
    {
      name: "_rels/.rels",
      data: XML_HEAD + `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${RNS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data:
        XML_HEAD +
        `<workbook xmlns="${NS}" xmlns:r="${RNS}"><sheets><sheet name="Applications" sheetId="1" r:id="rId1"/></sheets>` +
        (jobs.length ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Applications!$A$1:$I$${jobs.length + 1}</definedName></definedNames>` : "") +
        `</workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data:
        XML_HEAD +
        `<Relationships xmlns="${PKG}">` +
        `<Relationship Id="rId1" Type="${RNS}/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="${RNS}/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    },
    { name: "xl/worksheets/sheet1.xml", data: sheet },
    { name: "xl/styles.xml", data: styles },
  ]);
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function exportJobsXlsx(jobs: Job[], statusLabel?: (s: JobStatus) => string): Blob {
  return new Blob([jobsToXlsx(jobs, statusLabel) as BlobPart], { type: XLSX_MIME });
}
