// War Room backend: live per-job unit state, ops log feed, AFK mode.
//
// Unit state is in memory only (it is a live picture, not a record). Content
// scripts report transitions with {type:"unit"}; job lifecycle events fill in
// the rest. Open War Room pages get throttled {type:"units"} broadcasts.
import { api } from "../shared/api";
import { copy } from "../shared/copy";
import type { UnitState } from "../shared/types";
import { afkStartFromOps, span, summarizeSitrep, type Sitrep } from "../ui/warroom/model";
import { ACTIVE, desktopNotify, on, opsLog, register, toPages } from "./core";
import { getState, mutate } from "./store";

const units = new Map<string, UnitState>();
/** Units whose thumbnail changed since the last broadcast (thumbs are only sent when new). */
const thumbDirty = new Set<string>();

const PUSH_MS = 250; // ≤ 4 broadcasts per second
const LINGER_MS = 30_000; // keep units of finished jobs this long
const THUMB_MS = 6_000;
const THUMB_WIDTH = 320;

// ---------------------------------------------------------------------------
// broadcast (throttled, leading + trailing)

let lastPush = 0;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

function snapshot(withThumbs: "all" | "dirty"): UnitState[] {
  return [...units.values()].map((u) => {
    if (!u.thumb || withThumbs === "all" || thumbDirty.has(u.jobId)) return { ...u };
    const { thumb: _t, ...rest } = u;
    return rest;
  });
}

function flush(): void {
  pushTimer = null;
  lastPush = Date.now();
  const list = snapshot("dirty");
  thumbDirty.clear();
  toPages({ type: "units", units: list });
}

function pushUnits(): void {
  if (pushTimer) return;
  const wait = PUSH_MS - (Date.now() - lastPush);
  if (wait <= 0) flush();
  else pushTimer = setTimeout(flush, wait);
}

const BLANK: Omit<UnitState, "jobId" | "updatedAt"> = { phase: "opening", step: 1, fieldsTotal: 0, fieldsDone: 0, currentField: "" };

function setUnit(jobId: string, patch: Partial<Omit<UnitState, "jobId" | "updatedAt">>): UnitState {
  const prev = units.get(jobId);
  const next: UnitState = { ...BLANK, ...prev, ...patch, jobId, updatedAt: Date.now() };
  units.set(jobId, next);
  pushUnits();
  schedulePrune();
  return next;
}

// ---------------------------------------------------------------------------
// pruning: drop units for jobs that are no longer active after LINGER_MS

let pruneTimer: ReturnType<typeof setInterval> | null = null;

async function prune(): Promise<void> {
  if (!units.size) return;
  const s = await getState();
  const now = Date.now();
  let changed = false;
  for (const [id, u] of units) {
    const job = s.jobs.find((j) => j.id === id);
    const live = job && (ACTIVE.includes(job.status) || job.status === "queued");
    if (!job || (!live && now - u.updatedAt > LINGER_MS)) {
      units.delete(id);
      changed = true;
    }
  }
  if (changed) pushUnits();
  if (!units.size && pruneTimer) {
    clearInterval(pruneTimer);
    pruneTimer = null;
  }
}

function schedulePrune(): void {
  pruneTimer ??= setInterval(() => void prune().catch(() => undefined), 10_000);
}

// ---------------------------------------------------------------------------
// job lifecycle → unit phase

on("launched", ({ job }) => void setUnit(job.id, { ...BLANK, phase: "opening", step: 1 }));
on("needs", ({ job }) => void setUnit(job.id, { phase: "holding" }));
on("released", ({ job }) => void setUnit(job.id, { phase: "releasing", currentField: "" }));
on("delivered", ({ job }) => {
  const u = units.get(job.id);
  setUnit(job.id, { phase: "delivered", currentField: "", ...(u?.fieldsTotal ? { fieldsDone: u.fieldsTotal } : {}) });
});
on("lost", ({ job }) => void setUnit(job.id, { phase: "lost", currentField: "" }));

