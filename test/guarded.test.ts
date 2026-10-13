// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardedRelease, HOLD_MS, type GuardedOptions } from "../src/ui/guarded";

const labels = { guard: "Lift", hold: "Hold", arming: "Arming", done: "Done", hint: "Lift, then hold" };

function make(extra: Partial<GuardedOptions> = {}) {
  const onFire = vi.fn();
  const onHoldStart = vi.fn();
  const onHoldEnd = vi.fn();
  const root = guardedRelease({ labels, onFire, onHoldStart, onHoldEnd, ...extra });
  document.body.append(root);
  const cover = root.querySelector<HTMLButtonElement>(".guard-cover")!;
  const sw = root.querySelector<HTMLButtonElement>(".guard-switch")!;
  const key = (el: HTMLElement, type: "keydown" | "keyup", k = " ", repeat = false) =>
    el.dispatchEvent(new KeyboardEvent(type, { key: k, repeat, bubbles: true, cancelable: true }));
  const down = () => sw.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 1, isPrimary: true, bubbles: true, cancelable: true }));
  const up = () => sw.dispatchEvent(new PointerEvent("pointerup", { button: 0, pointerId: 1, isPrimary: true, bubbles: true }));
  const text = () => sw.querySelector(".guard-label")!.textContent;
  return { root, cover, sw, onFire, onHoldStart, onHoldEnd, key, down, up, text, state: () => root.dataset.state };
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("guardedRelease", () => {
  it("builds the documented DOM", () => {
    const g = make();
    expect(g.root.className).toBe("guarded");
    expect(g.cover.textContent).toBe("Lift");
    expect(g.cover.getAttribute("aria-expanded")).toBe("false");
    expect(g.sw.querySelector("svg.guard-ring .track")).toBeTruthy();
    expect(g.sw.querySelector("svg.guard-ring .prog")).toBeTruthy();
    expect(g.text()).toBe("Hold");
    const hint = g.root.querySelector(".guard-hint")!;
    expect(g.sw.getAttribute("aria-describedby")).toBe(hint.id);
    expect(hint.textContent).toBe("Lift, then hold");
  });

  it("ignores holds while closed", () => {
    const g = make();
    expect(g.sw.tabIndex).toBe(-1);
    expect(g.sw.getAttribute("aria-disabled")).toBe("true");
    g.down();
    g.key(g.sw, "keydown");
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(g.onFire).not.toHaveBeenCalled();
    expect(g.onHoldStart).not.toHaveBeenCalled();
    expect(g.state()).toBe("closed");
  });

  it("lifts by click and never fires", () => {
    const g = make();
    g.cover.click();
    expect(g.state()).toBe("open");
    expect(g.cover.getAttribute("aria-expanded")).toBe("true");
    expect(g.sw.tabIndex).toBe(0);
    expect(g.sw.hasAttribute("aria-disabled")).toBe(false);
    expect(document.activeElement).toBe(g.sw);
    vi.advanceTimersByTime(1000);
    expect(g.onFire).not.toHaveBeenCalled();
  });

  it.each([" ", "Enter"])("lifts by keyboard (%j), and the carried key repeat does not arm", (k) => {
    const g = make();
    g.key(g.cover, "keydown", k);
    expect(g.state()).toBe("open");
    // The held key keeps repeating, now on the focused switch.
    g.key(g.sw, "keydown", k, true);
    g.key(g.sw, "keydown", k, true);
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(g.state()).toBe("open");
    expect(g.onFire).not.toHaveBeenCalled();
    g.key(g.sw, "keyup", k);
    // A fresh press does arm.
    g.key(g.sw, "keydown", k);
    expect(g.state()).toBe("arming");
  });

  it("early release cancels and resets progress; a plain click does nothing", () => {
    const g = make();
    g.cover.click();
    g.down();
    expect(g.state()).toBe("arming");
    expect(g.text()).toBe("Arming");
    vi.advanceTimersByTime(HOLD_MS / 2);
    g.up();
    expect(g.state()).toBe("open");
    expect(g.root.style.getPropertyValue("--p")).toBe("0");
    vi.advanceTimersByTime(HOLD_MS * 2);
    g.sw.click();
    expect(g.onFire).not.toHaveBeenCalled();
    expect(g.text()).toBe("Hold");
  });

  it("blur cancels", () => {
    const g = make();
    g.cover.click();
    g.key(g.sw, "keydown");
    g.sw.dispatchEvent(new FocusEvent("blur"));
    expect(g.state()).toBe("open");
  });

  it("a full hold fires once and disables both buttons", () => {
    const g = make();
    g.cover.click();
    g.key(g.sw, "keydown");
    vi.advanceTimersByTime(HOLD_MS - 50);
    expect(g.onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(g.onFire).toHaveBeenCalledTimes(1);
    expect(g.state()).toBe("fired");
    expect(g.sw.disabled).toBe(true);
    expect(g.cover.disabled).toBe(true);
    expect(g.text()).toBe("Done");
    g.key(g.sw, "keyup");
    g.down();
    vi.advanceTimersByTime(HOLD_MS * 3);
    expect(g.onFire).toHaveBeenCalledTimes(1);
  });

  it("relocks after relockMs idle, but not mid-hold", () => {
    const g = make({ relockMs: 5000 });
    g.cover.click();
    vi.advanceTimersByTime(4900);
    expect(g.state()).toBe("open");
    vi.advanceTimersByTime(200);
    expect(g.state()).toBe("closed");
    expect(g.sw.tabIndex).toBe(-1);
    g.cover.click();
    vi.advanceTimersByTime(4000);
    g.key(g.sw, "keydown");
    vi.advanceTimersByTime(HOLD_MS - 10);
    expect(g.state()).toBe("arming");
  });

  it("pairs onHoldStart and onHoldEnd", () => {
    const g = make();
    g.cover.click();
    g.down();
    expect(g.onHoldStart).toHaveBeenCalledTimes(1);
    expect(g.onHoldEnd).not.toHaveBeenCalled();
    g.up();
    expect(g.onHoldEnd).toHaveBeenCalledTimes(1);
    g.down();
    vi.advanceTimersByTime(HOLD_MS + 10);
    expect(g.onHoldStart).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(g.onHoldEnd).toHaveBeenCalledTimes(2);
  });
});
