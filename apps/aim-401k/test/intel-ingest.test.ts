import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntelItem, Job, OpsEvent, RawMail, Settings } from "../src/shared/types";

// A tiny in-memory `browser` so the background modules can run under vitest.
const fake = vi.hoisted(() => {
  const data: Record<string, unknown> = {};
  const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
  const ev = () => ({ addListener: () => undefined });
  type Changes = Record<string, { oldValue?: unknown; newValue?: unknown }>;
  const changed: ((c: Changes, area: string) => void)[] = [];
  const browser = {
    storage: {
      local: {
        get: async (keys?: string | string[] | null) => {
          const list = keys == null ? Object.keys(data) : Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, clone(data[k])]));
        },
        set: (obj: Record<string, unknown>) =>
          new Promise<void>((resolve) => {
            const c: Changes = {};
            for (const [k, v] of Object.entries(obj)) c[k] = { oldValue: clone(data[k]), newValue: clone(v) };
            Object.assign(data, clone(obj));
            // Like browsers (IPC): set() resolves in a later task, and the change
            // event arrives a little after that, often after the next write began.
            setTimeout(resolve, 0);
            setTimeout(() => changed.forEach((fn) => fn(clone(c), "local")), 4);
          }),
      },
      onChanged: { addListener: (fn: (c: Changes, area: string) => void) => void changed.push(fn) },
    },
    runtime: { sendMessage: async () => undefined, getURL: (p: string) => `moz-extension://test/${p}`, onMessage: ev() },
    alarms: { get: async () => undefined, create: () => undefined, clear: async () => true, onAlarm: ev() },
    notifications: { create: async (id: string, _opts: unknown) => id, onClicked: ev() },
    tabs: { query: async () => [], create: async () => ({ id: 1 }), sendMessage: async () => undefined, remove: async () => undefined },
    action: { setBadgeText: async () => undefined, setBadgeBackgroundColor: async () => undefined },
  };
  (globalThis as Record<string, unknown>).browser = browser;
  return { data, browser };
});

const ai = vi.hoisted(() => ({ ready: false, reply: { kind: "interview", company: "" } as { kind: string; company: string } | Error, calls: 0 }));
vi.mock("../src/background/ai", () => ({
  aiReady: () => ai.ready,
  completeJson: async () => {
    ai.calls++;
    if (ai.reply instanceof Error) throw ai.reply;
    return ai.reply;
  },
}));

const { ingest } = await import("../src/background/intel");
const { dispatch } = await import("../src/background/core");
const { getState, mutate } = await import("../src/background/store");
const { DEFAULT_SETTINGS } = await import("../src/shared/defaults");

const NOW = Date.now();
let n = 0;
const mail = (subject: string, snippet: string, from: string, fromEmail: string, ago = 3600_000): RawMail => ({ messageId: `m${++n}`, from, fromEmail, subject, snippet, receivedAt: NOW - ago });
const job = (id: string, company: string, title: string, status: Job["status"] = "submitted"): Job => ({
  id,
  url: `https://example.org/jobs/${id}`,
  company,
  title,
  location: "",
  ats: "",
  status,
  createdAt: NOW - 86400_000,
  updatedAt: NOW - 86400_000,
  appliedAt: status === "submitted" ? NOW - 86400_000 : null,
  lastProgressAt: NOW,
  notes: "",
  tabId: null,
  autoTab: false,
  aiDrafted: 0,
  log: [],
});

async function reset(patch: (s: Settings) => void = () => undefined): Promise<void> {
  await mutate((s) => {
    s.jobs = [job("globex", "Globex", "Data Engineer"), job("acme", "Acme Robotics", "Senior Platform Engineer"), job("initech", "Initech", "Backend Engineer", "offer")];
    s.intel = [];
    s.ops = [];
    s.needs = [];
    s.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Settings;
    patch(s.settings);
  });
  ai.ready = false;
  ai.calls = 0;
  ai.reply = { kind: "interview", company: "" };
}

