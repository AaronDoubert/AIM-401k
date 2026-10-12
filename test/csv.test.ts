import { describe, expect, it } from "vitest";
import { extractUrls, jobsToCsv } from "../src/core/csv";
import type { Job } from "../src/shared/types";

describe("csv", () => {
  it("escapes commas, quotes and newlines", () => {
    const job = {
      company: 'Acme, "Inc"',
      title: "Eng",
      location: "",
      status: "submitted",
      appliedAt: Date.UTC(2026, 0, 2),
      createdAt: Date.UTC(2026, 0, 1),
      ats: "lever",
      url: "https://x",
      notes: "line1\nline2",
    } as Job;
    const csv = jobsToCsv([job]).split("\n").slice(1).join("\n");
    expect(csv).toBe('"Acme, ""Inc""",Eng,,submitted,2026-01-02,2026-01-01,lever,https://x,"line1\nline2"');
  });
  it("extracts and dedupes urls", () => {
    expect(extractUrls("see https://a.com/x, and https://a.com/x\nhttps://b.io/job?id=1).")).toEqual(["https://a.com/x", "https://b.io/job?id=1"]);
  });
});
