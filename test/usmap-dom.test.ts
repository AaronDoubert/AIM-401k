// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { type MapCopy, type MapPoint, UsMap } from "../src/ui/warroom/map";

const copy: MapCopy = {
  title: "Where",
  remote: (n) => `${n} remote`,
  unplaced: (n) => `${n} no fix`,
  empty: "Nothing to plot",
  stage: (id) => `L:${id}`,
  failed: "L:failed",
  clear: "Clear",
};
const pt = (jobId: string, location: string, extra: Partial<MapPoint> = {}): MapPoint => ({
  jobId,
  label: `Job ${jobId}`,
  location,
  stage: "engaged",
  failed: false,
  ...extra,
});
const make = () => new UsMap(() => copy);
const pts = (m: UsMap) => [...m.el.querySelectorAll(".pt")];
const keys = (m: UsMap) => [...m.el.querySelectorAll(".usmap-key")].map((e) => e.className.replace("usmap-key k-", ""));
const click = (e: Element | undefined) => e?.dispatchEvent(new Event("click"));
const ret = (m: UsMap) => m.el.querySelector(".reticle") as Element;

describe("UsMap symbols", () => {
  it("renders one point per place and an aria summary", () => {
    const m = make();
    m.update([pt("a", "Austin, TX"), pt("b", "Seattle, WA")]);
    expect(pts(m)).toHaveLength(2);
    const label = m.el.querySelector("svg")?.getAttribute("aria-label") ?? "";
    expect(label).toContain("Where");
    expect(label).toContain("2 L:engaged");
    expect(m.el.querySelector(".pt title")?.textContent).toContain("Job a");
  });

  it("draws a frame per stage", () => {
    const m = make();
    m.update([
      pt("1", "Austin, TX", { stage: "targets" }),
      pt("2", "Boston, MA", { stage: "engaged" }),
      pt("3", "Denver, CO", { stage: "hold" }),
      pt("4", "Seattle, WA", { stage: "splash" }),
      pt("5", "Chicago, IL", { stage: "contact" }),
      pt("6", "Miami, FL", { stage: "secured" }),
      pt("7", "Phoenix, AZ", { stage: "lost" }),
      pt("8", "Atlanta, GA", { stage: "lost", failed: true }),
    ]);
    const sym = (job: string) => m.el.querySelector(`.pt[data-job="${job}"]`) as Element;
    const shapes = (job: string) => [...sym(job).querySelectorAll(".sym > *")].map((e) => e.tagName.toLowerCase());
    expect(sym("1").getAttribute("class")).toContain("s-targets");
    expect(sym("1").querySelector("rect.dashed")).not.toBeNull();
    expect(sym("2").querySelector("rect.dashed")).toBeNull();
    expect(shapes("2")).toEqual(["rect"]);
    expect(shapes("3")).toEqual(["path"]);
    expect(sym("3").getAttribute("class")).toContain("s-hold");
    expect(shapes("4")).toEqual(["circle"]);
    expect(sym("4").querySelector("circle.solid")).toBeNull();
    expect(sym("5").getAttribute("class")).toContain("s-contact");
    expect(sym("6").querySelector("circle.solid")).not.toBeNull();
    expect(shapes("7")).toEqual(["rect", "path"]); // square with X
    expect(sym("7").getAttribute("class")).toContain("s-lost");
    expect(sym("8").getAttribute("class")).toContain("s-failed");
    expect(shapes("8")).toEqual(["rect", "path"]);
  });

  it("clusters jobs at one place: most urgent wins, with a count", () => {
    const m = make();
    m.update([pt("a", "Austin, TX", { stage: "splash" }), pt("b", "Austin, Texas", { stage: "hold" }), pt("c", "Austin, TX", { stage: "lost" })]);
    expect(pts(m)).toHaveLength(1);
    expect(m.el.querySelector(".count")?.textContent).toBe("3");
    expect(pts(m)[0]?.classList.contains("s-hold")).toBe(true);
    m.update([pt("a", "Austin, TX")]);
    expect(m.el.querySelector(".count")).toBeNull();
  });

  it("orders urgency hold > failed > engaged > contact > secured > splash > targets > lost", () => {
    const order: [string, Partial<MapPoint>][] = [
      ["hold", { stage: "hold" }],
      ["failed", { stage: "lost", failed: true }],
      ["engaged", { stage: "engaged" }],
      ["contact", { stage: "contact" }],
      ["secured", { stage: "secured" }],
      ["splash", { stage: "splash" }],
      ["targets", { stage: "targets" }],
      ["lost", { stage: "lost" }],
    ];
    const m = make();
    for (let i = 0; i < order.length - 1; i++) {
      const [win, wp] = order[i] as [string, Partial<MapPoint>];
      for (const [, lp] of order.slice(i + 1)) {
        m.update([pt("l", "Austin, TX", lp), pt("w", "Austin, TX", wp)]);
        expect(pts(m)[0]?.classList.contains(`s-${win}`)).toBe(true);
      }
    }
  });

  it("failed beats the stage and is red-classed", () => {
    const m = make();
    m.update([pt("a", "Austin, TX", { stage: "lost", failed: true })]);
    expect(pts(m)[0]?.classList.contains("s-failed")).toBe(true);
  });
});

