// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { gmailSelf, hashId, isDateOnly, isReadableView, parseGmail, parseMailDate, parseOutlook, providerFor, recentMails } from "../src/content/mailParse";
import { classify } from "../src/core/intel";

// Fixed "now" so the fixtures' dates stay inside/outside the 60-day window: Mon Oct 12 2026, 12:00 local.
const NOW = new Date(2026, 9, 12, 12, 0).getTime();
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

function load(name: string): void {
  const html = readFileSync(join(__dirname, "fixtures/mail", name), "utf8");
  document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, "");
}

describe("parseMailDate", () => {
  it("reads Gmail tooltips and list cells", () => {
    expect(parseMailDate("Sun, Oct 11, 2026, 4:12 PM", NOW)).toBe(at(2026, 10, 11, 16, 12));
    expect(parseMailDate("Mon, Oct 12, 2026, 9:02\u202fAM", NOW)).toBe(at(2026, 10, 12, 9, 2));
    expect(parseMailDate("2 Oct 2026, 15:45", NOW)).toBe(at(2026, 10, 2, 15, 45));
    expect(parseMailDate("Oct 3", NOW)).toBe(at(2026, 10, 3));
    expect(parseMailDate("9:14 AM", NOW)).toBe(at(2026, 10, 12, 9, 14));
    expect(parseMailDate("10/3/25", NOW)).toBe(at(2025, 10, 3));
  });
  it("reads Outlook formats", () => {
    expect(parseMailDate("Mon 10/12/2026 10:42 AM", NOW)).toBe(at(2026, 10, 12, 10, 42));
    expect(parseMailDate("Thu 10/8", NOW)).toBe(at(2026, 10, 8));
    expect(parseMailDate("Yesterday", NOW)).toBe(at(2026, 10, 11));
    expect(parseMailDate("Sat 3:15 PM", NOW)).toBe(at(2026, 10, 10, 15, 15));
    expect(parseMailDate("2026-10-01T08:30", NOW)).toBe(at(2026, 10, 1, 8, 30));
  });
  it("handles year rollover and non-dates", () => {
    expect(parseMailDate("Dec 30", NOW)).toBe(at(2025, 12, 30)); // can't be in the future
    expect(parseMailDate("11:30 PM", NOW)).toBe(at(2026, 10, 11, 23, 30)); // later than now → yesterday
    expect(parseMailDate("Next steps for your application", NOW)).toBeNull();
    expect(parseMailDate("", NOW)).toBeNull();
  });
  it("tells a date tooltip from a subject that mentions a time", () => {
    expect(isDateOnly("Mon 10/12/2026 10:42 AM")).toBe(true);
    expect(isDateOnly("Yesterday")).toBe(true);
    expect(isDateOnly("Interview at 10:30 tomorrow")).toBe(false);
  });
});

describe("helpers", () => {
  it("recognises mail hosts and skips non-inbox views", () => {
    expect(providerFor("mail.google.com")).toBe("gmail");
    expect(providerFor("outlook.office365.com")).toBe("outlook");
    expect(providerFor("outlook.live.com")).toBe("outlook");
    expect(providerFor("example.com")).toBeNull();
    expect(isReadableView("gmail", { hash: "#inbox", pathname: "/mail/u/0/" })).toBe(true);
    expect(isReadableView("gmail", { hash: "#sent", pathname: "/mail/u/0/" })).toBe(false);
    expect(isReadableView("outlook", { hash: "", pathname: "/mail/inbox" })).toBe(true);
    expect(isReadableView("outlook", { hash: "", pathname: "/mail/sentitems" })).toBe(false);
    expect(gmailSelf("Inbox (4) - ada@example.com - Gmail")).toBe("ada@example.com");
    expect(hashId("abc")).toBe(hashId("abc"));
    expect(hashId("abc")).not.toBe(hashId("abd"));
  });
});

