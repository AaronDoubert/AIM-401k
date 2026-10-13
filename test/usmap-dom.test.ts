// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { type MapCopy, type MapPoint, UsMap } from "../src/ui/warroom/map";

const copy: MapCopy = {
  title: "Where",
  remote: (n) => `${n} remote`,
  unplaced: (n) => `${n} no fix`,
  empty: "Nothing to plot",
};
const pt = (jobId: string, location: string, extra: Partial<MapPoint> = {}): MapPoint => ({
  jobId,
  label: `Job ${jobId}`,
  location,
  tone: "ok",
  queued: false,
  ...extra,
});
const make = () => new UsMap(() => copy);
const dots = (m: UsMap) => [...m.el.querySelectorAll(".pt")];

describe("UsMap", () => {
  it("renders one point per place and an aria summary", () => {
    const m = make();
    m.update([pt("a", "Austin, TX"), pt("b", "Seattle, WA")]);
    expect(dots(m)).toHaveLength(2);
    expect(m.el.querySelector("svg")?.getAttribute("aria-label")).toContain("Where");
    expect(m.el.querySelector(".pt title")?.textContent).toContain("Job a");
  });

  it("clusters jobs at one place with a count and the loudest tone", () => {
    const m = make();
    m.update([pt("a", "Austin, TX"), pt("b", "Austin, Texas", { tone: "alert" }), pt("c", "Austin, TX", { tone: "dim" })]);
    expect(dots(m)).toHaveLength(1);
    expect(m.el.querySelector(".count")?.textContent).toBe("3");
    expect(dots(m)[0]?.classList.contains("t-alert")).toBe(true);
    m.update([pt("a", "Austin, TX")]);
    expect(m.el.querySelector(".count")).toBeNull();
  });

  it("draws queued points dashed", () => {
    const m = make();
    m.update([pt("a", "Austin, TX", { queued: true }), pt("b", "Boston, MA")]);
    const [q, n] = m.el.querySelectorAll(".dot");
    expect(q?.getAttribute("stroke-dasharray")).toBeTruthy();
    expect(n?.getAttribute("stroke-dasharray")).toBeNull();
    expect(dots(m)[0]?.classList.contains("q")).toBe(true);
  });

  it("shows remote and no-fix buckets, omitting zeros", () => {
    const m = make();
    m.update([pt("a", "Remote"), pt("b", "Remote - US"), pt("c", "London, UK"), pt("d", ""), pt("e", "Austin, TX")]);
    const t = [...m.el.querySelectorAll(".usmap-bucket")].map((e) => e.textContent);
    expect(t).toEqual(["2 remote", "2 no fix"]);
    expect(dots(m)).toHaveLength(1);
    m.update([pt("a", "Remote")]);
    expect([...m.el.querySelectorAll(".usmap-bucket")].map((e) => e.textContent)).toEqual(["1 remote"]);
  });

  it("shows the empty line when there are no points", () => {
    const m = make();
    m.update([]);
    expect(m.el.querySelector(".usmap-foot")?.textContent).toBe("Nothing to plot");
    expect(dots(m)).toHaveLength(0);
  });

  it("select() places a reticle on the place holding the job", () => {
    const m = make();
    m.update([pt("a", "Austin, TX"), pt("b", "Boston, MA"), pt("r", "Remote")]);
    const ret = () => m.el.querySelector(".reticle") as Element;
    expect(ret().getAttribute("visibility")).toBe("hidden");
    m.select("b");
    expect(ret().getAttribute("visibility")).toBe("visible");
    expect(ret().getAttribute("d")).toMatch(/^M/);
    expect(m.el.querySelectorAll(".pt.sel")).toHaveLength(1);
    m.select("r"); // unplaced: no reticle
    expect(ret().getAttribute("visibility")).toBe("hidden");
    m.select("a");
    m.update([pt("a", "Austin, TX"), pt("x", "Denver, CO")]); // survives rebuild
    expect(ret().getAttribute("visibility")).toBe("visible");
    m.select(null);
    expect(ret().getAttribute("visibility")).toBe("hidden");
  });

  it("click selects the first job at that place", () => {
    const m = make();
    const got: string[] = [];
    m.onSelect = (id) => got.push(id);
    m.update([pt("a", "Austin, TX"), pt("b", "Austin, TX")]);
    (dots(m)[0] as Element).dispatchEvent(new Event("click"));
    expect(got).toEqual(["a"]);
  });

  it("keeps untrusted job text as text", () => {
    const m = make();
    const evil = '<img src=x onerror="alert(1)">';
    m.update([pt("a", evil + ", TX", { label: evil })]);
    expect(m.el.querySelector("img")).toBeNull();
    m.update([pt("a", "Austin, TX", { label: evil })]);
    expect(m.el.querySelector("img")).toBeNull();
    expect(m.el.querySelector(".pt title")?.textContent).toContain(evil);
  });

  it("does not rebuild the DOM for an identical update", () => {
    const m = make();
    m.update([pt("a", "Austin, TX"), pt("b", "Remote")]);
    const node = dots(m)[0];
    const foot = m.el.querySelector(".usmap-bucket");
    m.update([pt("a", "Austin, TX"), pt("b", "Remote")]);
    expect(dots(m)[0]).toBe(node);
    expect(m.el.querySelector(".usmap-bucket")).toBe(foot);
    m.update([pt("a", "Austin, TX", { tone: "warn" }), pt("b", "Remote")]);
    expect(dots(m)[0]).not.toBe(node);
  });
});