describe("UsMap legend", () => {
  it("lists only the symbols present, with counts, then buckets", () => {
    const m = make();
    m.update([
      pt("a", "Austin, TX", { stage: "hold" }),
      pt("b", "Boston, MA", { stage: "hold" }),
      pt("c", "Denver, CO", { stage: "secured" }),
      pt("d", "Seattle, WA", { stage: "lost", failed: true }),
      pt("e", "Remote"),
      pt("f", "London, UK"),
      pt("g", ""),
    ]);
    expect(keys(m)).toEqual(["hold", "secured", "failed"]);
    const hold = m.el.querySelector(".k-hold") as Element;
    expect(hold.textContent).toBe("L:hold2");
    expect(hold.querySelector("svg .sym")).not.toBeNull();
    expect([...m.el.querySelectorAll(".usmap-bucket")].map((e) => e.textContent)).toEqual(["1 remote", "2 no fix"]);
    m.update([pt("a", "Austin, TX", { stage: "contact" })]);
    expect(keys(m)).toEqual(["contact"]);
    expect(m.el.querySelectorAll(".usmap-bucket")).toHaveLength(0);
  });

  it("shows the empty line when there are no points", () => {
    const m = make();
    m.update([]);
    expect(m.el.querySelector(".usmap-foot")?.textContent).toBe("Nothing to plot");
    expect(pts(m)).toHaveLength(0);
  });
});

