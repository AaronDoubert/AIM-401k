import { api } from "../shared/api";
import { copy, type CopyKey } from "../shared/copy";
import type { OverlayState, ToBackground } from "../shared/messages";
import type { Need } from "../shared/types";

// The floating "AIM-401k needs you" box shown on every tab. Lives in a closed
// shadow root so page CSS can't break it and page scripts can't read it.
// All page-derived text is set via textContent (never innerHTML).
// Fonts: system stacks only (no web-accessible font files, so pages can't probe for the extension).

const send = (msg: ToBackground): Promise<unknown> => api.runtime.sendMessage(msg);

/** Press-and-hold time for "submit for me". */
export const HOLD_MS = 1200;

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.wrap {
  --bg: #0a0c0b; --panel: #111513; --well: #0d100e; --line: #1f2723; --line-2: #2e3833; --bracket: #56625b;
  --fg: #e8e6e1; --fg-2: #bfc3be; --muted: #8a928d; --accent: #ff5f1f; --accent-hi: #ff7a43; --ok: #39ff6a; --warn: #ffb000; --danger: #ff3b30;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Mono", Menlo, Consolas, "Liberation Mono", monospace;
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
  display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
  font: 13px/1.4 var(--sans); color: var(--fg); text-align: left;
}
.wrap * { font-family: inherit; }
.mono, .pill, .head, .job, .kind, .detail, button.b, label.rem, .empty { font-family: var(--mono); }

/* corner brackets */
.brk::before { content: ""; position: absolute; inset: -1px; pointer-events: none;
  background:
    linear-gradient(var(--bc), var(--bc)) left top / 10px 2px, linear-gradient(var(--bc), var(--bc)) left top / 2px 10px,
    linear-gradient(var(--bc), var(--bc)) right top / 10px 2px, linear-gradient(var(--bc), var(--bc)) right top / 2px 10px,
    linear-gradient(var(--bc), var(--bc)) left bottom / 10px 2px, linear-gradient(var(--bc), var(--bc)) left bottom / 2px 10px,
    linear-gradient(var(--bc), var(--bc)) right bottom / 10px 2px, linear-gradient(var(--bc), var(--bc)) right bottom / 2px 10px;
  background-repeat: no-repeat; }

.pip { width: 7px; height: 7px; flex: none; background: var(--ok); display: inline-block; }
.pip.blink { animation: blink 1s steps(2, jump-none) infinite; }
@keyframes blink { 50% { opacity: .2; } }

.pill { --bc: var(--bracket); position: relative; display: flex; align-items: center; gap: 9px; padding: 9px 13px; border: 1px solid var(--line-2); border-radius: 0;
  cursor: pointer; background: var(--bg); color: var(--fg); font-size: 11px; font-weight: 700; letter-spacing: .1em;
  box-shadow: 0 10px 30px rgba(0,0,0,.45); }
