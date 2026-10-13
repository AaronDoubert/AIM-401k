import { describe, expect, it } from "vitest";
import { createBingoGate, lostKind, shouldWinchester } from "../src/background/feedrules";
import { isDailyQuota } from "../src/background/ai";

describe("lostKind", () => {
  it("only a stand-down stays quiet; real failures are errors", () => {
    expect(lostKind("stood down")).toBe("lost");
    for (const why of ["tab closed", "tab lost", "couldn't open tab"]) expect(lostKind(why)).toBe("error");
  });
});

describe("shouldWinchester", () => {
  const j = (status: string) => ({ status }) as never;
  it("needs arming and an empty queue with nothing running", () => {
    expect(shouldWinchester(false, [])).toBe(false);
    expect(shouldWinchester(true, [])).toBe(true);
    expect(shouldWinchester(true, [j("needs_you"), j("submitted")])).toBe(true);
    expect(shouldWinchester(true, [j("queued")])).toBe(false);
    expect(shouldWinchester(true, [j("running")])).toBe(false);
  });
});

describe("createBingoGate", () => {
  it("lets one line through per provider per day", () => {
    const gate = createBingoGate();
    expect(gate("gemini", "2026-10-13")).toBe(true);
    expect(gate("gemini", "2026-10-13")).toBe(false);
    expect(gate("groq", "2026-10-13")).toBe(true);
    expect(gate("gemini", "2026-10-14")).toBe(true);
  });
});

describe("isDailyQuota", () => {
  it("needs a 429 with daily-quota wording", () => {
    expect(isDailyQuota(429, "You exceeded your current quota")).toBe(true);
    expect(isDailyQuota(429, "Too many requests, slow down")).toBe(false);
    expect(isDailyQuota(500, "quota")).toBe(false);
  });
});
