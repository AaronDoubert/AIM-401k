// Unit tiles: one per active job. DOM is built once per tile and patched on
// update, so typing into an answer box survives live refreshes. All job and
// page derived text goes through textContent (never innerHTML).
import type { CopyKey } from "../../shared/copy";
import type { ToBackground } from "../../shared/messages";
import type { Need } from "../../shared/types";
import { h } from "../common";
import { holdToFire } from "./holdfire";
import { progressOf, schematicRows, stopwatch, type TileModel } from "./model";

export type T = (key: CopyKey, vars?: Record<string, string | number>) => string;

export interface TileDeps {
  t: () => T;
  send: (msg: ToBackground) => Promise<unknown>;
  /** Unsent answer text per need id, kept across re-renders. */
  drafts: Map<string, string>;
}

const ROWS = 6;

export class TileView {
  readonly el: HTMLElement;
  private readonly hit: HTMLElement;
  private readonly unitId: HTMLElement;
  private readonly meta: HTMLElement;
  private readonly phaseEl: HTMLElement;
  private readonly company: HTMLElement;
  private readonly title: HTMLElement;
  private readonly viz: HTMLElement;
  private readonly rows: HTMLElement[] = [];
  private readonly lockLabel: HTMLElement;
  private readonly lockField: HTMLElement;
  private readonly lock: HTMLElement;
  private readonly meterFill: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly stepEl: HTMLElement;
  private readonly stamp: HTMLElement;
  private readonly operator: HTMLElement;
  private readonly opTimer: HTMLElement;
  private thumb: HTMLImageElement | null = null;
  private needSig = "";
  private lastLock = "";