.pill:hover { border-color: var(--bracket); }
.pill.alert { --bc: var(--danger); border-color: rgba(255,59,48,.6); color: var(--accent); background: #140b09; }
.pill.alert .pip { background: var(--danger); }
.pill.paused .pip { background: var(--muted); }
.pill.arrive { animation: arrive .5s ease-out 2; }
@keyframes arrive { 50% { box-shadow: 0 0 0 4px rgba(255,59,48,.35), 0 10px 30px rgba(0,0,0,.45); } }

.panel { --bc: var(--bracket); position: relative; width: 384px; max-width: calc(100vw - 32px); max-height: min(72vh, 580px); display: flex; flex-direction: column;
  background: var(--bg); border: 1px solid var(--line-2); box-shadow: 0 18px 50px rgba(0,0,0,.55); animation: open .16s ease-out; }
.panel.hot { --bc: var(--accent); }
@keyframes open { from { opacity: 0; transform: translateY(6px); } }
.head { display: flex; flex-direction: column; gap: 6px; padding: 9px 10px 9px 12px; border-bottom: 1px solid var(--line); background: var(--panel); flex: none; }
.head > div { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; }
.head b { display: flex; align-items: center; gap: 8px; font-size: 10.5px; font-weight: 700; letter-spacing: .1em; color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.panel.hot .head b { color: var(--accent); }
.head .pip { background: var(--accent); }
.panel:not(.hot) .head .pip { background: var(--ok); }
.head small { display: block; color: var(--muted); font-size: 10px; letter-spacing: .1em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.head button.b { flex: none; }
.chud .job { text-transform: uppercase; }
.list { overflow: auto; overscroll-behavior: contain; }
.empty { padding: 18px 14px; color: var(--muted); font-size: 11.5px; letter-spacing: .04em; }

.card { position: relative; padding: 11px 14px 12px 16px; border-bottom: 1px solid var(--line); }
.card:last-child { border-bottom: 0; }
.card::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background: var(--k, var(--danger)); }
.job { font-size: 10px; color: var(--muted); letter-spacing: .1em; margin-bottom: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kind { display: inline-block; font-size: 9.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; padding: 1px 5px; margin-right: 8px;
  border: 1px solid currentColor; color: var(--k, var(--danger)); vertical-align: 1px; }
.k-question { --k: var(--warn); }
.k-consent, .k-signature { --k: var(--accent); }
.k-review_submit { --k: var(--ok); }
.k-captcha, .k-login, .k-stalled, .k-error { --k: var(--danger); }
.prompt { font-size: 13.5px; line-height: 1.4; margin: 2px 0 9px; white-space: pre-wrap; word-break: break-word; color: var(--fg); }
.detail { font-size: 11px; color: var(--warn); margin: -4px 0 9px; }
input[type=text], input[type=date], textarea, select { display: block; width: 100%; margin: 0; font: 13px/1.4 var(--sans); padding: 7px 9px; border: 1px solid var(--line-2); border-radius: 0;
  color: var(--fg); background: var(--well); color-scheme: dark; }
input::placeholder, textarea::placeholder { color: #7d8681; opacity: 1; }
input:focus, textarea:focus, select:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
textarea { min-height: 72px; resize: vertical; }
input[type=checkbox] { appearance: none; -webkit-appearance: none; width: 13px; height: 13px; margin: 0; border: 1px solid var(--bracket); background: var(--well) no-repeat center / 9px 7px; cursor: pointer; flex: none; }
input[type=checkbox]:checked { background-color: var(--accent); border-color: var(--accent);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='8' viewBox='0 0 10 8'%3E%3Cpath d='M1 4l3 3 5-6' fill='none' stroke='%230a0c0b' stroke-width='2'/%3E%3C/svg%3E"); }
.opts { display: flex; flex-direction: column; gap: 4px; margin-bottom: 4px; }
.row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; align-items: center; }
button.b { position: relative; display: inline-flex; align-items: center; gap: 7px; font-size: 10.5px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; line-height: 1.2;
  padding: 7px 10px; min-height: 30px; border-radius: 0; border: 1px solid var(--line-2); background: var(--panel); color: var(--fg); cursor: pointer; overflow: hidden; }
button.b:hover { border-color: var(--bracket); background: #171c19; }
button.b.primary { background: var(--accent); border-color: var(--accent); color: var(--bg); font-weight: 700; }
button.b.primary:hover { background: var(--accent-hi); border-color: var(--accent-hi); }
button.b.link { border-color: transparent; background: none; color: var(--muted); padding: 7px 5px; }
button.b.link:hover { color: var(--fg); background: none; border-color: transparent; text-decoration: underline; text-underline-offset: 3px; }
button.b.icon { padding: 5px 8px; min-height: 26px; font-size: 12px; }
button.b:focus-visible, .pill:focus-visible, input[type=checkbox]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
label.rem { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); display: inline-flex; gap: 5px; align-items: center; cursor: pointer; }
.opts label.rem { font: 13px/1.35 var(--sans); text-transform: none; letter-spacing: 0; color: var(--fg); gap: 8px; }

/* hold-to-release */
button.b.hold { justify-content: center; border-color: rgba(255,95,31,.55); color: var(--accent); user-select: none; -webkit-user-select: none; touch-action: none; }
button.b.hold:hover { border-color: var(--accent); background: rgba(255,95,31,.08); }
.hold svg { width: 15px; height: 15px; flex: none; transform: rotate(-90deg); }
.hold circle { fill: none; stroke-width: 2.5; }
.hold .track { stroke: rgba(255,95,31,.25); }
.hold .prog { stroke: var(--accent); stroke-dasharray: 50.27; stroke-dashoffset: 50.27; }
.hold .bar { position: absolute; left: 0; bottom: 0; height: 2px; width: 0; background: var(--accent); }
.hold.arming { background: rgba(255,95,31,.12); border-color: var(--accent); }
.hold.arming .prog { stroke-dashoffset: 0; transition: stroke-dashoffset var(--hold) linear; }
.hold.arming .bar { width: 100%; transition: width var(--hold) linear; }
.hold.fired { background: var(--accent); color: var(--bg); border-color: var(--accent); }
.hold.fired .track { stroke: rgba(10,12,11,.3); }
.hold.fired .prog { stroke: var(--bg); stroke-dashoffset: 0; }

@media (prefers-reduced-motion: reduce) {
  .pip.blink, .pill.arrive, .panel { animation: none; }
}
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const k of kids) e.append(k);
  return e;
}

function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
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

export class Overlay {
  private host: HTMLElement;
  private root: ShadowRoot;
  private wrap: HTMLDivElement;
  private open = false;
  private lastNeedCount = 0;
  private state: OverlayState | null = null;
  /** Unsent text typed into answer boxes, kept across re-renders. */
  private drafts = new Map<string, string>();
  /** A hold-to-release is in progress: don't re-render under the user's finger. */
  private holding = false;
  private renderPending = false;
  private arrived = false;

  constructor() {
    this.host = document.createElement("div");
    this.host.id = "aim401k-root";
    this.root = this.host.attachShadow({ mode: "closed" });
    this.root.append(el("style", { textContent: CSS }));
    this.wrap = el("div", { className: "wrap" });
    this.root.append(this.wrap);
    (document.body ?? document.documentElement).append(this.host);
    // Plain mode is switched from extension pages; pick it up without waiting for the next broadcast.
    api.storage?.onChanged?.addListener((changes, area) => {
      if (area !== "local" || !changes.settings) return;
      void (send({ type: "getOverlayState" }) as Promise<OverlayState | undefined>).then((s) => s && this.update(s)).catch(() => undefined);
    });
  }

  private c(key: CopyKey, vars?: Record<string, string | number>): string {
    return copy(this.state?.chud ?? true, key, vars);
  }

  update(state: OverlayState): void {
    this.state = state;
    const n = state.needs.length;
    if (n > this.lastNeedCount) {
      this.open = true; // new need: pop open
      this.arrived = true;
    }
    if (n === 0 && this.lastNeedCount > 0) this.open = false;
    this.lastNeedCount = n;
    this.render();
  }

  private render(): void {
    if (this.holding) {
      this.renderPending = true;
      return;
    }
    const s = this.state;
    // Keep focus inside an answer box from being clobbered while typing.
    const active = this.root.activeElement as HTMLElement | null;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;

    this.wrap.replaceChildren();
    if (!s) return;
    this.wrap.classList.toggle("chud", s.chud !== false);
    const n = s.needs.length;
    if (n === 0 && s.running === 0 && s.queued === 0) return;

    if (this.open) this.wrap.append(this.panel(s));

    const text = n
      ? this.c("theme.ov.pill.needs", { n, s: n === 1 ? "s" : "" })
      : s.paused
        ? this.c("theme.ov.pill.paused")
        : this.c("theme.ov.pill.running", { running: s.running, queued: s.queued });
    const pill = el(
      "button",
      { className: `pill brk ${n ? "alert" : ""} ${s.paused ? "paused" : ""} ${this.arrived && !this.open ? "arrive" : ""}`, type: "button" },
      el("span", { className: `pip ${n || s.running ? "blink" : ""}` }),
      text,
    );
    this.arrived = false;
    pill.setAttribute("aria-expanded", String(this.open));
    pill.addEventListener("click", () => {
      this.open = !this.open;
      this.render();
    });
    this.wrap.append(pill);
  }

  private panel(s: OverlayState): HTMLElement {
    const sub = `${this.c("theme.ov.sub", { running: s.running, queued: s.queued })}${s.paused ? ` · ${this.c("theme.ov.paused")}` : ""}`;
    const min = button("–", () => {
      this.open = false;
      this.render();
    }, "icon");
    min.setAttribute("aria-label", this.c("theme.ov.minimize"));
    min.title = this.c("theme.ov.minimize");
    // Two lines: title · minimize / run state · pause toggle
    const head = el(
      "div",
      { className: "head" },
      el("div", {}, el("b", {}, el("span", { className: `pip ${s.needs.length ? "blink" : ""}` }), s.needs.length ? this.c("theme.ov.head.needs") : this.c("theme.ov.head.idle")), min),
      el("div", {}, el("small", { textContent: sub }), button(s.paused ? this.c("theme.resume") : this.c("theme.pause"), () => void send({ type: "setPaused", paused: !s.paused }))),
    );
    const list = el("div", { className: "list" });
    const panel = el("div", { className: `panel brk ${s.needs.length ? "hot" : ""}` }, head, list);
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", "AIM-401k");
    if (!s.needs.length) list.append(el("div", { className: "empty", textContent: this.c("theme.ov.empty") }));
    for (const need of s.needs) list.append(this.card(need, s));
    return panel;
  }

  private card(need: Need, s: OverlayState): HTMLElement {
    const job = s.jobs[need.jobId];
    const card = el(
      "div",
      { className: `card k-${need.kind}` },
      el("div", { className: "job", textContent: job ? this.c("theme.ov.job", { company: job.company || this.c("theme.ov.unknownCompany"), title: job.title || this.c("theme.ov.untitled") }) : "" }),
      el("div", { className: "prompt" }, el("span", { className: "kind", textContent: this.c(`theme.kind.${need.kind}` as CopyKey) }), need.prompt),
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
        actions.append(button(this.c("theme.ov.use"), () => sel.value && answer(sel.value, remember.checked), "primary"));
      } else if (need.inputType === "multi" && need.options?.length) {
        const box = el("div", { className: "opts" });
        const checks = need.options.map((o) => {
          const c = el("input", { type: "checkbox", value: o });
          box.append(el("label", { className: "rem" }, c, o));
          return c;
        });
        card.append(box);
        actions.append(
          button(this.c("theme.ov.use"), () => {
            const v = checks.filter((c) => c.checked).map((c) => c.value).join("; ");
            if (v) answer(v, remember.checked);
          }, "primary"),
        );
      } else {
        const input = need.inputType === "textarea" ? el("textarea") : el("input", { type: need.inputType === "date" ? "date" : "text" });
        input.placeholder = need.kind === "signature" ? "Type your full legal name to sign" : "Your answer";
        input.setAttribute("aria-label", need.prompt.slice(0, 120));
        input.value = this.drafts.get(need.id) ?? "";
        input.addEventListener("input", () => this.drafts.set(need.id, input.value));
        input.addEventListener("keydown", (ev) => {
          const e = ev as KeyboardEvent;
          e.stopPropagation(); // don't trigger page shortcuts
          if (e.key === "Enter" && !(input instanceof HTMLTextAreaElement) && input.value.trim()) answer(input.value.trim(), remember.checked);
        });
        card.append(input);
        actions.append(button(need.kind === "signature" ? this.c("theme.ov.sign") : this.c("theme.ov.fill"), () => input.value.trim() && answer(input.value.trim(), remember.checked), "primary"));
      }
      actions.append(el("label", { className: "rem" }, remember, this.c("theme.ov.remember")));
      actions.append(button(this.c("theme.ov.openTab"), go, "link"));
    } else if (need.kind === "consent") {
      const remember = el("input", { type: "checkbox", checked: true });
      actions.append(button(this.c("theme.ov.agree"), () => answer("checked", remember.checked), "primary"));
      actions.append(el("label", { className: "rem" }, remember, this.c("theme.ov.always")));
      actions.append(button(this.c("theme.ov.openTab"), go, "link"));
    } else if (need.kind === "review_submit") {
      actions.append(button(this.c("theme.ov.review"), go, "primary"));
      actions.append(this.holdButton(() => void send({ type: "submitJob", jobId: need.jobId })));
    } else {
      actions.append(button(this.c("theme.ov.openTab"), go, "primary"));
      if (need.kind === "stalled" || need.kind === "error") actions.append(button(this.c("theme.ov.retry"), () => void send({ type: "retryJob", jobId: need.jobId })));
      if (need.kind === "login" || need.kind === "captcha") actions.append(button(this.c("theme.ov.done"), () => void send({ type: "dismissNeed", needId: need.id })));
    }
    actions.append(button(this.c("theme.ov.skip"), () => void send({ type: "skipJob", jobId: need.jobId }), "link"));
    card.append(actions);
    return card;
  }

  /**
   * "Submit for me" as press-and-hold: pointer or Space/Enter held for HOLD_MS
   * fires; releasing early (or leaving the button) cancels. A plain click does nothing.
   */
  private holdButton(onFire: () => void): HTMLButtonElement {
    const idle = this.c("theme.ov.hold");
    const label = el("span", { textContent: idle });
    const ring = svg("svg", { viewBox: "0 0 20 20", "aria-hidden": "true" });
    ring.append(svg("circle", { class: "track", cx: "10", cy: "10", r: "8" }), svg("circle", { class: "prog", cx: "10", cy: "10", r: "8" }));
    const b = el("button", { className: "b hold", type: "button" }, ring, label, el("span", { className: "bar" }));
    b.style.setProperty("--hold", `${HOLD_MS}ms`);
    b.title = idle;
    b.setAttribute("aria-label", `${idle} (${(HOLD_MS / 1000).toFixed(1)}s)`);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let fired = false;
    const end = () => {
      this.holding = false;
      if (this.renderPending) {
        this.renderPending = false;
        this.render();
      }
    };
    const start = () => {
      if (fired || timer) return;
      // Freeze the size: a shorter label would reflow the bottom-anchored panel and slide the button out from under the pointer.
      if (!b.style.width) b.style.width = `${b.getBoundingClientRect().width}px`;
      this.holding = true;
      b.classList.add("arming");
      label.textContent = this.c("theme.ov.holding");
      timer = setTimeout(() => {
        timer = null;
        fired = true;
        b.classList.remove("arming");
        b.classList.add("fired");
        label.textContent = this.c("theme.ov.released");
        onFire();
        setTimeout(end, 250);
      }, HOLD_MS);
    };
    const cancel = () => {
      if (fired || !timer) return;
      clearTimeout(timer);
      timer = null;
      b.classList.remove("arming");
      label.textContent = idle;
      end();
    };
    const isFireKey = (e: KeyboardEvent) => e.key === " " || e.key === "Enter";
    b.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); // no text selection / long-press menu while holding
      start();
    });
    b.addEventListener("pointerup", cancel);
    b.addEventListener("pointerleave", cancel);
    b.addEventListener("pointercancel", cancel);
    b.addEventListener("blur", cancel);
    b.addEventListener("keydown", (e) => {
      if (!isFireKey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) start();
    });
    b.addEventListener("keyup", (e) => {
      if (!isFireKey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      cancel();
    });
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    return b;
  }
}
