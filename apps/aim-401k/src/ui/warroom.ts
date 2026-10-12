// War Room: full-screen ops dashboard (radar, unit tiles, ops log, operator panel).
// Data: jobs/needs/settings from storage.local (+ onChanged), live unit state
// and ops events from background broadcasts (+ getUnits/getOps on load).
import { extractUrls } from "../core/csv";
import { api } from "../shared/api";
import { copy, type CopyKey } from "../shared/copy";
import { normalizeSettings, STORAGE_KEYS } from "../shared/defaults";
import type { ToPages } from "../shared/messages";
import type { Job, Need, OpsEvent, Settings, UnitState } from "../shared/types";
import { $, h, send, toast } from "./common";
import { OpsLog } from "./warroom/log";
import {
  afkStartFromOps,
  clampUnits,
  clock,
  deriveTiles,
  killSheet,
  rankFor,
  type Sitrep,
  SlotMap,
  span,
  stopwatch,
  type TileModel,
  unitCounts,
  zulu,
} from "./warroom/model";
import { type Blip, Radar } from "./warroom/radar";
import { deliveredClick, masterCaution, setSoundEnabled, unlockAudio } from "./warroom/sound";
import { type T, TileView } from "./warroom/tiles";

// ---------------------------------------------------------------------------
// state

let settings: Settings = normalizeSettings(undefined);
let jobs: Job[] = [];
let needs: Need[] = [];
const units = new Map<string, UnitState>();
let afkSince: number | null = null;
let linkUp = true;
let seenNeeds: Set<string> | null = null;
let shown = new Set<string>();
/** Latest ops events (for the AFK-start fallback). */
let recentOps: OpsEvent[] = [];
const tiles = new Map<string, TileView>();
const slots = new SlotMap();
const drafts = new Map<string, string>();
/** Company/title as seen while the job was in flight (confirmation pages often lack them). */
const names = new Map<string, { company: string; title: string }>();

const t: T = (key, vars) => copy(settings, key, vars);
const chud = () => settings.ui.chud;

// ---------------------------------------------------------------------------
// elements

const el = {
  title: $("#wr-title"),
  zulu: $("#wr-zulu"),
  local: $("#wr-local"),
  live: $("#wr-live"),
  afkPip: $("#wr-afk-pip"),
  afkStrip: $("#wr-afk-strip"),
  counts: $("#wr-counts"),
  afk: $<HTMLButtonElement>("#wr-afk"),
  unitsOut: $("#wr-units"),
  unitsDec: $<HTMLButtonElement>("#wr-units-dec"),
  unitsInc: $<HTMLButtonElement>("#wr-units-inc"),
  pause: $<HTMLButtonElement>("#wr-pause"),
  sound: $<HTMLButtonElement>("#wr-sound"),
  fs: $<HTMLButtonElement>("#wr-fs"),
  radarMeta: $("#wr-radar-meta"),
  kills: {
    delivered: $("#wr-k-delivered"),
    contacts: $("#wr-k-contacts"),
    secured: $("#wr-k-secured"),
    lost: $("#wr-k-lost"),
  },
  rank: $("#wr-rank"),
  rankBar: $("#wr-rank-bar"),
  rankNext: $("#wr-rank-next"),
  rankInsignia: $("#wr-rank-insignia"),
  tiles: $("#wr-tiles"),
  empty: $("#wr-empty"),
  unitSummary: $("#wr-unit-summary"),
  armInput: $<HTMLTextAreaElement>("#wr-arm-input"),
  armCount: $("#wr-arm-count"),
  armGo: $<HTMLButtonElement>("#wr-arm-go"),
  countdown: $("#wr-countdown"),
  cdNum: $("#wr-cd-num"),
  cdSeq: $("#wr-cd-seq"),
  cdAbort: $<HTMLButtonElement>("#wr-cd-abort"),
  modal: $("#wr-modal"),
};

const radar = new Radar($<HTMLCanvasElement>("#wr-radar"));
const opsLog = new OpsLog($("#wr-log"), $("#wr-chips"), $<HTMLButtonElement>("#wr-log-new"), () => t);

// ---------------------------------------------------------------------------
// copy (static labels carry data-copy="warroom.key")

