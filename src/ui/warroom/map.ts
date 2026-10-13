// War Room map layer: a quiet USA plot of where applications are. Offline data only
// (src/core/usmap.data.ts). Job text is untrusted: it only ever reaches the DOM via
// textContent / <title>. Styling lives in static/warroom-map.css (scoped under .wr .usmap).
//
// Each place is a small MIL-STD-2525-flavoured frame symbol in the stage colour used by
// the stats row. Symbols are laid out in screen pixels (the group is scaled by viewBox
// units per CSS pixel), so they stay ~14px wide however wide the map is rendered.
//
// API change (was: Tone/queued + onSelect): points carry `stage` + `failed`; a click
// filters (`onFilter`) instead of selecting; `highlight()` is new (table row hover).
import { type Place, parseLocation } from "../../core/geo";
import { MAP_VIEWBOX, NATION_PATH, STATE_BORDERS_PATH } from "../../core/usmap.data";
import type { StageId } from "../stages";

export interface MapPoint {
  jobId: string;
  label: string;
  location: string;
  stage: StageId;
  /** A real error (red). Overrides the stage symbol. */
  failed: boolean;
}
export interface MapCopy {
  title: string;
  remote: (n: number) => string;
  unplaced: (n: number) => string;
  empty: string;
  /** Stage label, same words as the stats row. */
  stage: (id: StageId) => string;
  /** Legend label for failed jobs. Falls back to the "lost" label. */
  failed?: string;
  /** Label of the clear-filter control. Falls back to "Clear". */
  clear?: string;
}

type Sym = StageId | "failed";

const SVG_NS = "http://www.w3.org/2000/svg";
const VB_W = Number(MAP_VIEWBOX.split(" ")[2]) || 975;
/** When several jobs share a place, the most urgent symbol wins. */
const URGENCY: Sym[] = ["hold", "failed", "engaged", "contact", "secured", "splash", "targets", "lost"];
/** Legend order: the stats row, with failed beside lost. */
const LEGEND_ORDER: Sym[] = ["targets", "engaged", "hold", "splash", "contact", "secured", "failed", "lost"];
const HIT = 12; // px
const RETICLE = 11; // px, half-size
const RETICLE_ARM = 4; // px
const DEFAULT_WIDTH = 350;
const MIN_WIDTH = 240;

interface Group {
  place: Place;
  points: MapPoint[];
  sym: Sym;
}

const symOf = (p: MapPoint): Sym => (p.failed ? "failed" : p.stage);

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** The frame shape for a symbol, centred on 0,0, in CSS pixels. */
function frame(sym: Sym): SVGElement[] {
  switch (sym) {
    case "targets":
      return [svg("rect", { class: "fr dashed", x: -7, y: -5, width: 14, height: 10 })];
    case "engaged":
      return [svg("rect", { class: "fr", x: -7, y: -5, width: 14, height: 10 })];
    case "hold":
      return [svg("path", { class: "fr", d: "M0 -8L8 0L0 8L-8 0Z" })];
    case "secured":
      return [svg("circle", { class: "fr solid", r: 6 })];
    case "splash":
    case "contact":
      return [svg("circle", { class: "fr", r: 6 })];
    default:
      return [svg("rect", { class: "fr", x: -5, y: -5, width: 10, height: 10 }), svg("path", { class: "x", d: "M-3 -3L3 3M3 -3L-3 3" })];
  }
}

function symbolEl(sym: Sym): SVGGElement {
  const g = svg("g", { class: `sym s-${sym}` });
  g.append(...frame(sym));
  return g;
}

export class UsMap {
  readonly el: HTMLElement;
  /**
   * Called when the filter changes: every job id at the clicked place, or null when the
   * same place is clicked again / the legend's clear control is used / the filtered place
   * has vanished. Also called with the new ids if the filtered place's jobs change.
   * Not called by clearFilter().
   */
  onFilter: ((jobIds: string[] | null) => void) | null = null;

