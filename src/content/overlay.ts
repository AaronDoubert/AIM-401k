import { api } from "../shared/api";
import { MARK_OFFWHITE_SVG } from "../shared/brand";
import { copy, type CopyKey } from "../shared/copy";
import type { OverlayState, SpotReply, ToBackground } from "../shared/messages";
import type { Need, PageMeta } from "../shared/types";
import { guardedRelease, HOLD_MS } from "../ui/guarded";

// The floating "AIM-401k needs you" box shown on every tab. Lives in a closed
// shadow root so page CSS can't break it and page scripts can't read it.
// All page-derived text is set via textContent (never innerHTML).
// Fonts: Geist / Geist Mono when installed, else system stacks (no web-accessible font
// files, so pages can't probe for the extension). The mark is inlined for the same reason.

const send = (msg: ToBackground): Promise<unknown> => api.runtime.sendMessage(msg);

/** What the Spotter found on this page, and where the card is in its short life. */
export interface Spot {
  url: string;
  meta: PageMeta;
  reply: SpotReply;
  phase: "ready" | "engaged" | "saved";
}

/** Press-and-hold time for "submit for me". */
export { HOLD_MS };

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.wrap {
  --bg: #0c0c0b; --panel: #131311; --well: #090908; --line: #262522; --line-2: #353330;
  --fg: #f1ede4; --fg-2: #cdc9c0; --muted: #a19d94;
  --ok: #86c095; --warn: #dcae5e; --danger: #ec5f48; --info: #6fb3c4;
  --sans: "Geist", "Geist Variable", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: "Geist Mono", "Geist Mono Variable", ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, "Liberation Mono", monospace;
  --cond: "Barlow Condensed", "DIN Condensed", "DIN Alternate", Bahnschrift, "Arial Narrow", sans-serif-condensed, sans-serif;
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
  display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
  font: 13px/1.4 var(--sans); color: var(--fg); text-align: left; font-variant-numeric: tabular-nums;
}
.wrap * { font-family: inherit; }
/* Three voices: mono = machine data only; condensed = headers and buttons; sans = human content. */
.kind, .count { font-family: var(--mono); text-transform: uppercase; }
.pill, .head b, .head small, button.b, label.rem, .guard-cover, .guard-label { font-family: var(--cond); }
.chud .pill, .chud .head b, .chud .head small, .chud button.b, .chud label.rem, .chud .guard-cover, .chud .guard-label { text-transform: uppercase; }

.mark { width: 18px; height: 18px; flex: none; display: block; }
.head .mark { width: 16px; height: 16px; }
/* status lamp: steady, round */
.lamp { width: 8px; height: 8px; flex: none; display: inline-block; border-radius: 50%; background: var(--ok); }
.lamp.waiting { background: var(--warn); }
.lamp.paused { background: var(--muted); }

.pill { display: flex; align-items: center; gap: 9px; padding: 8px 13px; border: 1px solid var(--line-2); border-radius: 0;
  cursor: pointer; background: var(--bg); color: var(--fg); font-size: 14px; font-weight: 500; letter-spacing: .06em; line-height: 1.2;
  box-shadow: 0 8px 24px rgba(0,0,0,.45); }