function applyCopy(): void {
  document.documentElement.dataset.mode = chud() ? "chud" : "plain";
  for (const node of document.querySelectorAll<HTMLElement>("[data-copy]")) node.textContent = t(node.dataset.copy as CopyKey);
  for (const node of document.querySelectorAll<HTMLElement>("[data-copy-placeholder]")) node.setAttribute("placeholder", t(node.dataset.copyPlaceholder as CopyKey));
  radar.setRingLabels(t("warroom.radar.ring.outer"), t("warroom.radar.ring.mid"), t("warroom.radar.ring.inner"));
  opsLog.relabel();
  updateArmCount();
}

// ---------------------------------------------------------------------------
// render

let renderTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRender(): void {
  renderTimer ??= setTimeout(() => {
    renderTimer = null;
    render();
  }, 16);
}

function render(): void {
  const now = Date.now();
  const list = deriveTiles(jobs, needs, units, now, shown);
  for (const m of list) {
    const terminal = m.phase === "delivered" || m.phase === "lost";
    const known = names.get(m.jobId);
    if (!terminal && (m.company || m.title)) names.set(m.jobId, { company: m.company, title: m.title });
    else if (terminal && known) Object.assign(m, known);
  }
  const slotMap = slots.assign(list.map((m) => m.jobId));
  renderTiles(list, slotMap, now);
  shown = new Set(list.map((m) => m.jobId));

  // Radar: every tile plus the queue on the outer ring.
  const blips: Blip[] = list.map((m) => ({ id: m.jobId, label: chud() ? `U${slotMap.get(m.jobId) ?? ""}` : `#${slotMap.get(m.jobId) ?? ""}`, phase: m.phase }));
  for (const j of jobs) if (j.status === "queued") blips.push({ id: j.id, label: "", phase: "queued" });
  radar.setBlips(blips);
  el.radarMeta.textContent = t("warroom.radar.meta", { n: blips.length });

  renderHeader(now);
  renderKillSheet();

  const holding = list.filter((m) => m.needs.length).length;
  document.title = `${holding ? `(${holding}) ` : ""}${t("warroom.doc_title")}`;
}

function renderTiles(list: TileModel[], slotMap: Map<string, number>, now: number): void {
  const ids = new Set(list.map((m) => m.jobId));
  for (const [id, view] of tiles) {
    if (ids.has(id)) continue;
    view.el.remove();
    tiles.delete(id);
  }
  for (const m of list) {
    let view = tiles.get(m.jobId);
    if (!view) {
      view = new TileView(m.jobId, { t: () => t, send, drafts });
      tiles.set(m.jobId, view);
      view.el.classList.add("enter");
    }
    view.update(m, slotMap.get(m.jobId) ?? 0, now, chud());
  }
  // Keep DOM order = list order, moving nodes only when needed (moving would blur a focused input).
  const want = list.map((m) => tiles.get(m.jobId)!.el);
  const have = [...el.tiles.children];
  if (want.length !== have.length || want.some((n, i) => n !== have[i])) {
    want.forEach((n, i) => {
      if (el.tiles.children[i] !== n) el.tiles.insertBefore(n, el.tiles.children[i] ?? null);
    });
  }
  el.empty.hidden = list.length > 0;
  el.tiles.hidden = list.length === 0;
  const c = unitCounts(jobs);
  el.unitSummary.textContent = t("warroom.counts", c);
}

function renderHeader(now: number): void {
  el.zulu.textContent = zulu(now);
  el.local.textContent = `LCL ${clock(now).slice(0, 5)}`;
  const c = unitCounts(jobs);
  el.counts.textContent = t("warroom.counts", c);

  el.live.dataset.state = !linkUp ? "down" : settings.paused ? "paused" : "live";
  el.live.textContent = !linkUp ? t("warroom.offline") : settings.paused ? t("warroom.paused") : t("warroom.live");

  el.afk.setAttribute("aria-pressed", String(settings.afk));
  el.afkPip.hidden = !settings.afk;
  el.afkStrip.hidden = !settings.afk;
  if (settings.afk) el.afkPip.textContent = t("warroom.afk_pip", { dur: stopwatch(now - (afkSince ?? now)) });
  document.body.classList.toggle("is-afk", settings.afk);
  document.body.classList.toggle("is-paused", settings.paused);

  el.unitsOut.textContent = String(clampUnits(settings.concurrency));
  el.unitsDec.disabled = settings.concurrency <= 1;
  el.unitsInc.disabled = settings.concurrency >= 6;
  el.pause.textContent = settings.paused ? t("warroom.ctl.resume") : t("warroom.ctl.pause");
  el.pause.setAttribute("aria-pressed", String(settings.paused));
  el.sound.textContent = settings.ui.sound ? t("warroom.ctl.sound_on") : t("warroom.ctl.sound_off");
  el.sound.setAttribute("aria-pressed", String(settings.ui.sound));
  el.fs.textContent = document.fullscreenElement ? t("warroom.ctl.exit_fullscreen") : t("warroom.ctl.fullscreen");
}

