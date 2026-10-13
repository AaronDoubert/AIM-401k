// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sanitizeFields } from "../src/background/unitfields";
import type { ContentContext } from "../src/shared/messages";
import { DEFAULT_SETTINGS } from "../src/shared/defaults";
import type { FieldCheck } from "../src/shared/types";
import { profile } from "./helpers";

const sent: any[] = [];
vi.mock("../src/shared/api", () => ({
  api: {
    runtime: {
      sendMessage: vi.fn(async (msg: any) => {
        sent.push(msg);
        if (msg.type === "draft") return { answer: "", needsHuman: true, reason: "no" };
        return undefined;
      }),
    },
  },
}));

describe("sanitizeFields", () => {
  it("keeps valid entries, trims labels, caps length and count", () => {
    const raw = [
      { label: "  First   name ", state: "ok" },
      { label: "x".repeat(100), state: "need" },
      { label: "bad state", state: "done" },
      { label: 5, state: "ok" },
      null,
      "str",
      { label: "", state: "ok" },
    ];
    const out = sanitizeFields(raw)!;
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ label: "First name", state: "ok" });
    expect(out[1]!.label).toHaveLength(60);
    const many = Array.from({ length: 50 }, (_, i) => ({ label: `f${i}`, state: "todo" }));
    expect(sanitizeFields(many)).toHaveLength(30);
  });
  it("returns undefined for non-arrays and empty results", () => {
    expect(sanitizeFields(undefined)).toBeUndefined();
    expect(sanitizeFields("x")).toBeUndefined();
    expect(sanitizeFields([])).toBeUndefined();
    expect(sanitizeFields([{ label: "a", state: "nope" }])).toBeUndefined();
  });
});

describe("Autopilot field checklist", () => {
  beforeEach(() => {
    sent.length = 0;
    const html = readFileSync(join(__dirname, "fixtures", "apply.html"), "utf8");
    document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/^<!doctype html>/i, "");
  });

  it("reports ok / need / todo states in page order, capped and clipped", async () => {
    const { Autopilot } = await import("../src/content/autopilot");
    const ctx: ContentContext = {
      managed: true,
      jobId: "job1",
      profile,
      answers: [],
      settings: { ...DEFAULT_SETTINGS, autoAdvance: false, autoSubmit: false, llmMode: "off", hasApiKey: false } as ContentContext["settings"],
    };
    // refreshCtx asks the background for the context.
    const api = (await import("../src/shared/api")).api;
    (api.runtime.sendMessage as any).mockImplementation(async (msg: any) => {
      sent.push(msg);
      return msg.type === "hello" ? ctx : undefined;
    });
    await new Autopilot(ctx, true).tick();
    await new Promise((r) => setTimeout(r, 350)); // trailing throttled send
    const units = sent.filter((m) => m.type === "unit");
    expect(units.length).toBeGreaterThan(0);
    const fields: FieldCheck[] = units[units.length - 1].state.fields;
    expect(fields.length).toBeGreaterThan(3);
    expect(fields.length).toBeLessThanOrEqual(30);
    expect(fields.every((f) => f.label.length <= 40)).toBe(true);
    expect(fields[0]).toEqual({ label: "First Name", state: "ok" });
    expect(fields.some((f) => f.state === "need")).toBe(true);
    expect(sanitizeFields(fields)).toHaveLength(fields.length);
  });
});
