// Guarded release switch: a flip-up cover over a press-and-hold switch, like a
// master-arm switch. Step 1 lifts the guard (never fires). Step 2 is a deliberate
// press-and-hold on the switch. This is the one dramatic moment in the UI; it is the
// human action before submitting an application.
//
// Style-agnostic: this module builds the DOM and state machine only. It must bundle into
// the content script, so it imports nothing and carries no CSS of its own.
//
//   <span class="guarded" data-state="closed|open|arming|fired" style="--p:0..1">
//     <button class="guard-cover" aria-expanded>guard label</button>
//     <button class="guard-switch" aria-describedby>
//       <svg class="guard-ring"><circle class="track"/><circle class="prog"/></svg>
//       <span class="guard-label"/>
//     </button>
//     <span class="guard-hint" (visually hidden)/>
//   </span>

export const HOLD_MS = 1200;

export interface GuardedOptions {
  labels: { guard: string; hold: string; arming: string; done: string; hint: string };
  /** Called exactly once, when the hold completes. */
  onFire: () => void;
  /** false: no cover, just press-and-hold (for actions that don't submit anything). Default true. */
  guard?: boolean;
  /** Hold duration. Default HOLD_MS. */
  ms?: number;
  /** The cover drops again after this long open without arming. Default 8000. */
  relockMs?: number;
  /** Called when arming begins. */
  onHoldStart?: () => void;
  /** Called when arming ends: immediately on cancel, shortly after the confirmation on fire. */
  onHoldEnd?: () => void;
}

type State = "closed" | "open" | "arming" | "fired";

const RING_C = 50.27; // 2 * PI * r(8)
/** How long the "released" confirmation stays before onHoldEnd (callers may re-render then). */
const CONFIRM_MS = 700;
let uid = 0;

const NS = "http://www.w3.org/2000/svg";
const isFireKey = (e: KeyboardEvent) => e.key === " " || e.key === "Enter" || e.key === "Spacebar";

