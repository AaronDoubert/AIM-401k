// War Room map layer: a quiet USA plot of where applications are. Offline data only
// (src/core/usmap.data.ts). Job text is untrusted: it only ever reaches the DOM via
// textContent / <title>. Styling lives in static/warroom-map.css (scoped under .wr .usmap).
import { type Place, parseLocation } from "../../core/geo";
import { MAP_VIEWBOX, NATION_PATH, STATE_BORDERS_PATH } from "../../core/usmap.data";

export type Tone = "ok" | "warn" | "alert" | "advisory" | "status" | "dim";
export interface MapPoint {
  jobId: string;
  label: string;
  location: string;
  tone: Tone;
  queued: boolean;
}
export interface MapCopy {
  title: string;
  remote: (n: number) => string;
  unplaced: (n: number) => string;
  empty: string;
}

const SVG_NS = "http://www.w3.org/2000/svg";
/** When several jobs share a place, the loudest tone wins. */
const TONE_RANK: Tone[] = ["alert", "warn", "advisory", "ok", "status", "dim"];
const R = 4.5;
const RETICLE = 10;
const RETICLE_ARM = 4;

interface Group {
  place: Place;
  points: MapPoint[];
  tone: Tone;
  queued: boolean;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

export class UsMap {
  readonly el: HTMLElement;
  onSelect: ((jobId: string) => void) | null = null;

  private readonly copy: () => MapCopy;
  private readonly root: SVGSVGElement;
  private readonly pointsLayer: SVGGElement;
  private readonly reticle: SVGPathElement;
  private readonly foot: HTMLElement;
  private readonly titleEl: SVGTitleElement;
  private readonly placeCache = new Map<string, Place>();
  private groups: Group[] = [];
  private sig = "";
  private selected: string | null = null;

  constructor(copy: () => MapCopy) {
    this.copy = copy;
    this.el = document.createElement("figure");
    this.el.className = "usmap";

    this.root = svg("svg", { viewBox: MAP_VIEWBOX, role: "img", preserveAspectRatio: "xMidYMid meet" });
    this.titleEl = svg("title");
    this.root.append(this.titleEl);
    this.root.append(svg("path", { class: "land", d: NATION_PATH }));
    this.root.append(svg("path", { class: "borders", d: STATE_BORDERS_PATH }));
    this.root.append(svg("path", { class: "coast", d: NATION_PATH }));
    this.pointsLayer = svg("g", { class: "points" });
    this.root.append(this.pointsLayer);
    this.reticle = svg("path", { class: "reticle", d: "", visibility: "hidden" });
    this.root.append(this.reticle);

    this.foot = document.createElement("figcaption");
    this.foot.className = "usmap-foot";
    this.el.append(this.root, this.foot);
    this.render("", 0, 0, true);
  }

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
        else groups.set(place.key, { place, points: [p], tone: p.tone, queued: p.queued });
      }
    }
    const list = [...groups.values()];
    for (const g of list) {
      g.tone = TONE_RANK.find((t) => g.points.some((p) => p.tone === t)) ?? "dim";
      g.queued = g.points.every((p) => p.queued);
    }

    const footText = [remote > 0 ? c.remote(remote) : "", nofix > 0 ? c.unplaced(nofix) : ""];
    const sig = JSON.stringify([
      c.title,
      points.length ? footText : c.empty,
      list.map((g) => [g.place.key, g.tone, g.queued, g.points.map((p) => [p.jobId, p.label, p.location])]),
    ]);
    if (sig === this.sig) return;
    this.sig = sig;
    this.groups = list;
    this.render(c.title, remote, nofix, false, footText, points.length === 0 ? c.empty : "");
    this.placeReticle();
  }

  select(jobId: string | null): void {
    if (jobId === this.selected) return;
    this.selected = jobId;
    this.placeReticle();
  }

  private place(loc: string): Place {
    let p = this.placeCache.get(loc);
    if (!p) {
      p = parseLocation(loc);
      if (this.placeCache.size > 2000) this.placeCache.clear();
      this.placeCache.set(loc, p);
    }
    return p;
  }

  private render(title: string, remote: number, nofix: number, initial: boolean, footText: string[] = [], empty = ""): void {
    this.pointsLayer.replaceChildren();
    for (const g of this.groups) this.pointsLayer.append(this.drawPoint(g));

    const placed = this.groups.reduce((n, g) => n + g.points.length, 0);
    this.titleEl.textContent = title;
    this.root.setAttribute("aria-label", [title, `${placed}`, ...footText].filter(Boolean).join(", "));

    this.foot.replaceChildren();
    if (initial) return;
    if (empty) {
      const s = document.createElement("span");
      s.className = "usmap-empty";
      s.textContent = empty;
      this.foot.append(s);
      return;
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
  }

  private drawPoint(g: Group): SVGGElement {
    const { x = 0, y = 0 } = g.place;
    const first = g.points[0] as MapPoint;
    const el = svg("g", {
      class: `pt t-${g.tone}${g.queued ? " q" : ""}`,
      transform: `translate(${x} ${y})`,
      tabindex: 0,
      role: "button",
      "data-job": first.jobId,
      "data-place": g.place.key,
    });
    const title = svg("title");
    title.textContent = [g.place.label, ...g.points.map((p) => (p.label ? `${p.label} (${p.location || "?"})` : p.location))].join("\n");
    const hit = svg("circle", { class: "hit", r: R + 4 });
    const dot = svg("circle", { class: "dot", r: R });
    if (g.queued) dot.setAttribute("stroke-dasharray", "2 1.6");
    el.append(title, hit, dot);
    if (g.points.length > 1) {
      const n = svg("text", { class: "count", x: R + 3, y: 4 });
      n.textContent = String(g.points.length);
      el.append(n);
    }
    const fire = () => this.onSelect?.(first.jobId);
    el.addEventListener("click", fire);
    el.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter" || (e as KeyboardEvent).key === " ") {
        e.preventDefault();
        fire();
      }
    });
    return el;
  }

  private placeReticle(): void {
    const g = this.selected ? this.groups.find((gr) => gr.points.some((p) => p.jobId === this.selected)) : undefined;
    for (const e of this.pointsLayer.children) e.classList.toggle("sel", e.getAttribute("data-place") === g?.place.key);
    if (!g) {
      this.reticle.setAttribute("visibility", "hidden");
      this.reticle.setAttribute("d", "");
      return;
    }
    const { x = 0, y = 0 } = g.place;
    const a = RETICLE;
    const b = RETICLE - RETICLE_ARM;
    const d = [
      `M${x - a} ${y - b}V${y - a}H${x - b}`,
      `M${x + b} ${y - a}H${x + a}V${y - b}`,
      `M${x + a} ${y + b}V${y + a}H${x + b}`,
      `M${x - b} ${y + a}H${x - a}V${y + b}`,
    ].join("");
    this.reticle.setAttribute("d", d);
    this.reticle.setAttribute("visibility", "visible");
    this.reticle.setAttribute("data-job", this.selected as string);
  }
}
