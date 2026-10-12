import { describe, expect, it } from "vitest";
import { normalizeProfile, normalizeSettings } from "../src/shared/defaults";
import { startDateIso, yearsOfExperience } from "../src/core/matcher";
import { extractJson } from "../src/background/ai";

describe("v1 → v2 migration", () => {
  it("moves flat job/school fields into lists", () => {
    const p = normalizeProfile({ firstName: "Ada", currentCompany: "Acme", currentTitle: "Eng", school: "MIT", degree: "BS", major: "CS", graduationYear: "2016", startDate: "2 weeks" });
    expect(p.workHistory).toEqual([expect.objectContaining({ company: "Acme", title: "Eng", current: true })]);
    expect(p.education).toEqual([expect.objectContaining({ school: "MIT", degree: "BS", field: "CS", endDate: "2016" })]);
    expect(p.noticePeriod).toBe("2 weeks");
    expect("currentCompany" in p).toBe(false);
  });
  it("moves the single Anthropic key into the provider map", () => {
    const s = normalizeSettings({ anthropicApiKey: "sk-ant-x", model: "claude-opus-5-5", llmMode: "draft" });
    expect(s).toMatchObject({ aiProvider: "anthropic", apiKeys: { anthropic: "sk-ant-x" }, models: { anthropic: "claude-opus-5-5" }, llmMode: "draft" });
    expect("anthropicApiKey" in s).toBe(false);
  });
});

describe("derived values", () => {
  const today = new Date(2026, 9, 12);
  it("computes years of experience and start date", () => {
    const p = normalizeProfile({ workHistory: [{ startDate: "2016-06" }, { startDate: "2019-03" }], noticePeriod: "2 weeks" });
    expect(yearsOfExperience(p, today)).toBe("10");
    expect(startDateIso(p, today)).toBe("2026-10-26");
    expect(startDateIso({ ...p, earliestStartDate: "2026-12-01" }, today)).toBe("2026-12-01");
  });
  it("extracts JSON from chatty model replies", () => {
    expect(extractJson('Sure!\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a": {"b": 2}} hope that helps')).toEqual({ a: { b: 2 } });
  });
});
