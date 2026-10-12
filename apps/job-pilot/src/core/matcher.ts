import type { AnswerEntry, Profile } from "../shared/types";
import { interpolate } from "../shared/util";
import { findAnswer } from "./answerBank";
import { chooseOption } from "./choose";
import { cleanLabel, norm } from "./text";

export type FieldKind =
  | "text"
  | "email"
  | "tel"
  | "url"
  | "number"
  | "date"
  | "textarea"
  | "select"
  | "radio"
  | "checkbox"
  | "checkboxGroup"
  | "file"
  | "combobox";

/** DOM-independent description of a form field, produced by the scanner. */
export interface FieldInfo {
  key: string;
  kind: FieldKind;
  label: string;
  /** name / id attributes, humanized */
  attrs: string;
  autocomplete: string;
  placeholder: string;
  required: boolean;
  options: string[];
}

export interface JobCtx {
  company: string;
  title: string;
}

export type Resolution =
  | { type: "value"; value: string; source: "profile" | "bank" | "template" }
  | { type: "resume" }
  | { type: "human"; kind: "question" | "consent" | "signature"; reason: string }
  | { type: "unknown" };

type ValueFn = (p: Profile, ctx: JobCtx) => string;

interface Rule {
  id: string;
  re: RegExp;
  value: ValueFn;
  /** Only apply to these kinds (default: any non-file). */
  kinds?: FieldKind[];
  /** Extra check against the normalized label; false = rule does not apply. */
  guard?: (label: string, p: Profile) => boolean;
}

const COUNTRIES = [
  "united states", "u s", "usa", "america", "canada", "united kingdom", "uk", "england", "britain", "ireland", "germany",
  "france", "netherlands", "spain", "italy", "poland", "portugal", "sweden", "switzerland", "eu", "european union", "europe",
  "india", "australia", "new zealand", "singapore", "japan", "mexico", "brazil", "israel", "philippines", "china",
];
const US_ALIASES = ["united states", "u s", "usa", "america", "united states of america"];

/** Work-eligibility answers only hold for the user's own country. */
const sameCountry = (label: string, p: Profile): boolean => {
  const mine = norm(p.country || "united states");
  const mineAliases = US_ALIASES.includes(mine) ? US_ALIASES : [mine];
  const padded = ` ${label} `;
  const mentioned = COUNTRIES.filter((c) => padded.includes(` ${c} `));
  return mentioned.length === 0 || mentioned.some((c) => mineAliases.includes(c));
};

const yn = (v: string): string => (v === "yes" ? "Yes" : v === "no" ? "No" : "");
const fullName: ValueFn = (p) => [p.firstName, p.lastName].filter(Boolean).join(" ");

