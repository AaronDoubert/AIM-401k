// War Room: full-screen live picture. A track table (one row per job in flight),
// the shared stage totals, a master caution light that cycles through the units
// waiting on you, the ops log, and an optional map layer.
// Data: jobs/needs/settings from storage.local (+ onChanged), live unit state
// and ops events from background broadcasts (+ getUnits/getOps on load).
import { extractUrls } from "../core/csv";
import { api } from "../shared/api";
import { copy, type CopyKey } from "../shared/copy";
import { normalizeSettings, STORAGE_KEYS } from "../shared/defaults";
import { companyName, dtg } from "../shared/display";
import type { ToPages } from "../shared/messages";
import type { Job, Need, OpsEvent, Settings, UnitState } from "../shared/types";
import { callsigns } from "./board";
import { $, h, pad, send, toast } from "./common";
import { MasterCaution } from "./caution";
import { appliedCount, stageCounts, stageStrip, stageOf } from "./stages";
import { OpsLog } from "./warroom/log";
import { type MapPoint, UsMap } from "./warroom/map";
import { afkStartFromOps, clampUnits, clock, deriveTiles, rankFor, type Sitrep, SlotMap, span, stopwatch, type TileModel } from "./warroom/model";
import { deliveredClick, masterCaution, setSoundEnabled, unlockAudio } from "./warroom/sound";
import { type T, TrackView } from "./warroom/tracks";

// ---------------------------------------------------------------------------
// state

let settings: Settings = normalizeSettings(undefined);
let jobs: Job[] = [];
let needs: Need[] = [];
const units = new Map<string, UnitState>();
let afkSince: number | null = null;
let linkUp = true;
let shown = new Set<string>();
/** Latest ops events (for the AFK-start fallback). */
let recentOps: OpsEvent[] = [];
const tracks = new Map<string, TrackView>();
const slots = new SlotMap();
const drafts = new Map<string, string>();
/** Company/title as seen while the job was in flight (confirmation pages often lack them). */
const names = new Map<string, { company: string; title: string }>();
let signs = new Map<string, number>();
/** The locked unit (corner brackets). */
let selected: string | null = null;
let lastList: TileModel[] = [];
/** Jobs the map filtered the table down to, and the text filter. */
let mapFilter: Set<string> | null = null;
let textFilter = "";
let lastRank: number | null = null;

const t: T = (key, vars) => copy(settings, key, vars);
const chud = () => settings.ui.chud;
const tgtOf = (jobId: string) => (signs.has(jobId) ? copy(settings, "theme.tgt", { n: pad(signs.get(jobId)!, 4) }) : "");

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
let mapOn = pref.get("warroom.layer.map") === "1";

// ---------------------------------------------------------------------------
// elements

const el = {
  clock: $("#wr-clock"),
  live: $("#wr-live"),
  afkPip: $("#wr-afk-pip"),
  afkStrip: $("#wr-afk-strip"),
  caution: $<HTMLButtonElement>("#wr-caution"),
  afk: $<HTMLButtonElement>("#wr-afk"),
  unitsOut: $("#wr-units"),
  unitsDec: $<HTMLButtonElement>("#wr-units-dec"),
  unitsInc: $<HTMLButtonElement>("#wr-units-inc"),
  pause: $<HTMLButtonElement>("#wr-pause"),
  pauseLabel: $("#wr-pause-label"),
  insignia: $("#wr-insignia"),
  filter: $<HTMLInputElement>("#wr-filter"),
  filterChip: $<HTMLButtonElement>("#wr-filter-chip"),
  sound: $<HTMLButtonElement>("#wr-sound"),
  layerMap: $<HTMLButtonElement>("#wr-layer-map"),
  fs: $<HTMLButtonElement>("#wr-fs"),
  stages: $("#wr-stages"),
  table: $("#wr-tracks"),
  list: $("#wr-track-list"),
  empty: $("#wr-empty"),
  mapPanel: $("#wr-map-panel"),
  map: $("#wr-map"),
  armInput: $<HTMLTextAreaElement>("#wr-arm-input"),
  armCount: $("#wr-arm-count"),
  armGo: $<HTMLButtonElement>("#wr-arm-go"),
  modal: $("#wr-modal"),
};

const opsLog = new OpsLog($("#wr-log"), $("#wr-chips"), $<HTMLButtonElement>("#wr-log-new"), () => t, () => ({ chud: chud(), tgt: tgtOf }));

