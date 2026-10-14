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
const hold = () => root().querySelector<HTMLButtonElement>("button.guard-switch")!;
const cover = () => root().querySelector<HTMLButtonElement>("button.guard-cover")!;
const lift = () => cover().click();
const gstate = () => root().querySelector(".guarded")!.getAttribute("data-state");
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
    expect(root().textContent).toContain("WAITING ON YOU");
    expect(root().querySelectorAll("svg.mark").length).toBeGreaterThan(0); // the supplied mark, not a typed logo
    expect(root().textContent).toContain("Acme Robotics — Platform Eng");
    expect(cover().textContent).toContain("LIFT GUARD");
    expect(hold().textContent).toContain("HOLD TO RELEASE");
    expect(root().querySelector(".brk")).toBeNull();
    o.update(state(false));
    expect(root().textContent).toContain("Needs your input");
    expect(cover().textContent).toContain("Unlock submit");
    expect(hold().textContent).toContain("Hold to submit");
  });

  it("fires only after lift then the full hold (chud)", () => {
    new Overlay().update(state(true));
    key("keydown"); // still guarded: ignored
    vi.advanceTimersByTime(HOLD_MS + 10);
    expect(submits()).toHaveLength(0);
    lift();
    key("keydown");
    vi.advanceTimersByTime(HOLD_MS - 100);
    expect(submits()).toHaveLength(0);
    vi.advanceTimersByTime(150);
    expect(submits()).toEqual([[{ type: "submitJob", jobId: "j1" }]]);
    key("keyup");
    expect(submits()).toHaveLength(1);
  });

  it("lift then hold in plain mode", () => {
    new Overlay().update(state(false));
    lift();
    key("keydown");
    vi.advanceTimersByTime(HOLD_MS + 10);
    expect(submits()).toHaveLength(1);
  });

  it("works with a pointer too", () => {
    new Overlay().update(state(true));
    lift();
    hold().dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true, cancelable: true }));
    expect(gstate()).toBe("arming");
    expect(hold().textContent).toContain("RELEASING");
    vi.advanceTimersByTime(HOLD_MS + 10);
    expect(submits()).toHaveLength(1);
  });

  it("early release cancels; a plain click does nothing", () => {
    new Overlay().update(state(true));
    lift();
    key("keydown", "Enter");
    vi.advanceTimersByTime(HOLD_MS / 2);
    key("keyup", "Enter");
    vi.advanceTimersByTime(HOLD_MS * 2);
    hold().click();
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(submits()).toHaveLength(0);
    expect(gstate()).toBe("open");
  });

  it("does not re-render under the user's finger", () => {
    const o = new Overlay();
    o.update(state(true));
    lift();
    const btn = hold();
    key("keydown");
    o.update({ ...state(true), running: 1 });
    expect(btn.isConnected).toBe(true);
    key("keyup");
    expect(btn.isConnected).toBe(false); // the deferred render ran on release
  });
});

describe("overlay question suggestions", () => {
  const question = (): OverlayState => ({
    ...state(true),
    needs: [
      {
        id: "q1",
        jobId: "j1",
        kind: "question",
        prompt: "Please list your previous employer",
        frameId: 0,
        fieldKey: "k1",
        inputType: "text",
        createdAt: 0,
        suggestions: [
          { value: "Babbage & Co", why: "Past employer · From your work history" },
          { value: "Analytical Engines", why: "Your answer to \"Most recent employer\"" },
        ],
        family: { id: "employer_n", label: "Past employer", slots: { ordinal: 1 }, sure: true },
      },
    ],
  });

  it("pre-fills the best suggestion, says why, and offers the rest as chips", () => {
    new Overlay().update(question());
    const input = root().querySelector<HTMLInputElement>(".card input[type=text]")!;
    expect(input.value).toBe("Babbage & Co");
    expect(root().querySelector(".sugg .why")!.textContent).toBe("Past employer · From your work history");
    expect(root().textContent).toContain("remember as Past employer");
    const chips = [...root().querySelectorAll<HTMLButtonElement>("button.chip")];
    expect(chips.map((c) => c.textContent)).toEqual(["Babbage & Co", "Analytical Engines"]);
    chips[1]!.click();
    expect(input.value).toBe("Analytical Engines");
    expect(root().querySelector(".sugg .why")!.textContent).toContain("Most recent employer");
  });

  it("pre-selects a suggested option", () => {
    const s = question();
    s.needs[0] = {
      ...s.needs[0]!,
      inputType: "choice",
      options: ["Yes", "No"],
      suggestions: [{ value: "No", why: "You prefer remote work" }],
      family: { id: "onsite_days", label: "In-office days", slots: { days: 4 }, sure: false },
    };
    new Overlay().update(s);
    // A guessed family isn't promised: the answer is only filed under it if the suggestion is taken.
    expect(root().textContent).not.toContain("remember as");
    expect(root().querySelector<HTMLSelectElement>(".card select")!.value).toBe("No");
    expect(root().querySelectorAll("button.chip").length).toBe(0);
  });
});