// Order matters: the first matching rule wins.
const RULES: Rule[] = [
  { id: "preferredName", re: /preferred (first )?name|nick ?name|name you go by/, value: (p) => p.preferredName || p.firstName },
  { id: "firstName", re: /\b(first|given|legal first|fore) ?name\b|^first$/, value: (p) => p.firstName },
  { id: "lastName", re: /\b(last|family|legal last|sur) ?name\b|^last$/, value: (p) => p.lastName },
  { id: "fullName", re: /^(your )?(full |legal |complete )?name$|\bfull (legal )?name\b|^legal name/, value: fullName },
  { id: "email", re: /\be ?mail\b/, value: (p) => p.email },
  { id: "phone", re: /\b(phone|mobile|telephone|cell)\b(?! type)/, value: (p) => p.phone },
  { id: "linkedin", re: /linkedin/, value: (p) => p.linkedin },
  { id: "github", re: /github/, value: (p) => p.github },
  { id: "portfolio", re: /portfolio|personal (web ?site|site|url)|^web ?site( url)?$|other (website|link|url)/, value: (p) => p.portfolio || p.github || p.linkedin },
  { id: "pronouns", re: /pronoun/, value: (p) => p.pronouns },
  {
    id: "location",
    re: /^(current )?location|where are you (currently )?(located|based)|^city state|current city/,
    value: (p) => [p.city, p.state].filter(Boolean).join(", "),
  },
  { id: "street", re: /street|address line 1|^address( 1)?$|^mailing address$|^home address$/, value: (p) => p.street },
  { id: "city", re: /^city\b|\bcity$|^town$/, value: (p) => p.city },
  { id: "state", re: /^state\b|\bstate$|province|^region$|state province/, value: (p) => p.state },
  { id: "postal", re: /\bzip\b|postal|post code|postcode/, value: (p) => p.postalCode },
  { id: "country", re: /^country\b|\bcountry$|country of residence/, value: (p) => p.country },
  { id: "currentCompany", re: /(current|most recent|present) (company|employer)|^company( name)?$|^employer$/, value: (p) => p.currentCompany },
  { id: "currentTitle", re: /(current|most recent|present) (job )?(title|role|position)|^job title$|^title$/, value: (p) => p.currentTitle },
  {
    id: "years",
    re: /^(total )?years of (professional |relevant |work |industry )?experience$|^how many years of (professional |work |industry )?experience do you have$/,
    value: (p) => p.yearsExperience,
  },
  { id: "school", re: /\b(school|university|college|institution)\b/, value: (p) => p.school },
  { id: "degree", re: /\bdegree\b|level of education|highest education/, value: (p) => p.degree },
  { id: "major", re: /\bmajor\b|field of study|discipline|area of study/, value: (p) => p.major },
  { id: "gradYear", re: /graduat/, value: (p) => p.graduationYear },
  {
    id: "workAuthorized",
    re: /(legally )?(authori[sz]ed|eligible|permitted|entitled) to work|work authori[sz]ation|right to work|work permit/,
    value: (p) => yn(p.workAuthorized),
    guard: sameCountry,
  },
  { id: "sponsorship", re: /sponsor/, value: (p) => yn(p.requiresSponsorship), guard: sameCountry },
  { id: "over18", re: /\b(18|eighteen)\b.*(years|older|age)|at least 18|of legal age/, value: (p) => yn(p.over18) },
  { id: "relocate", re: /relocat/, value: (p) => yn(p.willingToRelocate) },
  { id: "salary", re: /salary|compensation|pay (expectation|requirement|range)|desired pay|expected pay/, value: (p) => p.salaryExpectation },
  { id: "startDate", re: /start date|available to start|earliest (start|availab)|notice period|when can you (start|begin)|availability to start/, value: (p) => p.startDate },
  { id: "howHeard", re: /how did you (hear|find|learn|come across)|where did you (hear|find|see)/, value: (p) => p.howDidYouHear },
  { id: "hispanic", re: /hispanic|latin[oax]/, value: (p) => p.hispanicLatino },
  { id: "gender", re: /\bgender\b|\bsex\b/, value: (p) => p.gender },
  { id: "race", re: /\brace\b|ethnicit/, value: (p) => p.race },
  { id: "veteran", re: /veteran|military|armed forces/, value: (p) => p.veteranStatus },
  { id: "disability", re: /disabilit/, value: (p) => p.disabilityStatus },
  {
    id: "coverLetter",
    re: /cover letter|letter of (interest|motivation)/,
    kinds: ["textarea"],
    value: (p, ctx) => interpolate(p.coverLetterTemplate, { ...ctx, firstName: p.firstName, lastName: p.lastName, name: fullName(p, ctx) }),
  },
];

const AUTOCOMPLETE: Record<string, ValueFn> = {
  "given-name": (p) => p.firstName,
  "family-name": (p) => p.lastName,
  name: fullName,
  nickname: (p) => p.preferredName || p.firstName,
  email: (p) => p.email,
  tel: (p) => p.phone,
  "tel-national": (p) => p.phone,
  "street-address": (p) => p.street,
  "address-line1": (p) => p.street,
  "address-level2": (p) => p.city,
  "address-level1": (p) => p.state,
  "postal-code": (p) => p.postalCode,
  country: (p) => p.country,
  "country-name": (p) => p.country,
  organization: (p) => p.currentCompany,
  "organization-title": (p) => p.currentTitle,
  url: (p) => p.portfolio || p.linkedin,
};

