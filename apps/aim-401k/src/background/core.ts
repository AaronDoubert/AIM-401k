import { api } from "../shared/api";
import { copy } from "../shared/copy";
import type { NeedInput, OverlayState, PublicSettings, ToBackground, ToContent, ToPages } from "../shared/messages";
import type { Job, JobStatus, Need, OpsEvent, OpsKind } from "../shared/types";
import { uid } from "../shared/util";
import { aiReady } from "./ai";
import { getState, mutate, type State } from "./store";

// Shared background plumbing. index.ts owns the core job/needs messages;
// feature modules (units.ts, intel.ts, data.ts) register their own message
// handlers and subscribe to job events here, so they stay in separate files.

export type Sender = browser.runtime.MessageSender;
type Msg<K extends ToBackground["type"]> = Extract<ToBackground, { type: K }>;
export type Handlers = { [K in ToBackground["type"]]?: (msg: Msg<K>, sender: Sender) => unknown };

const registry: Handlers = {};

/** Register message handlers from a feature module. */
export function register(handlers: Handlers): void {
  Object.assign(registry, handlers);
}

export function dispatch(msg: ToBackground, sender: Sender): unknown {
  const fn = registry[msg.type] as ((m: ToBackground, s: Sender) => unknown) | undefined;
  return fn ? fn(msg, sender) : undefined;
}

// --- job lifecycle events ---------------------------------------------------

export interface JobEvents {
  /** A queued job got a tab and started. */
  launched: { job: Job };
  /** New needs were raised for a job (already persisted). */
  needs: { job: Job; needs: Need[] };
  /** The human answered / approved something. */
  intervened: { job: Job; what: string };
  /** Final submit was triggered (by the human or auto-submit). */
  released: { job: Job };
  /** Confirmation page detected. */
  delivered: { job: Job };
  /** Job failed, was skipped, or its tab was lost. */
  lost: { job: Job; why: string };
  /** Any status change (incl. manual ones from the tracker and intel). */
  status: { job: Job; from: JobStatus; to: JobStatus };
  /** Free-form progress line from the content script. */
  progress: { job: Job; msg: string };
}

type Listener<K extends keyof JobEvents> = (e: JobEvents[K]) => void;
const listeners: { [K in keyof JobEvents]?: Listener<K>[] } = {};

export function on<K extends keyof JobEvents>(event: K, fn: Listener<K>): void {
  ((listeners[event] ??= []) as Listener<K>[]).push(fn);
}

export function emit<K extends keyof JobEvents>(event: K, payload: JobEvents[K]): void {
  for (const fn of (listeners[event] ?? []) as Listener<K>[]) {
    try {
      fn(payload);
    } catch (e) {
      console.error("listener failed", event, e);
    }
  }
}

// --- ops log (War Room terminal) ---------------------------------------------

const OPS_CAP = 300;

/** Append a line to the ops log and push it to open extension pages. */
export async function opsLog(kind: OpsKind, text: string, jobId?: string): Promise<OpsEvent> {
  const event: OpsEvent = { id: uid("op_"), t: Date.now(), kind, text, ...(jobId ? { jobId } : {}) };
  await mutate((s) => {
    s.ops.push(event);
    if (s.ops.length > OPS_CAP) s.ops.splice(0, s.ops.length - OPS_CAP);
  });
  toPages({ type: "opsEvent", event });
  return event;
}

/** Broadcast to extension pages (War Room, tracker). Content scripts don't receive these. */
export function toPages(msg: ToPages): void {
  void api.runtime.sendMessage(msg).catch(() => undefined);
}

export function jobLabel(job: Job | undefined): string {
  return job ? [job.company, job.title].filter(Boolean).join(" · ") || job.url : "?";
}

export const ACTIVE: JobStatus[] = ["running", "needs_you", "ready_to_submit"];
const LOG_CAP = 60;

// ---------------------------------------------------------------------------
// helpers

export function log(job: Job, msg: string): void {
  job.log.push({ t: Date.now(), msg });
  if (job.log.length > LOG_CAP) job.log.splice(0, job.log.length - LOG_CAP);
  job.updatedAt = Date.now();
}

export function newJob(url: string, status: JobStatus, autoTab: boolean): Job {
  const now = Date.now();
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    /* keep empty */
  }
  return {
    id: uid("job_"),
    url,
    company: "",
    title: "",
    location: "",
    ats: host,
    status,
    createdAt: now,
    updatedAt: now,
    appliedAt: null,
    lastProgressAt: now,
    notes: "",
    tabId: null,
    autoTab,
    aiDrafted: 0,
    log: [],
  };
}

/** Status of an in-flight job, derived from its open needs. */
export function statusFromNeeds(s: State, jobId: string): JobStatus {
  const needs = s.needs.filter((n) => n.jobId === jobId);
  if (!needs.length) return "running";
  return needs.every((n) => n.kind === "review_submit") ? "ready_to_submit" : "needs_you";
}

export function publicSettings(s: State): PublicSettings {
  const { apiKeys: _keys, ...rest } = s.settings;
  return { ...rest, hasApiKey: aiReady(s.settings) };
}

