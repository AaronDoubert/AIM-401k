import { beforeEach, describe, expect, it, vi } from "vitest";
import { candidateFacts, redactText, REDACTED_FIELDS, restoreContact } from "../src/background/tasks";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/shared/defaults";
import type { AnswerEntry, Job } from "../src/shared/types";
import { profile } from "./helpers";
// @ts-expect-error plain .mjs fixture shared with the e2e run
import { SAMPLE as SAMPLE_RESUME } from "./fixtures/sample-resume.mjs";

// A fake extension API for the background modules (store.ts / core.ts / data.ts).
const fake = vi.hoisted(() => {
  const mem: Record<string, unknown> = {};
  const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const removedTabs: number[] = [];
  const api = {
    storage: {
      local: {
        get: async (keys?: string | string[] | null) => {
          if (keys == null) return clone(mem);
          const list = typeof keys === "string" ? [keys] : keys;
          return Object.fromEntries(list.filter((k) => k in mem).map((k) => [k, clone(mem[k])]));
        },
        set: async (o: Record<string, unknown>) => void Object.assign(mem, clone(o)),
        remove: async (keys: string | string[]) => {
          for (const k of typeof keys === "string" ? [keys] : keys) delete mem[k];
        },
      },
      onChanged: { addListener: () => undefined },
    },
    tabs: {
      remove: async (id: number) => void removedTabs.push(id),
      query: async () => [],
      sendMessage: async () => undefined,
    },
    runtime: { sendMessage: async () => undefined, getURL: (p: string) => p },
    action: { setBadgeText: async () => undefined, setBadgeBackgroundColor: async () => undefined },
    notifications: { create: async () => undefined },
  };
  return { mem, api, removedTabs };
});
vi.mock("../src/shared/api", () => ({ api: fake.api }));

const answers: AnswerEntry[] = [
  { id: "a1", question: "Best way to reach you?", answer: "Email ada@example.com or call (512) 555-0100", source: "user", updatedAt: 1 },
  { id: "a2", question: "Why us?", answer: "I like robots.", source: "user", updatedAt: 1 },
];

const fullProfile = {
  ...profile,
  street: "12 Byron Lane",
  addressLine2: "Apt 4B",
  phone: "(512) 555-0100",
  resumeText: SAMPLE_RESUME as string,
  summary: "Engineer. Reach me at ada.l@work.example.org.",
  workHistory: [{ ...profile.workHistory[0]!, description: "On call: +44 20 7946 0958" }, profile.workHistory[1]!],
};

describe("redactText", () => {
  it("replaces emails and phone numbers in free text", () => {
    const out = redactText(SAMPLE_RESUME);
    expect(out).not.toContain("ada@example.com");
    expect(out).not.toContain("555-0100");
    expect(out).toContain("Austin, TX 78701 | [email] | [phone]");
  });
  it("handles common phone shapes", () => {
    for (const phone of ["(512) 555-0100", "512-555-0100", "512.555.0100", "+1 512 555 0100", "1-512-555-0100", "+44 20 7946 0958", "555-0100", "(512)5550100"]) {
      expect(redactText(`call ${phone} today`), phone).toBe("call [phone] today");
    }
  });
  it("leaves dates, years, ranges and numbers alone", () => {
    const text = "Mar 2021 – Present · 2012 – 2016 · 2016-06 to 2019-02 · 2026-10-12 · GPA 3.9 · 40 services · p99 cut 35% · $120,000-140,000 · ISO 9001:2015";
    expect(redactText(text)).toBe(text);
  });
  it("replaces the profile's own address and postal code verbatim", () => {
    const out = redactText("Lives at 12 Byron Lane, Apt 4B, Austin 78701.", fullProfile);
    expect(out).toBe("Lives at [address], [address], Austin [postal code].");
  });
});

