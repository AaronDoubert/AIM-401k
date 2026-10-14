import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadEmbedder, type StaticEmbedder } from "../src/core/embed";
import { daysIn, FAMILY_BY_ID, ordinalIn } from "../src/core/families";
import { resolveField } from "../src/core/matcher";
import { classify, recall, rememberedEntry, resolveSmart, settledNeeds } from "../src/core/smart";
import type { AnswerEntry, Need } from "../src/shared/types";
import { ctx, field, profile } from "./helpers";

let e: StaticEmbedder;
beforeAll(() => {
  const dir = join(__dirname, "..", "static", "models");
  const buf = readFileSync(join(dir, "m2v.bin"));
  e = loadEmbedder(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), readFileSync(join(dir, "m2v.vocab.txt"), "utf8"));
});

const ans = (question: string, answer: string, extra: Partial<AnswerEntry> = {}): AnswerEntry => ({
  id: question,
  question,
  answer,
  source: "user",
  updatedAt: 1,
  ...extra,
});

// Wordings that appear in no family's examples. null = belongs to no family.
const HELDOUT: [string, string | null][] = [
  ["Who was your employer prior to your current one?", "employer_n"],
  ["Name of the company you worked at before your latest job", "employer_n"],
  ["List the organization you were with before your present employer", "employer_n"],
  ["What was your title at your last job?", "title_n"],
  ["Position held at previous company", "title_n"],
  ["Are you comfortable working from our office 4 days a week?", "onsite_days"],
  ["Would you be able to be in the office Tuesday through Thursday?", "onsite_days"],
  ["This is an in-person role. Can you work on site full time?", "onsite_days"],
  ["Are you OK with being in the office most days?", "onsite_days"],
  ["Can you travel up to 30% of the time?", "travel"],
  ["Does travelling for work suit you?", "travel"],
  ["Have you ever worked for Syska Hennessy Group?", "worked_here"],
  ["Were you previously employed by our firm?", "worked_here"],
  ["Have you submitted an application to us in the past?", "applied_here"],
  ["Do you know anyone who works here who is a family member?", "relative_here"],
  ["Did someone at the company refer you?", "referred"],
  ["Can you get to our downtown office every day?", "commute"],
  ["What draws you to our firm?", "why_company"],
  ["Why are you applying to this position?", "why_company"],
  ["Are you a student right now?", "enrolled"],
  ["Have you signed any non-compete or non-solicitation agreements?", "non_compete"],
  ["Do you consent to a background investigation?", "background_check"],
  ["Are you available on Saturdays and Sundays?", "weekends"],
  ["How many hours can you work weekly?", "hours"],
  ["What is your availability for a summer 2027 internship?", "internship_dates"],
  ["Describe yourself in a few sentences", "about_you"],
  ["Given name(s)", "first_name"],
  ["Surname / family name", "last_name"],
  ["Mobile phone", "phone"],
  ["E-mail", "email"],
  ["LinkedIn", "linkedin"],
  ["Personal site", "portfolio"],
  ["Where do you live?", "location"],
  ["Town/City", "city"],
  ["Province/State", "state"],
  ["Zip", "postal"],
  ["Nation of residence", "country"],
  ["Present employer", "current_employer"],
  ["Present job title", "current_title"],
  ["How much experience do you have in years?", "years_experience"],
  ["Alma mater", "school"],
  ["Name of college or university", "school"],
  ["Education level", "degree"],
  ["Concentration", "field_of_study"],
  ["What are you majoring in?", "field_of_study"],
  ["Engineering specialty", "field_of_study"],
  ["Cumulative grade point average", "gpa"],
  ["Expected graduation", "grad_date"],
  ["Year of graduation", "grad_date"],
  ["Are you eligible for employment in the US?", "work_authorized"],
  ["Do you have unrestricted work authorization in the U.S.?", "work_authorized"],
  ["Will you need sponsorship for an employment visa?", "sponsorship"],
  ["Do you now or will you ever require immigration sponsorship?", "sponsorship"],
  ["Are you 18 or older?", "over_18"],
  ["Would you be willing to move?", "relocate"],
  ["Valid driving license?", "drivers_license"],
  ["Active security clearance level", "clearance"],
  ["Pay expectations", "salary"],
  ["What hourly wage are you looking for?", "salary"],
  ["When would you be available to begin?", "start_date"],
  ["How did you find out about this opening?", "how_heard"],
  ["Gender identity", "gender"],
  ["Ethnic background", "race"],
  ["Protected veteran status", "veteran"],
  ["Disability", "disability"],
  ["Languages you speak", "languages"],
  ["Relevant certifications", "certifications"],
  // Not in any family: should stay unmatched (or at most a low-confidence guess).
  ["Describe a challenging engineering project you worked on", null],
  ["What CAD software are you proficient in?", null],
  ["Upload your transcript", null],
  ["Please describe your experience with HVAC design", null],
  ["What is your favorite programming language and why?", null],
  ["Are you familiar with Revit?", null],
  ["Do you have a PE license?", null],
  ["Tell us about a time you failed", null],
  ["Which of our values resonates with you most?", null],
  ["Date of birth", null],
  ["Social security number", null],
  ["Emergency contact name", null],
  ["T-shirt size", null],
];

