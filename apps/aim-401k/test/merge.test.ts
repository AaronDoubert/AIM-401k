import { describe, expect, it } from "vitest";
import { mergeById, mergeEdits } from "../src/shared/merge";

describe("mergeEdits", () => {
  const base = { paused: false, afk: false, concurrency: 1, notifications: true, apiKeys: { gemini: "k1" }, intel: { gmailApi: false, autoStatus: true } };
  it("keeps changes made elsewhere while the page was open", () => {
    // Page edited notifications; meanwhile the War Room set AFK + units and Gmail got connected.
    const edited = { ...base, notifications: false };
    const current = { ...base, afk: true, concurrency: 4, intel: { gmailApi: true, autoStatus: true } };
    expect(mergeEdits(base, edited, current)).toEqual({ ...current, notifications: false });
  });
  it("merges nested objects key by key", () => {
    const edited = { ...base, intel: { gmailApi: false, autoStatus: false } };
    const current = { ...base, intel: { gmailApi: true, autoStatus: true } };
    expect(mergeEdits(base, edited, current).intel).toEqual({ gmailApi: true, autoStatus: false });
  });
  it("doesn't resurrect keys forgotten elsewhere", () => {
    const current = { ...base, apiKeys: {} };
    expect(mergeEdits(base, { ...base }, current).apiKeys).toEqual({});
    // …unless the page deliberately set a new key.
    expect(mergeEdits(base, { ...base, apiKeys: { gemini: "k2" } }, current).apiKeys).toEqual({ gemini: "k2" });
  });
  it("replaces arrays whole", () => {
    const b = { jobs: [1, 2] };
    expect(mergeEdits(b, { jobs: [1] }, { jobs: [1, 2, 3] })).toEqual({ jobs: [1] });
  });
});

describe("mergeById", () => {
  const a = (id: string, answer: string) => ({ id, question: id, answer });
  it("applies edits/deletes and keeps entries added elsewhere", () => {
    const base = [a("1", "x"), a("2", "y")];
    const edited = [a("1", "x2")]; // edited 1, deleted 2
    const current = [a("3", "from overlay"), a("1", "x"), a("2", "y")];
    expect(mergeById(base, edited, current)).toEqual([a("1", "x2"), a("3", "from overlay")]);
  });
});

import { frameMayFill, siteOf } from "../src/shared/frames";

describe("frameMayFill", () => {
  const top = "https://careers.acme.co.uk/jobs/1";
  it("allows the page, same-site frames and ATS frames only", () => {
    expect(siteOf("careers.acme.co.uk")).toBe("acme.co.uk");
    expect(frameMayFill(top, top, 0)).toBe(true);
    expect(frameMayFill("https://apply.acme.co.uk/form", top, 3)).toBe(true);
    expect(frameMayFill("https://boards.greenhouse.io/embed/job_app?for=acme", top, 2)).toBe(true);
    expect(frameMayFill("https://ads.doubleclick.net/x", top, 4)).toBe(false);
    expect(frameMayFill("https://widget.intercom.io/frame", top, 5)).toBe(false);
    expect(frameMayFill("about:blank", top, 6)).toBe(false);
  });
});
