import { api } from "../shared/api";
import type { ContentContext, OverlayState, SpotReply, ToBackground, ToContent } from "../shared/messages";
import { Autopilot } from "./autopilot";
import { spotJob } from "./detect";
import { Overlay } from "./overlay";

declare global {
  interface Window {
    __aim401kLoaded?: boolean;
  }
}

// Lock-on reticles. Layout-neutral: only outline (never takes space) plus, on
// text boxes, corner brackets painted as background layers over the field's own
// background colour. Selects, checkboxes and custom widgets get the outline only,
// so native arrows / page background images stay intact.
// green = filled from profile/answers · amber dashed = AI-drafted (review) · red pulsing = needs you
const RETICLE = (c: string) => `
  background-image:
    linear-gradient(${c},${c}), linear-gradient(${c},${c}), linear-gradient(${c},${c}), linear-gradient(${c},${c}),
    linear-gradient(${c},${c}), linear-gradient(${c},${c}), linear-gradient(${c},${c}), linear-gradient(${c},${c}) !important;
  background-size: 10px 2px, 2px 8px, 10px 2px, 2px 8px, 10px 2px, 2px 8px, 10px 2px, 2px 8px !important;
  background-position: left top, left top, right top, right top, left bottom, left bottom, right bottom, right bottom !important;
  background-repeat: no-repeat !important;
  background-origin: padding-box !important;`;
const TEXTY = (v: string) =>
  `input[data-aim="${v}"]:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]):not([type=color]), textarea[data-aim="${v}"]`;
const HIGHLIGHT_CSS = `
[data-aim] { transition: outline-color .25s; }
[data-aim="filled"] { outline: 1px solid rgba(22,199,84,.55) !important; outline-offset: 3px !important; }
${TEXTY("filled")} { ${RETICLE("#16c754")} }
[data-aim="ai"] { outline: 1px dashed #f5a000 !important; outline-offset: 3px !important; }
${TEXTY("ai")} { ${RETICLE("#f5a000")} }
[data-aim="need"] { outline: 2px solid rgba(255,59,48,.95) !important; outline-offset: 3px !important; animation: aim401k-lock 1.2s ease-out infinite; }
${TEXTY("need")} { ${RETICLE("#ff3b30")} }
input[type=checkbox][data-aim], input[type=radio][data-aim] { outline-width: 2px !important; }
/* Animated box-shadow beats the page's normal declarations; the !important outline stays put. */
@keyframes aim401k-lock { from { box-shadow: 0 0 0 4px rgba(255,59,48,.5); } to { box-shadow: 0 0 0 12px rgba(255,59,48,0); } }
@media (prefers-reduced-motion: reduce) { [data-aim] { animation: none !important; transition: none !important; } }
`;

const send = (msg: ToBackground): Promise<unknown> => api.runtime.sendMessage(msg);

async function main(): Promise<void> {
  if (window.__aim401kLoaded) return;
  window.__aim401kLoaded = true;
  const top = window === window.top;

  let overlay: Overlay | null = null;
  let pilot: Autopilot | null = null;

  let managed = false;
  const startPilot = async (): Promise<void> => {
    const ctx = (await send({ type: "hello", top, url: location.href })) as ContentContext | undefined;
    if (!ctx?.managed) return;
    managed = true;
    if (overlay?.spotted?.phase === "ready") overlay.setSpot(null);
    if (!pilot) {
      const style = document.createElement("style");
      style.textContent = HIGHLIGHT_CSS;
      (document.head ?? document.documentElement).append(style);
      pilot = new Autopilot(ctx, top);
      const obs = new MutationObserver(() => pilot?.maybeRerun());
      obs.observe(document.documentElement, { childList: true, subtree: true });
      // When the human edits the page themselves, re-check what's still missing.
      document.addEventListener("change", (e) => e.isTrusted && pilot?.schedule(800), true);
    }
    pilot.schedule(top ? 1200 : 1500);
  };

  api.runtime.onMessage.addListener((raw: unknown) => {
    const msg = raw as ToContent;
    switch (msg.type) {
      case "overlay":
        if (top) {
          overlay ??= new Overlay();
          overlay.update(msg.state);
        }
        return undefined;
      case "applyAnswer":
        return pilot ? pilot.applyAnswer(msg.fieldKey, msg.value, msg.kind) : Promise.resolve(false);
      case "submit":
        return pilot ? pilot.submit() : Promise.resolve(false);
      case "run":
        void startPilot();
        return undefined;
    }
    return undefined;
  });

  if (top) {
    const state = (await send({ type: "getOverlayState" })) as OverlayState | undefined;
    if (state) {
      // A broadcast may have created the overlay while we awaited: reuse it (never mount two).
      overlay ??= new Overlay();
      overlay.update(state);
    }
  }
  await startPilot();
  if (top) watchForPostings();

  // Spotter: when this tab shows a job posting, offer it from a corner card. Checked once the
  // page settles and again whenever the URL changes (LinkedIn/Indeed swap postings in place).
  // Postings the user waved off stay off for this page's life.
  function watchForPostings(): void {
    const dismissed = new Set<string>();
    let lastUrl = "";
    let tries = 0;
    const check = async () => {
      if (managed) return;
      const url = location.href;
      if (url !== lastUrl) {
        if (overlay?.spotted && overlay.spotted.url !== url) {
          if (overlay.spotted.phase === "ready") dismissed.add(overlay.spotted.url);
          overlay.setSpot(null);
        }
        lastUrl = url;
        tries = 0;
      }
      if (overlay?.spotted || dismissed.has(url) || tries >= 4) return;
      tries++; // client-rendered boards fill in late: look a few times, then stop
      const meta = spotJob();
      if (!meta) return;
      tries = 4;
      const reply = (await send({ type: "spot", url, meta })) as SpotReply | undefined;
      if (!reply?.show || managed || location.href !== url) return;
      overlay ??= new Overlay();
      overlay.setSpot({ url, meta, reply, phase: "ready" });
    };
    setTimeout(() => void check(), 900);
    setInterval(() => void check(), 1500);
  }
}

void main();