  private readonly copy: () => MapCopy;
  private readonly root: SVGSVGElement;
  private readonly pointsLayer: SVGGElement;
  private readonly reticle: SVGGElement;
  private readonly filterReticle: SVGGElement;
  private readonly foot: HTMLElement;
  private readonly titleEl: SVGTitleElement;
  private readonly placeCache = new Map<string, Place>();
  private readonly ro: ResizeObserver | null = null;
  private clearBtn: HTMLButtonElement | null = null;
  private groups: Group[] = [];
  private sig = "";
  private k = VB_W / DEFAULT_WIDTH; // viewBox units per CSS pixel
  private selected: string | null = null;
  private highlighted: string | null = null;
  private filterKey: string | null = null;
  /** Job ids at the filtered place, joined; used to notice the set changing. */
  private filterIds: string | null = null;

  constructor(copy: () => MapCopy) {
    this.copy = copy;
    this.el = document.createElement("figure");
    this.el.className = "usmap";

    this.root = svg("svg", { viewBox: MAP_VIEWBOX, role: "group", preserveAspectRatio: "xMidYMid meet" });
    this.titleEl = svg("title");
    this.root.append(this.titleEl);
    this.root.append(svg("path", { class: "land", d: NATION_PATH }));
    this.root.append(svg("path", { class: "borders", d: STATE_BORDERS_PATH }));
    this.root.append(svg("path", { class: "coast", d: NATION_PATH }));
    this.pointsLayer = svg("g", { class: "points" });
    this.root.append(this.pointsLayer);
    this.filterReticle = this.makeReticle("reticle-flt");
    this.reticle = this.makeReticle("reticle");
    this.root.append(this.filterReticle, this.reticle);

    this.foot = document.createElement("figcaption");
    this.foot.className = "usmap-foot";
    this.el.append(this.root, this.foot);
    this.render("", 0, 0, true);

    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(() => this.measure());
      this.ro.observe(this.root);
    }
  }

  /** Redraw the places from the current jobs. Cheap when nothing visible changed. */
  update(points: MapPoint[]): void {
    const c = this.copy();
    const groups = new Map<string, Group>();
    let remote = 0;
    let nofix = 0;
    for (const p of points) {
      const place = this.place(p.location);
      if (place.kind === "remote") remote++;
      else if (place.kind === "foreign" || place.kind === "unknown") nofix++;
      else {
        const g = groups.get(place.key);
        if (g) g.points.push(p);
        else groups.set(place.key, { place, points: [p], sym: symOf(p) });
      }
    }
    const list = [...groups.values()];
    for (const g of list) g.sym = URGENCY.find((s) => g.points.some((p) => symOf(p) === s)) ?? "lost";
    // Most urgent drawn last, so it sits on top where places overlap.
    list.sort((a, b) => URGENCY.indexOf(b.sym) - URGENCY.indexOf(a.sym));

    const footText = [remote > 0 ? c.remote(remote) : "", nofix > 0 ? c.unplaced(nofix) : ""];
    const labels = LEGEND_ORDER.map((s) => legendLabel(c, s));
    const sig = JSON.stringify([
      c.title,
      c.clear ?? "",
      labels,
      points.length ? footText : c.empty,
      list.map((g) => [g.place.key, g.sym, g.points.map((p) => [p.jobId, p.label, p.location, p.stage, p.failed])]),
    ]);
    if (sig === this.sig) return;
    this.sig = sig;
    this.groups = list;
    this.render(c.title, remote, nofix, false, footText, points.length === 0 ? c.empty : "");
    this.apply();

    if (this.filterKey) {
      const g = this.filtered();
      if (!g) {
        this.filterKey = null;
        this.apply();
        this.onFilter?.(null);
      } else if (this.filterIds !== null && g.points.map((p) => p.jobId).join("\n") !== this.filterIds) {
        this.filterIds = g.points.map((p) => p.jobId).join("\n");
        this.onFilter?.(g.points.map((p) => p.jobId));
      }
    }
  }

  /** The locked row (reticle stays on its place while nothing is highlighted). */
  select(jobId: string | null): void {
    if (jobId === this.selected) return;
    this.selected = jobId;
    this.apply();
  }

  /** The hovered row: reticle on its place; null returns to the selected place. */
  highlight(jobId: string | null): void {
    if (jobId === this.highlighted) return;
    this.highlighted = jobId;
    this.apply();
  }

  /** Drop the filter without calling onFilter (the caller already cleared it). */
  clearFilter(): void {
    if (this.filterKey === null) return;
    this.filterKey = null;
    this.filterIds = null;
    this.apply();
  }

  destroy(): void {
    this.ro?.disconnect();
  }

  // ------------------------------------------------------------------------

  private place(loc: string): Place {
    let p = this.placeCache.get(loc);
    if (!p) {
      p = parseLocation(loc);
      if (this.placeCache.size > 2000) this.placeCache.clear();
      this.placeCache.set(loc, p);
    }
    return p;
  }

  private makeReticle(cls: string): SVGGElement {
    const g = svg("g", { class: cls, visibility: "hidden", transform: "" });
    const a = RETICLE;
    const b = RETICLE - RETICLE_ARM;
    const d = [`M${-a} ${-b}V${-a}H${-b}`, `M${b} ${-a}H${a}V${-b}`, `M${a} ${b}V${a}H${b}`, `M${-b} ${a}H${-a}V${b}`].join("");
    g.append(svg("path", { d }));
    return g;
  }

  private measure(): void {
    const w = this.root.getBoundingClientRect().width;
    const k = VB_W / Math.max(MIN_WIDTH, w > 0 ? Math.round(w / 10) * 10 : DEFAULT_WIDTH);
    if (k === this.k) return;
    this.k = k;
    for (const e of this.pointsLayer.children) this.setTransform(e, Number(e.getAttribute("data-x")), Number(e.getAttribute("data-y")));
    this.apply();
  }

  private setTransform(e: Element, x: number, y: number): void {
    e.setAttribute("transform", `translate(${x} ${y}) scale(${this.k})`);
  }

  private filtered(): Group | undefined {
    return this.filterKey ? this.groups.find((g) => g.place.key === this.filterKey) : undefined;
  }

  private groupOf(jobId: string | null): Group | undefined {
    return jobId ? this.groups.find((g) => g.points.some((p) => p.jobId === jobId)) : undefined;
  }

  private render(title: string, remote: number, nofix: number, initial: boolean, footText: string[] = [], empty = ""): void {
    const c = this.copy();
    this.pointsLayer.replaceChildren();
    for (const g of this.groups) this.pointsLayer.append(this.drawPoint(g, c));

    const placed = this.groups.reduce((n, g) => n + g.points.length, 0);
    const per = new Map<Sym, number>();
    for (const g of this.groups) for (const p of g.points) per.set(symOf(p), (per.get(symOf(p)) ?? 0) + 1);
    const summary = LEGEND_ORDER.filter((s) => per.has(s)).map((s) => `${per.get(s)} ${legendLabel(c, s)}`);
    this.titleEl.textContent = title;
    this.root.setAttribute("aria-label", [title, `${placed}`, ...summary, ...footText].filter(Boolean).join(", "));

    this.foot.replaceChildren();
    this.clearBtn = null;
    if (initial) return;
    if (empty) {
      const s = document.createElement("span");
      s.className = "usmap-empty";
      s.textContent = empty;
      this.foot.append(s);
      return;
    }
    for (const sym of LEGEND_ORDER) {
      const n = per.get(sym);
      if (!n) continue;
      const key = document.createElement("span");
      key.className = `usmap-key k-${sym}`;
      const icon = svg("svg", { class: "usmap-icon", viewBox: "-9 -9 18 18", "aria-hidden": "true" });
      icon.append(symbolEl(sym));
      const label = document.createElement("span");
      label.textContent = legendLabel(c, sym);
      const num = document.createElement("b");
      num.textContent = String(n);
      key.append(icon, label, num);
      this.foot.append(key);
    }
    const buckets: [string, string][] = [];
    if (remote > 0 && footText[0]) buckets.push(["remote", footText[0]]);
    if (nofix > 0 && footText[1]) buckets.push(["nofix", footText[1]]);
    for (const [cls, text] of buckets) {
      const s = document.createElement("span");
      s.className = `usmap-bucket ${cls}`;
      s.textContent = text;
      this.foot.append(s);
    }
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "usmap-clear";
    clear.textContent = `× ${c.clear ?? "Clear"}`;
    clear.hidden = true;
    clear.addEventListener("click", () => this.setFilter(null));
    this.foot.append(clear);
    this.clearBtn = clear;
  }

  private drawPoint(g: Group, c: MapCopy): SVGGElement {
    const { x = 0, y = 0 } = g.place;
    const el = svg("g", {
      class: `pt s-${g.sym}`,
      tabindex: 0,
      role: "button",
      "aria-pressed": "false",
      "data-job": (g.points[0] as MapPoint).jobId,
      "data-place": g.place.key,
      "data-x": x,
      "data-y": y,
    });
    this.setTransform(el, x, y);
    const title = svg("title");
    title.textContent = [
      g.place.label,
      ...g.points.map((p) => `${p.label ? `${p.label} (${p.location || "?"})` : p.location} - ${legendLabel(c, symOf(p))}`),
    ].join("\n");
    el.append(title, svg("circle", { class: "hit", r: HIT }), symbolEl(g.sym));
    if (g.points.length > 1) {
      const n = svg("text", { class: "count", x: 10, y: 3.5 });
      n.textContent = String(g.points.length);
      el.append(n);
    }
    const fire = () => this.setFilter(g.place.key);
    el.addEventListener("click", fire);
    el.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter" || (e as KeyboardEvent).key === " ") {
        e.preventDefault();
        fire();
      }
    });
    return el;
  }

  /** Toggle the filter on a place (null clears) and tell the owner. */
  private setFilter(key: string | null): void {
    const next = key === this.filterKey ? null : key;
    this.filterKey = next;
    const g = this.filtered();
    this.filterIds = g ? g.points.map((p) => p.jobId).join("\n") : null;
    this.apply();
    this.onFilter?.(g ? g.points.map((p) => p.jobId) : null);
  }

  /** Cheap state pass: classes, reticles, clear control. No node creation. */
  private apply(): void {
    const flt = this.filtered();
    const sel = this.groupOf(this.selected);
    const active = this.groupOf(this.highlighted) ?? sel;
    this.el.classList.toggle("filtering", !!flt);
    for (const e of this.pointsLayer.children) {
      const key = e.getAttribute("data-place");
      e.classList.toggle("sel", key === sel?.place.key);
      e.classList.toggle("flt", key === flt?.place.key);
      e.setAttribute("aria-pressed", String(key === flt?.place.key));
    }
    if (this.clearBtn) this.clearBtn.hidden = !flt;
    this.putReticle(this.reticle, active, this.highlighted ?? this.selected);
    this.putReticle(this.filterReticle, flt && flt !== active ? flt : undefined, null);
  }

  private putReticle(r: SVGGElement, g: Group | undefined, job: string | null): void {
    if (!g) {
      r.setAttribute("visibility", "hidden");
      r.removeAttribute("data-job");
      return;
    }
    const { x = 0, y = 0 } = g.place;
    this.setTransform(r, x, y);
    r.setAttribute("visibility", "visible");
    r.setAttribute("data-place", g.place.key);
    if (job) r.setAttribute("data-job", job);
  }
}

function legendLabel(c: MapCopy, s: Sym): string {
  return s === "failed" ? c.failed ?? c.stage("lost") : c.stage(s);
}