const usMap = new UsMap(() => ({
  title: t("warroom.map.title"),
  remote: (n) => t("warroom.map.remote", { n }),
  unplaced: (n) => t("warroom.map.unplaced", { n }),
  empty: t("warroom.map.empty"),
  stage: (id) => t(`stage.${id}` as CopyKey),
}));
el.map.append(usMap.el);
// Clicking a place on the map filters the track table to the jobs there.
usMap.onFilter = (ids) => {
  mapFilter = ids ? new Set(ids) : null;
  render();
};

// Master caution: pressing it acknowledges (the lamp goes dark, rows stay amber) and jumps to the oldest hold.
const caution = new MasterCaution(el.caution, () => jumpToHold());

// ---------------------------------------------------------------------------
// copy (static labels carry data-copy="warroom.key")

function applyCopy(): void {
  document.documentElement.dataset.mode = chud() ? "chud" : "plain";
  for (const node of document.querySelectorAll<HTMLElement>("[data-copy]")) node.textContent = t(node.dataset.copy as CopyKey);
  for (const node of document.querySelectorAll<HTMLElement>("[data-copy-placeholder]")) node.setAttribute("placeholder", t(node.dataset.copyPlaceholder as CopyKey));
  for (const node of document.querySelectorAll<HTMLElement>("[data-copy-label]")) {
    node.setAttribute("aria-label", t(node.dataset.copyLabel as CopyKey));
    node.title = t(node.dataset.copyLabel as CopyKey);
  }
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
  lastList = list;
  if (selected && !list.some((m) => m.jobId === selected) && !jobs.some((j) => j.id === selected)) selected = null;
  const slotMap = slots.assign(list.map((m) => m.jobId));
  const q = textFilter.trim().toLowerCase();
  const visible = list.filter((m) => (!mapFilter || mapFilter.has(m.jobId)) && (!q || `${companyName(m)} ${m.title} ${m.location}`.toLowerCase().includes(q)));
  renderTracks(visible, slotMap, now);
  const filtered = visible.length !== list.length || !!mapFilter;
  el.filterChip.hidden = !filtered;
  if (filtered) el.filterChip.textContent = t("warroom.filter.on", { n: visible.length });
  shown = new Set(list.map((m) => m.jobId));
  // Everything waiting on the operator, oldest first.
  const holds = [...needs].sort((a, b) => a.createdAt - b.createdAt).map((n) => n.id);
  if (caution.update(holds) && settings.ui.sound) masterCaution();

  renderHeader(now, list);
  renderTotals();
  if (mapOn) renderMap();

  const holding = list.filter((m) => m.needs.length).length;
  document.title = `${holding ? `(${holding}) ` : ""}${t("warroom.doc_title")}`;
}

function renderTracks(list: TileModel[], slotMap: Map<string, number>, now: number): void {
  const ids = new Set(list.map((m) => m.jobId));
  for (const [id, view] of tracks) {
    if (ids.has(id)) continue;
    view.el.remove();
    tracks.delete(id);
  }
  for (const m of list) {
    let view = tracks.get(m.jobId);
    if (!view) {
      view = new TrackView(m.jobId, { t: () => t, send, drafts, select: (id) => select(id, false) });
      const id = m.jobId;
      view.el.addEventListener("mouseenter", () => usMap.highlight(id));
      view.el.addEventListener("mouseleave", () => usMap.highlight(null));
      tracks.set(m.jobId, view);
    }
    view.update(m, slotMap.get(m.jobId) ?? 0, tgtOf(m.jobId), now, chud(), m.jobId === selected);
  }
  // Keep DOM order = list order, moving nodes only when needed (moving would blur a focused input).
  const want = list.map((m) => tracks.get(m.jobId)!.el);
  const have = [...el.list.children];
  if (want.length !== have.length || want.some((n, i) => n !== have[i])) {
    want.forEach((n, i) => {
      if (el.list.children[i] !== n) el.list.insertBefore(n, el.list.children[i] ?? null);
    });
  }
  el.empty.hidden = list.length > 0 || lastList.length > 0;
  el.table.hidden = lastList.length === 0;
}