describe("candidateFacts privacy guard", () => {
  it("sends everything when redaction is off", () => {
    const facts = candidateFacts(fullProfile, answers);
    expect(facts).toContain("ada@example.com");
    expect(facts).toContain("12 Byron Lane");
  });

  it("omits contact fields and scrubs free text when on", () => {
    const facts = candidateFacts(fullProfile, answers, { redact: true });
    const profileJson = JSON.parse(facts.match(/<profile>\n([\s\S]*?)\n<\/profile>/)![1]!) as Record<string, unknown>;
    for (const k of REDACTED_FIELDS) expect(profileJson).not.toHaveProperty(k);
    for (const leak of ["ada@example.com", "ada.l@work.example.org", "555-0100", "7946", "12 Byron Lane", "Apt 4B", "78701"]) expect(facts).not.toContain(leak);
    // Still useful: name, links, history, the rest of the resume, saved answers.
    expect(profileJson).toMatchObject({ firstName: "Ada", lastName: "Lovelace", city: "Austin", linkedin: "https://linkedin.com/in/ada" });
    expect(facts).toContain("Analytical Engines");
    expect(facts).toContain("Led migration of 40 services to Kubernetes");
    expect(facts).toContain("Email [email] or call [phone]");
    expect(facts).toContain("On call: [phone]");
  });

  it("never sends the resume file or EEO answers, and doesn't touch the stored profile", () => {
    const before = JSON.stringify(fullProfile);
    const facts = candidateFacts(fullProfile, answers, { redact: true });
    expect(facts).not.toContain("JVBERi0="); // resume file bytes
    expect(facts).not.toMatch(/"gender"|"race"|veteran|disability/);
    expect(JSON.stringify(fullProfile)).toBe(before);
  });

  it("is on by default for new and existing users", () => {
    expect(DEFAULT_SETTINGS.aiRedact).toBe(true);
    expect(normalizeSettings({ llmMode: "draft" }).aiRedact).toBe(true);
    expect(normalizeSettings({ aiRedact: false }).aiRedact).toBe(false);
  });
});

describe("restoreContact (AI resume reading with the guard on)", () => {
  it("fills email and phone back in from the original text", () => {
    const out = { email: "[email]", phone: "[phone]" };
    restoreContact(out, SAMPLE_RESUME);
    expect(out).toEqual({ email: "ada@example.com", phone: "(512) 555-0100" });
  });
  it("keeps what the model returned when it's real", () => {
    const out = { email: "x@y.dev", phone: "" };
    restoreContact(out, "no contact here");
    expect(out).toEqual({ email: "x@y.dev", phone: "" });
  });
});

// ---------------------------------------------------------------------------

const { buildStorageReport, keysToClear, wipeAll, forgetAiKeys, approxBytes } = await import("../src/background/data");
const { getState } = await import("../src/background/store");

const job = (id: string, over: Partial<Job> = {}): Job => ({
  id,
  url: `https://jobs.example/${id}`,
  company: "Acme",
  title: "Eng",
  location: "",
  ats: "",
  status: "submitted",
  createdAt: 1,
  updatedAt: 1,
  appliedAt: 1,
  lastProgressAt: 1,
  notes: "",
  tabId: null,
  autoTab: false,
  aiDrafted: 0,
  log: [],
  ...over,
});