// ---------------------------------------------------------------------------
// thumbnails (Firefox tabs.captureTab; best effort, only while a War Room is open)

const warrooms = new Set<browser.runtime.Port>();
let thumbTimer: ReturnType<typeof setTimeout> | null = null;

api.runtime.onConnect.addListener((port) => {
  if (port.name !== "warroom") return;
  warrooms.add(port);
  port.onDisconnect.addListener(() => warrooms.delete(port));
  thumbTimer ??= setTimeout(thumbLoop, 1_500);
});

async function thumbLoop(): Promise<void> {
  thumbTimer = null;
  if (!warrooms.size) return;
  try {
    await captureThumbs();
  } catch {
    /* best effort */
  }
  if (warrooms.size) thumbTimer = setTimeout(thumbLoop, THUMB_MS);
}

async function captureThumbs(): Promise<void> {
  const tabs = api.tabs as typeof api.tabs & { captureTab?: unknown };
  if (typeof tabs.captureTab !== "function") return; // Chromium: no captureTab, schematic only
  const s = await getState();
  let any = false;
  for (const u of units.values()) {
    const job = s.jobs.find((j) => j.id === u.jobId);
    if (!job || job.tabId == null || !ACTIVE.includes(job.status)) continue;
    try {
      const tab = await api.tabs.get(job.tabId);
      const scale = tab.width ? Math.min(1, THUMB_WIDTH / tab.width) : 0.25;
      const raw = await api.tabs.captureTab(job.tabId, { format: "jpeg", quality: 40, scale });
      const thumb = await downscale(raw, THUMB_WIDTH);
      const cur = units.get(u.jobId);
      if (cur && thumb) {
        cur.thumb = thumb;
        thumbDirty.add(u.jobId);
        any = true;
      }
    } catch {
      /* tab gone, discarded, or capture refused: skip */
    }
  }
  if (any) pushUnits();
}

/**
 * Shrink a data: URL image to ≤ maxWidth px wide (OffscreenCanvas when
 * available). Returns null for a blank capture (e.g. an unrendered background tab).
 */
async function downscale(dataUrl: string, maxWidth: number): Promise<string | null> {
  try {
    if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap !== "function") return dataUrl;
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const w = Math.min(maxWidth, bmp.width);
    const h = Math.max(1, Math.round((bmp.height * w) / bmp.width));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    if (isBlank(ctx.getImageData(0, 0, w, h).data)) return null;
    return await blobToDataUrl(await canvas.convertToBlob({ type: "image/jpeg", quality: 0.5 }));
  } catch {
    return dataUrl;
  }
}