const notified = vi.spyOn(fake.browser.notifications, "create");
const broadcasts = vi.spyOn(fake.browser.runtime, "sendMessage");

describe("intelIngest", () => {
  beforeEach(async () => {
    await reset();
    notified.mockClear();
    broadcasts.mockClear();
  });

  it("stores a matched interview email, moves the job, logs an intel ops line and pings", async () => {
    const r = await ingest("gmail-tab", [mail("Next steps", "Hi Ada, we'd love to schedule a phone screen with the Globex team.", "Globex Recruiting", "talent@globex.com")]);
    expect(r).toEqual({ enabled: true, added: 1, matched: 1, updated: 1 });
    const s = await getState();
    const g = s.jobs.find((j) => j.id === "globex")!;
    expect(g.status).toBe("interviewing");
    expect(g.log.at(-1)!.msg).toMatch(/^Email \(interview\): "Next steps" → interviewing/);
    expect(s.intel[0]).toMatchObject({ source: "gmail-tab", kind: "interview", jobId: "globex", company: "Globex", applied: true });
    expect(s.ops.map((o: OpsEvent) => [o.kind, o.text])).toContainEqual(["intel", 'INTEL · Globex · "Next steps" → CONTACT']);
    expect(notified).toHaveBeenCalledTimes(1);
    expect(notified.mock.calls[0]![1]).toMatchObject({ title: "CONTACT. Globex wants to talk", message: "Next steps" });
    expect(broadcasts).toHaveBeenCalledWith(expect.objectContaining({ type: "intel", items: expect.any(Array) }));
  });

  it("uses plain copy when chud is off", async () => {
    await reset((s) => (s.ui.chud = false));
    await ingest("outlook-tab", [mail("Next steps", "We'd love to schedule a call.", "Globex", "jobs@globex.com")]);
    expect((await getState()).ops.at(-1)!.text).toBe('Email · Globex · "Next steps" → Interview');
  });

  it("dedupes by source + message id and across sources by content", async () => {
    const m = mail("Thank you for applying to Acme Robotics", "We've received your application.", "Acme Robotics", "no-reply@us.greenhouse-mail.io");
    expect((await ingest("gmail-tab", [m])).added).toBe(1);
    expect((await ingest("gmail-tab", [m])).added).toBe(0);
    expect((await ingest("gmail-api", [{ ...m, messageId: "api-1" }])).added).toBe(0);
    expect((await getState()).intel).toHaveLength(1);
  });

  it("applies the newest email last, never downgrades an offer, and keeps unmatched job mail", async () => {
    await ingest("gmail-tab", [
      mail("Your application to Globex", "Unfortunately, we will not be moving forward with your application.", "Globex", "jobs@globex.com", 1000),
      mail("Thank you for applying to Globex", "We have received your application.", "Globex", "jobs@globex.com", 5 * 86400_000),
      mail("Initech update", "Thank you for your interest. Unfortunately we decided not to move forward.", "Initech", "hr@initech.com"),
      mail("Interview invitation", "We'd like to invite you to an interview. Book a time on calendly.com/ph", "Pied Piper", "jobs@piedpiper.com"),
      mail("Why your sourdough won't rise", "Today's highlights", "Medium", "noreply@medium.com"),
      mail("Next steps", "About your application with us.", "Hooli", "jobs@hooli.com"),
    ]);
    const s = await getState();
    expect(s.jobs.find((j) => j.id === "globex")!.status).toBe("rejected");
    expect(s.jobs.find((j) => j.id === "initech")!.status).toBe("offer");
    const pp = s.intel.find((i: IntelItem) => i.company === "Pied Piper");
    expect(pp).toMatchObject({ jobId: null, kind: "interview" });
    expect(s.intel.some((i: IntelItem) => i.from === "Medium")).toBe(false); // not about a job
    expect(s.intel.some((i: IntelItem) => i.from === "Hooli")).toBe(false); // weak and unmatched: noise
    expect(s.intel.map((i: IntelItem) => i.receivedAt)).toEqual([...s.intel.map((i: IntelItem) => i.receivedAt)].sort((a, b) => b - a));
    expect(s.ops.filter((o: OpsEvent) => o.kind === "intel").some((o: OpsEvent) => /NO TGT/.test(o.text))).toBe(true);
  });

  it("marks a received email as applied without touching jobs further along", async () => {
    await mutate((s) => {
      s.jobs.push(job("draft", "Stark Industries", "Engineer", "saved"));
    });
    await ingest("gmail-tab", [mail("Application received", "Thanks for applying to Stark Industries!", "Stark Industries", "careers@stark.com", 7200_000)]);
    const j = (await getState()).jobs.find((x) => x.id === "draft")!;
    expect(j.status).toBe("submitted");
    expect(j.appliedAt).toBe(NOW - 7200_000);
  });

  it("respects the switches: source off, autoStatus off, AFK", async () => {
    await reset((s) => {
      s.intel.gmailTab = false;
      s.intel.autoStatus = false;
      s.afk = true;
    });
    expect(await ingest("gmail-tab", [mail("x", "y", "Globex", "jobs@globex.com")])).toMatchObject({ enabled: false, added: 0 });
    const r = await ingest("outlook-tab", [mail("Offer letter", "We are pleased to offer you the role.", "Globex", "jobs@globex.com")]);
    expect(r).toMatchObject({ added: 1, matched: 1, updated: 0 });
    expect((await getState()).jobs.find((j) => j.id === "globex")!.status).toBe("submitted");
    expect(notified).not.toHaveBeenCalled();
  });

  it("asks the AI only about unclear job mail, and falls back when it fails", async () => {
    await reset((s) => (s.intel.useAi = true));
    ai.ready = true;
    ai.reply = { kind: "rejection", company: "Globex" };
    await ingest("gmail-tab", [
      mail("An update", "Hi Ada, regarding your application: the team went another direction.", "Recruiting", "no-reply@ashbyhq.com"),
      mail("Thank you for applying", "We received your application.", "Acme Robotics", "no-reply@us.greenhouse-mail.io"),
    ]);
    expect(ai.calls).toBe(1);
    let s = await getState();
    expect(s.intel.find((i: IntelItem) => i.subject === "An update")).toMatchObject({ kind: "rejection", jobId: "globex", confidence: 0.7 });
    expect(s.jobs.find((j) => j.id === "globex")!.status).toBe("rejected");

    ai.reply = new Error("rate limited");
    await ingest("gmail-tab", [mail("Following up", "Regarding your application with us.", "Acme Robotics", "no-reply@us.greenhouse-mail.io")]);
    s = await getState();
    expect(ai.calls).toBe(2);
    expect(s.intel.find((i: IntelItem) => i.subject === "Following up")).toBeUndefined(); // stayed "other"
  });

  it("never moves a job that's queued or mid-application (Workday account mail arrives mid-fill)", async () => {
    await mutate((s) => {
      s.jobs.push(job("wd", "Acme Corp", "Platform Engineer", "needs_you"), job("q", "Hooli", "SRE", "queued"));
    });
    await ingest("gmail-tab", [
      mail("Thank you for your interest in Acme Corp", "Your candidate account has been created.", "Acme Corp", "acmecorp@myworkday.com"),
      mail("Thanks for your interest in Hooli", "We've received your application.", "Hooli", "jobs@hooli.com"),
    ]);
    const s = await getState();
    expect(s.jobs.find((j) => j.id === "wd")!.status).toBe("needs_you");
    expect(s.jobs.find((j) => j.id === "q")!.status).toBe("queued");
    // Still recorded and matched, so the user can see it.
    expect(s.intel.filter((i) => i.jobId === "wd" || i.jobId === "q")).toHaveLength(2);
    expect(s.intel.every((i) => !i.applied)).toBe(true);
  });

  it("ignores mail older than the application and display-name-only rejections", async () => {
    await ingest("gmail-tab", [
      // 40 days old: about some earlier Globex role.
      mail("Your application to Globex", "Unfortunately, we will not be moving forward.", "Globex", "jobs@globex.com", 40 * 86400_000),
      // Freemail sender spoofing a display name.
      mail("Acme Robotics update", "We regret to inform you that we will not be moving forward.", "Acme Robotics Careers", "acme.careers@gmail.com"),
    ]);
    const s = await getState();
    expect(s.jobs.find((j) => j.id === "globex")!.status).toBe("submitted");
    expect(s.jobs.find((j) => j.id === "acme")!.status).toBe("submitted");
  });

  it("still applies rejections from the company's own domain or an ATS mailer", async () => {
    await ingest("gmail-tab", [
      mail("Your application", "Unfortunately, we have decided to move forward with other candidates.", "Acme Robotics", "no-reply@us.greenhouse-mail.io"),
      mail("Globex update", "Unfortunately, we will not be moving forward with your application.", "Globex Talent", "talent@globex.com"),
    ]);
    const s = await getState();
    expect(s.jobs.find((j) => j.id === "acme")!.status).toBe("rejected");
    expect(s.jobs.find((j) => j.id === "globex")!.status).toBe("rejected");
  });

  it("drops malformed input from the page", async () => {
    const r = await ingest("gmail-tab", [null, { messageId: "", subject: "x" }, { messageId: "ok", subject: 5 }, "junk"] as unknown as RawMail[]);
    expect(r.added).toBe(0);
  });
});