describe("Gmail inbox list", () => {
  beforeEach(() => load("gmail-inbox.html"));

  it("parses every row into a RawMail", () => {
    const mails = parseGmail(document, NOW, gmailSelf(document.title));
    expect(mails).toHaveLength(11);
    const [first] = mails;
    expect(first).toEqual({
      messageId: "18b2f0c1a0000001",
      from: "Pied Piper",
      fromEmail: "no-reply@us.greenhouse-mail.io",
      subject: "Next steps for your application",
      snippet: expect.stringMatching(/^Hi Ada, thanks for applying to the Platform Engineer role! We'd love to schedule a 30-minute phone screen/),
      receivedAt: at(2026, 10, 11, 16, 12),
    });
  });

  it("picks the other party in a thread with the user, and the last message id", () => {
    const m = parseGmail(document, NOW, "ada@example.com").find((x) => x.subject.startsWith("Re: Technical interview"))!;
    expect(m.from).toBe("Umbrella Corp Recruiting");
    expect(m.fromEmail).toBe("talent@umbrellacorp.com");
    expect(m.messageId).toBe("18b2f0c1a00000a5");
  });

  it("falls back to thread ids and content hashes when legacy ids are missing", () => {
    const mails = parseGmail(document, NOW);
    const soylent = mails.find((m) => m.fromEmail === "jobs@soylent.com")!;
    expect(soylent.messageId).toMatch(/^1780551234567890009#\w+$/);
    const vandelay = mails.find((m) => m.from === "Vandelay Industries")!;
    expect(vandelay.messageId).toMatch(/^h:\w+$/);
    expect(vandelay.receivedAt).toBe(at(2026, 10, 2, 15, 45));
    // stable across re-parses (Gmail re-renders rows all the time)
    expect(parseGmail(document, NOW).find((m) => m.from === "Vandelay Industries")!.messageId).toBe(vandelay.messageId);
  });

  it("reads today's time-only rows and decodes entities", () => {
    const offer = parseGmail(document, NOW).find((m) => m.fromEmail === "people@cyberdyne.io")!;
    expect(offer.receivedAt).toBe(at(2026, 10, 12, 9, 2));
    expect(offer.subject).toBe("Offer letter — Cyberdyne Systems");
    const news = parseGmail(document, NOW).find((m) => m.fromEmail === "noreply@medium.com")!;
    expect(news.subject).toBe("Why your sourdough won't rise | 7 habits of calm people");
  });

  it("keeps the last 60 days only and classifies the job mail", () => {
    const recent = recentMails(parseGmail(document, NOW), NOW);
    expect(recent).toHaveLength(10);
    expect(recent.some((m) => m.from === "Initrode")).toBe(false);
    expect(recent[0]!.fromEmail).toBe("people@cyberdyne.io"); // newest first
    const kinds = Object.fromEntries(recent.map((m) => [m.from, classify(m).kind]));
    expect(kinds).toMatchObject({
      "Pied Piper": "interview",
      "Hooli Careers": "rejection",
      LinkedIn: "received",
      "Medium Daily Digest": "other",
      "Umbrella Corp Recruiting": "interview",
      "Wayne Enterprises": "received",
      "Tyrell Corporation Hiring Team": "assessment",
      "Miles Dyson": "offer",
      "Soylent Talent": "received",
      "Vandelay Industries": "other", // unknown sender, no hiring words…
    });
    // …but the same mail from a company the user applied to is an interview request.
    expect(classify(recent.find((m) => m.from === "Vandelay Industries")!, { known: true }).kind).toBe("interview");
  });

  it("still finds rows through the ARIA grid when Gmail's class names change", () => {
    for (const tr of document.querySelectorAll("tr.zA")) tr.className = "x1 y2";
    const mails = parseGmail(document, NOW);
    expect(mails).toHaveLength(11);
    expect(mails[1]!.subject).toBe("Your application to Hooli");
  });

  it("caps a scan at 100 rows", () => {
    const body = document.querySelector("tbody")!;
    const row = body.querySelector("tr.zA")!;
    for (let i = 0; i < 150; i++) {
      const r = row.cloneNode(true) as Element;
      r.querySelector("[data-legacy-last-message-id]")!.setAttribute("data-legacy-last-message-id", `x${i}`);
      body.append(r);
    }
    expect(recentMails(parseGmail(document, NOW), NOW)).toHaveLength(100);
  });
});

describe("Outlook web message list", () => {
  beforeEach(() => load("outlook-inbox.html"));

  it("parses options into RawMail with sender, subject, preview and time", () => {
    const mails = parseOutlook(document, NOW);
    expect(mails).toHaveLength(5);
    expect(mails[0]).toEqual({
      messageId: expect.stringMatching(/^AAQkADAwATM0MDAAMS1hYmNkLWVmZ2gALTAwAi0wMAoAEAA1#\w+$/),
      from: "Massive Dynamic Talent",
      fromEmail: "talent@massivedynamic.com",
      subject: "Interview invitation – Massive Dynamic",
      snippet: expect.stringMatching(/^Hi Ada, We'd like to invite you to a video interview/),
      receivedAt: at(2026, 10, 12, 10, 42),
    });
    expect(mails[1]).toMatchObject({ from: "Oscorp", fromEmail: "no-reply@hire.lever.co", subject: "Your application for Research Scientist", receivedAt: at(2026, 10, 12, 8, 5) });
  });

  it("handles the older markup (convid on a wrapper, plain-text sender)", () => {
    const m = parseOutlook(document, NOW).find((x) => x.from === "Aperture Science")!;
    expect(m.fromEmail).toBe("");
    expect(m.subject).toBe("Thank you for applying");
    expect(m.snippet).toMatch(/^We've received your application for Test Engineer/);
    expect(m.receivedAt).toBe(at(2026, 10, 8, 15, 30));
    expect(m.messageId).toMatch(/^AAQkADAwATM0MDAAMS1hYmNkLWVmZ2gALTAwAi0wMAoAEAA3#/);
  });

  it("keeps recent mail only and classifies it", () => {
    const recent = recentMails(parseOutlook(document, NOW), NOW);
    expect(recent.map((m) => m.from)).toEqual(["Massive Dynamic Talent", "Oscorp", "Aperture Science", "Contoso Rewards"]);
    expect(recent.map((m) => classify(m).kind)).toEqual(["interview", "rejection", "received", "other"]);
  });

  it("falls back to the accessible name when the inner markup is unknown", () => {
    const opt = document.querySelector('[role="option"]')!;
    opt.replaceChildren();
    const m = parseOutlook(document, NOW)[0]!;
    expect(m.subject).toMatch(/Massive Dynamic Talent Interview invitation/);
  });
});
