// Inbox / spreadsheet intel: classify emails, match them to jobs, update statuses.
// Mail arrives from the Gmail/Outlook tab reader (content/mail.ts) or the
// optional Gmail API sync (gmail.ts); both go through ingest().
// OWNER: Intel agent.
import { z } from "zod";
import { classify, type Classification, fingerprint, guessCompany, looksJobRelated, matchJob, nextStatus } from "../core/intel";
import { api } from "../shared/api";
import { copy, type CopyKey } from "../shared/copy";
import { normalizeSettings, STORAGE_KEYS } from "../shared/defaults";
import type { IntelItem, IntelKind, IntelSource, Job, JobStatus, OpsEvent, Profile, RawMail, Settings } from "../shared/types";
import { truncate, uid } from "../shared/util";
import { aiReady, completeJson } from "./ai";
import { ACTIVE, broadcast, clearNeeds, desktopNotify, emit, log, opsLog, pump, register, toPages } from "./core";
import * as gmail from "./gmail";
import { getState, mutate, type State } from "./store";
import { redactText } from "./tasks";

const INTEL_CAP = 500;
/** Same cap core.ts's opsLog applies to the ops log. */
const OPS_CAP = 300;
/** Below this, keyword results are "weak": AI may re-check them, and they don't change statuses on their own. */
const WEAK = 0.6;
/** Unmatched mail is only kept when it's clearly about hiring. */
const KEEP_UNMATCHED = 0.7;
const AI_PER_BATCH = 3;
const NOTIFY_PER_BATCH = 3;
const NOTIFY_MAX_AGE = 3 * 86_400_000;
const ALARM = "intel-gmail";

export interface IngestResult {
  enabled: boolean;
  added: number;
  matched: number;
  updated: number;
}

const kindLabel = (s: Settings, k: IntelKind) => copy(s, `intel.kind.${k}` as CopyKey);
const dedupeKey = (source: IntelSource, id: string) => `${source.startsWith("gmail") ? "gmail" : source}:${id}`;

/**
 * Mail we classified as noise, so it isn't re-classified (or re-sent to the AI)
 * on every scan. Persisted: Firefox suspends the background page when idle, and
 * an in-memory set would be empty again at every Gmail sync.
 */
const DROPPED_KEY = "intelDropped";
const dropped = new Set<string>();
let droppedLoaded: Promise<void> | null = null;
let droppedSaveTimer: ReturnType<typeof setTimeout> | null = null;

function loadDropped(): Promise<void> {
  droppedLoaded ??= api.storage.local
    .get(DROPPED_KEY)
    .then((r) => {
      const list = (r as Record<string, unknown>)[DROPPED_KEY];
      if (Array.isArray(list)) for (const k of list) if (typeof k === "string") dropped.add(k);
    })
    .catch(() => undefined);
  return droppedLoaded;
}

function drop(key: string): void {
  dropped.add(key);
  if (dropped.size > 3000) dropped.delete(dropped.values().next().value!);
  if (droppedSaveTimer) clearTimeout(droppedSaveTimer);
  droppedSaveTimer = setTimeout(() => void api.storage.local.set({ [DROPPED_KEY]: [...dropped] }).catch(() => undefined), 500);
}