function renderKillSheet(): void {
  const k = killSheet(jobs);
  for (const key of ["delivered", "contacts", "secured", "lost"] as const) el.kills[key].textContent = String(k[key]).padStart(3, "0");
  const r = rankFor(k.delivered);
  el.rank.textContent = t(`warroom.rank.${r.index}` as CopyKey);
  el.rankBar.style.width = `${Math.round(r.progress * 100)}%`;
  el.rankNext.textContent = r.next == null ? t("warroom.rank.max") : t("warroom.rank.next", { n: r.toNext, rank: t(`warroom.rank.${r.next}` as CopyKey) });
  if (el.rankInsignia.dataset.rank !== String(r.index)) {
    el.rankInsignia.dataset.rank = String(r.index);
    el.rankInsignia.replaceChildren(...insignia(r.index));
  }
}

/** Chevrons / bars / stars for the rank badge (pure decoration). */
function insignia(index: number): HTMLElement[] {
  if (index === 0) return [h("i", { className: "ins dot" })];
  if (index <= 4) return Array.from({ length: index }, () => h("i", { className: "ins chev" }));
  if (index <= 6) return Array.from({ length: index - 4 }, () => h("i", { className: "ins bar" }));
  return Array.from({ length: index - 6 }, () => h("i", { className: "ins star", textContent: "★" }));
}

// ---------------------------------------------------------------------------
// data in

function mergeUnits(list: UnitState[]): void {
  const prev = new Map(units);
  units.clear();
  for (const u of list) {
    const thumb = u.thumb ?? prev.get(u.jobId)?.thumb;
    units.set(u.jobId, thumb ? { ...u, thumb } : u);
  }
  scheduleRender();
}

function onNeeds(next: Need[]): void {
  if (seenNeeds) {
    const fresh = next.filter((n) => !seenNeeds!.has(n.id));
    if (fresh.length && settings.ui.sound) masterCaution();
  }
  seenNeeds = new Set(next.map((n) => n.id));
  needs = next;
}

api.runtime.onMessage.addListener((raw: unknown) => {
  const msg = raw as ToPages | undefined;
  if (msg?.type === "units") {
    linkUp = true;
    mergeUnits(msg.units);
  } else if (msg?.type === "opsEvent") {
    recentOps = [...recentOps.slice(-299), msg.event];
    if (opsLog.add(msg.event) && msg.event.kind === "deliver" && settings.ui.sound) deliveredClick();
  }
  return undefined; // never answer: background handles requests
});

api.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[STORAGE_KEYS.jobs]) jobs = (changes[STORAGE_KEYS.jobs]!.newValue as Job[] | undefined) ?? [];
  if (changes[STORAGE_KEYS.needs]) onNeeds((changes[STORAGE_KEYS.needs]!.newValue as Need[] | undefined) ?? []);
  if (changes[STORAGE_KEYS.settings]) {
    const was = settings;
    settings = normalizeSettings(changes[STORAGE_KEYS.settings]!.newValue);
    setSoundEnabled(settings.ui.sound);
    if (settings.afk && !was.afk) afkSince ??= Date.now();
    if (!settings.afk) afkSince = null;
    if (was.ui.chud !== settings.ui.chud) applyCopy();
  }
  scheduleRender();
});

