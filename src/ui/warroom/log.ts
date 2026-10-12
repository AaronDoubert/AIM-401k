// Ops log terminal: newest at the bottom, autoscroll unless the operator has
// scrolled up (then a "N NEW" chip offers to jump down), filter chips by kind.
import type { CopyKey } from "../../shared/copy";
import type { OpsEvent } from "../../shared/types";
import { h } from "../common";
import { LOG_FILTERS, logLine, type LogFilter, matchesFilter, mergeOps } from "./model";
import type { T } from "./tiles";

const CAP = 300;

export class OpsLog {
  private events: OpsEvent[] = [];
  private filter: LogFilter = "all";
  private unseen = 0;
  private readonly chipEls = new Map<LogFilter, HTMLButtonElement>();

  constructor(
    private readonly box: HTMLElement,
    private readonly chips: HTMLElement,
    private readonly jump: HTMLButtonElement,
    private readonly t: () => T,
  ) {
    for (const f of LOG_FILTERS) {
      const b = h("button", { type: "button", className: "chip" });
      b.dataset.filter = f;
      b.addEventListener("click", () => this.setFilter(f));
      this.chipEls.set(f, b);
      chips.append(b);
    }
    try {
      const saved = localStorage.getItem("warroom.logFilter") as LogFilter | null;
      if (saved && LOG_FILTERS.includes(saved)) this.filter = saved;
    } catch {
      /* storage blocked */
    }
    box.addEventListener("scroll", () => {
      if (this.atBottom()) this.clearUnseen();
    });
    jump.addEventListener("click", () => {
      this.scrollToEnd();
      this.clearUnseen();
    });
    this.relabel();
  }

  /** Re-apply copy (plain/chud switch). */
  relabel(): void {
    const t = this.t();
    for (const [f, b] of this.chipEls) {
      b.textContent = t(`warroom.log.filter.${f}` as CopyKey);
      b.setAttribute("aria-pressed", String(f === this.filter));
    }
    this.renderAll();
  }

  setFilter(f: LogFilter): void {
    this.filter = f;
    try {
      localStorage.setItem("warroom.logFilter", f);
    } catch {
      /* storage blocked */
    }
    for (const [k, b] of this.chipEls) b.setAttribute("aria-pressed", String(k === f));
    this.renderAll();
  }

  /** Replace/merge a batch (initial getOps, periodic resync). */
  load(list: OpsEvent[]): void {
    const before = this.events.length ? this.events[this.events.length - 1]!.id : "";
    this.events = mergeOps(this.events, list, CAP);
    const after = this.events.length ? this.events[this.events.length - 1]!.id : "";
    if (before !== after || !this.box.childElementCount) this.renderAll();
  }

  /** One live event. Returns false if it was a duplicate. */
  add(e: OpsEvent): boolean {
    if (this.events.some((x) => x.id === e.id)) return false;
    const last = this.events[this.events.length - 1];
    this.events = mergeOps(this.events, [e], CAP);
    if (last && e.t < last.t) {
      this.renderAll();
      return true;
    }
    if (!matchesFilter(e.kind, this.filter)) return true;
    const stick = this.atBottom();
    this.box.querySelector(".log-empty")?.remove();
    const el = this.line(e);
    el.classList.add("fresh");
    this.box.append(el);
    while (this.box.childElementCount > CAP) this.box.firstElementChild?.remove();
    if (stick) this.scrollToEnd();
    else {
      this.unseen++;
      this.jump.hidden = false;
      this.jump.textContent = this.t()("warroom.log.new", { n: this.unseen });
    }
    return true;
  }

  private renderAll(): void {
    const t = this.t();
    const shown = this.events.filter((e) => matchesFilter(e.kind, this.filter)).slice(-CAP);
    this.box.replaceChildren(...shown.map((e) => this.line(e)));
    if (!shown.length) this.box.append(h("div", { className: "log-empty", textContent: t("warroom.log.empty") }));
    this.scrollToEnd();
    this.clearUnseen();
  }

  private line(e: OpsEvent): HTMLElement {
    const l = logLine(e);
    const el = h(
      "div",
      { className: `ln tone-${l.tone}` },
      h("time", { textContent: l.time, dateTime: new Date(e.t).toISOString() }),
      h("b", { className: "k", textContent: this.t()(`warroom.kind.${l.kind}` as CopyKey) }),
      h("span", { className: "tx", textContent: l.text }),
    );
    el.dataset.kind = e.kind;
    el.dataset.id = e.id;
    return el;
  }

  private atBottom(): boolean {
    return this.box.scrollHeight - this.box.scrollTop - this.box.clientHeight < 28;
  }

  private scrollToEnd(): void {
    this.box.scrollTop = this.box.scrollHeight;
  }

  private clearUnseen(): void {
    this.unseen = 0;
    this.jump.hidden = true;
  }
}