function sourceEnabled(s: Settings, source: IntelSource): boolean {
  if (source === "gmail-tab") return s.intel.gmailTab;
  if (source === "outlook-tab") return s.intel.outlookTab;
  if (source === "gmail-api") return s.intel.gmailApi;
  return true;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Content scripts read untrusted page markup: keep only well-formed, bounded fields. */
function sanitize(raw: unknown): RawMail[] {
  if (!Array.isArray(raw)) return [];
  const out: RawMail[] = [];
  for (const r of raw.slice(0, 200) as Partial<RawMail>[]) {
    if (!r || typeof r !== "object") continue;
    const m: RawMail = {
      messageId: str(r.messageId, 200),
      from: str(r.from, 200),
      fromEmail: str(r.fromEmail, 200).toLowerCase(),
      subject: str(r.subject, 300),
      snippet: str(r.snippet, 600),
      receivedAt: typeof r.receivedAt === "number" && Number.isFinite(r.receivedAt) ? Math.min(r.receivedAt, Date.now() + 3600_000) : Date.now(),
    };
    if (m.messageId && (m.subject || m.snippet)) out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------------------
// optional AI classification for mail the keyword rules aren't sure about

const AiVerdict = z.object({
  kind: z.enum(["received", "rejection", "interview", "assessment", "offer", "other"]).describe("What this email means for the candidate's job application"),
  company: z.string().describe("The hiring company the email is about, or empty if unclear"),
});

const AI_SYSTEM = `You sort a job seeker's emails. Given one email's sender, subject and preview, decide what it means for their job application:
- received: the company confirms it got the application
- rejection: the company is not moving forward
- interview: the company wants to schedule or confirms a call/interview
- assessment: the candidate is asked to complete a test or take-home exercise
- offer: a job offer
- other: anything else (newsletters, job alerts, marketing, unrelated mail)
Only use the text given. If unsure, answer "other".`;

async function aiClassify(s: Settings, m: RawMail, profile?: Partial<Profile>): Promise<{ kind: IntelKind; company: string } | null> {
  try {
    // Privacy guard: the sender's domain is enough to tell the company; the user's own
    // contact details (and anyone's emails/phones) are scrubbed from the text.
    const scrub = (t: string) => (s.aiRedact ? redactText(t, profile) : t);
    const from = s.aiRedact ? `${scrub(m.from)} <…@${m.fromEmail.split("@")[1] ?? ""}>` : `${m.from} <${m.fromEmail}>`;
    const prompt = `From: ${from}\nSubject: ${scrub(m.subject)}\nPreview: ${scrub(m.snippet)}`;
    return await completeJson(s, { schema: AiVerdict, system: AI_SYSTEM, context: [], prompt, maxTokens: 400, consent: ["personalCommunications"] });
  } catch {
    return null; // AI is a helper: fall back to the keyword result
  }
}

/** Which tab reader a page URL belongs to (null for anything that isn't Gmail/Outlook web). */
export function mailSourceFor(url: string): "gmail-tab" | "outlook-tab" | null {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  if (host === "mail.google.com") return "gmail-tab";
  if (host === "outlook.live.com" || host === "outlook.office.com" || host === "outlook.office365.com") return "outlook-tab";
  return null;
}

// ---------------------------------------------------------------------------
// applying a matched email to its job

interface Change {
  job: Job;
  from: JobStatus;
  to: JobStatus;
}

/**
 * Move the job's status as the email implies (if autoStatus). Returns the change, if any.
 * `confirmed` = the user assigned the email themselves, which skips the evidence checks.
 */
function applyStatus(s: State, item: IntelItem, opts: { strong: boolean; confirmed: boolean }): Change | null {
  if (!item.jobId || !s.settings.intel.autoStatus) return null;
  const job = s.jobs.find((j) => j.id === item.jobId);
  if (!job) return null;
  if (!opts.confirmed) {
    // Never let mail steer an application AIM-401k is about to make or is making
    // (e.g. Workday's "thanks for your interest" account mail arrives mid-fill).
    if (ACTIVE.includes(job.status) || job.status === "queued") return null;
    // Mail from before this application is about something else (an older role).
    const since = (job.appliedAt ?? job.createdAt) - 2 * 86_400_000;
    if (item.receivedAt && item.receivedAt < since) return null;
    // Rejections and offers need the sender to vouch for the company, not just a display name.
    if ((item.kind === "rejection" || item.kind === "offer") && !opts.strong) return null;
  }
  const to = nextStatus(job.status, item.kind);
  if (!to) return null;
  const from = job.status;
  if (ACTIVE.includes(from) && !ACTIVE.includes(to)) {
    // The application is settled elsewhere: stop the runner from fighting over the tab.
    clearNeeds(s, job.id);
    job.tabId = null;
  }
  if (to === "submitted" && !job.appliedAt) job.appliedAt = item.receivedAt || Date.now();
  log(job, `Email (${item.kind}): "${truncate(item.subject || item.snippet, 80)}" → ${to}`);
  emit("status", { job, from, to });
  job.status = to;
  job.updatedAt = Date.now();
  item.applied = true;
  return { job, from, to };
}

function sortCap(s: State): void {
  s.intel.sort((a, b) => b.receivedAt - a.receivedAt);
  if (s.intel.length > INTEL_CAP) s.intel.length = INTEL_CAP;
}

function opsLine(s: Settings, item: IntelItem): string {
  return copy(s, item.jobId ? "intel.ops" : "intel.ops.unmatched", {
    company: item.company || item.from || "?",
    subject: truncate(item.subject || item.snippet || "(no subject)", 40),
    kind: kindLabel(s, item.kind),
  });
}

async function notifyItems(s: Settings, items: IntelItem[], jobs: Job[]): Promise<void> {
  if (!s.notifications || s.afk) return;
  const worth = items.filter((i) => i.jobId && ["interview", "offer", "rejection"].includes(i.kind) && Date.now() - i.receivedAt < NOTIFY_MAX_AGE).slice(-NOTIFY_PER_BATCH);
  for (const i of worth) {
    const job = jobs.find((j) => j.id === i.jobId);
    const company = i.company || job?.company || "Target";
    const key = i.kind === "offer" ? "notify.offer.title" : i.kind === "rejection" ? "notify.rejected.title" : "notify.contact.title";
    // Rejections get one line; interviews and offers carry the subject.
    await desktopNotify(`intel-${i.id}`, copy(s, key, { company }), i.kind === "rejection" ? job?.title || "" : truncate(i.subject || i.snippet, 120));
  }
}

/** Classify, match, store and act on a batch of mail from one source. */
export async function ingest(source: IntelSource, raw: unknown): Promise<IngestResult> {
  await loadDropped();
  const s0 = await getState();
  if (!sourceEnabled(s0.settings, source)) return { enabled: false, added: 0, matched: 0, updated: 0 };
  // Oldest first, so a later rejection wins over an earlier "received".
  const mails = sanitize(raw).sort((a, b) => a.receivedAt - b.receivedAt);
  if (!mails.length) return { enabled: true, added: 0, matched: 0, updated: 0 };

  const known = new Set(s0.intel.map((i) => dedupeKey(i.source, i.messageId)));
  const prints = new Set(s0.intel.map(fingerprint));
  const fresh = mails.filter((m) => !known.has(dedupeKey(source, m.messageId)) && !prints.has(fingerprint(m)) && !dropped.has(dedupeKey(source, m.messageId)));

  // Classify before taking the store lock (AI calls can take seconds).
  const useAi = s0.settings.intel.useAi && aiReady(s0.settings);
  let aiBudget = AI_PER_BATCH;
  const verdicts: { m: RawMail; c: Classification; hint: string }[] = [];
  for (const m of fresh) {
    const fromKnownCompany = matchJob(m, s0.jobs) !== null;
    let c = classify(m, { known: fromKnownCompany });
    let hint = "";
    if (c.confidence < WEAK && useAi && aiBudget > 0 && (fromKnownCompany || looksJobRelated(m, s0.jobs))) {
      aiBudget--;
      const ai = await aiClassify(s0.settings, m, s0.profile);
      if (ai) {
        c = { kind: ai.kind, confidence: 0.7 };
        hint = ai.company.trim().slice(0, 80);
      }
    }
    verdicts.push({ m, c, hint });
  }

  const added: IntelItem[] = [];
  const changes: Change[] = [];
  const events: OpsEvent[] = [];
  const s = await mutate((s) => {
    const seen = new Set(s.intel.map((i) => dedupeKey(i.source, i.messageId)));
    const seenPrints = new Set(s.intel.map(fingerprint));
    for (const { m, c, hint } of verdicts) {
      const key = dedupeKey(source, m.messageId);
      if (seen.has(key) || seenPrints.has(fingerprint(m))) continue;
      const match = c.kind === "other" ? null : matchJob(m, s.jobs, hint);
      if (c.kind === "other" || (!match && c.confidence < KEEP_UNMATCHED)) {
        drop(key);
        continue;
      }
      const item: IntelItem = {
        ...m,
        id: uid("intel_"),
        source,
        kind: c.kind,
        confidence: Math.round(c.confidence * 100) / 100,
        jobId: match?.jobId ?? null,
        company: match?.company || hint || guessCompany(m),
        applied: false,
      };
      if (c.confidence >= WEAK) {
        const ch = applyStatus(s, item, { strong: !!match?.strong, confirmed: false });
        if (ch) changes.push(ch);
      }
      s.intel.push(item);
      seen.add(key);
      seenPrints.add(fingerprint(m));
      added.push(item);
    }
    sortCap(s);
    // One ops line per new email, written with the items (a single storage write per scan).
    for (const item of added) {
      const event: OpsEvent = { id: uid("op_"), t: Date.now(), kind: "intel", text: opsLine(s.settings, item), ...(item.jobId ? { jobId: item.jobId } : {}) };
      s.ops.push(event);
      events.push(event);
    }
    if (s.ops.length > OPS_CAP) s.ops.splice(0, s.ops.length - OPS_CAP);
    return s;
  });

  if (added.length) {
    for (const event of events) toPages({ type: "opsEvent", event });
    toPages({ type: "intel", items: s.intel });
    await notifyItems(s.settings, added, s.jobs);
  }
  if (changes.length) {
    broadcast();
    if (changes.some((c) => ACTIVE.includes(c.from))) void pump();
  }
  return { enabled: true, added: added.length, matched: added.filter((i) => i.jobId).length, updated: changes.length };
}

/** Manual (re)assignment from the tracker. Applies the status when autoStatus is on. */
async function assign(intelId: string, jobId: string | null): Promise<{ ok: boolean; item?: IntelItem; status?: JobStatus }> {
  let change: Change | null = null;
  const res = await mutate((s) => {
    const item = s.intel.find((i) => i.id === intelId);
    if (!item) return null;
    if (!jobId) {
      item.jobId = null;
      item.applied = false;
      return { s, item };
    }
    const job = s.jobs.find((j) => j.id === jobId);
    if (!job) return null;
    item.jobId = job.id;
    item.company = job.company || item.company;
    item.applied = false;
    change = applyStatus(s, item, { strong: true, confirmed: true }); // the user confirmed the match
    return { s, item };
  });
  if (!res) return { ok: false };
  toPages({ type: "intel", items: res.s.intel });
  const ch = change as Change | null;
  if (ch) {
    broadcast();
    if (ACTIVE.includes(ch.from)) void pump();
  }
  return { ok: true, item: res.item, ...(ch ? { status: ch.to } : {}) };
}

// ---------------------------------------------------------------------------
// Gmail API sync (BYO OAuth client)

/** Settings straight from storage: the options page may have written the client id a moment ago. */
async function freshSettings(): Promise<Settings> {
  const raw = (await api.storage.local.get(STORAGE_KEYS.settings)) as { settings?: unknown };
  return normalizeSettings(raw.settings);
}

async function ensureAlarm(on: boolean): Promise<void> {
  const has = await api.alarms.get(ALARM).catch(() => undefined);
  if (on && !has) api.alarms.create(ALARM, { periodInMinutes: 30 });
  if (!on && has) await api.alarms.clear(ALARM).catch(() => undefined);
}

export interface SyncResult {
  ok: boolean;
  added: number;
  lastSync: number;
  error?: string;
  connected: boolean;
}

/** Token rejected and no silent refresh: say so once, then stay quiet until reconnect. */
async function linkLost(s: Settings): Promise<string> {
  const error = "Gmail sign-in expired or was revoked. Click Connect to sign in again.";
  const st = await gmail.getStatus();
  await gmail.signOut(false);
  await gmail.setStatus({ connected: false, error, lostNotified: true });
  if (!st.lostNotified) {
    await opsLog("intel", copy(s, "intel.ops.gmail.lost"));
    if (s.notifications && !s.afk) await desktopNotify("intel-gmail-lost", copy(s, "intel.notify.gmail.lost"), error);
  }
  return error;
}

let syncing: Promise<SyncResult> | null = null;

export function syncGmail(): Promise<SyncResult> {
  syncing ??= runSync().finally(() => (syncing = null));
  return syncing;
}

async function runSync(): Promise<SyncResult> {
  const s = await freshSettings();
  const st = await gmail.getStatus();
  if (!s.intel.gmailApi) return { ok: false, added: 0, lastSync: s.intel.lastSync, connected: st.connected, error: "Gmail API sync is off." };
  const tok = await gmail.validToken(s.intel.gmailClientId);
  if (!tok) return { ok: false, added: 0, lastSync: s.intel.lastSync, connected: false, error: await linkLost(s) };
  try {
    const state = await getState();
    const known = new Set(state.intel.filter((i) => i.source.startsWith("gmail")).map((i) => i.messageId));
    await loadDropped();
    for (const k of dropped) if (k.startsWith("gmail:")) known.add(k.slice(6));
    const mails = await gmail.fetchRecent(tok.token, known);
    const r = await ingest("gmail-api", mails);
    const lastSync = Date.now();
    await mutate((s) => {
      s.settings.intel.lastSync = lastSync;
    });
    await gmail.setStatus({ connected: true, expiresAt: tok.expiresAt, lastSync, error: "" });
    return { ok: true, added: r.added, lastSync, connected: true };
  } catch (e) {
    if (e instanceof gmail.GmailAuthError) return { ok: false, added: 0, lastSync: s.intel.lastSync, connected: false, error: await linkLost(s) };
    const error = e instanceof Error ? e.message : String(e);
    await gmail.setStatus({ error });
    return { ok: false, added: 0, lastSync: s.intel.lastSync, connected: true, error };
  }
}

async function connect(): Promise<SyncResult> {
  const s = await freshSettings();
  const clientId = s.intel.gmailClientId.trim();
  try {
    await gmail.signIn(clientId, true);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await gmail.setStatus({ connected: false, error });
    return { ok: false, added: 0, lastSync: s.intel.lastSync, connected: false, error };
  }
  await mutate((st) => {
    st.settings.intel.gmailApi = true;
    st.settings.intel.gmailClientId = clientId;
  });
  await ensureAlarm(true);
  await opsLog("intel", copy(s, "intel.ops.gmail.up"));
  return syncGmail();
}

async function disconnect(): Promise<boolean> {
  await gmail.signOut(true);
  await gmail.setStatus({ connected: false, error: "", lostNotified: false });
  await mutate((s) => {
    s.settings.intel.gmailApi = false;
  });
  await ensureAlarm(false);
  return true;
}

// ---------------------------------------------------------------------------

register({
  intelIngest: (msg, sender) => {
    // From a content script, the source is whatever mail site the tab is really on.
    if (sender.tab) {
      const source = mailSourceFor(sender.tab.url ?? sender.url ?? "");
      if (!source) return { enabled: false, added: 0, matched: 0, updated: 0 };
      return ingest(source, msg.mails);
    }
    return ingest(msg.source, msg.mails);
  },
  getIntel: async () => (await getState()).intel,
  intelAssign: (msg) => assign(msg.intelId, msg.jobId),
  intelSync: () => syncGmail(),
  gmailConnect: () => connect(),
  gmailDisconnect: () => disconnect(),
});

api.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) void syncGmail();
});

// Keep the 30-minute alarm in step with the setting (also after the options page saves).
void getState().then((s) => ensureAlarm(s.settings.intel.gmailApi && !!s.settings.intel.gmailClientId));
api.storage.onChanged.addListener((changes, area) => {
  const next = changes[STORAGE_KEYS.settings]?.newValue;
  if (area === "local" && next) {
    const s = normalizeSettings(next);
    void ensureAlarm(s.intel.gmailApi && !!s.intel.gmailClientId);
  }
});

// A click on an intel notification opens the tracker, where the feed lives.
api.notifications.onClicked.addListener((id) => {
  if (id.startsWith("intel-")) void api.tabs.create({ url: api.runtime.getURL("tracker.html") });
});