describe("embedder", () => {
  it("tokenizes like BERT WordPiece and returns unit vectors", () => {
    expect(e.dims).toBe(256);
    expect(e.tokenIds("Résumé").length).toBeGreaterThan(0);
    const v = e.embed("Previous employer");
    expect(Math.hypot(...v)).toBeCloseTo(1, 4);
    expect(e.embed("").every((x) => x === 0)).toBe(true);
  });

  it("puts paraphrases closer than unrelated questions", () => {
    const dot = (a: string, b: string) => e.embed(a).reduce((s, x, i) => s + x * e.embed(b)[i]!, 0);
    expect(dot("Field of study", "What are you majoring in?")).toBeGreaterThan(dot("Field of study", "Are you willing to relocate?"));
  });
});

describe("classify (held-out wordings)", () => {
  it("never makes a confident call on the wrong family", () => {
    const wrong = HELDOUT.map(([q, want]) => ({ q, want, c: classify(q, e) })).filter((r) => r.c?.sure && r.c.family.id !== r.want);
    expect(wrong.map((r) => `${r.q} → ${r.c!.family.id}`)).toEqual([]);
  });

  it("puts the right family on top for most wordings", () => {
    const pos = HELDOUT.filter(([, want]) => want);
    const right = pos.filter(([q, want]) => classify(q, e)?.family.id === want).length;
    expect(right / pos.length).toBeGreaterThanOrEqual(0.8);
  });

  it("leaves questions outside every family unmatched", () => {
    const hits = HELDOUT.filter(([, want]) => !want).map(([q]) => ({ q, c: classify(q, e) })).filter((r) => r.c);
    expect(hits.map((r) => `${r.q} → ${r.c!.family.id} ${r.c!.score.toFixed(2)}`)).toEqual([]);
  });

  it("matches by pattern without the model", () => {
    expect(classify("Please list your previous employer (the one before your most recent)")?.family.id).toBe("employer_n");
    expect(classify("Position held at previous company")?.family.id).toBe("title_n");
    expect(classify("Can you come into the office at least 4x a week?")?.family.id).toBe("onsite_days");
    expect(classify("Discipline")).toBeNull();
  });

  it("skips patterns for essay prompts", () => {
    expect(classify("Describe your role in a previous project")?.family.id).toBeUndefined();
    expect(classify("Have you ever worked with Revit?")).toBeNull();
    expect(classify("Is your experience related to HVAC?")).toBeNull();
    expect(classify("Describe a time you worked overtime to meet a deadline")).toBeNull();
  });

  it("reads the employer's name as 'this company'", () => {
    expect(classify("Have you ever worked for Syska Hennessy Group?", null, [], "Syska Hennessy Group")?.family.id).toBe("worked_here");
    expect(classify("Have you ever worked for Syska Hennessy Group?")).toBeNull();
  });

  it("learns wordings the user answered", () => {
    expect(classify("Program of emphasis", e)?.family.id).not.toBe("field_of_study");
    const bank = [ans("Program of emphasis", "Mechanical Engineering", { family: "field_of_study" })];
    expect(classify("Program of emphasis", e, bank)).toMatchObject({ sure: true, family: { id: "field_of_study" } });
  });
});

describe("slots", () => {
  it("reads in-office days", () => {
    expect(daysIn("can you come into the office at least 4x a week")).toBe(4);
    expect(daysIn("three days per week in office")).toBe(3);
    expect(daysIn("are you able to work on site")).toBe(5);
    expect(daysIn("in the office twice a week")).toBe(2);
  });

  it("reads which past job is meant", () => {
    expect(ordinalIn("previous employer the one before your most recent", profile)).toEqual({ ordinal: 1, sure: true });
    expect(ordinalIn("current or most recent employer", profile)).toEqual({ ordinal: 0, sure: true });
    expect(ordinalIn("third most recent employer", profile)).toEqual({ ordinal: 2, sure: true });
    // Ada is currently employed, so a bare "previous" is probably the job before, but that's a guess.
    expect(ordinalIn("previous employer", profile)).toEqual({ ordinal: 1, sure: false });
  });
});

