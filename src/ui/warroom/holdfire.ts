// Hold-to-fire RELEASE control: press and hold (pointer, or Space/Enter) for
// HOLD_MS; a ring fills while held. Letting go early cancels.
import { h } from "../common";

const HOLD_MS = 1200;
const SVG = "http://www.w3.org/2000/svg";
const CIRC = 2 * Math.PI * 15;

export interface HoldFireOptions {
  label: string;
  arming: string;
  done: string;
  hint: string;
  onFire: () => void;
  ms?: number;
}

let seq = 0;

export function holdToFire(o: HoldFireOptions): HTMLElement {
  const ms = o.ms ?? HOLD_MS;
  const hintId = `wr-fire-hint-${++seq}`;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 36 36");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("fire-ring");
  const track = document.createElementNS(SVG, "circle");
  const prog = document.createElementNS(SVG, "circle");
  for (const c of [track, prog]) {
    c.setAttribute("cx", "18");
    c.setAttribute("cy", "18");
    c.setAttribute("r", "15");
  }
  track.classList.add("track");
  prog.classList.add("prog");
  prog.setAttribute("stroke-dasharray", String(CIRC));
  prog.setAttribute("stroke-dashoffset", String(CIRC));
  svg.append(track, prog);

  const label = h("span", { className: "fire-label", textContent: o.label });
  const btn = h("button", { type: "button", className: "fire-btn" }, svg, label);
  btn.setAttribute("aria-describedby", hintId);
  btn.dataset.state = "idle";
  const hint = h("span", { id: hintId, className: "sr-only", textContent: o.hint });

  let t0 = 0;
  let raf = 0;
  let fired = false;

  const paint = (p: number) => {
    prog.setAttribute("stroke-dashoffset", String(CIRC * (1 - p)));
    btn.style.setProperty("--p", p.toFixed(3));
  };
  const reset = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    if (fired) return;
    btn.dataset.state = "idle";
    label.textContent = o.label;
    paint(0);
  };
  const fire = () => {
    fired = true;
    raf = 0;
    paint(1);
    btn.dataset.state = "fired";
    label.textContent = o.done;
    btn.disabled = true;
    o.onFire();
  };
  const tick = (t: number) => {
    const p = Math.min(1, (t - t0) / ms);
    paint(p);
    if (p >= 1) fire();
    else raf = requestAnimationFrame(tick);
  };
  const begin = () => {
    if (fired || raf) return;
    t0 = performance.now();
    btn.dataset.state = "arming";
    label.textContent = o.arming;
    raf = requestAnimationFrame(tick);
  };

  btn.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    btn.focus();
    try {
      btn.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer */
    }
    begin();
  });
  for (const ev of ["pointerup", "pointercancel", "lostpointercapture"] as const) btn.addEventListener(ev, reset);
  btn.addEventListener("keydown", (e) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) begin();
  });
  btn.addEventListener("keyup", (e) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    reset();
  });
  btn.addEventListener("blur", reset);
  // A plain click never fires: it must be held.
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  return h("span", { className: "fire-wrap" }, btn, hint);
}
