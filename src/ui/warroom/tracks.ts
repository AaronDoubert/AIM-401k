// Track rows: one per job in flight, in a table like a C2 track list. DOM is
// built once per row and patched on update, so typing into an answer box
// survives live refreshes. All job and page derived text goes through
// textContent (never innerHTML).
import type { CopyKey } from "../../shared/copy";
import { callsign, companyName } from "../../shared/display";
import type { ToBackground } from "../../shared/messages";
import type { FieldCheck, Need } from "../../shared/types";
import { h } from "../common";
import { guardedRelease } from "../guarded";
import { progressOf, stopwatch, type TileModel } from "./model";

export type T = (key: CopyKey, vars?: Record<string, string | number>) => string;

export interface TrackDeps {
  t: () => T;
  send: (msg: ToBackground) => Promise<unknown>;
  /** Unsent answer text per need id, kept across re-renders. */
  drafts: Map<string, string>;
  /** Row clicked: lock onto this unit. */
  select: (jobId: string) => void;
}

const MARK: Record<FieldCheck["state"], string> = { ok: "✓", ai: "◆", need: "⚠", todo: "·" };

export class TrackView {
  readonly el: HTMLElement;
  private readonly row: HTMLElement;
  private readonly unit: HTMLElement;
  private readonly tgt: HTMLElement;
  private readonly company: HTMLElement;
  private readonly role: HTMLElement;
  private readonly status: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly fieldsText: HTMLElement;
  private readonly hold: HTMLElement;
  private readonly open: HTMLButtonElement;
  private readonly detail: HTMLElement;
  private readonly checklist: HTMLElement;
  private readonly now: HTMLElement;
  private readonly operator: HTMLElement;
  private readonly opTimer: HTMLElement;
  private thumb: HTMLImageElement | null = null;
  private needSig = "";
  private checkSig = "";

