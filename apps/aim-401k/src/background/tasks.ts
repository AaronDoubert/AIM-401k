import { z } from "zod";
import type { DraftRequest, DraftResult } from "../shared/messages";
import type { AnswerEntry, Profile, Settings } from "../shared/types";
import { AiError, completeJson } from "./ai";

// The AI jobs AIM-401k runs: drafting answers to application questions and
// reading a resume into a profile.

const Draft = z.object({
  answer: z.string().describe("The exact text to put in the field. Empty if you cannot answer."),
  needs_human: z.boolean().describe("True if the candidate must answer this themselves."),
  reason: z.string().describe("One short sentence: why a human is needed, or what the answer is based on."),
});

const DRAFT_SYSTEM = `You fill out job applications on behalf of a candidate, one question at a time.

Rules:
- Use only facts from the candidate profile, resume, and saved answers. Never invent employers, dates, degrees, certifications, numbers, links, or personal circumstances.
- If the question asks for a fact you don't have, a legal attestation, a signature, references, or anything the candidate should personally decide, set needs_human to true and leave answer empty.
- For choice questions, answer must be exactly one of the listed options (for multi-select, options separated by "; ").
- For date questions, answer as YYYY-MM-DD.
- For free-text questions, write in the candidate's first-person voice, specific to this company and role, plain and professional with no clichés. Short fields: a phrase or one sentence. Long fields: 80-180 words unless the question asks otherwise.
- Never answer EEO / demographic questions differently from what the profile states.`;

// ---------------------------------------------------------------------------
// Privacy guard ("Redact contact details before sending to AI", on by default).
// An application question never needs the model to know how to reach you: the
// form fields for email/phone/address are filled from the profile directly.

/** Profile fields left out of AI prompts when redaction is on. */
export const REDACTED_FIELDS = ["email", "phone", "street", "addressLine2", "postalCode"] as const;