  constructor(
    readonly jobId: string,
    private readonly deps: TileDeps,
  ) {
    this.unitId = h("span", { className: "unit-id" });
    this.meta = h("span", { className: "tile-meta" });
    this.phaseEl = h("span", { className: "tile-phase" });
    this.company = h("div", { className: "tile-company" });
    this.title = h("div", { className: "tile-title" });
    const schematic = h("div", { className: "schematic", ariaHidden: "true" });
    for (let i = 0; i < ROWS; i++) {
      const row = h("div", { className: "srow", style: `--i:${i}` }, h("i", { className: "lab" }), h("i", { className: "inp" }, h("b", { className: "fill" })));
      this.rows.push(row);
      schematic.append(row);
    }
    this.stamp = h("div", { className: "stamp", ariaHidden: "true" });
    this.viz = h("div", { className: "viz" }, schematic, h("i", { className: "brk tl" }), h("i", { className: "brk tr" }), h("i", { className: "brk bl" }), h("i", { className: "brk br" }), this.stamp);
    this.lockLabel = h("span", { className: "lock-label" });
    this.lockField = h("span", { className: "lock-field" });
    this.lock = h("div", { className: "lock" }, this.lockLabel, h("span", { className: "reticle", ariaHidden: "true", textContent: "⌖" }), this.lockField);
    this.meterFill = h("i");
    this.stats = h("span", { className: "tile-fields" });
    this.stepEl = h("span", { className: "tile-step" });

    this.hit = h(
      "div",
      { className: "tile-hit", tabIndex: 0 },
      h("div", { className: "tile-top" }, this.unitId, this.meta, h("span", { className: "tile-pip", ariaHidden: "true" }), this.phaseEl),
      this.company,
      this.title,
      this.viz,
      this.lock,
      h("div", { className: "meter" }, this.meterFill),
      h("div", { className: "tile-foot" }, this.stats, this.stepEl),
    );
    this.hit.setAttribute("role", "button");
    const focus = () => void this.deps.send({ type: "focusJob", jobId: this.jobId });
    this.hit.addEventListener("click", focus);
    this.hit.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        focus();
      }
    });

    this.opTimer = h("span", { className: "op-timer" });
    this.operator = h("section", { className: "operator" });
    this.operator.hidden = true;
    this.el = h("article", { className: "tile frame" }, this.hit, this.operator);
    this.el.dataset.job = jobId;
  }

  update(m: TileModel, slot: number, now: number, chud: boolean): void {
    const t = this.deps.t();
    const unit = String(slot).padStart(2, "0");
    const phaseKey = (m.ready ? "warroom.phase.ready" : `warroom.phase.${m.phase}`) as CopyKey;
    const name = m.company || hostOf(m.url) || t("warroom.tile.untitled");

    const ds = this.el.dataset;
    ds.phase = m.phase;
    ds.ready = String(m.ready);
    ds.done = String(m.fieldsDone);
    ds.total = String(m.fieldsTotal);
    ds.step = String(m.step);
    ds.slot = unit;

    setText(this.unitId, chud ? `UNIT-${unit}` : `#${slot}`);
    setText(this.meta, chud ? `TGT-${m.tgt}` : "");
    setText(this.phaseEl, t(phaseKey));
    setText(this.company, name);
    setText(this.title, m.title || pathOf(m.url));
    this.hit.setAttribute("aria-label", t("warroom.tile.open", { job: [name, m.title].filter(Boolean).join(" · ") }));

    // Schematic + progress.
    const { filled, active } = schematicRows(m, ROWS);
    this.rows.forEach((r, i) => {
      r.classList.toggle("on", i < filled);
      r.classList.toggle("active", i === active);
    });
    const p = progressOf(m);
    this.meterFill.style.width = `${(p * 100).toFixed(1)}%`;
    setText(this.stats, m.fieldsTotal ? t("warroom.tile.fields", { done: m.fieldsDone, total: m.fieldsTotal }) : "—");
    setText(this.stepEl, t("warroom.tile.step", { step: m.step }));
    setText(this.stamp, m.phase === "delivered" || m.phase === "lost" ? t(`warroom.phase.${m.phase}`) : "");

    // Lock-on line.
    const field = lockText(m, t);
    setText(this.lockLabel, m.phase === "filling" && m.currentField ? t("warroom.tile.lock") : "");
    if (field !== this.lastLock) {
      this.lastLock = field;
      this.lockField.textContent = field;
      this.lock.classList.remove("acq");
      void this.lock.offsetWidth; // restart the lock-on animation
      this.lock.classList.add("acq");
    }

    // Thumbnail (Firefox only) behind the schematic.
    if (m.thumb) {
      if (!this.thumb) {
        this.thumb = h("img", { className: "thumb", alt: "" });
        this.viz.prepend(this.thumb);
      }
      if (this.thumb.src !== m.thumb) this.thumb.src = m.thumb;
      this.viz.classList.add("has-thumb");
    }

    // Operator panel: rebuilt only when the set of needs (or the copy mode) changes.
    const sig = `${chud}|${m.needs.map((n) => n.id).join(",")}`;
    if (sig !== this.needSig) {
      this.needSig = sig;
      this.renderOperator(m, t);
    }
    if (m.holdingSince != null) setText(this.opTimer, t("warroom.op.holding", { t: stopwatch(now - m.holdingSince) }));
  }

  private renderOperator(m: TileModel, t: T): void {
    this.operator.replaceChildren();
    this.operator.hidden = !m.needs.length;
    if (!m.needs.length) return;
    this.operator.append(
      h("div", { className: "op-head" }, h("span", { className: "op-title", textContent: t(m.ready ? "warroom.op.ready" : "warroom.op.title") }), this.opTimer),
    );
    // Questions first, the release last.
    const order = [...m.needs].sort((a, b) => Number(a.kind === "review_submit") - Number(b.kind === "review_submit"));
    for (const n of order) this.operator.append(this.needCard(n, t));
  }

  private needCard(need: Need, t: T): HTMLElement {
    const { send, drafts } = this.deps;
    const card = h("div", { className: "need" });
    card.dataset.kind = need.kind;
    card.dataset.need = need.id;
    card.append(h("div", { className: "need-q" }, h("span", { className: "need-kind", textContent: t(`warroom.need.${need.kind}`) }), h("span", { className: "need-prompt", textContent: need.prompt })));
    if (need.detail) card.append(h("div", { className: "need-detail", textContent: need.detail }));

    const row = h("div", { className: "need-actions" });
    const sent = () => {
      card.classList.add("sent");
      for (const el of card.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input, textarea, select")) el.disabled = true;
    };
    const answer = (value: string, remember: boolean) => {
      drafts.delete(need.id);
      sent();
      void send({ type: "answerNeed", needId: need.id, value, remember });
    };
    const go = () => void send({ type: "focusJob", jobId: need.jobId });
    const btn = (label: string, fn: () => void, cls = "") => {
      const b = h("button", { type: "button", className: `wr-btn ${cls}`, textContent: label });
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        fn();
      });
      return b;
    };
    const check = (label: string, on: boolean) => {
      const c = h("input", { type: "checkbox", checked: on });
      return { box: c, el: h("label", { className: "wr-check" }, c, h("span", { textContent: label })) };
    };

    if ((need.kind === "question" || need.kind === "signature") && need.inputType) {
      const remember = check(t("warroom.need.remember"), need.kind !== "signature");
      if (need.inputType === "choice" && need.options?.length) {
        const sel = h("select", { className: "wr-input" });
        sel.append(h("option", { value: "", textContent: t("warroom.need.choose") }));
        for (const o of need.options) sel.append(h("option", { value: o, textContent: o }));
        card.append(sel);
        row.append(btn(t("warroom.need.fill"), () => sel.value && answer(sel.value, remember.box.checked), "primary"));
      } else if (need.inputType === "multi" && need.options?.length) {
        const box = h("div", { className: "need-multi" });
        const checks = need.options.map((o) => {
          const c = check(o, false);
          box.append(c.el);
          c.box.value = o;
          return c.box;
        });
        card.append(box);
        row.append(
          btn(t("warroom.need.fill"), () => {
            const v = checks.filter((c) => c.checked).map((c) => c.value).join("; ");
            if (v) answer(v, remember.box.checked);
          }, "primary"),
        );
      } else {
        const input = need.inputType === "textarea" ? h("textarea", { className: "wr-input", rows: 3 }) : h("input", { className: "wr-input", type: need.inputType === "date" ? "date" : "text" });
        input.placeholder = t(need.kind === "signature" ? "warroom.need.sign_placeholder" : "warroom.need.placeholder");
        input.value = drafts.get(need.id) ?? "";
        input.setAttribute("aria-label", need.prompt);
        input.addEventListener("input", () => drafts.set(need.id, input.value));
        const submit = () => input.value.trim() && answer(input.value.trim(), remember.box.checked);
        input.addEventListener("keydown", (ev) => {
          const e = ev as KeyboardEvent;
          e.stopPropagation();
          if (e.key === "Enter" && (!(input instanceof HTMLTextAreaElement) || e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        });
        card.append(input);
        row.append(btn(t(need.kind === "signature" ? "warroom.need.sign" : "warroom.need.fill"), submit, "primary"));
      }
      row.append(remember.el, btn(t("warroom.need.open"), go, "ghost"));
    } else if (need.kind === "consent") {
      const always = check(t("warroom.need.always"), true);
      row.append(btn(t("warroom.need.agree"), () => answer("checked", always.box.checked), "primary"), always.el, btn(t("warroom.need.open"), go, "ghost"));
    } else if (need.kind === "review_submit") {
      row.append(
        holdToFire({
          label: t("warroom.fire.label"),
          arming: t("warroom.fire.arming"),
          done: t("warroom.fire.done"),
          hint: t("warroom.fire.hint"),
          onFire: () => {
            sent();
            void send({ type: "submitJob", jobId: need.jobId });
          },
        }),
        btn(t("warroom.need.review"), go, "ghost"),
      );
    } else {
      row.append(btn(t("warroom.need.open"), go, "primary"));
      if (need.kind === "login" || need.kind === "captcha") row.append(btn(t("warroom.need.done"), () => (sent(), void send({ type: "dismissNeed", needId: need.id }))));
      else row.append(btn(t("warroom.need.retry"), () => (sent(), void send({ type: "retryJob", jobId: need.jobId }))));
    }
    row.append(btn(t("warroom.need.skip"), () => (sent(), void send({ type: "skipJob", jobId: need.jobId })), "link"));
    card.append(row);
    return card;
  }
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** "https://acme.com/jobs/42?x=1" → "/jobs/42" (title stand-in before the page reports one). */
function pathOf(url: string): string {
  try {
    const p = new URL(url).pathname;
    return p.length > 1 ? p : url;
  } catch {
    return url;
  }
}

function lockText(m: TileModel, t: T): string {
  switch (m.phase) {
    case "filling":
      return m.currentField || t("warroom.tile.acquiring");
    case "holding": {
      if (m.ready) return t("warroom.phase.ready");
      const q = m.needs.find((n) => n.kind !== "review_submit");
      return q?.prompt ?? t("warroom.phase.holding");
    }
    case "advancing":
      return `${t("warroom.tile.step", { step: m.step })} ▸`;
    case "opening":
    case "recon":
    case "queued":
      return t("warroom.tile.acquiring");
    default:
      return t(`warroom.phase.${m.phase}`);
  }
}