describe("resolveSmart: the questions from the screenshot", () => {
  it("previous employer (the one before your most recent) comes from work history", () => {
    const f = field("Please list your previous employer (the one before your most recent)");
    expect(resolveField(f, profile, [], ctx).type).toBe("unknown");
    expect(resolveSmart(f, profile, [], ctx, e)).toMatchObject({ value: "Babbage & Co", via: "family" });
  });

  it("a bare 'previous employer' is a suggestion, not a fill", () => {
    const r = resolveSmart(field("Previous employer"), profile, [], ctx, e);
    expect(r.value).toBeUndefined();
    expect(r.suggestions[0]).toMatchObject({ value: "Babbage & Co" });
  });

  it("an answer to a bare 'previous employer' doesn't override 'the one before your most recent'", () => {
    const bank = [ans("Previous employer", "Analytical Engines", { family: "employer_n", slots: {} })];
    expect(resolveSmart(field("Previous employer?"), profile, bank, ctx, e).value).toBe("Analytical Engines");
    const f = field("Please list your previous employer (the one before your most recent)");
    expect(resolveSmart(f, profile, bank, ctx, e).value).toBe("Babbage & Co");
  });

  it("in-office days: one answer covers less demanding wordings", () => {
    const q = field("Can you come into the office at least 4x a week?", { kind: "select", options: ["Yes", "No"] });
    const yes5 = [ans("This role is on-site 5 days a week. Are you able to work on site?", "Yes", { family: "onsite_days", slots: { days: 5 } })];
    expect(resolveSmart(q, profile, yes5, ctx, e)).toMatchObject({ value: "Yes" });
    const no3 = [ans("Are you able to work onsite 3 days per week?", "No", { family: "onsite_days", slots: { days: 3 } })];
    expect(resolveSmart(q, profile, no3, ctx, e)).toMatchObject({ value: "No" });
    // "Yes" to 2 days says nothing certain about 4: suggest, don't fill.
    const yes2 = [ans("In the office twice a week?", "Yes", { family: "onsite_days", slots: { days: 2 } })];
    const r = resolveSmart(q, profile, yes2, ctx, e);
    expect(r.value).toBeUndefined();
    expect(r.suggestions[0]?.value).toBe("Yes");
  });

  it("in-office days from the workplace preference", () => {
    const q = field("Can you come into the office at least 4x a week?");
    expect(resolveSmart(q, { ...profile, workplacePreference: "On-site" }, [], ctx, e).value).toBe("Yes");
    const remote = resolveSmart(q, { ...profile, workplacePreference: "Remote" }, [], ctx, e);
    expect(remote.value).toBeUndefined();
    expect(remote.suggestions[0]).toMatchObject({ value: "No" });
    expect(remote.family).toMatchObject({ id: "onsite_days", sure: true, slots: { days: 4 } });
  });

  it("'Discipline' reuses the answer given to any wording of field of study", () => {
    const noField = { ...profile, education: [{ ...profile.education[0]!, field: "" }] };
    const f = field("Discipline");
    expect(resolveField(f, noField, [], ctx).type).toBe("unknown");
    const bank = [ans("What is your major?", "Mechanical Engineering", { family: "field_of_study" })];
    expect(resolveSmart(f, noField, bank, ctx, e)).toMatchObject({ value: "Mechanical Engineering", via: "family" });
  });

  it("'Discipline' as a dropdown: the nearest option by meaning is suggested", () => {
    const p = { ...profile, education: [{ ...profile.education[0]!, field: "Mechanical Engineering" }] };
    const f = field("Discipline", { kind: "select", options: ["Electrical", "HVAC / Mechanical", "Plumbing / Fire Protection", "Structural"] });
    const r = resolveSmart(f, p, [], ctx, e);
    expect(r.value).toBeUndefined();
    expect(r.suggestions[0]?.value).toBe("HVAC / Mechanical");
  });
});

