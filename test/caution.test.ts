// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { MasterCaution } from "../src/ui/caution";

const make = () => {
  const el = document.createElement("button");
  const onPress = vi.fn();
  return { el, onPress, mc: new MasterCaution(el, onPress) };
};

describe("master caution", () => {
  it("is dark with nothing pending", () => {
    const { el, mc } = make();
    expect(mc.update([])).toBe(false);
    expect(el.dataset.lit).toBe("false");
  });

  it("lights for holds present at load without flashing", () => {
    const { el, mc } = make();
    expect(mc.update(["a"])).toBe(false);
    expect(el.dataset.lit).toBe("true");
    expect(el.classList.contains("flash")).toBe(false);
  });

  it("flashes on a new hold, goes dark when pressed, relights on the next one", () => {
    const { el, mc, onPress } = make();
    mc.update([]);
    expect(mc.update(["a"])).toBe(true);
    expect(el.classList.contains("flash")).toBe(true);
    el.click();
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(el.dataset.lit).toBe("false");
    expect(mc.update(["a"])).toBe(false);
    expect(el.dataset.lit).toBe("false"); // acknowledged hold stays dark
    expect(mc.update(["a", "b"])).toBe(true);
    expect(el.dataset.lit).toBe("true");
  });

  it("forgets acknowledgements for holds that cleared", () => {
    const { el, mc } = make();
    mc.update(["a"]);
    mc.press();
    mc.update([]);
    mc.update(["a"]); // same id back again (re-raised): it's new
    expect(el.dataset.lit).toBe("true");
  });
});