function renderHeader(now: number, list: TileModel[]): void {
  el.clock.textContent = chud() ? dtg(now) : clock(now).slice(0, 5);
  el.clock.setAttribute("datetime", new Date(now).toISOString());

  el.live.dataset.state = !linkUp ? "down" : settings.paused ? "paused" : "live";
  el.live.textContent = !linkUp ? t("warroom.offline") : settings.paused ? t("warroom.paused") : t("warroom.live");

  el.caution.title = caution.lit ? t("warroom.caution.hint") : t("warroom.caution.clear");

  el.afk.setAttribute("aria-pressed", String(settings.afk));
  el.afkPip.hidden = !settings.afk;
  el.afkStrip.hidden = !settings.afk;
  if (settings.afk) el.afkPip.textContent = t("warroom.afk_pip", { dur: stopwatch(now - (afkSince ?? now)) });
  document.body.classList.toggle("is-afk", settings.afk);
  document.body.classList.toggle("is-paused", settings.paused);

  el.unitsOut.textContent = String(clampUnits(settings.concurrency));
  el.unitsDec.disabled = settings.concurrency <= 1;
  el.unitsInc.disabled = settings.concurrency >= 6;
  el.pauseLabel.textContent = settings.paused ? t("warroom.ctl.resume") : t("warroom.ctl.pause");
  el.pause.setAttribute("aria-pressed", String(settings.paused));
  el.sound.setAttribute("aria-pressed", String(settings.ui.sound));
  el.layerMap.setAttribute("aria-pressed", String(mapOn));
  el.mapPanel.hidden = !mapOn;
  el.fs.textContent = document.fullscreenElement ? t("warroom.ctl.exit_fullscreen") : t("warroom.ctl.fullscreen");
}

let totalsSig = "";
function renderTotals(): void {
  const counts = stageCounts(jobs);
  const r = rankFor(appliedCount(jobs));
  const sig = `${chud()}|${JSON.stringify(counts)}|${r.index}|${r.toNext}`;
  if (sig === totalsSig) return;
  totalsSig = sig;
  el.stages.replaceChildren(stageStrip(counts, (k) => t(k)));
  renderInsignia(r);
}

/** Rank as a chevron insignia beside the operation name; a promotion gets one moment. */
function renderInsignia(r: ReturnType<typeof rankFor>): void {
  const name = t(`warroom.rank.${r.index}` as CopyKey);
  el.insignia.title = r.next == null ? `${name} · ${t("warroom.rank.max")}` : `${name} · ${t("warroom.rank.next", { n: r.toNext, rank: t(`warroom.rank.${r.next}` as CopyKey) })}`;
  el.insignia.setAttribute("aria-label", name);
  if (el.insignia.dataset.rank !== String(r.index)) {
    el.insignia.dataset.rank = String(r.index);
    const marks = r.index === 0 ? ["dot"] : r.index <= 4 ? Array(r.index).fill("chev") : r.index <= 6 ? Array(r.index - 4).fill("bar") : Array(r.index - 6).fill("star");
    el.insignia.replaceChildren(...marks.map((k) => h("i", { className: `ins ${k}` })));
  }
  if (lastRank != null && r.index > lastRank) {
    toast(t("warroom.promoted", { rank: name }));
    el.insignia.classList.remove("promoted");
    void el.insignia.offsetWidth;
    el.insignia.classList.add("promoted");
  }
  lastRank = r.index;
}

function renderMap(): void {
  usMap.update(
    jobs.map((j): MapPoint => ({
      jobId: j.id,
      label: [companyName(j), j.title].filter(Boolean).join(" — ") || j.url,
      location: j.location,
      stage: stageOf(j.status),
      failed: j.status === "failed",
    })),
  );
  usMap.select(selected);
}

// ---------------------------------------------------------------------------
// selection + master caution

function select(jobId: string | null, scroll: boolean): void {
  selected = jobId;
  render();
  if (scroll && jobId) tracks.get(jobId)?.el.scrollIntoView({ block: "nearest" });
}

/** Lock onto the next unit waiting on you (oldest hold first), cycling on repeat presses. */
function jumpToHold(): void {
  const holds = lastList.filter((m) => m.needs.length).sort((a, b) => (a.holdingSince ?? 0) - (b.holdingSince ?? 0));
  if (!holds.length) return;
  if (mapFilter || textFilter) clearFilters();
  const i = holds.findIndex((m) => m.jobId === selected);
  const next = holds[(i + 1) % holds.length]!;
  select(next.jobId, true);
  tracks.get(next.jobId)?.focusOperator();
}

function clearFilters(): void {
  mapFilter = null;
  textFilter = "";
  el.filter.value = "";
  usMap.clearFilter?.();
  render();
}
el.filterChip.addEventListener("click", clearFilters);
el.filter.addEventListener("input", () => {
  textFilter = el.filter.value;
  render();
});

/** Rows currently on screen, in order (for J/K). */
const visibleIds = () => [...el.list.children].map((n) => (n as HTMLElement).dataset.job!).filter(Boolean);

