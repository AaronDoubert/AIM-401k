// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OverlayState } from "../src/shared/messages";

// The overlay talks to the background through browser.runtime; stub it before import.
const sendMessage = vi.fn((_msg: unknown) => Promise.resolve(undefined));
(globalThis as unknown as { browser: unknown }).browser = {
  runtime: { sendMessage },
  storage: { onChanged: { addListener: () => undefined } },
};
// The real overlay uses a closed shadow root; open it so the test can look inside.
const attach = HTMLElement.prototype.attachShadow;
HTMLElement.prototype.attachShadow = function (init: ShadowRootInit) {
  return attach.call(this, { ...init, mode: "open" });
};

let Overlay: typeof import("../src/content/overlay").Overlay;
let HOLD_MS: number;
beforeAll(async () => {
  ({ Overlay, HOLD_MS } = await import("../src/content/overlay"));
});

const state = (chud: boolean): OverlayState => ({
  needs: [{ id: "n1", jobId: "j1", kind: "review_submit", prompt: "All fields filled. Review and submit.", frameId: -1, createdAt: 0 }],
  jobs: { j1: { id: "j1", company: "Acme Robotics", title: "Platform Eng", status: "ready_to_submit", tabId: 1 } },
  paused: false,
  running: 0,
  queued: 0,
  chud,
});

const root = () => document.getElementById("aim401k-root")!.shadowRoot!;
const hold = () => root().querySelector<HTMLButtonElement>("button.hold")!;
const key = (type: "keydown" | "keyup", k = " ") => hold().dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true }));
const submits = () => sendMessage.mock.calls.filter(([m]) => (m as { type: string }).type === "submitJob");

beforeEach(() => {
  document.body.replaceChildren();
  sendMessage.mockClear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("overlay hold-to-release", () => {
  it("renders the HUD in CHUD mode and plain mode", () => {
    const o = new Overlay();
    o.update(state(true));
    expect(root().textContent).toContain("AIM-401k // OPERATOR INPUT REQUIRED");
    expect(root().textContent).toContain("TGT · Acme Robotics · Platform Eng");
    expect(hold().textContent).toContain("HOLD TO RELEASE");
    o.update(state(false));
    expect(root().textContent).toContain("AIM-401k needs you");
    expect(hold().textContent).toContain("Hold to submit");
  });

  it("fires only after the full hold", () => {
    new Overlay().update(state(true));
    key("keydown");
    vi.advanceTimersByTime(HOLD_MS - 100);
    expect(submits()).toHaveLength(0);
    vi.advanceTimersByTime(150);
    expect(submits()).toEqual([[{ type: "submitJob", jobId: "j1" }]]);
    key("keyup");
    expect(submits()).toHaveLength(1);
  });

  it("works with a pointer too", () => {
    new Overlay().update(state(true));
    hold().dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true, cancelable: true }));
    expect(hold().classList.contains("arming")).toBe(true);
    expect(hold().textContent).toContain("RELEASING");
    vi.advanceTimersByTime(HOLD_MS + 10);
    expect(submits()).toHaveLength(1);
  });

  it("early release cancels; a plain click does nothing", () => {
    new Overlay().update(state(true));
    key("keydown", "Enter");
    vi.advanceTimersByTime(HOLD_MS / 2);
    key("keyup", "Enter");
    vi.advanceTimersByTime(HOLD_MS * 2);
    hold().click();
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(submits()).toHaveLength(0);
    expect(hold().classList.contains("arming")).toBe(false);
  });

  it("does not re-render under the user's finger", () => {
    const o = new Overlay();
    o.update(state(true));
    const btn = hold();
    key("keydown");
    o.update({ ...state(true), running: 1 });
    expect(btn.isConnected).toBe(true);
    key("keyup");
    expect(btn.isConnected).toBe(false); // the deferred render ran on release
  });
});
