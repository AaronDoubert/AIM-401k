import { api } from "../shared/api";
import type { ContentContext, OverlayState, ToBackground, ToContent } from "../shared/messages";
import { Autopilot } from "./autopilot";
import { Overlay } from "./overlay";

declare global {
  interface Window {
    __jobpilotLoaded?: boolean;
  }
}

const HIGHLIGHT_CSS = `
[data-jobpilot="filled"] { outline: 2px solid rgba(34,197,94,.55) !important; outline-offset: 1px; }
[data-jobpilot="ai"] { outline: 2px solid rgba(245,158,11,.9) !important; outline-offset: 1px; }
[data-jobpilot="need"] { outline: 2px solid rgba(220,38,38,.9) !important; outline-offset: 1px; }
`;

const send = (msg: ToBackground): Promise<unknown> => api.runtime.sendMessage(msg);

async function main(): Promise<void> {
  if (window.__jobpilotLoaded) return;
  window.__jobpilotLoaded = true;
  const top = window === window.top;

  let overlay: Overlay | null = null;
  let pilot: Autopilot | null = null;

  const startPilot = async (): Promise<void> => {
    const ctx = (await send({ type: "hello", top, url: location.href })) as ContentContext | undefined;
    if (!ctx?.managed) return;
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
      overlay = new Overlay();
      overlay.update(state);
    }
  }
  await startPilot();
}

void main();