const EMAIL_RE = /[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/g;
// Phone shapes: international with a leading +, North American (with or
// without a country code), and 7-digit local numbers with a - or . separator.
// Dates ("2016-06", "2012 – 2016", "2026-10-12") don't match any of them.
const PHONE_RES = [
  /\+\d{1,3}(?:[\s.-]?\(?\d{1,4}\)?){2,5}(?!\d)/g,
  /(?<![\d+])(?:1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}(?!\d)/g,
  /(?<![\d+])\(\d{3}\)\d{3}\d{4}(?!\d)/g,
  /(?<![\d.-])\d{3}[.-]\d{4}(?![\d.-])/g,
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Replace email addresses and phone numbers in free text with [email] / [phone].
 * When the profile is given, its own street address and postal code are
 * replaced too wherever they appear verbatim (e.g. in the resume header).
 */
export function redactText(text: string, p?: Partial<Profile>): string {
  if (!text) return text;
  let out = text.replace(EMAIL_RE, "[email]");
  for (const re of PHONE_RES) {
    out = out.replace(re, (m) => {
      const digits = m.replace(/\D/g, "").length;
      return digits >= 7 && digits <= 15 ? "[phone]" : m;
    });
  }
  if (p) {
    for (const [value, label] of [
      [p.email, "[email]"],
      [p.phone, "[phone]"],
      [p.street, "[address]"],
      [p.addressLine2, "[address]"],
      [p.postalCode, "[postal code]"],
    ] as const) {
      const v = (value ?? "").trim();
      if (v.length >= 3) out = out.replace(new RegExp(`(?<![\\w])${escapeRe(v)}(?![\\w])`, "gi"), label);
    }
  }
  return out;
}

export interface FactsOptions {
  /** Privacy guard: omit contact fields and scrub emails/phones from free text. */
  redact?: boolean;
}

/** Profile facts worth giving the model (drops file data and EEO answers). */
export function candidateFacts(p: Profile, answers: AnswerEntry[], opts: FactsOptions = {}): string {
  const { resume: _r, resumeText: rawResume, coverLetterTemplate: _c, gender: _g, race: _ra, hispanicLatino: _h, veteranStatus: _v, disabilityStatus: _d, ...rest } = p;
  const scrub = (t: string) => (opts.redact ? redactText(t, p) : t);
  const hidden = new Set<string>(opts.redact ? REDACTED_FIELDS : []);
  const facts = Object.fromEntries(
    Object.entries(rest)
      .filter(([k, v]) => !hidden.has(k) && v !== "" && v != null && !(Array.isArray(v) && !v.length))
      .map(([k, v]) => [k, typeof v === "string" ? scrub(v) : k === "workHistory" ? p.workHistory.map((w) => ({ ...w, description: scrub(w.description) })) : v]),
  );
  const resumeText = scrub(rawResume);
  const saved = answers
    .filter((a) => a.source === "user")
    .slice(0, 40)
    .map((a) => `Q: ${a.question}\nA: ${scrub(a.answer)}`)
    .join("\n\n");
  return [
    `<profile>\n${JSON.stringify(facts, null, 2)}\n</profile>`,
    resumeText ? `<resume>\n${resumeText}\n</resume>` : "<resume>(not provided)</resume>",
    saved ? `<saved_answers>\n${saved}\n</saved_answers>` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function draftAnswer(req: DraftRequest, profile: Profile, answers: AnswerEntry[], settings: Settings): Promise<DraftResult> {
  const question = [
    `Question: ${req.question}`,
    `Field type: ${req.inputType}${req.required ? " (required)" : ""}`,
    req.options.length ? `Options:\n${req.options.map((o) => `- ${o}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const job = `<job>\nCompany: ${req.meta.company}\nTitle: ${req.meta.title}\nLocation: ${req.meta.location}\n\n${req.meta.description}\n</job>`;
  try {
    const facts = candidateFacts(profile, answers, { redact: settings.aiRedact });
    const out = await completeJson(settings, { schema: Draft, system: DRAFT_SYSTEM, context: [facts, job], prompt: question });
    const answer = out.answer.trim();
    return { answer: answer || null, needsHuman: out.needs_human || !answer, reason: out.reason };
  } catch (e) {
    return { answer: null, needsHuman: true, reason: e instanceof AiError ? `AI: ${e.message}` : `AI unavailable: ${String(e)}`.slice(0, 200) };
  }
}

const s = () => z.string();
export const ParsedResume = z.object({
  firstName: s(),
  middleName: s(),
  lastName: s(),
  email: s(),
  phone: s(),
  street: s(),
  city: s(),
  state: s(),
  postalCode: s(),
  country: s(),
  linkedin: s(),
  github: s(),
  portfolio: s(),
  summary: s().describe("2-3 sentence professional summary, from the resume's own summary if present"),
  skills: s().describe("Comma-separated skills"),
  certifications: s(),
  languages: s().describe("Spoken languages, comma-separated"),
  workHistory: z.array(
    z.object({
      company: s(),
      title: s(),
      location: s(),
      startDate: s().describe("YYYY-MM, or YYYY if only the year is given"),
      endDate: s().describe("YYYY-MM; empty if current"),
      current: z.boolean(),
      description: s().describe("The role's bullet points as plain text lines"),
    }),
  ),
  education: z.array(
    z.object({
      school: s(),
      degree: s().describe("e.g. Bachelor of Science"),
      field: s().describe("Major / field of study"),
      startDate: s(),
      endDate: s().describe("YYYY-MM graduation (or expected)"),
      gpa: s(),
    }),
  ),
});
export type ParsedResume = z.infer<typeof ParsedResume>;

const RESUME_SYSTEM = `You convert resume text into structured profile data.
Copy facts exactly as written; never guess or embellish. Use "" for anything not present. List jobs and schools most recent first. Dates: YYYY-MM (or YYYY when only a year is given); a job with "Present"/"Current" has current=true and endDate "".`;

export async function parseResumeWithAi(text: string, settings: Settings): Promise<ParsedResume> {
  // With the privacy guard on, the model reads a scrubbed copy; email and phone
  // are then filled back in from the original text, locally.
  const sent = settings.aiRedact ? redactText(text) : text;
  const out = await completeJson(settings, {
    schema: ParsedResume,
    system: RESUME_SYSTEM,
    context: [`<resume>\n${sent.slice(0, 60000)}\n</resume>`],
    prompt: "Extract the profile.",
    maxTokens: 8000,
  });
  if (settings.aiRedact) restoreContact(out, text);
  return out;
}

/** Put back the contact details the model only saw as [email] / [phone]. */
export function restoreContact(out: Pick<ParsedResume, "email" | "phone">, original: string): void {
  const email = original.match(new RegExp(EMAIL_RE.source))?.[0] ?? "";
  let phone = "";
  for (const re of PHONE_RES) {
    for (const m of original.match(new RegExp(re.source, "g")) ?? []) {
      const digits = m.replace(/\D/g, "").length;
      if (!phone && digits >= 7 && digits <= 15) phone = m.trim();
    }
  }
  if (!out.email || out.email.includes("[email]")) out.email = email;
  if (!out.phone || out.phone.includes("[phone]")) out.phone = phone;
}
