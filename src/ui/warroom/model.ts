// War Room pure logic: no DOM, no browser APIs, so it is unit-testable and
// shared with the background (sitrep). Rendering lives in the sibling files.
import { dtgShort } from "../../shared/display";
import type { FieldCheck, Job, JobStatus, Need, OpsEvent, OpsKind, UnitPhase, UnitState } from "../../shared/types";

/** What a track row shows. "queued" is a job waiting for a free unit. */
export type DisplayPhase = UnitPhase | "queued";

const ACTIVE: JobStatus[] = ["running", "needs_you", "ready_to_submit"];
const APPLIED: JobStatus[] = ["submitted", "interviewing", "offer", "rejected"];

// ---------------------------------------------------------------------------
// rank

/** Minimum delivered count for each rank, in order. Names live in copy (warroom.rank.N). */
export const RANK_THRESHOLDS = [0, 5, 10, 20, 35, 50, 75, 100, 150, 250] as const;

export interface RankInfo {
  /** Index into RANK_THRESHOLDS (and copy key warroom.rank.N). */
  index: number;
  /** Index of the next rank, or null at the top. */
  next: number | null;
  /** Deliveries still needed for the next rank (0 at the top). */
  toNext: number;
  /** 0..1 progress from this rank's threshold to the next one. */
  progress: number;
}

export function rankFor(delivered: number): RankInfo {
  const n = Math.max(0, Math.floor(delivered || 0));
  let index = 0;
  for (let i = 0; i < RANK_THRESHOLDS.length; i++) if (n >= RANK_THRESHOLDS[i]!) index = i;
  if (index === RANK_THRESHOLDS.length - 1) return { index, next: null, toNext: 0, progress: 1 };
  const lo = RANK_THRESHOLDS[index]!;
  const hi = RANK_THRESHOLDS[index + 1]!;
  return { index, next: index + 1, toNext: hi - n, progress: (n - lo) / (hi - lo) };
}

// ---------------------------------------------------------------------------
// time formatting

const pad = (n: number) => String(n).padStart(2, "0");