async function pollUnits(): Promise<void> {
  try {
    const list = await send<UnitState[]>({ type: "getUnits" });
    linkUp = Array.isArray(list);
    if (Array.isArray(list)) mergeUnits(list);
  } catch {
    linkUp = false;
    scheduleRender();
  }
}

async function pollOps(): Promise<void> {
  try {
    const list = await send<OpsEvent[]>({ type: "getOps", limit: 300 });
    if (Array.isArray(list)) {
      recentOps = list;
      opsLog.load(list);
    }
  } catch {
    /* background asleep; next poll */
  }
}

/** A named port tells the background a War Room is watching (enables thumbnails). */
function connect(): void {
  try {
    const port = api.runtime.connect({ name: "warroom" });
    port.onDisconnect.addListener(() => setTimeout(connect, 3000));
  } catch {
    setTimeout(connect, 5000);
  }
}

// ---------------------------------------------------------------------------
// controls

async function patchSettings(patch: (raw: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
  const got = (await api.storage.local.get(STORAGE_KEYS.settings)) as Record<string, unknown>;
  const raw = (got[STORAGE_KEYS.settings] as Record<string, unknown> | undefined) ?? {};
  await api.storage.local.set({ [STORAGE_KEYS.settings]: patch(raw) });
}

async function setUnits(n: number): Promise<void> {
  const next = clampUnits(n);
  if (next === settings.concurrency) return;
  settings = { ...settings, concurrency: next };
  scheduleRender();
  await patchSettings((raw) => ({ ...raw, concurrency: next }));
  toast(t("warroom.toast.units", { n: next }));
  void send({ type: "kick" });
}

el.unitsDec.addEventListener("click", () => void setUnits(settings.concurrency - 1));
el.unitsInc.addEventListener("click", () => void setUnits(settings.concurrency + 1));

el.pause.addEventListener("click", () => void send({ type: "setPaused", paused: !settings.paused }));

el.sound.addEventListener("click", () => {
  const on = !settings.ui.sound;
  setSoundEnabled(on);
  if (on) unlockAudio();
  settings = { ...settings, ui: { ...settings.ui, sound: on } };
  scheduleRender();
  void patchSettings((raw) => ({ ...raw, ui: { ...normalizeSettings(raw).ui, sound: on } }));
});

el.fs.addEventListener("click", () => {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  else void document.documentElement.requestFullscreen().catch(() => undefined);
});
document.addEventListener("fullscreenchange", scheduleRender);

el.afk.addEventListener("click", async () => {
  const want = !settings.afk;
  el.afk.disabled = true;
  try {
    const reply = await send<{ afk: boolean; since: number | null; sitrep: Sitrep | null }>({ type: "setAfk", afk: want });
    afkSince = reply?.since ?? (want ? Date.now() : null);
    settings = { ...settings, afk: want };
    if (!want && reply?.sitrep) showSitrep(reply.sitrep);
  } finally {
    el.afk.disabled = false;
    scheduleRender();
  }
});

// Any gesture unlocks audio (autoplay policy).
for (const ev of ["pointerdown", "keydown"] as const) document.addEventListener(ev, unlockAudio, { passive: true });

// ---------------------------------------------------------------------------
// ARM TARGETS: paste URLs → LAUNCH IN 3·2·1 → addJobs

let countdown: { timer: ReturnType<typeof setTimeout>; urls: string[] } | null = null;

function updateArmCount(): void {
  const n = extractUrls(el.armInput.value).length;
  el.armCount.textContent = el.armInput.value.trim() ? (n ? t("warroom.arm.count", { n }) : t("warroom.arm.none")) : "";
  el.armCount.dataset.ok = String(n > 0);
}

el.armInput.addEventListener("input", updateArmCount);
el.armInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    arm();
  }
});
el.armGo.addEventListener("click", arm);
el.cdAbort.addEventListener("click", abortCountdown);

function arm(): void {
  if (countdown) return;
  const urls = extractUrls(el.armInput.value);
  if (!urls.length) {
    toast(t("warroom.arm.none"));
    el.armInput.focus();
    return;
  }
  const seq = [3, 2, 1];
  el.cdSeq.replaceChildren(...seq.map((n) => h("span", { textContent: String(n) })));
  el.countdown.hidden = false;
  el.cdAbort.focus();
  let i = 0;
  const step = () => {
    if (i >= seq.length) return void launch(urls);
    el.cdNum.textContent = String(seq[i]);
    el.cdNum.classList.remove("pop");
    void el.cdNum.offsetWidth;
    el.cdNum.classList.add("pop");
    [...el.cdSeq.children].forEach((c, k) => c.classList.toggle("on", k <= i));
    i++;
    countdown = { timer: setTimeout(step, 700), urls };
  };
  step();
}