.pill:hover { border-color: #55524c; }
.pill.alert { border-color: var(--warn); background: #181408; }
.pill.arrive { animation: arrive .5s ease-out 2; }
@keyframes arrive { 50% { box-shadow: 0 0 0 4px rgba(220,174,94,.35), 0 8px 24px rgba(0,0,0,.45); } }

.panel { width: 384px; max-width: calc(100vw - 32px); max-height: min(72vh, 580px); display: flex; flex-direction: column;
  background: var(--bg); border: 1px solid var(--line-2); box-shadow: 0 16px 44px rgba(0,0,0,.55); animation: open .16s ease-out; }
@keyframes open { from { opacity: 0; transform: translateY(6px); } }
.head { display: flex; flex-direction: column; gap: 6px; padding: 9px 10px 9px 12px; border-bottom: 1px solid var(--line); background: var(--panel); flex: none; }
.head > div { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; }
.head b { display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 600; letter-spacing: .06em; color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.head small { display: block; color: var(--muted); font-size: 13px; letter-spacing: .04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.head button.b { flex: none; }
.list { overflow: auto; overscroll-behavior: contain; }
.empty { padding: 16px 14px; color: var(--muted); font-size: 13px; }

.card { position: relative; padding: 11px 14px 12px 16px; border-bottom: 1px solid var(--line); }
.card:last-child { border-bottom: 0; }
.card::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background: var(--k, var(--warn)); }
.job { font-size: 12px; color: var(--muted); margin-bottom: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kind { display: inline-block; font-size: 10px; font-weight: 500; letter-spacing: .1em; padding: 1px 5px; margin-right: 8px;
  border: 1px solid currentColor; color: var(--k, var(--warn)); vertical-align: 1px; }
/* red = true failures only; amber = an operator is needed */
.k-question, .k-consent, .k-signature, .k-login, .k-captcha, .k-review_submit { --k: var(--warn); }
.k-stalled, .k-error { --k: var(--danger); }
/* Spotter card: advisory (cyan). It's an offer, not a demand. */
.spot .card { --k: var(--info); border-bottom: 0; }
.spot .head { flex-direction: row; align-items: center; justify-content: space-between; }
.spot .role { font-size: 15px; font-weight: 600; line-height: 1.3; color: var(--fg); margin: 0 0 3px; word-break: break-word; }
.spot .where { font-size: 12px; color: var(--muted); margin-bottom: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.spot .note { font-size: 12px; color: var(--info); margin: -4px 0 9px; }
.spot .after { font-size: 13px; color: var(--fg-2); }
.guarded.unguarded .guard-switch { border-color: var(--fg); color: var(--fg); cursor: pointer; }
.prompt { font-size: 14px; line-height: 1.4; margin: 2px 0 9px; white-space: pre-wrap; word-break: break-word; color: var(--fg); }
.detail { font-size: 12px; color: var(--warn); margin: -4px 0 9px; }
input[type=text], input[type=date], textarea, select { display: block; width: 100%; margin: 0; font: 13px/1.4 var(--sans); padding: 7px 9px; border: 1px solid var(--line-2); border-radius: 0;
  color: var(--fg); background: var(--well); color-scheme: dark; }
input::placeholder, textarea::placeholder { color: #79766f; opacity: 1; }
input:focus, textarea:focus, select:focus { outline: none; border-color: var(--fg); box-shadow: 0 0 0 1px var(--fg); }
textarea { min-height: 72px; resize: vertical; }
input[type=checkbox] { appearance: none; -webkit-appearance: none; width: 13px; height: 13px; margin: 0; border: 1px solid #55524c; background: var(--well) no-repeat center / 9px 7px; cursor: pointer; flex: none; }
input[type=checkbox]:checked { background-color: var(--fg); border-color: var(--fg);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='8' viewBox='0 0 10 8'%3E%3Cpath d='M1 4l3 3 5-6' fill='none' stroke='%230c0c0b' stroke-width='2'/%3E%3C/svg%3E"); }
.opts { display: flex; flex-direction: column; gap: 4px; margin-bottom: 4px; }
.row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; align-items: center; }
button.b { display: inline-flex; align-items: center; gap: 7px; font-size: 14px; font-weight: 600; letter-spacing: .05em; line-height: 1.2;
  padding: 6px 11px; min-height: 30px; border-radius: 0; border: 1px solid var(--line-2); background: var(--panel); color: var(--fg); cursor: pointer; }
button.b:hover { border-color: #55524c; background: #1b1a18; }
button.b.primary { background: var(--fg); border-color: var(--fg); color: var(--bg); }
button.b.primary:hover { background: #fff; border-color: #fff; }
button.b.link { border-color: transparent; background: none; color: var(--muted); padding: 6px 5px; font-weight: 500; }
button.b.link:hover { color: var(--fg); background: none; border-color: transparent; text-decoration: underline; text-underline-offset: 3px; }
button.b.icon { padding: 4px 9px; min-height: 26px; font-size: 15px; }
button.b:focus-visible, .pill:focus-visible, input[type=checkbox]:focus-visible, .guard-cover:focus-visible, .guard-switch:focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }
label.rem { font-size: 13px; letter-spacing: .03em; color: var(--muted); display: inline-flex; gap: 5px; align-items: center; cursor: pointer; }
.opts label.rem { font: 13px/1.35 var(--sans); text-transform: none; letter-spacing: 0; color: var(--fg); gap: 8px; }

/* Guarded release: a cover that flips up over a hold switch. The one animated element. */
.guarded { position: relative; display: inline-block; perspective: 360px; vertical-align: middle; }
.guard-switch { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 30px; padding: 6px 12px;
  border: 1px solid var(--line-2); border-radius: 0; background: var(--panel); color: var(--muted); cursor: default;
  font-size: 14px; font-weight: 600; letter-spacing: .05em; line-height: 1.2; user-select: none; -webkit-user-select: none; touch-action: none; }
.guard-ring { width: 15px; height: 15px; flex: none; transform: rotate(-90deg); }
.guard-ring circle { fill: none; stroke-width: 2.5; }
.guard-ring .track { stroke: rgba(241,237,228,.22); }
.guard-ring .prog { stroke: var(--fg); }
.guarded[data-state="open"] .guard-switch { border-color: var(--fg); color: var(--fg); cursor: pointer; }
.guarded[data-state="open"] .guard-switch:hover { background: rgba(241,237,228,.07); }
.guarded[data-state="arming"] .guard-switch { border-color: var(--fg); color: var(--fg); background: rgba(241,237,228,.1); cursor: pointer;
  background-image: linear-gradient(var(--fg), var(--fg)); background-repeat: no-repeat; background-size: calc(var(--p, 0) * 100%) 2px; background-position: left bottom; }
.guarded[data-state="fired"] .guard-switch { background: var(--ok); border-color: var(--ok); color: var(--bg); animation: fired .35s ease-out; }
.guarded[data-state="fired"] .guard-ring .track { stroke: rgba(12,12,11,.3); }
.guarded[data-state="fired"] .guard-ring .prog { stroke: var(--bg); }
@keyframes fired { from { box-shadow: 0 0 0 5px rgba(134,192,149,.45); } }
.guard-cover { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; margin: 0; padding: 0 12px;
  border: 1px solid #000; border-radius: 0; cursor: pointer; font-size: 14px; font-weight: 700; letter-spacing: .08em; color: var(--warn);
  background: linear-gradient(#14120d, #14120d) center / calc(100% - 20px) calc(100% - 8px) no-repeat, repeating-linear-gradient(-45deg, var(--warn) 0 7px, #14120d 7px 14px);
  z-index: 1; transform-origin: 50% 0; transform: rotateX(0deg); transition: transform 180ms ease-out, opacity 180ms ease-out; }
.guard-cover:hover { filter: brightness(1.1); }
.guarded:not([data-state="closed"]) .guard-cover { transform: rotateX(-180deg); opacity: 0; pointer-events: none; }

@media (prefers-reduced-motion: reduce) {
  .pill.arrive, .panel, .guarded[data-state="fired"] .guard-switch { animation: none; }
  .guard-cover { transition: none; }
}
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const k of kids) e.append(k);
  return e;
}

/** The brand mark, parsed from the supplied artwork (never redrawn). */
function mark(): Element {
  const doc = new DOMParser().parseFromString(MARK_OFFWHITE_SVG.replaceAll("mmo", "aim401k-mark-mask"), "image/svg+xml");
  const m = document.importNode(doc.documentElement, true);
  m.setAttribute("class", "mark");
  m.setAttribute("aria-hidden", "true");
  return m;
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
  private spot: Spot | null = null;

  constructor() {
    this.host = document.createElement("div");
    this.host.id = "aim401k-root";
    this.root = this.host.attachShadow({ mode: "closed" });
    this.root.append(el("style", { textContent: CSS }));
    this.wrap = el("div", { className: "wrap" });
    this.root.append(this.wrap);
    (document.body ?? document.documentElement).append(this.host);
    // No storage.onChanged here: in a content script that would copy every storage write
    // (profile, resume, keys, email intel) into every tab. The background re-broadcasts the
    // overlay state (incl. plain mode) whenever settings change.
  }

  private c(key: CopyKey, vars?: Record<string, string | number>): string {
    return copy(this.state?.chud ?? this.spot?.reply.chud ?? true, key, vars);
  }

  /** Show, update or (null) remove the Spotter card. */
  setSpot(spot: Spot | null): void {
    // One panel at a time: a fresh find folds the waiting list back into its pill.
    if (spot && spot !== this.spot && spot.phase === "ready") this.open = false;
    this.spot = spot;
    this.render();
  }

  get spotted(): Spot | null {
    return this.spot;
  }

  update(state: OverlayState): void {
    this.state = state;
    const n = state.needs.length;
    if (n > this.lastNeedCount) {
      this.open = !this.spot; // new need: pop open (unless the Spotter card is up)
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
    this.wrap.classList.toggle("chud", (s?.chud ?? this.spot?.reply.chud) !== false);
    if (this.spot) this.wrap.append(this.spotCard(this.spot));
    if (!s) return;
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
      { className: `pill ${n ? "alert" : ""} ${s.paused ? "paused" : ""} ${this.arrived && !this.open ? "arrive" : ""}`, type: "button" },
      mark(),
      el("span", { className: `lamp ${n ? "waiting" : s.paused ? "paused" : ""}` }),
      text,
    );
    this.arrived = false;
    pill.setAttribute("aria-expanded", String(this.open));
    pill.setAttribute("aria-label", `AIM-401k: ${text}`);
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
      el("div", {}, el("b", {}, mark(), el("span", { className: `lamp ${s.needs.length ? "waiting" : s.paused ? "paused" : ""}` }), s.needs.length ? this.c("theme.ov.head.needs") : this.c("theme.ov.head.idle")), min),
      el("div", {}, el("small", { textContent: sub }), button(s.paused ? this.c("theme.resume") : this.c("theme.pause"), () => void send({ type: "setPaused", paused: !s.paused }))),
    );
    const list = el("div", { className: "list" });
    const panel = el("div", { className: `panel` }, head, list);
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
      actions.append(this.release(() => void send({ type: "submitJob", jobId: need.jobId })));
    } else {
      actions.append(button(this.c("theme.ov.openTab"), go, "primary"));
      if (need.kind === "stalled" || need.kind === "error") actions.append(button(this.c("theme.ov.retry"), () => void send({ type: "retryJob", jobId: need.jobId })));
      if (need.kind === "login" || need.kind === "captcha") actions.append(button(this.c("theme.ov.done"), () => void send({ type: "dismissNeed", needId: need.id })));
    }
    actions.append(button(this.c("theme.ov.skip"), () => void send({ type: "skipJob", jobId: need.jobId }), "link"));
    card.append(actions);
    return card;
  }

  /** "Target acquired": the posting's role and company, hold to engage, or track it for later. */
  private spotCard(sp: Spot): HTMLElement {
    const { meta, reply } = sp;
    const close = button("×", () => this.setSpot(null), "icon link");
    close.setAttribute("aria-label", this.c("theme.spot.dismiss"));
    close.title = this.c("theme.spot.dismiss");
    const head = el("div", { className: "head" }, el("b", {}, mark(), this.c("theme.spot.head")), close);
    const card = el(
      "div",
      { className: "card" },
      el("div", { className: "role", textContent: meta.title || this.c("theme.spot.untitled") }),
      el("div", { className: "where", textContent: [meta.company, meta.location].filter(Boolean).join(" · ") }),
    );
    const known = reply.known;
    const applied = known && ["submitted", "interviewing", "offer", "rejected"].includes(known.status);
    if (sp.phase === "engaged") card.append(el("div", { className: "after", textContent: this.c("theme.spot.next") }));
    else if (sp.phase === "saved") card.append(el("div", { className: "after", textContent: this.c("theme.spot.saved") }));
    else if (applied) {
      const date = known.appliedAt ? new Date(known.appliedAt).toLocaleDateString([], { day: "numeric", month: "short" }) : "";
      card.append(el("div", { className: "note", textContent: this.c("theme.spot.applied", { date }).replace(/\s+\./, ".") }));
      card.append(el("div", { className: "row" }, button(this.c("theme.spot.dismiss"), () => this.setSpot(null), "link")));
    } else {
      if (known?.elsewhere) card.append(el("div", { className: "note", textContent: this.c("theme.spot.active") }));
      const hold = guardedRelease({
        guard: false,
        labels: { guard: "", hold: this.c("theme.spot.hold"), arming: this.c("theme.spot.holding"), done: this.c("theme.spot.done"), hint: this.c("theme.spot.hint") },
        onFire: () => {
          void send({ type: "engageHere", url: sp.url, meta });
          if (this.spot === sp) sp.phase = "engaged";
          // The tab's own overlay takes over; the confirmation lingers briefly, then goes.
          setTimeout(() => this.spot === sp && this.setSpot(null), 4000);
        },
        onHoldStart: () => {
          this.holding = true;
        },
        onHoldEnd: () => {
          this.holding = false;
          this.render();
        },
      });
      const row = el("div", { className: "row" }, hold);
      if (!known) {
        row.append(
          button(this.c("theme.spot.save"), () => {
            void send({ type: "saveSpotted", url: sp.url, meta });
            sp.phase = "saved";
            this.render();
            setTimeout(() => this.spot === sp && this.setSpot(null), 2500);
          }, "link"),
        );
      }
      card.append(row);
    }
    const panel = el("div", { className: "panel spot" }, head, card);
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", this.c("theme.spot.head"));
    return panel;
  }

  /** Text for a copy key; falls back if the key is missing from the copy tables. */
  private t(key: string, fallback: string): string {
    const v = this.c(key as CopyKey);
    return v === key ? fallback : v;
  }

  /** "Submit for me": lift the guard, then press and hold. A plain click does nothing. */
  private release(onFire: () => void): HTMLElement {
    const chud = this.state?.chud !== false;
    const g = guardedRelease({
      labels: {
        guard: this.t("theme.ov.guard", chud ? "LIFT GUARD" : "Unlock submit"),
        hold: this.c("theme.ov.hold"),
        arming: this.c("theme.ov.holding"),
        done: this.c("theme.ov.released"),
        hint: this.t("theme.ov.guard.hint", "Lift the guard, then press and hold to release (submit) this application"),
      },
      onFire,
      onHoldStart: () => {
        // Freeze the size: a shorter label would reflow the bottom-anchored panel and slide the switch out from under the pointer.
        const sw = g.querySelector<HTMLElement>(".guard-switch");
        if (sw && !sw.style.minWidth) sw.style.minWidth = `${sw.getBoundingClientRect().width}px`;
        this.holding = true;
      },
      onHoldEnd: () => {
        this.holding = false;
        if (this.renderPending) {
          this.renderPending = false;
          this.render();
        }
      },
    });
    return g;
  }
}