const SIGNATURE_RE = /\b(e ?)?signature\b|sign (your name|here|below)|type your (full )?(legal )?name to sign|electronically sign/;
const CONSENT_RE = /\b(i )?(certify|attest|acknowledge|agree|consent|understand|confirm|accept)\b|terms (of|and)|privacy (policy|notice)|true and (complete|accurate)/;
const RESUME_RE = /resume|résumé|\bcv\b|curriculum/;

export function matchRule(field: FieldInfo, profile: Profile): Rule | null {
  const label = norm(cleanLabel(field.label));
  const hay = label || norm(`${field.attrs} ${field.placeholder}`);
  if (!hay) return null;
  for (const r of RULES) {
    if (r.kinds && !r.kinds.includes(field.kind)) continue;
    if (r.re.test(hay) && (!r.guard || r.guard(hay, profile))) return r;
  }
  return null;
}

/** Turn a desired answer into something valid for this field (option text for choices). */
export function fitToField(field: FieldInfo, value: string): string | null {
  if (!value) return null;
  if (field.kind === "select" || field.kind === "radio" || field.kind === "combobox") {
    if (!field.options.length) return value; // combobox options only appear after typing
    const i = chooseOption(value, field.options);
    return i >= 0 ? field.options[i] ?? null : null;
  }
  if (field.kind === "checkbox") {
    const v = norm(value);
    if (["yes", "true", "checked", "agree", "on", "1"].includes(v)) return "checked";
    if (["no", "false", "unchecked", "off", "0"].includes(v)) return "unchecked";
    return null;
  }
  if (field.kind === "checkboxGroup") {
    // answers stored as "a; b; c"
    const picks = value
      .split(/\s*;\s*/)
      .map((v) => chooseOption(v, field.options))
      .filter((i) => i >= 0)
      .map((i) => field.options[i]!);
    return picks.length ? picks.join("; ") : null;
  }
  return value;
}

/**
 * Decide what to do with a field using only local knowledge (profile + saved
 * answers). Anything returning "unknown" may go to the AI drafter or the human.
 */
export function resolveField(field: FieldInfo, profile: Profile, bank: AnswerEntry[], ctx: JobCtx): Resolution {
  const label = norm(cleanLabel(field.label));

  if (field.kind === "file") {
    const hay = `${label} ${norm(field.attrs)}`;
    if (RESUME_RE.test(hay) || (!/cover/.test(hay) && profile.resume)) {
      return profile.resume ? { type: "resume" } : { type: "human", kind: "question", reason: "No resume file saved in your profile" };
    }
    return { type: "unknown" };
  }

  if (SIGNATURE_RE.test(label)) {
    const saved = findAnswer(field.label, bank);
    if (saved) return { type: "value", value: saved.answer, source: "bank" };
    return { type: "human", kind: "signature", reason: "Signature / attestation" };
  }

  if (field.kind === "checkbox" && CONSENT_RE.test(label)) {
    const saved = findAnswer(field.label, bank);
    if (saved && fitToField(field, saved.answer)) return { type: "value", value: saved.answer, source: "bank" };
    return { type: "human", kind: "consent", reason: "Needs your agreement" };
  }

  // Saved answers beat generic profile rules: they're the user's explicit choice
  // for this exact wording.
  const saved = findAnswer(field.label, bank);
  if (saved) {
    const fitted = fitToField(field, saved.answer);
    if (fitted) return { type: "value", value: fitted, source: "bank" };
  }

  const ac = field.autocomplete.split(/\s+/).pop() ?? "";
  const acFn = AUTOCOMPLETE[ac];
  if (acFn && field.kind !== "checkbox") {
    const fitted = fitToField(field, acFn(profile, ctx));
    if (fitted) return { type: "value", value: fitted, source: "profile" };
  }

  const rule = matchRule(field, profile);
  if (rule) {
    const fitted = fitToField(field, rule.value(profile, ctx));
    if (fitted) return { type: "value", value: fitted, source: rule.id === "coverLetter" ? "template" : "profile" };
  }

  return { type: "unknown" };
}
