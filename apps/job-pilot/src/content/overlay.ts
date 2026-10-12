import { api } from "../shared/api";
import type { OverlayState, ToBackground } from "../shared/messages";
import type { Need } from "../shared/types";

// The floating "JobPilot needs you" box shown on every tab. Lives in a closed
// shadow root so page CSS can't break it and page scripts can't read it.
// All page-derived text is set via textContent (never innerHTML).

const send = (msg: ToBackground): Promise<unknown> => api.runtime.sendMessage(msg);

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
.wrap { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; color: #0f172a; }
.pill { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 999px; border: 0; cursor: pointer;
  background: #0f172a; color: #fff; font-size: 13px; font-weight: 600; box-shadow: 0 6px 20px rgba(0,0,0,.25); }
.pill.alert { background: #dc2626; animation: pulse 1.6s ease-in-out 3; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; }
.pill.alert .dot { background: #fff; }
.pill.paused .dot { background: #94a3b8; }
@keyframes pulse { 50% { transform: scale(1.06); } }
.panel { width: 360px; max-width: calc(100vw - 32px); max-height: min(70vh, 560px); overflow: auto; background: #fff; border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0,0,0,.3); border: 1px solid #e2e8f0; }
.head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid #e2e8f0;
  position: sticky; top: 0; background: #fff; }
.head b { font-size: 14px; }
.head small { color: #64748b; font-size: 12px; display: block; }
.empty { padding: 16px 12px; color: #64748b; font-size: 13px; }
.card { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; }
.job { font-size: 11px; color: #64748b; margin-bottom: 4px; text-transform: none; }
.kind { display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: .03em; text-transform: uppercase; padding: 1px 6px;
  border-radius: 4px; background: #fee2e2; color: #991b1b; margin-right: 6px; }
.kind.review_submit { background: #dcfce7; color: #166534; }
.kind.question { background: #fef3c7; color: #92400e; }
.prompt { font-size: 13px; line-height: 1.35; margin: 4px 0 8px; white-space: pre-wrap; word-break: break-word; }
input[type=text], textarea, select { width: 100%; font-size: 13px; padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 6px; color: #0f172a; background: #fff; }
textarea { min-height: 70px; resize: vertical; }
.detail { font-size: 12px; color: #b45309; margin: -4px 0 8px; }
.row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; align-items: center; }
button.b { font-size: 12px; padding: 5px 10px; border-radius: 6px; border: 1px solid #cbd5e1; background: #f8fafc; cursor: pointer; color: #0f172a; }
button.b.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
button.b.link { border: 0; background: none; color: #64748b; text-decoration: underline; padding: 5px 4px; }
label.rem { font-size: 11px; color: #64748b; display: flex; gap: 4px; align-items: center; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const k of kids) e.append(k);
  return e;
}

function button(text: string, onClick: () => void, cls = ""): HTMLButtonElement {
  const b = el("button", { className: `b ${cls}`, textContent: text, type: "button" });
  b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    onClick();
  });
  return b;
}

const KIND_LABEL: Record<Need["kind"], string> = {
  question: "Question",
  consent: "Agree?",
  signature: "Signature",
  captcha: "CAPTCHA",
  login: "Sign in",
  review_submit: "Ready",
  stalled: "Stuck",
  error: "Error",
};

export class Overlay {
  private host: HTMLElement;
  private root: ShadowRoot;
  private wrap: HTMLDivElement;
  private open = false;
  private lastNeedCount = 0;
  private state: OverlayState | null = null;
  /** Unsent text typed into answer boxes, kept across re-renders. */
  private drafts = new Map<string, string>();

  constructor() {
    this.host = document.createElement("div");
    this.host.id = "jobpilot-root";
    this.root = this.host.attachShadow({ mode: "closed" });
    this.root.append(el("style", { textContent: CSS }));
    this.wrap = el("div", { className: "wrap" });
    this.root.append(this.wrap);
    (document.body ?? document.documentElement).append(this.host);
  }

  update(state: OverlayState): void {
    this.state = state;
    const n = state.needs.length;
    if (n > this.lastNeedCount) this.open = true; // new need: pop open
    if (n === 0 && this.lastNeedCount > 0) this.open = false;
    this.lastNeedCount = n;
    this.render();
  }

  private render(): void {
    const s = this.state;
    // Keep focus inside an answer box from being clobbered while typing.
    const active = this.root.activeElement as HTMLElement | null;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;

    this.wrap.replaceChildren();
    if (!s) return;
    const n = s.needs.length;
    if (n === 0 && s.running === 0 && s.queued === 0) return;

    if (this.open) this.wrap.append(this.panel(s));

    const text = n ? `${n} need${n === 1 ? "s" : ""} you` : s.paused ? "Paused" : `Applying… ${s.running} active · ${s.queued} queued`;
    const pill = el("button", { className: `pill ${n ? "alert" : ""} ${s.paused ? "paused" : ""}`, type: "button" }, el("span", { className: "dot" }), `JobPilot · ${text}`);
    pill.addEventListener("click", () => {
      this.open = !this.open;
      this.render();
    });
    this.wrap.append(pill);
  }

  private panel(s: OverlayState): HTMLElement {
    const head = el(
      "div",
      { className: "head" },
      el("div", {}, el("b", { textContent: "JobPilot" }), el("small", { textContent: `${s.running} active · ${s.queued} queued${s.paused ? " · paused" : ""}` })),
      el(
        "div",
        { className: "row" },
        button(s.paused ? "Resume" : "Pause", () => void send({ type: "setPaused", paused: !s.paused })),
        button("–", () => {
          this.open = false;
          this.render();
        }),
      ),
    );
    const panel = el("div", { className: "panel" }, head);
    if (!s.needs.length) panel.append(el("div", { className: "empty", textContent: "Nothing needs you right now. I'll pop up when something does." }));
    for (const need of s.needs) panel.append(this.card(need, s));
    return panel;
  }

  private card(need: Need, s: OverlayState): HTMLElement {
    const job = s.jobs[need.jobId];
    const card = el(
      "div",
      { className: "card" },
      el("div", { className: "job", textContent: job ? `${job.company || "?"} — ${job.title || "Untitled role"}` : "" }),
      el("div", { className: "prompt" }, el("span", { className: `kind ${need.kind}`, textContent: KIND_LABEL[need.kind] }), need.prompt),
    );
    if (need.detail) card.append(el("div", { className: "detail", textContent: need.detail }));
    const go = () => void send({ type: "focusJob", jobId: need.jobId });
    const answer = (value: string, remember: boolean) => {
      this.drafts.delete(need.id);
      void send({ type: "answerNeed", needId: need.id, value, remember });
    };
    const actions = el("div", { className: "row" });

    if ((need.kind === "question" || need.kind === "signature") && need.inputType) {
      const remember = el("input", { type: "checkbox", checked: need.kind !== "signature" });
      if (need.inputType === "choice" && need.options?.length) {
        const sel = el("select");
        sel.append(el("option", { value: "", textContent: "Choose…" }));
        for (const o of need.options) sel.append(el("option", { value: o, textContent: o }));
        card.append(sel);
        actions.append(button("Use answer", () => sel.value && answer(sel.value, remember.checked), "primary"));
      } else if (need.inputType === "multi" && need.options?.length) {
        const box = el("div");
        const checks = need.options.map((o) => {
          const c = el("input", { type: "checkbox", value: o });
          box.append(el("label", { className: "rem" }, c, o));
          return c;
        });
        card.append(box);
        actions.append(
          button("Use answer", () => {
            const v = checks.filter((c) => c.checked).map((c) => c.value).join("; ");
            if (v) answer(v, remember.checked);
          }, "primary"),
        );
      } else {
        const input = need.inputType === "textarea" ? el("textarea") : el("input", { type: "text" });
        input.placeholder = need.kind === "signature" ? "Type your full legal name to sign" : "Your answer";
        input.value = this.drafts.get(need.id) ?? "";
        input.addEventListener("input", () => this.drafts.set(need.id, input.value));
        input.addEventListener("keydown", (ev) => {
          const e = ev as KeyboardEvent;
          e.stopPropagation(); // don't trigger page shortcuts
          if (e.key === "Enter" && !(input instanceof HTMLTextAreaElement) && input.value.trim()) answer(input.value.trim(), remember.checked);
        });
        card.append(input);
        actions.append(button(need.kind === "signature" ? "Sign" : "Fill", () => input.value.trim() && answer(input.value.trim(), remember.checked), "primary"));
      }
      actions.append(el("label", { className: "rem" }, remember, "remember"));
      actions.append(button("Open tab", go, "link"));
    } else if (need.kind === "consent") {
      const remember = el("input", { type: "checkbox", checked: true });
      actions.append(button("I agree", () => answer("checked", remember.checked), "primary"));
      actions.append(el("label", { className: "rem" }, remember, "always"));
      actions.append(button("Open tab", go, "link"));
    } else if (need.kind === "review_submit") {
      actions.append(button("Open & review", go, "primary"));
      actions.append(button("Submit for me", () => void send({ type: "submitJob", jobId: need.jobId })));
    } else {
      actions.append(button("Open tab", go, "primary"));
      if (need.kind === "stalled" || need.kind === "error") actions.append(button("Retry", () => void send({ type: "retryJob", jobId: need.jobId })));
      if (need.kind === "login" || need.kind === "captcha") actions.append(button("Done", () => void send({ type: "dismissNeed", needId: need.id })));
    }
    actions.append(button("Skip job", () => void send({ type: "skipJob", jobId: need.jobId }), "link"));
    card.append(actions);
    return card;
  }
}