function abortCountdown(): void {
  if (!countdown) return;
  clearTimeout(countdown.timer);
  countdown = null;
  el.countdown.hidden = true;
  el.armInput.focus();
}

async function launch(urls: string[]): Promise<void> {
  countdown = null;
  el.countdown.hidden = true;
  const n = await send<number>({ type: "addJobs", urls, start: true });
  toast(n ? t("warroom.arm.launched", { n }) : t("warroom.arm.dupes"));
  if (n) {
    el.armInput.value = "";
    updateArmCount();
  }
}

// ---------------------------------------------------------------------------
// SITREP modal

function showSitrep(rep: Sitrep): void {
  const cell = (key: CopyKey, n: number, tone: string) =>
    h("div", { className: `sr-cell tone-${tone}` }, h("b", { textContent: String(n).padStart(2, "0") }), h("span", { textContent: t(key) }));
  const ack = h("button", { type: "button", className: "wr-btn primary", textContent: t("warroom.sitrep.ack") });
  const box = h(
    "div",
    { className: "sr-box frame" },
    h("div", { className: "sr-kicker", textContent: `${zulu(rep.until)} · ${t("warroom.sitrep.sub", { dur: span(rep.until - rep.since) })}` }),
    h("h2", { id: "wr-sr-title", textContent: t("warroom.sitrep.title") }),
    h(
      "div",
      { className: "sr-grid" },
      cell("warroom.sitrep.delivered", rep.delivered, "ok"),
      cell("warroom.sitrep.holding", rep.holding, rep.holding ? "warn" : "dim"),
      cell("warroom.sitrep.contacts", rep.contacts, rep.contacts ? "fire" : "dim"),
      cell("warroom.sitrep.lost", rep.lost, rep.lost ? "alert" : "dim"),
    ),
    h("div", { className: "sr-actions" }, ack),
  );
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-labelledby", "wr-sr-title");
  const close = () => {
    el.modal.hidden = true;
    el.modal.replaceChildren();
    el.afk.focus();
  };
  ack.addEventListener("click", close);
  el.modal.replaceChildren(box);
  el.modal.hidden = false;
  el.modal.onclick = (e) => e.target === el.modal && close();
  ack.focus();
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!el.modal.hidden) {
    el.modal.hidden = true;
    el.modal.replaceChildren();
  } else if (countdown) abortCountdown();
});

// ---------------------------------------------------------------------------
// boot

async function boot(): Promise<void> {
  const got = (await api.storage.local.get([STORAGE_KEYS.jobs, STORAGE_KEYS.needs, STORAGE_KEYS.settings])) as {
    jobs?: Job[];
    needs?: Need[];
    settings?: unknown;
  };
  settings = normalizeSettings(got.settings);
  jobs = got.jobs ?? [];
  onNeeds(got.needs ?? []);
  setSoundEnabled(settings.ui.sound);
  applyCopy();
  $("#wr-ver").textContent = `AIM-401k v${api.runtime.getManifest().version}`;

  connect();
  await Promise.all([pollUnits(), pollOps()]);
  if (settings.afk) {
    try {
      const session = (api.storage as unknown as { session?: { get(k: string): Promise<Record<string, unknown>> } }).session;
      const v = (await session?.get("warroom.afkSince"))?.["warroom.afkSince"];
      if (typeof v === "number") afkSince = v;
    } catch {
      /* not available */
    }
  }
  render();
  radar.start();
  document.body.classList.add("booted");

  setInterval(() => {
    // AFK clock fallback when the background lost track (e.g. browser restart).
    if (settings.afk && afkSince == null) afkSince = afkStartFromOps(recentOps) ?? Date.now();
    render();
  }, 1000);
  setInterval(() => void pollUnits(), 3000);
  setInterval(() => void pollOps(), 15000);
}

void boot();