export function guardedRelease(o: GuardedOptions): HTMLElement {
  const ms = o.ms ?? HOLD_MS;
  const relockMs = o.relockMs ?? 8000;

  const root = document.createElement("span");
  root.className = "guarded";

  const cover = document.createElement("button");
  cover.type = "button";
  cover.className = "guard-cover";
  cover.textContent = o.labels.guard;

  const sw = document.createElement("button");
  sw.type = "button";
  sw.className = "guard-switch";
  sw.style.userSelect = "none";
  sw.style.setProperty("-webkit-user-select", "none");
  sw.style.touchAction = "none";

  const ring = document.createElementNS(NS, "svg");
  ring.setAttribute("class", "guard-ring");
  ring.setAttribute("viewBox", "0 0 20 20");
  ring.setAttribute("aria-hidden", "true");
  for (const cls of ["track", "prog"]) {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("class", cls);
    c.setAttribute("cx", "10");
    c.setAttribute("cy", "10");
    c.setAttribute("r", "8");
    if (cls === "prog") {
      c.setAttribute("stroke-dasharray", String(RING_C));
      c.style.setProperty("stroke-dashoffset", `calc(${RING_C} * (1 - var(--p, 0)))`);
    }
    ring.append(c);
  }
  const label = document.createElement("span");
  label.className = "guard-label";
  sw.append(ring, label);

  const hint = document.createElement("span");
  hint.className = "guard-hint";
  hint.id = `guard-hint-${++uid}`;
  hint.textContent = o.labels.hint;
  Object.assign(hint.style, { position: "absolute", width: "1px", height: "1px", margin: "-1px", padding: "0", overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: "0" });
  sw.setAttribute("aria-describedby", hint.id);
  cover.setAttribute("aria-describedby", hint.id);

  root.append(cover, sw, hint);

  let state: State = "closed";
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let relockTimer: ReturnType<typeof setTimeout> | null = null;
  let frame: { raf: boolean; id: number | ReturnType<typeof setTimeout> } | null = null;
  let startedAt = 0;
  let pointerId: number | null = null;
  let captured = false;
  let keyHold = false;

  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const setP = (p: number) => root.style.setProperty("--p", String(Math.max(0, Math.min(1, p))));

  const stopFrame = () => {
    if (!frame) return;
    if (frame.raf) cancelAnimationFrame(frame.id as number);
    else clearTimeout(frame.id as ReturnType<typeof setTimeout>);
    frame = null;
  };
  const tick = () => {
    frame = null;
    if (state !== "arming") return;
    setP((now() - startedAt) / ms);
    schedule();
  };
  const schedule = () => {
    if (typeof requestAnimationFrame === "function") frame = { raf: true, id: requestAnimationFrame(tick) };
    else frame = { raf: false, id: setTimeout(tick, 16) };
  };

  const clearRelock = () => {
    if (relockTimer) clearTimeout(relockTimer);
    relockTimer = null;
  };
  const armRelock = () => {
    clearRelock();
    if (o.guard === false) return;
    relockTimer = setTimeout(() => {
      relockTimer = null;
      if (state !== "open") return;
      const focused = (root.getRootNode() as Document | ShadowRoot).activeElement === sw;
      set("closed");
      if (focused) cover.focus();
    }, relockMs);
  };

  const set = (s: State) => {
    state = s;
    root.dataset.state = s;
    const closed = s === "closed";
    const fired = s === "fired";
    cover.setAttribute("aria-expanded", String(!closed));
    cover.disabled = fired;
    cover.tabIndex = closed ? 0 : -1;
    if (closed) cover.removeAttribute("aria-hidden");
    else cover.setAttribute("aria-hidden", "true");
    sw.disabled = fired;
    sw.tabIndex = s === "open" || s === "arming" ? 0 : -1;
    if (closed || fired) sw.setAttribute("aria-disabled", "true");
    else sw.removeAttribute("aria-disabled");
    label.textContent = s === "arming" ? o.labels.arming : fired ? o.labels.done : o.labels.hold;
  };

  const lift = () => {
    if (state !== "closed") return;
    set("open");
    armRelock();
    sw.focus();
  };

  const start = () => {
    if (state !== "open") return;
    clearRelock();
    set("arming");
    startedAt = now();
    setP(0);
    stopFrame();
    schedule();
    holdTimer = setTimeout(complete, ms);
    o.onHoldStart?.();
  };

  const releaseCapture = () => {
    if (pointerId !== null && captured) {
      try {
        sw.releasePointerCapture?.(pointerId);
      } catch {
        /* already released */
      }
    }
    pointerId = null;
    captured = false;
    keyHold = false;
  };

  const cancel = () => {
    if (state !== "arming") return;
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
    stopFrame();
    releaseCapture();
    setP(0);
    set("open");
    armRelock();
    o.onHoldEnd?.();
  };

  function complete() {
    holdTimer = null;
    if (state !== "arming") return;
    stopFrame();
    releaseCapture();
    setP(1);
    set("fired");
    o.onFire();
    setTimeout(() => o.onHoldEnd?.(), CONFIRM_MS);
  }

  // Lift: a click (pointer, or assistive tech) or a fresh Space/Enter press. Never fires.
  cover.addEventListener("click", (e) => {
    e.stopPropagation();
    lift();
  });
  cover.addEventListener("keydown", (e) => {
    if (!isFireKey(e)) return;
    e.preventDefault(); // we lift ourselves; no synthetic click on top
    e.stopPropagation();
    if (!e.repeat) lift();
  });
  cover.addEventListener("keyup", (e) => {
    if (!isFireKey(e)) return;
    e.preventDefault();
    e.stopPropagation();
  });

  // Hold: primary pointer (captured) or a fresh Space/Enter keydown.
  sw.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection / long-press menu while holding
    if (state !== "open") return;
    pointerId = e.pointerId;
    try {
      captured = typeof sw.setPointerCapture === "function";
      sw.setPointerCapture?.(e.pointerId);
    } catch {
      captured = false;
    }
    start();
  });
  const onPointerEnd = (e: Event) => {
    const id = (e as PointerEvent).pointerId;
    if (pointerId !== null && id !== undefined && id !== pointerId) return;
    if (keyHold) return; // a key hold isn't ended by stray pointer events
    cancel();
  };
  sw.addEventListener("pointerup", onPointerEnd);
  sw.addEventListener("pointercancel", onPointerEnd);
  sw.addEventListener("lostpointercapture", onPointerEnd);
  sw.addEventListener("pointerleave", (e) => {
    if (!captured) onPointerEnd(e); // with capture, leaving the box must not cancel
  });
  sw.addEventListener("blur", cancel);

  sw.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state === "open" && o.guard !== false) {
      e.stopPropagation();
      clearRelock();
      set("closed");
      cover.focus();
      return;
    }
    if (!isFireKey(e)) return;
    e.preventDefault();
    e.stopPropagation();
    // Repeats (including ones carried over from the lift keypress) never arm.
    if (e.repeat || state !== "open") return;
    keyHold = true;
    start();
  });
  sw.addEventListener("keyup", (e) => {
    if (!isFireKey(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (keyHold) cancel();
  });
  sw.addEventListener("click", (e) => {
    e.preventDefault(); // a plain click is never enough
    e.stopPropagation();
  });
  sw.addEventListener("contextmenu", (e) => e.preventDefault());
  sw.addEventListener("selectstart", (e) => e.preventDefault());
  sw.addEventListener("dragstart", (e) => e.preventDefault());

  setP(0);
  if (o.guard === false) {
    cover.remove();
    root.classList.add("unguarded");
    set("open");
  } else set("closed");
  return root;
}