describe("storage report", () => {
  it("sizes every key as JSON length and counts records", () => {
    const raw = {
      profile: { firstName: "Ada", resume: { name: "a.pdf", type: "application/pdf", data: "QUJD" } },
      jobs: [job("j1"), job("j2")],
      answers: answers,
      ops: [{ id: "o", t: 1, kind: "system", text: "x" }],
      settings: { llmMode: "draft", aiProvider: "groq" },
      somethingElse: "abc",
    };
    const r = buildStorageReport(raw);
    expect(r.bytes.profile).toBe(JSON.stringify(raw.profile).length);
    expect(r.bytes.jobs).toBe(JSON.stringify(raw.jobs).length);
    expect(r.bytes.somethingElse).toBe(5);
    expect(r.counts).toEqual({ jobs: 2, answers: 2, intel: 0, ops: 1 });
    expect(r.hasResume).toBe(true);
    expect(r.aiProvider).toBe("Groq");
  });
  it("reports no AI provider when AI is off, and handles empty storage", () => {
    expect(buildStorageReport({ settings: { aiProvider: "gemini", llmMode: "off" } }).aiProvider).toBeNull();
    expect(buildStorageReport({})).toEqual({ bytes: {}, counts: { jobs: 0, answers: 0, intel: 0, ops: 0 }, hasResume: false, aiProvider: null });
    expect(approxBytes(undefined)).toBe(0);
  });
  it("keeps the AI request counter with settings", () => {
    const stored = ["profile", "settings", "answers", "jobs", "needs", "ops", "intel", "aiUsage", "sheetMeta"];
    expect(keysToClear(stored, ["profile", "answers", "settings"])).toEqual(["jobs", "needs", "ops", "intel", "sheetMeta"]);
    expect(keysToClear(stored, [])).toEqual(stored);
  });
});

describe("wipe", () => {
  beforeEach(async () => {
    for (const k of Object.keys(fake.mem)) delete fake.mem[k];
    fake.removedTabs.length = 0;
    Object.assign(fake.mem, {
      profile: { firstName: "Ada", email: "ada@example.com" },
      answers,
      settings: { llmMode: "draft", aiProvider: "groq", apiKeys: { groq: "gsk_x", gemini: "AIza_y" }, onboarded: true },
      jobs: [job("j1", { status: "running", tabId: 11, autoTab: true }), job("j2", { status: "needs_you", tabId: 12, autoTab: false }), job("j3")],
      needs: [{ id: "n", jobId: "j1", kind: "question", prompt: "?", frameId: 0, createdAt: 1 }],
      ops: [{ id: "o", t: 1, kind: "launch", text: "x" }],
      intel: [{ id: "i" }],
      aiUsage: { day: "2026-10-12", counts: { groq: 3 } },
      gmailToken: "secret",
    });
    // Sync the background's cache with the fresh storage contents.
    const s = (await getState()) as unknown as Record<string, unknown>;
    for (const k of ["profile", "answers", "jobs", "needs", "ops", "intel"]) s[k] = JSON.parse(JSON.stringify(fake.mem[k]));
    s.settings = normalizeSettings(fake.mem.settings);
  });

  it("clears application history but keeps profile, answers and settings", async () => {
    const res = await wipeAll(["profile", "answers", "settings"]);
    expect(res.closedTabs).toBe(1);
    expect(fake.removedTabs).toEqual([11]); // only the tab the extension opened
    expect(Object.keys(fake.mem).sort()).toEqual(["aiUsage", "answers", "profile", "settings"]);
    expect(res.cleared.sort()).toEqual(["gmailToken", "intel", "jobs", "needs", "ops"]);
    const s = await getState();
    expect(s.jobs).toEqual([]);
    expect(s.needs).toEqual([]);
    expect(s.ops).toEqual([]);
    expect(s.intel).toEqual([]);
    expect(s.profile.firstName).toBe("Ada");
    expect(s.settings.apiKeys.groq).toBe("gsk_x");
  });

  it("erases everything, resetting the cache to defaults", async () => {
    await wipeAll([]);
    expect(Object.keys(fake.mem)).toEqual([]);
    const s = await getState();
    expect(s.profile.firstName).toBe("");
    expect(s.answers).toEqual([]);
    expect(s.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("forgets AI keys only", async () => {
    expect(await forgetAiKeys()).toEqual({ removed: 2 });
    const s = await getState();
    expect(s.settings.apiKeys).toEqual({});
    expect(s.settings.aiProvider).toBe("groq");
    expect((fake.mem.settings as { apiKeys: object }).apiKeys).toEqual({});
    expect(fake.mem.jobs).toHaveLength(3);
  });
});