describe("resolveSmart: companies, details and similar answers", () => {
  it("worked here before: derived from work history, per company", () => {
    const f = field("Have you ever worked for Acme?", { kind: "radio", options: ["Yes", "No"] });
    expect(resolveSmart(f, profile, [], ctx, e)).toMatchObject({ value: "No", family: { id: "worked_here", company: "Acme" } });
    const babbage = field("Have you ever worked for Babbage & Co?", { kind: "radio", options: ["Yes", "No"] });
    expect(resolveSmart(babbage, profile, [], { ...ctx, company: "Babbage & Co" }, e).value).toBe("Yes");
  });

  it("another company's answer is only a suggestion", () => {
    const f = field("Do you have any relatives employed by the company?");
    const bank = [ans("Are you related to anyone at Initech?", "No", { family: "relative_here", company: "Initech" })];
    const r = resolveSmart(f, profile, bank, ctx, e);
    expect(r.value).toBeUndefined();
    expect(r.suggestions[0]).toMatchObject({ value: "No", why: expect.stringContaining("Initech") });
    const here = [ans("Any relatives at Acme?", "Yes", { family: "relative_here", company: "Acme" }), ...bank];
    expect(resolveSmart(f, profile, here, ctx, e).value).toBe("Yes");
  });

  it("work authorization answers are kept per country", () => {
    const f = field("Are you authorized to work in the United Kingdom?", { kind: "select", options: ["Yes", "No"] });
    const canada = [ans("Are you authorized to work in Canada?", "No", { family: "work_authorized", slots: { country: "canada" } })];
    expect(resolveSmart(f, profile, canada, ctx, e).value).toBeUndefined();
    const uk = [ans("Do you have the right to work in the UK?", "Yes", { family: "work_authorized", slots: { country: "united kingdom" } })];
    expect(resolveSmart(f, profile, uk, ctx, e).value).toBe("Yes");
  });

  it("reuses a saved answer to a near-identical wording", () => {
    const bank = [ans("What CAD software do you use?", "SolidWorks, AutoCAD")];
    expect(resolveSmart(field("Which CAD software do you use?"), profile, bank, ctx, e)).toMatchObject({ value: "SolidWorks, AutoCAD", via: "similar" });
  });

  it("but not when a number or a negation differs", () => {
    const bank = [ans("Do you have 5 years of Revit experience?", "Yes")];
    const r = resolveSmart(field("Do you have 3 years of Revit experience?"), profile, bank, ctx, e);
    expect(r.value).toBeUndefined();
    expect(r.suggestions[0]?.value).toBe("Yes");
  });

  it("suggests the closest saved answers when nothing is certain", () => {
    const bank = [ans("Describe your experience with HVAC load calculations", "Did Manual J calcs for 40 homes"), ans("Favorite color?", "Blue")];
    const r = resolveSmart(field("Tell us about your HVAC design experience", { kind: "textarea" }), profile, bank, ctx, e);
    expect(r.value).toBeUndefined();
    expect(r.suggestions.map((s) => s.value)).toEqual(["Did Manual J calcs for 40 homes"]);
  });

  it("drops suggestions that fit none of a dropdown's options", () => {
    const bank = [ans("What is your major?", "Underwater Basket Weaving", { family: "field_of_study" })];
    const f = field("Discipline", { kind: "select", options: ["Electrical", "Mechanical", "Structural"] });
    const noField = { ...profile, education: [{ ...profile.education[0]!, field: "" }] };
    expect(resolveSmart(f, noField, bank, ctx, e).suggestions).toEqual([]);
  });
});

describe("recall", () => {
  const fam = FAMILY_BY_ID.get("travel")!;
  const bank = [ans("Travel up to 25%?", "Yes", { family: "travel", slots: { percent: 25 } })];
  it("monotone families reason across thresholds", () => {
    expect(recall(bank, fam, { percent: 10 }, "")).toMatchObject({ value: "Yes", sure: true });
    expect(recall(bank, fam, { percent: 50 }, "")).toMatchObject({ value: "Yes", sure: false });
  });
});

describe("remember and settle", () => {
  const need = (over: Partial<Need>): Need => ({
    id: "n1",
    jobId: "j1",
    kind: "question",
    prompt: "Can you come into the office at least 4x a week?",
    frameId: 0,
    fieldKey: "k1",
    inputType: "choice",
    options: ["Yes", "No"],
    createdAt: 0,
    family: { id: "onsite_days", label: "In-office days", slots: { days: 4 }, sure: true },
    ...over,
  });
  const base = ans("Can you come into the office at least 4x a week?", "Yes");

  it("files the answer under a certain family", () => {
    expect(rememberedEntry(need({}), "Yes", base)).toMatchObject({ family: "onsite_days", slots: { days: 4 } });
  });

  it("files under an uncertain family only when the user took its suggestion", () => {
    const guess = need({ family: { id: "field_of_study", label: "Field of study", slots: {}, sure: false }, suggestions: [{ value: "Mathematics", why: "" }] });
    expect(rememberedEntry(guess, "Mathematics", base).family).toBe("field_of_study");
    expect(rememberedEntry(guess, "Something else", base).family).toBeUndefined();
  });

  it("settles the same question waiting in other tabs", () => {
    const bank = [rememberedEntry(need({}), "Yes", base)];
    const others = [
      need({ id: "n2", jobId: "j2", prompt: "Are you able to work onsite 3 days per week?", options: ["Yes, I can", "No"], family: { id: "onsite_days", label: "", slots: { days: 3 }, sure: true } }),
      need({ id: "n3", jobId: "j3", family: { id: "onsite_days", label: "", slots: { days: 5 }, sure: true } }),
      need({ id: "n4", jobId: "j4", family: { id: "onsite_days", label: "", slots: { days: 2 }, sure: false } }),
    ];
    expect(settledNeeds(others, bank).map((s) => [s.need.id, s.value])).toEqual([["n2", "Yes, I can"]]);
  });
});