/** "HH:MM:SS" in UTC (utc=true) or local time. */
export function clock(t: number, utc = false): string {
  const d = new Date(t);
  return utc ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` : `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Zulu clock for the header: "14:03:22Z". */
export function zulu(t: number): string {
  return `${clock(t, true)}Z`;
}

/** Stopwatch style: "mm:ss", or "h:mm:ss" past an hour. */
export function stopwatch(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** Human span: "45s", "12m", "1h 05m", "2d 3h". */
export function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${pad(m % 60)}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

// ---------------------------------------------------------------------------
// ops log

export type LogFilter = "all" | "ops" | "intel" | "errors";
export const LOG_FILTERS: LogFilter[] = ["all", "ops", "intel", "errors"];

const FILTER_KINDS: Record<Exclude<LogFilter, "all">, OpsKind[]> = {
  ops: ["launch", "intervene", "release", "deliver", "lost", "afk", "system"],
  intel: ["intel", "contact"],
  errors: ["error"],
};

export function matchesFilter(kind: OpsKind, filter: LogFilter): boolean {
  return filter === "all" || FILTER_KINDS[filter].includes(kind);
}

/** Signal colors, cockpit doctrine: red warning, amber caution, green normal, cyan advisory, white status. */
export type Tone = "ok" | "warn" | "alert" | "advisory" | "status" | "dim";

/**
 * Color for a log kind. The log is mostly white: amber belongs to the master
 * caution and the rows on hold, red to real faults, cyan to replies.
 */
export function kindTone(kind: OpsKind): Tone {
  switch (kind) {
    case "launch":
    case "intervene":
    case "deliver":
    case "release":
      return "status";
    case "contact":
    case "intel":
      return "advisory";
    case "error":
      return "alert";
    default:
      return "dim";
  }
}

export interface LogLine {
  id: string;
  /** Short date-time group ("121736Z") in chud mode, local "HH:MM" in plain mode. */
  time: string;
  kind: OpsKind;
  tone: Tone;
  text: string;
}

export function logLine(e: OpsEvent, chud = true): LogLine {
  return { id: e.id, time: chud ? dtgShort(e.t) : clock(e.t).slice(0, 5), kind: e.kind, tone: kindTone(e.kind), text: shortenUrls(e.text) };
}

/** Log-friendly URLs: "https://www.acme.com/jobs/123?src=x" → "acme.com/jobs/123" (host and path, no port). */
export function shortenUrls(text: string, max = 48): string {
  return text.replace(/https?:\/\/[^\s·|]+/gi, (u) => {
    try {
      const x = new URL(u);
      const s = x.hostname.replace(/^www\./, "") + (x.pathname === "/" ? "" : x.pathname.replace(/\/$/, ""));
      return s.length > max ? `${s.slice(0, max - 1)}…` : s;
    } catch {
      return u;
    }
  });
}

/** Merge new events into a capped, id-deduped, time-ordered list (newest last). */
export function mergeOps(list: OpsEvent[], incoming: OpsEvent[], cap = 300): OpsEvent[] {
  const seen = new Set(list.map((e) => e.id));
  const out = list.slice();
  let sorted = true;
  for (const e of incoming) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    if (out.length && e.t < out[out.length - 1]!.t) sorted = false;
    out.push(e);
  }
  if (!sorted) out.sort((a, b) => a.t - b.t);
  return out.length > cap ? out.slice(out.length - cap) : out;
}

// ---------------------------------------------------------------------------
// sitrep (AFK summary) — also used by background/units.ts

export interface Sitrep {
  since: number;
  until: number;
  delivered: number;
  holding: number;
  contacts: number;
  lost: number;
}

export function summarizeSitrep(input: { ops: OpsEvent[]; jobs: Job[]; needs: Need[]; since: number; now: number }): Sitrep {
  const { ops, jobs, needs, since, now } = input;
  const recent = ops.filter((e) => e.t >= since && e.t <= now);
  const delivered = new Set<string>();
  for (const j of jobs) if (j.appliedAt != null && j.appliedAt >= since && j.appliedAt <= now) delivered.add(j.id);
  let anon = 0;
  for (const e of recent) if (e.kind === "deliver") e.jobId ? delivered.add(e.jobId) : anon++;
  const countKind = (kind: OpsKind) => {
    const ids = new Set<string>();
    let n = 0;
    for (const e of recent) if (e.kind === kind) e.jobId ? ids.add(e.jobId) : n++;
    return ids.size + n;
  };
  return {
    since,
    until: now,
    delivered: delivered.size + anon,
    holding: new Set(needs.map((n) => n.jobId)).size,
    contacts: countKind("contact"),
    lost: countKind("lost"),
  };
}

/** When AFK began, if we lost track of it: the latest "afk" ops line. */
export function afkStartFromOps(ops: OpsEvent[]): number | null {
  for (let i = ops.length - 1; i >= 0; i--) if (ops[i]!.kind === "afk") return ops[i]!.t;
  return null;
}

// ---------------------------------------------------------------------------
// unit tiles

export interface TileModel {
  jobId: string;
  company: string;
  title: string;
  url: string;
  location: string;
  status: JobStatus;
  phase: DisplayPhase;
  /** Every open need is a review_submit (awaiting release). */
  ready: boolean;
  step: number;
  fieldsDone: number;
  fieldsTotal: number;
  currentField: string;
  /** Field checklist for the current form step (from the content script). */
  fields: FieldCheck[];
  needs: Need[];
  /** Oldest open need's createdAt, for the HOLD mm:ss timer. */
  holdingSince: number | null;
  thumb?: string;
  createdAt: number;
}

/** The phase a tile shows, reconciling the live unit with the persisted job/needs. */
export function displayPhase(job: Job, unit: UnitState | undefined, jobNeeds: Need[]): DisplayPhase {
  if (APPLIED.includes(job.status)) return "delivered";
  if (job.status === "failed" || job.status === "skipped") return "lost";
  if (job.status === "queued" || job.status === "saved") return "queued";
  if (jobNeeds.length) return "holding";
  if (!unit) return "opening";
  // A stale unit from a previous run (job retried) or a need that was just answered.
  if (unit.phase === "delivered" || unit.phase === "lost") return "opening";
  if (unit.phase === "holding") return "filling";
  return unit.phase;
}

/**
 * Tiles to show: every active job, plus jobs that were delivered/lost within
 * `linger` ms (if their unit says so, or if they were on screen already).
 */
export function deriveTiles(
  jobs: Job[],
  needs: Need[],
  units: Map<string, UnitState>,
  now: number,
  shown: ReadonlySet<string> = new Set(),
  linger = 20_000,
): TileModel[] {
  const out: TileModel[] = [];
  for (const job of jobs) {
    const unit = units.get(job.id);
    const active = ACTIVE.includes(job.status);
    if (!active) {
      const terminal = APPLIED.includes(job.status) || job.status === "failed" || job.status === "skipped";
      if (!terminal) continue;
      const unitRecent = !!unit && (unit.phase === "delivered" || unit.phase === "lost") && now - unit.updatedAt < linger;
      const jobRecent = shown.has(job.id) && now - job.updatedAt < linger;
      if (!unitRecent && !jobRecent) continue;
    }
    const jobNeeds = needs.filter((n) => n.jobId === job.id);
    const phase = displayPhase(job, unit, jobNeeds);
    const total = unit?.fieldsTotal ?? 0;
    out.push({
      jobId: job.id,
      company: job.company,
      title: job.title,
      url: job.url,
      location: job.location,
      status: job.status,
      phase,
      ready: jobNeeds.length > 0 && jobNeeds.every((n) => n.kind === "review_submit"),
      step: Math.max(1, unit?.step ?? 1),
      fieldsDone: phase === "delivered" && total ? total : Math.min(unit?.fieldsDone ?? 0, total || Infinity),
      fieldsTotal: total,
      currentField: unit?.currentField ?? "",
      fields: unit?.fields ?? [],
      needs: jobNeeds,
      holdingSince: jobNeeds.length ? Math.min(...jobNeeds.map((n) => n.createdAt)) : null,
      ...(unit?.thumb ? { thumb: unit.thumb } : {}),
      createdAt: job.createdAt,
    });
  }
  // Finished units sink below the live ones; otherwise launch order (stable).
  const done = (t: TileModel) => Number(t.phase === "delivered" || t.phase === "lost");
  return out.sort((a, b) => done(a) - done(b) || a.createdAt - b.createdAt);
}

/** 0..1 fill progress for a tile's bar. */
export function progressOf(t: Pick<TileModel, "fieldsDone" | "fieldsTotal" | "phase">): number {
  if (t.phase === "delivered" || t.phase === "releasing") return 1;
  if (!t.fieldsTotal) return 0;
  return Math.max(0, Math.min(1, t.fieldsDone / t.fieldsTotal));
}

/**
 * Stable unit slots (ALPHA, BRAVO…): a job keeps its slot while on screen; freed slots
 * are reused lowest-first.
 */
export class SlotMap {
  private slots = new Map<string, number>();

  assign(ids: string[]): Map<string, number> {
    const keep = new Set(ids);
    for (const id of [...this.slots.keys()]) if (!keep.has(id)) this.slots.delete(id);
    const used = new Set(this.slots.values());
    for (const id of ids) {
      if (this.slots.has(id)) continue;
      let n = 1;
      while (used.has(n)) n++;
      used.add(n);
      this.slots.set(id, n);
    }
    return new Map(this.slots);
  }
}

/** Clamp the War Room's UNITS stepper (settings.concurrency). */
export function clampUnits(n: number): number {
  return Math.max(1, Math.min(6, Math.round(Number.isFinite(n) ? n : 1)));
}