describe("store echoes", () => {
  beforeEach(() => reset());

  it("doesn't lose rapid successive writes to the same key", async () => {
    const { opsLog } = await import("../src/background/core");
    for (let i = 0; i < 12; i++) await opsLog("system", `line ${i}`);
    await ingest("gmail-tab", [mail("Next steps", "We'd love to schedule a phone screen.", "Globex", "jobs@globex.com")]);
    await ingest("outlook-tab", [mail("Offer letter", "We are pleased to offer you the role.", "Acme Robotics", "jobs@acmerobotics.com")]);
    await new Promise((r) => setTimeout(r, 50)); // let every echo arrive
    const cached = (await getState()).ops.map((o: OpsEvent) => o.text);
    const stored = (fake.data.ops as OpsEvent[]).map((o) => o.text);
    expect(cached.filter((t) => t.startsWith("line "))).toHaveLength(12);
    expect(cached.filter((t) => t.startsWith("INTEL"))).toHaveLength(2);
    expect(stored).toEqual(cached);
    expect((fake.data.intel as IntelItem[]).length).toBe(2);
  });
});

describe("intelAssign / getIntel", () => {
  beforeEach(() => reset());

  it("assigns an unmatched item to a job and applies its status", async () => {
    await ingest("outlook-tab", [mail("Interview invitation", "We'd like to invite you to an interview next week.", "Massive Dynamic", "talent@massivedynamic.com")]);
    const [item] = (await dispatch({ type: "getIntel" }, {} as never)) as IntelItem[];
    expect(item!.jobId).toBeNull();
    const res = (await dispatch({ type: "intelAssign", intelId: item!.id, jobId: "acme" }, {} as never)) as { ok: boolean; status?: string };
    expect(res).toMatchObject({ ok: true, status: "interviewing" });
    const s = await getState();
    expect(s.jobs.find((j) => j.id === "acme")!.status).toBe("interviewing");
    expect(s.intel[0]).toMatchObject({ jobId: "acme", company: "Acme Robotics", applied: true });
    const back = (await dispatch({ type: "intelAssign", intelId: item!.id, jobId: null }, {} as never)) as { ok: boolean };
    expect(back.ok).toBe(true);
    expect((await getState()).intel[0]!.jobId).toBeNull();
  });
});