/** True when sampled pixels are (nearly) all the same brightness. */
function isBlank(px: Uint8ClampedArray): boolean {
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < px.length; i += 4 * 97) {
    const l = (px[i]! * 3 + px[i + 1]! * 6 + px[i + 2]!) / 10;
    if (l < lo) lo = l;
    if (l > hi) hi = l;
  }
  return hi - lo < 8;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || "image/jpeg"};base64,${btoa(bin)}`;
}

// ---------------------------------------------------------------------------
// AFK

const AFK_KEY = "warroom.afkSince";
let afkSince: number | null = null;

type SessionArea = { get(k: string): Promise<Record<string, unknown>>; set(v: Record<string, unknown>): Promise<void>; remove(k: string): Promise<void> };
const session = (): SessionArea | undefined => (api.storage as unknown as { session?: SessionArea }).session;

async function readAfkSince(): Promise<number | null> {
  if (afkSince != null) return afkSince;
  try {
    const v = (await session()?.get(AFK_KEY))?.[AFK_KEY];
    return typeof v === "number" ? v : null;
  } catch {
    return null;
  }
}

async function writeAfkSince(t: number | null): Promise<void> {
  afkSince = t;
  try {
    if (t == null) await session()?.remove(AFK_KEY);
    else await session()?.set({ [AFK_KEY]: t });
  } catch {
    /* storage.session unavailable: memory only */
  }
}

export interface AfkReply {
  afk: boolean;
  since: number | null;
  sitrep: Sitrep | null;
}

async function setAfk(afk: boolean): Promise<AfkReply> {
  const was = await mutate((s) => {
    const prev = s.settings.afk;
    s.settings.afk = afk;
    return prev;
  });
  const s = await getState();
  if (afk) {
    let since = await readAfkSince();
    if (!was || since == null) {
      since = Date.now();
      await writeAfkSince(since);
      await opsLog("afk", copy(s.settings, "ops.afk.on"));
    }
    return { afk: true, since, sitrep: null };
  }
  if (!was) return { afk: false, since: null, sitrep: null };
  const now = Date.now();
  const since = (await readAfkSince()) ?? afkStartFromOps(s.ops) ?? now;
  await writeAfkSince(null);
  await opsLog("afk", copy(s.settings, "ops.afk.off"));
  const rep = summarizeSitrep({ ops: s.ops, jobs: s.jobs, needs: s.needs, since, now });
  const vars = { dur: span(now - since), delivered: rep.delivered, holding: rep.holding, contacts: rep.contacts, lost: rep.lost };
  await opsLog("afk", copy(s.settings, "warroom.sitrep.line", vars));
  if (s.settings.notifications) {
    await desktopNotify(`sitrep-${now}`, copy(s.settings, "notify.sitrep.title"), copy(s.settings, "warroom.sitrep.notify", vars));
  }
  return { afk: false, since, sitrep: rep };
}

// ---------------------------------------------------------------------------
// War Room page

async function openWarRoom(): Promise<boolean> {
  const url = api.runtime.getURL("warroom.html");
  const tabs = await api.tabs.query({});
  const open = tabs.find((t) => t.url?.split(/[?#]/)[0] === url);
  if (open?.id != null) {
    await api.tabs.update(open.id, { active: true });
    if (open.windowId != null) await api.windows.update(open.windowId, { focused: true }).catch(() => undefined);
    return true;
  }
  await api.tabs.create({ url, active: true });
  return true;
}

// ---------------------------------------------------------------------------
// messages

register({
  unit: async (msg, sender) => {
    const tabId = sender.tab?.id;
    if (tabId == null || !msg.jobId) return false;
    const job = (await getState()).jobs.find((j) => j.id === msg.jobId);
    if (!job || job.tabId !== tabId) return false;
    const prev = units.get(job.id);
    const st = msg.state;
    // Steps survive full-page navigations (a fresh content script restarts at 1):
    // each new "advancing" bumps the step past what we already know.
    let step = Math.max(1, st.step || 1, prev?.step ?? 1);
    if (st.phase === "advancing" && prev?.phase !== "advancing") step = Math.max((prev?.step ?? 1) + 1, st.step || 1);
    // A confirmation / submit report from a fresh page knows no field counts: keep the last ones.
    const keepCounts = !st.fieldsTotal && !!prev && (st.phase === "delivered" || st.phase === "releasing" || st.phase === "recon");
    const total = keepCounts ? prev!.fieldsTotal : Math.max(0, st.fieldsTotal | 0);
    const done = keepCounts ? (st.phase === "delivered" ? prev!.fieldsTotal : prev!.fieldsDone) : Math.max(0, st.fieldsDone | 0);
    setUnit(job.id, {
      phase: st.phase,
      step,
      fieldsTotal: total,
      fieldsDone: Math.min(done, total || Infinity),
      currentField: String(st.currentField ?? "").slice(0, 120),
    });
    return true;
  },

  getUnits: async () => {
    await prune().catch(() => undefined);
    return snapshot("all");
  },

  getOps: async (msg) => {
    const limit = Math.max(1, Math.min(300, Math.floor(msg.limit ?? 300)));
    return (await getState()).ops.slice(-limit);
  },

  openWarRoom: () => openWarRoom(),

  setAfk: (msg) => setAfk(!!msg.afk),
});