// Keyboard-first operation.
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target as HTMLElement;
  const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
  if (e.key === "Escape") {
    if (!el.modal.hidden) return; // the modal handles its own Esc
    if (caution.lit) caution.press();
    else if (typing && target === el.filter) {
      clearFilters();
      el.filter.blur();
    } else if (mapFilter || textFilter) clearFilters();
    else if (selected) select(null, false);
    return;
  }
  if (typing || target.closest(".guarded, .menu")) return;
  const ids = visibleIds();
  const move = (d: number) => {
    if (!ids.length) return;
    const i = selected ? ids.indexOf(selected) : -1;
    select(ids[Math.max(0, Math.min(ids.length - 1, i < 0 ? 0 : i + d))]!, true);
    tracks.get(selected!)?.el.querySelector<HTMLElement>(".track-row")?.focus({ preventScroll: true });
  };
  const view = selected ? tracks.get(selected) : undefined;
  switch (e.key) {
    case "j":
    case "ArrowDown":
      if (e.key === "ArrowDown" && !target.closest(".track-row")) return;
      e.preventDefault();
      move(1);
      break;
    case "k":
    case "ArrowUp":
      if (e.key === "ArrowUp" && !target.closest(".track-row")) return;
      e.preventDefault();
      move(-1);
      break;
    case "Enter":
      if (!view) return;
      e.preventDefault();
      view.expanded = !view.expanded;
      render();
      break;
    case "o":
      if (selected) void send({ type: "focusJob", jobId: selected });
      break;
    case " ":
      // Space on a unit that's ready: lift its guard; the switch takes focus, hold Space again to release.
      if (view?.liftGuard()) e.preventDefault();
      break;
    case "/":
      e.preventDefault();
      el.filter.focus();
      break;
    case "a":
      el.afk.click();
      break;
    case "s":
      el.sound.click();
      break;
    case "m":
      el.layerMap.click();
      break;
    case "p":
      el.pause.click();
      break;
  }
});

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
  needs = next;
}

function setJobs(next: Job[]): void {
  jobs = next;
  signs = callsigns(jobs);
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
  if (changes[STORAGE_KEYS.jobs]) setJobs((changes[STORAGE_KEYS.jobs]!.newValue as Job[] | undefined) ?? []);
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

el.layerMap.addEventListener("click", () => {
  mapOn = !mapOn;
  pref.set("warroom.layer.map", mapOn ? "1" : "0");
  render();
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
// ADD TARGETS: paste URLs → addJobs

function updateArmCount(): void {
  const n = extractUrls(el.armInput.value).length;
  el.armCount.textContent = el.armInput.value.trim() ? (n ? t("warroom.arm.count", { n }) : t("warroom.arm.none")) : "";
  el.armCount.dataset.ok = String(n > 0);
}

el.armInput.addEventListener("input", updateArmCount);
el.armInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    void arm();
  }
});
el.armGo.addEventListener("click", () => void arm());

async function arm(): Promise<void> {
  const urls = extractUrls(el.armInput.value);
  if (!urls.length) {
    toast(t("warroom.arm.none"));
    el.armInput.focus();
    return;
  }
  el.armGo.disabled = true;
  try {
    const n = await send<number>({ type: "addJobs", urls, start: true });
    toast(n ? t("warroom.arm.launched", { n }) : t("warroom.arm.dupes"));
    if (n) {
      el.armInput.value = "";
      updateArmCount();
    }
  } finally {
    el.armGo.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// SITREP modal

function showSitrep(rep: Sitrep): void {
  const row = (key: CopyKey, n: number, tone: string) => {
    const item = h("div", { className: `stage tone-${tone} ${n ? "" : "zero"}` }, h("dt", { textContent: t(key) }), h("dd", { textContent: String(n) }));
    return item;
  };
  const ack = h("button", { type: "button", className: "wr-btn primary", textContent: t("warroom.sitrep.ack") });
  const box = h(
    "div",
    { className: "sr-box" },
    h("div", { className: "sr-kicker", textContent: `${chud() ? dtg(rep.until) : clock(rep.until).slice(0, 5)} · ${t("warroom.sitrep.sub", { dur: span(rep.until - rep.since) })}` }),
    h("h2", { id: "wr-sr-title", textContent: t("warroom.sitrep.title") }),
    h(
      "dl",
      { className: "stages" },
      row("warroom.sitrep.delivered", rep.delivered, "status"),
      row("warroom.sitrep.holding", rep.holding, "warn"),
      row("warroom.sitrep.contacts", rep.contacts, "advisory"),
      row("warroom.sitrep.lost", rep.lost, "dim"),
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
  }
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
  setJobs(got.jobs ?? []);
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