describe("UsMap filtering", () => {
  it("click calls onFilter with every job at the place; again clears", () => {
    const m = make();
    const got: (string[] | null)[] = [];
    m.onFilter = (ids) => got.push(ids);
    m.update([pt("a", "Austin, TX"), pt("b", "Austin, TX"), pt("c", "Boston, MA")]);
    click(pts(m)[0] ?? undefined);
    expect(got).toEqual([["a", "b"]]);
    expect(pts(m)[0]?.classList.contains("flt")).toBe(true);
    expect(pts(m)[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(m.el.classList.contains("filtering")).toBe(true);
    expect(ret(m).getAttribute("visibility")).toBe("hidden"); // nothing selected
    expect(m.el.querySelector(".reticle-flt")?.getAttribute("visibility")).toBe("visible");
    click(pts(m)[0] ?? undefined);
    expect(got).toEqual([["a", "b"], null]);
    expect(m.el.classList.contains("filtering")).toBe(false);
    expect(m.el.querySelector(".reticle-flt")?.getAttribute("visibility")).toBe("hidden");
  });

  it("moves the filter to another place and clears from the legend control", () => {
    const m = make();
    const got: (string[] | null)[] = [];
    m.onFilter = (ids) => got.push(ids);
    m.update([pt("a", "Austin, TX"), pt("b", "Boston, MA")]);
    const clear = m.el.querySelector(".usmap-clear") as HTMLButtonElement;
    expect(clear.hidden).toBe(true);
    for (const p of pts(m)) if (p.getAttribute("data-job") === "a") click(p);
    expect(clear.hidden).toBe(false);
    for (const p of pts(m)) if (p.getAttribute("data-job") === "b") click(p);
    expect(got).toEqual([["a"], ["b"]]);
    click(clear);
    expect(got).toEqual([["a"], ["b"], null]);
    expect(clear.hidden).toBe(true);
  });

  it("Enter and Space filter; places are focusable buttons", () => {
    const m = make();
    const got: (string[] | null)[] = [];
    m.onFilter = (ids) => got.push(ids);
    m.update([pt("a", "Austin, TX")]);
    const p = pts(m)[0] as Element;
    expect(p.getAttribute("role")).toBe("button");
    expect(p.getAttribute("tabindex")).toBe("0");
    p.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    p.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    p.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
    expect(got).toEqual([["a"], null]);
  });

  it("survives rebuilds, reports a changed set, and clears when the place goes", () => {
    const m = make();
    const got: (string[] | null)[] = [];
    m.onFilter = (ids) => got.push(ids);
    m.update([pt("a", "Austin, TX"), pt("b", "Boston, MA")]);
    click(pts(m).find((p) => p.getAttribute("data-job") === "a"));
    m.update([pt("a", "Austin, TX", { stage: "hold" }), pt("b", "Boston, MA")]);
    expect(pts(m).find((p) => p.getAttribute("data-job") === "a")?.classList.contains("flt")).toBe(true);
    expect(got).toEqual([["a"]]);
    m.update([pt("a", "Austin, TX"), pt("a2", "Austin, TX"), pt("b", "Boston, MA")]);
    expect(got.at(-1)).toEqual(["a", "a2"]);
    m.update([pt("b", "Boston, MA")]);
    expect(got.at(-1)).toBeNull();
    expect(m.el.classList.contains("filtering")).toBe(false);
  });

  it("clearFilter() drops the filter silently", () => {
    const m = make();
    let calls = 0;
    m.onFilter = () => calls++;
    m.update([pt("a", "Austin, TX")]);
    click(pts(m)[0]);
    m.clearFilter();
    expect(calls).toBe(1);
    expect(m.el.classList.contains("filtering")).toBe(false);
  });
});

describe("UsMap reticle", () => {
  it("select() places a reticle on the place holding the job", () => {
    const m = make();
    m.update([pt("a", "Austin, TX"), pt("b", "Boston, MA"), pt("r", "Remote")]);
    expect(ret(m).getAttribute("visibility")).toBe("hidden");
    m.select("b");
    expect(ret(m).getAttribute("visibility")).toBe("visible");
    expect(ret(m).querySelector("path")?.getAttribute("d")).toMatch(/^M/);
    expect(m.el.querySelectorAll(".pt.sel")).toHaveLength(1);
    m.select("r"); // unplaced: no reticle
    expect(ret(m).getAttribute("visibility")).toBe("hidden");
    m.select("a");
    m.update([pt("a", "Austin, TX"), pt("x", "Denver, CO")]); // survives rebuild
    expect(ret(m).getAttribute("visibility")).toBe("visible");
    m.select(null);
    expect(ret(m).getAttribute("visibility")).toBe("hidden");
  });

  it("highlight() moves the reticle to the hovered row, then back to the selection", () => {
    const m = make();
    m.update([pt("a", "Austin, TX"), pt("b", "Boston, MA")]);
    m.select("a");
    const at = () => ret(m).getAttribute("data-place");
    const sel = at();
    m.highlight("b");
    expect(ret(m).getAttribute("visibility")).toBe("visible");
    expect(at()).not.toBe(sel);
    expect(ret(m).getAttribute("data-job")).toBe("b");
    m.highlight(null);
    expect(at()).toBe(sel);
    m.select(null);
    m.highlight("b");
    expect(ret(m).getAttribute("visibility")).toBe("visible");
    m.highlight(null);
    expect(ret(m).getAttribute("visibility")).toBe("hidden");
  });

  it("keeps a separate reticle on the filtered place while another is highlighted", () => {
    const m = make();
    m.update([pt("a", "Austin, TX"), pt("b", "Boston, MA")]);
    click(pts(m).find((p) => p.getAttribute("data-job") === "a"));
    m.highlight("b");
    expect(ret(m).getAttribute("visibility")).toBe("visible");
    expect(m.el.querySelector(".reticle-flt")?.getAttribute("visibility")).toBe("visible");
    m.highlight("a"); // same place: one reticle
    expect(m.el.querySelector(".reticle-flt")?.getAttribute("visibility")).toBe("hidden");
  });
});

describe("UsMap safety and cost", () => {
  it("keeps untrusted job text as text", () => {
    const m = make();
    const evil = '<img src=x onerror="alert(1)">';
    m.update([pt("a", evil + ", TX", { label: evil })]);
    expect(m.el.querySelector("img")).toBeNull();
    m.update([pt("a", "Austin, TX", { label: evil })]);
    expect(m.el.querySelector("img")).toBeNull();
    expect(m.el.querySelector(".pt title")?.textContent).toContain(evil);
    expect(m.el.innerHTML).not.toContain("<img");
  });

  it("does not rebuild the DOM for an identical update", () => {
    const m = make();
    m.update([pt("a", "Austin, TX"), pt("b", "Remote")]);
    const node = pts(m)[0];
    const foot = m.el.querySelector(".usmap-key");
    m.update([pt("a", "Austin, TX"), pt("b", "Remote")]);
    expect(pts(m)[0]).toBe(node);
    expect(m.el.querySelector(".usmap-key")).toBe(foot);
    m.update([pt("a", "Austin, TX", { stage: "hold" }), pt("b", "Remote")]);
    expect(pts(m)[0]).not.toBe(node);
  });

  it("filter, select and highlight do not rebuild the places", () => {
    const m = make();
    m.update([pt("a", "Austin, TX"), pt("b", "Boston, MA")]);
    const nodes = pts(m);
    click(nodes[0]);
    m.select("b");
    m.highlight("a");
    m.update([pt("a", "Austin, TX"), pt("b", "Boston, MA")]);
    expect(pts(m)).toEqual(nodes);
  });
});