  constructor(
    readonly jobId: string,
    private readonly deps: TrackDeps,
  ) {
    this.unit = h("span", { className: "c-unit" });
    this.tgt = h("span", { className: "c-tgt" });
    this.company = h("span", { className: "c-co" });
    this.role = h("span", { className: "c-role" });
    this.status = h("span", { className: "c-status" });
    this.bar = h("b", { className: "fill" });
    this.fieldsText = h("span", { className: "c-fields-n" });
    this.hold = h("span", { className: "c-hold" });
    this.open = h("button", { type: "button", className: "wr-btn ghost c-open" });
    this.open.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.deps.send({ type: "focusJob", jobId: this.jobId });
    });

    this.row = h(
      "div",
      { className: "track-row", tabIndex: 0 },
      this.unit,
      this.tgt,
      h("span", { className: "c-job" }, this.company, this.role),
      this.status,
      h("span", { className: "c-fields" }, h("i", { className: "bar" }, this.bar), this.fieldsText),
      this.hold,
      this.open,
    );
    const select = () => this.deps.select(this.jobId);
    this.row.addEventListener("click", select);
    this.row.addEventListener("dblclick", () => void this.deps.send({ type: "focusJob", jobId: this.jobId }));
    this.row.addEventListener("keydown", (e) => {
      if (e.target !== this.row) return;
      if (e.key === "Enter") void this.deps.send({ type: "focusJob", jobId: this.jobId });
      else if (e.key === " ") {
        e.preventDefault();
        select();
      }
    });

    this.checklist = h("ul", { className: "checklist" });
    this.now = h("div", { className: "c-now" });
    this.detail = h("div", { className: "track-detail" }, this.now, this.checklist);
    this.opTimer = h("span", { className: "op-timer" });
    this.operator = h("section", { className: "operator" });
    this.operator.hidden = true;
    this.el = h("article", { className: "track" }, this.row, this.detail, this.operator);
    this.el.dataset.job = jobId;
  }

  update(m: TileModel, slot: number, tgt: string, now: number, chud: boolean, selected: boolean): void {
    const t = this.deps.t();
    const name = companyName(m) || t("warroom.tile.untitled");
    const finished = m.phase === "delivered" || m.phase === "lost";

    const ds = this.el.dataset;
    ds.phase = m.phase;
    ds.status = m.status;
    ds.ready = String(m.ready);
    ds.done = String(m.fieldsDone);
    ds.total = String(m.fieldsTotal);
    ds.step = String(m.step);
    ds.slot = String(slot);
    this.el.classList.toggle("locked", selected);
    this.row.setAttribute("aria-selected", String(selected));

    setText(this.unit, chud ? callsign(slot) : `#${slot}`);
    setText(this.tgt, tgt);
    setText(this.company, name);
    setText(this.role, m.title || pathOf(m.url));
    setText(this.status, t((m.ready ? "warroom.phase.ready" : `warroom.phase.${m.phase}`) as CopyKey));
    setText(this.open, t("warroom.tile.open"));
    this.open.setAttribute("aria-label", t("warroom.tile.open_label", { job: [name, m.title].filter(Boolean).join(" — ") }));

    this.bar.style.width = `${(progressOf(m) * 100).toFixed(1)}%`;
    const fields = m.fieldsTotal ? t("warroom.tile.fields", { done: m.fieldsDone, total: m.fieldsTotal }) : "—";
    setText(this.fieldsText, m.step > 1 ? `${fields} · ${t("warroom.tile.step", { step: m.step })}` : fields);
    setText(this.hold, m.holdingSince != null ? stopwatch(now - m.holdingSince) : "");

    // What the unit is doing right now, then the field checklist.
    setText(this.now, finished ? "" : nowText(m, t));
    const sig = `${chud}|${m.fields.map((f) => `${f.state}:${f.label}`).join("|")}`;
    if (sig !== this.checkSig) {
      this.checkSig = sig;
      this.checklist.replaceChildren(
        ...m.fields.map((f) => {
          const li = h("li", { title: f.state === "ai" ? t("warroom.check.ai") : f.state === "need" ? t("warroom.check.need") : "" }, h("span", { textContent: f.label }), h("i", { textContent: MARK[f.state], ariaHidden: "true" }));
          li.dataset.state = f.state;
          if (f.state === "ai") li.append(h("em", { textContent: t("warroom.check.ai") }));
          return li;
        }),
      );
    }
    this.detail.hidden = finished || (!m.fields.length && !this.now.textContent && !(selected && m.thumb));

    // A live capture of the tab (Firefox), only for the locked unit.
    if (selected && m.thumb) {
      if (!this.thumb) {
        this.thumb = h("img", { className: "thumb", alt: "" });
        this.detail.prepend(this.thumb);
      }
      if (this.thumb.src !== m.thumb) this.thumb.src = m.thumb;
    } else if (this.thumb) {
      this.thumb.remove();
      this.thumb = null;
    }

    // Operator panel: rebuilt only when the set of needs (or the copy mode) changes.
    const needSig = `${chud}|${m.needs.map((n) => n.id).join(",")}`;
    if (needSig !== this.needSig) {
      this.needSig = needSig;
      this.renderOperator(m, t);
    }
    if (m.holdingSince != null) setText(this.opTimer, t("warroom.op.holding", { t: stopwatch(now - m.holdingSince) }));
  }

  /** Put the keyboard on this unit's first answer box (master caution jump). */
  focusOperator(): void {
    const target = this.operator.querySelector<HTMLElement>("textarea, input.wr-input, select, .guard-cover:not(:disabled), button.primary");
    (target ?? this.row).focus({ preventScroll: true });
  }

  private renderOperator(m: TileModel, t: T): void {
    this.operator.replaceChildren();
    this.operator.hidden = !m.needs.length;
    if (!m.needs.length) return;
    this.operator.append(h("div", { className: "op-head" }, h("span", { className: "op-title", textContent: t(m.ready ? "warroom.op.ready" : "warroom.op.title") }), this.opTimer));
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
        guardedRelease({
          labels: { guard: t("warroom.guard.lift"), hold: t("warroom.fire.label"), arming: t("warroom.fire.arming"), done: t("warroom.fire.done"), hint: t("warroom.fire.hint") },
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

/** "https://acme.com/jobs/42?x=1" → "/jobs/42" (title stand-in before the page reports one). */
function pathOf(url: string): string {
  try {
    const p = new URL(url).pathname;
    return p.length > 1 ? p : url;
  } catch {
    return url;
  }
}

function nowText(m: TileModel, t: T): string {
  switch (m.phase) {
    case "filling":
      return m.currentField ? t("warroom.tile.filling", { field: m.currentField }) : "";
    case "opening":
    case "recon":
      return t("warroom.tile.acquiring");
    default:
      return "";
  }
}