export function overlayState(s: State): OverlayState {
  const jobs: OverlayState["jobs"] = {};
  for (const j of s.jobs) if (ACTIVE.includes(j.status) || s.needs.some((n) => n.jobId === j.id)) {
    jobs[j.id] = { id: j.id, company: j.company, title: j.title, status: j.status, tabId: j.tabId };
  }
  return {
    needs: s.needs,
    jobs,
    paused: s.settings.paused,
    running: s.jobs.filter((j) => j.status === "running").length,
    queued: s.jobs.filter((j) => j.status === "queued").length,
    chud: s.settings.ui.chud,
  };
}

export function toTab(tabId: number, msg: ToContent, frameId?: number): Promise<unknown> {
  const opts = frameId != null && frameId >= 0 ? { frameId } : undefined;
  return api.tabs.sendMessage(tabId, msg, opts).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// fan-out: overlay on every tab, toolbar badge, desktop notifications

let broadcastTimer: ReturnType<typeof setTimeout> | null = null;
export function broadcast(): void {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(async () => {
    broadcastTimer = null;
    const s = await getState();
    const state = overlayState(s);
    const n = s.needs.length;
    await api.action.setBadgeText({ text: n ? String(n) : state.running ? "…" : "" });
    await api.action.setBadgeBackgroundColor({ color: n ? "#dc2626" : "#2563eb" });
    const tabs = await api.tabs.query({});
    for (const t of tabs) if (t.id != null && /^(https?|file):/.test(t.url ?? "")) void toTab(t.id, { type: "overlay", state }, 0);
  }, 120);
}

export async function notify(s: State, fresh: Need[]): Promise<void> {
  // In AFK mode the War Room collects prompts instead of desktop pings.
  if (!s.settings.notifications || s.settings.afk) return;
  for (const n of fresh) {
    if (n.kind === "review_submit") continue; // feed.ts sends the "ready" ping
    const job = s.jobs.find((j) => j.id === n.jobId);
    await desktopNotify(n.id, copy(s.settings, "notify.need.title", { company: job?.company || "A target" }), n.prompt);
  }
}

/** One short desktop notification (title + one line). */
export async function desktopNotify(id: string, title: string, message: string): Promise<void> {
  await api.notifications
    .create(id, { type: "basic", iconUrl: api.runtime.getURL("icons/icon-96.png"), title, message: message.slice(0, 200) })
    .catch(() => undefined);
}

// ---------------------------------------------------------------------------
// queue runner

export async function pump(): Promise<void> {
  await mutate(async (s) => {
    if (s.settings.paused) return;
    const running = () => s.jobs.filter((j) => j.status === "running").length;
    const open = () => s.jobs.filter((j) => ACTIVE.includes(j.status) && j.tabId != null).length;
    const queued = s.jobs.filter((j) => j.status === "queued").sort((a, b) => a.createdAt - b.createdAt);
    for (const job of queued) {
      if (!/^https?:\/\//i.test(job.url)) {
        // e.g. a spreadsheet row imported without a link: nothing to open.
        job.status = "saved";
        log(job, "No link to open; add the posting URL to apply");
        continue;
      }
      if (running() >= Math.max(1, s.settings.concurrency) || open() >= Math.max(1, s.settings.maxOpenTabs)) break;
      try {
        const tab = await api.tabs.create({ url: job.url, active: false });
        job.tabId = tab.id ?? null;
        job.autoTab = true;
        job.status = "running";
        job.lastProgressAt = Date.now();
        log(job, "Opened application tab");
        emit("launched", { job });
      } catch (e) {
        job.status = "failed";
        log(job, `Couldn't open tab: ${String(e)}`);
        emit("lost", { job, why: "couldn't open tab" });
      }
    }
  });
  broadcast();
}

export async function closeTabLater(tabId: number | null, ms: number): Promise<void> {
  if (tabId == null) return;
  setTimeout(() => void api.tabs.remove(tabId).catch(() => undefined), ms);
}

/** Replace the needs a given frame of a job reported, keeping ids for unchanged ones. */
export function replaceNeeds(s: State, jobId: string, frameId: number, inputs: NeedInput[]): Need[] {
  const sameAs = (n: Need, i: NeedInput) => n.kind === i.kind && n.fieldKey === i.fieldKey && n.prompt === i.prompt;
  const old = s.needs.filter((n) => n.jobId === jobId && n.frameId === frameId);
  const kept: Need[] = [];
  const fresh: Need[] = [];
  for (const i of inputs) {
    const prev = old.find((n) => sameAs(n, i));
    if (prev) {
      prev.detail = i.detail;
      kept.push(prev);
    } else {
      const n: Need = { ...i, id: uid("need_"), jobId, frameId, createdAt: Date.now() };
      fresh.push(n);
      kept.push(n);
    }
  }
  s.needs = [...s.needs.filter((n) => !(n.jobId === jobId && n.frameId === frameId)), ...kept];
  return fresh;
}

export function clearNeeds(s: State, jobId: string): void {
  s.needs = s.needs.filter((n) => n.jobId !== jobId);
}

