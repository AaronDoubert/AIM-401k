import type { Profile, Slots } from "../shared/types";
import { questionCountry, ruleValue, type FieldInfo, type JobCtx } from "./matcher";
import { norm } from "./text";

// Question families: the many wordings of one underlying question.
//
// A family says what a question *means*, so an answer can come from the
// profile or from a saved answer to any other wording of it. Families are
// recognized by a high-precision pattern first, then by similarity to their
// example wordings (see smart.ts). Slots are details in the wording that change
// the answer ("4 days a week", "the employer before your most recent", "Canada").
//
// Patterns count as certain, so they must be specific: an essay prompt that
// mentions "a previous company" must not get a company name (smart.ts skips
// patterns for essay prompts).
//
// The examples are authored here, once, and ship with the extension; they grow
// on each install from the wordings the user answers (saved answers carry their
// family, and become examples of it).

export type { Slots };

/** An answer worked out for a family; `sure` = safe to fill without asking. */
export interface Derived {
  value: string;
  sure: boolean;
  why: string;
}

export interface Family {
  id: string;
  /** Short name shown to the user ("Saved as: Field of study"). */
  label: string;
  examples: string[];
  /** Matched against the normalized label; a hit needs no model. */
  re?: RegExp;
  /** Answer from a matcher profile rule (by rule id). */
  rule?: string;
  /** Custom answer from the profile. */
  derive?: (p: Profile, s: Slots, ctx: JobCtx, label: string) => Derived | null;
  /** Pull the details that change the answer out of a (normalized) label. */
  slots?: (label: string, p: Profile) => Slots;
  /** Answers differ by employer ("Have you worked here before?"). */
  perCompany?: boolean;
  /**
   * A yes/no question about a threshold: yes at n days / n% implies yes at
   * anything less demanding, and no at n implies no at anything more.
   */
  monotone?: "days" | "percent";
}

// --- slot extraction ----------------------------------------------------------

const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, once: 1, twice: 2 };
const num = (w: string): number | undefined => (/^\d+$/.test(w) ? Number(w) : NUM[w]);

/** "4x a week", "three days per week", "5 days in office" → 4 / 3 / 5. No number → full time (5). */
export function daysIn(label: string): number {
  const m =
    /\b(\d|one|two|three|four|five|six|seven)\s*(?:x|times|days?)\b/.exec(label) ??
    /\b(once|twice)\b.*\bweek\b/.exec(label);
  const n = m ? num(m[1]!) : undefined;
  if (n && n >= 1 && n <= 7) return Math.min(n, 5);
  if (/\b(fully|full time|every day|daily|all week)\b/.test(label)) return 5;
  if (/\bhybrid\b/.test(label)) return 3;
  return 5;
}

export function percentIn(label: string): number | undefined {
  const m = /\b(\d{1,3})\s*(?:%|percent|pct)/.exec(label);
  return m ? Math.min(100, Number(m[1])) : undefined;
}

/**
 * Which past job a question means. "before your most recent" / "second" → 1;
 * "third" → 2; "current or previous" / "most recent" → 0. A bare "previous" is
 * the one before your current job if you have one, but that's a guess.
 */
export function ordinalIn(label: string, p: Profile): { ordinal: number; sure: boolean } {
  if (/\b(third|3rd)\b/.test(label)) return { ordinal: 2, sure: true };
  if (/\b(second|2nd)\b|\bbefore (your|the|my) (most recent|current|latest|last|present)\b|\bone before\b/.test(label)) return { ordinal: 1, sure: true };
  if (/\b(current|most recent|latest|present)\b/.test(label)) return { ordinal: 0, sure: true };
  return { ordinal: p.workHistory[0]?.current ? 1 : 0, sure: false };
}

// --- the families -------------------------------------------------------------

const PAST = "(previous|prior|former|past|last|second|2nd|third|3rd|earlier)";

/**
 * Only a certain position is a detail of the question: a saved answer to a
 * bare "previous employer" then covers that same ambiguous wording, not "the
 * one before your most recent".
 */
const pastJobSlot = (label: string, p: Profile): Slots => {
  const o = ordinalIn(label, p);
  return o.sure ? { ordinal: o.ordinal } : {};
};

export const FAMILIES: Family[] = [
  // Job history by position: the regex rules only know "current". Titles
  // first: "position at your previous company" is about the title.
  {
    id: "title_n",
    label: "Past job title",
    re: new RegExp(`\\b${PAST}( most recent)? (job )?(title|position|role)\\b|\\b(title|position|role)\\b.*\\b(at|with|in) ((your|my|the) )?${PAST} (employer|company|job)\\b|\\btitle\\b.*\\bbefore (your|the|my)\\b`),
    examples: [
      "Previous job title",
      "Title at your prior employer",
      "What was your role at your previous company?",
      "Former position",
      "Job title before your current role",
    ],
    slots: pastJobSlot,
    derive: (p, s, _ctx, l) => {
      const w = p.workHistory[s.ordinal ?? ordinalIn(l, p).ordinal];
      return w?.title ? { value: w.title, sure: s.ordinal !== undefined, why: "From your work history" } : null;
    },
  },

  {
    id: "employer_n",
    label: "Past employer",
    re: new RegExp(`\\b${PAST}( most recent)? (employer|company|organi[sz]ation|workplace)\\b|\\b(employer|company)\\b.*\\bbefore (your|the|my)\\b`),
    examples: [
      "Previous employer",
      "Please list your previous employer (the one before your most recent)",
      "Name of prior company",
      "Former employer",
      "Employer before your current one",
      "Second most recent employer",
      "Where did you work before your current job?",
      "Company name of your last position",
    ],
    slots: pastJobSlot,
    derive: (p, s, _ctx, l) => {
      const w = p.workHistory[s.ordinal ?? ordinalIn(l, p).ordinal];
      return w?.company ? { value: w.company, sure: s.ordinal !== undefined, why: "From your work history" } : null;
    },
  },
  // In-office / travel thresholds.
  {
    id: "onsite_days",
    label: "In-office days",
    re: /\b(office|on ?site|in person)\b.*\b(\d|one|two|three|four|five|once|twice)\b\s*(x|times|days?)?\b.*\bweek\b|\b(come|commute|report) (in)?to (the|our|an) office\b|\bwork (on ?site|in (the|our) office|in person)\b|\bin (the )?office\b.*\b(\d|four|five|three)\b/,
    examples: [
      "Can you come into the office at least 4x a week?",
      "Are you able to work onsite 3 days per week?",
      "This role requires being in the office five days a week. Are you comfortable with that?",
      "Are you willing to work in person at our office?",
      "Are you able to work on-site?",
      "Are you open to a hybrid schedule with 2 days in office?",
      "Can you commit to working from the office Monday through Friday?",
      "Is reporting to the office daily okay for you?",
    ],
    slots: (l) => ({ days: daysIn(l) }),
    monotone: "days",
    derive: (p, s) => {
      const pref = norm(p.workplacePreference);
      const d = s.days ?? 5;
      if (/on ?site|in office|office/.test(pref)) return { value: "Yes", sure: true, why: "You prefer on-site work" };
      if (/^any|flexible|open/.test(pref)) return { value: "Yes", sure: true, why: "You're open to any arrangement" };
      if (/hybrid/.test(pref)) return { value: d <= 3 ? "Yes" : "No", sure: false, why: "You prefer hybrid work" };
      if (/remote/.test(pref)) return { value: "No", sure: false, why: "You prefer remote work" };
      return null;
    },
  },
  {
    id: "travel",
    label: "Travel",
    re: /\b(willing|able|open|comfortable|ok|okay)\b.*\btravel\b|\btravel\b.*\b(\d{1,3}\s*%|percent|required|requirement)\b/,
    examples: [
      "Are you willing to travel up to 25% of the time?",
      "Is occasional travel okay?",
      "This position requires 50% travel. Are you able to meet this requirement?",
      "Are you comfortable with frequent business travel?",
    ],
    slots: (l) => ({ percent: percentIn(l) ?? (/\bfrequent|extensive|heavy\b/.test(l) ? 50 : 10) }),
    monotone: "percent",
  },

  // Facts about this employer: the answer changes per company.
  {
    id: "worked_here",
    label: "Worked here before",
    perCompany: true,
    // smart.ts reads the employer's own name in a question as "this company".
    re: /\b(previously|ever|formerly)\b.*\b(worked|been employed|employed|interned)\b.*\b(for|at|by) (us|this company|our (company|firm|organi[sz]ation)|the (company|firm|organi[sz]ation))\b|\bformer (employee|intern)\b|\bare you a (current|former) (employee|intern)\b/,
    examples: [
      "Have you previously worked for this company?",
      "Have you ever been employed by us before?",
      "Are you a former employee?",
      "Have you worked here in the past, including as a contractor or intern?",
    ],
    derive: (p, _s, ctx) => {
      const c = norm(ctx.company);
      if (!c) return null;
      const hit = p.workHistory.some((w) => {
        const n = norm(w.company);
        return n && (n.includes(c) || c.includes(n));
      });
      if (hit) return { value: "Yes", sure: true, why: "This company is in your work history" };
      return p.workHistory.length ? { value: "No", sure: true, why: "Not in your work history" } : null;
    },
  },
  {
    id: "applied_here",
    label: "Applied here before",
    perCompany: true,
    re: /\b(previously|ever|before)\b.*\bapplied\b/,
    examples: ["Have you applied to this company before?", "Have you previously applied for a position with us?", "Have you ever interviewed with us?"],
  },
  {
    id: "relative_here",
    label: "Relatives at the company",
    perCompany: true,
    re: /\brelatives?\b|\brelated to (anyone|someone|any employee|an employee)\b|\bfamily members?\b.*\b(work|employ)/,
    examples: [
      "Do you have any relatives employed by the company?",
      "Are you related to anyone who currently works here?",
      "Do any family members work for this organization?",
    ],
  },
  {
    id: "referred",
    label: "Referral",
    perCompany: true,
    re: /\b(were you|who) referred\b|\breferr(ed|al) by\b|\breferral name\b|\bemployee referral\b|\brefer(red)? you\b/,
    examples: ["Were you referred by a current employee?", "Referral name", "Who referred you?", "Did an employee refer you to this role?"],
  },
  {
    id: "commute",
    label: "Commute",
    perCompany: true,
    re: /\bcommut(e|ing)\b|\breliably (get|travel) to\b/,
    examples: ["Are you able to reliably commute to our office?", "Can you commute to this job's location?", "Do you live within commuting distance?"],
  },
  {
    id: "why_company",
    label: "Why this company",
    perCompany: true,
    examples: [
      "Why do you want to work here?",
      "Why are you interested in this role?",
      "What interests you about our company?",
      "Why do you want to join us?",
    ],
  },

  // One answer everywhere.
  {
    id: "enrolled",
    label: "Currently a student",
    re: /\b(currently|presently) (enrolled|a student|pursuing)\b|\bare you a (current )?student\b/,
    examples: ["Are you currently enrolled in a degree program?", "Are you a current student?", "Are you currently pursuing a degree?"],
    derive: (p) => {
      const end = p.education[0]?.endDate;
      if (!end) return null;
      const future = end.slice(0, 7) >= new Date().toISOString().slice(0, 7);
      return { value: future ? "Yes" : "No", sure: true, why: future ? "Your graduation date is ahead" : "You've graduated" };
    },
  },
  { id: "non_compete", label: "Non-compete", re: /non ?compete|non ?solicit|restrictive covenant/, examples: ["Are you subject to a non-compete agreement?", "Do you have any restrictive covenants with a current or former employer?"] },
  { id: "background_check", label: "Background check", re: /background (check|screening|investigation)/, examples: ["Are you willing to undergo a background check?", "Will you consent to a criminal background screening?"] },
  { id: "drug_test", label: "Drug test", re: /drug (test|screen)/, examples: ["Are you willing to take a drug test?", "Can you pass a pre-employment drug screening?"] },
  { id: "weekends", label: "Weekends / evenings / overtime", re: /^(are|can|could|would|will|do|is)\b.*\b(weekends?|evenings?|nights?|overtime|shifts?|on call)\b/, examples: ["Are you able to work weekends?", "Can you work evenings or overtime when needed?", "Are you available for on-call shifts?"] },
  { id: "hours", label: "Hours per week", re: /\bhours (per|a|each) week\b|\bfull time or part time\b/, examples: ["How many hours per week are you available?", "Are you seeking full-time or part-time work?"] },
  {
    id: "internship_dates",
    label: "Internship availability",
    re: /\b(summer|internship|co ?op)\b.*\b(availab|dates?|start|end|weeks?|months?)\b|\bavailab\w*\b.*\b(summer|internship|co ?op)\b/,
    examples: [
      "What dates are you available for the internship?",
      "Are you available for the full summer (June to August)?",
      "When can you start and end the co-op term?",
      "How many weeks are you available this summer?",
    ],
  },
  { id: "references", label: "References", re: /\breferences\b|\breference (name|contact|email|phone)\b/, examples: ["Please provide professional references", "Reference name and contact"] },
  { id: "about_you", label: "About you", examples: ["Tell us about yourself", "Briefly describe your background", "Give us a short summary of your experience"] },

  // Profile facts. The regex rules in matcher.ts catch the common wordings;
  // these catch the rest by meaning.
  { id: "first_name", label: "First name", rule: "firstName", examples: ["First name", "Given name", "Legal first name", "What is your first name?"] },
  { id: "last_name", label: "Last name", rule: "lastName", examples: ["Last name", "Surname", "Family name", "Legal last name"] },
  { id: "full_name", label: "Full name", rule: "fullName", examples: ["Full name", "Legal name", "Your name", "Full legal name"] },
  { id: "preferred_name", label: "Preferred name", rule: "preferredName", examples: ["Preferred name", "Nickname", "What name do you go by?", "What should we call you?"] },
  { id: "email", label: "Email", rule: "email", examples: ["Email", "Email address", "Contact email", "Where can we email you?"] },
  { id: "phone", label: "Phone", rule: "phone", examples: ["Phone number", "Mobile number", "Cell phone", "Best number to reach you"] },
  { id: "linkedin", label: "LinkedIn", rule: "linkedin", examples: ["LinkedIn profile", "LinkedIn URL"] },
  { id: "github", label: "GitHub", rule: "github", examples: ["GitHub", "GitHub profile URL"] },
  { id: "portfolio", label: "Website", rule: "portfolio", examples: ["Portfolio", "Personal website", "Link to your work samples", "Website URL"] },
  {
    id: "location",
    label: "Location",
    rule: "location",
    examples: ["Current location", "Where are you based?", "City and state of residence", "Where do you currently live?", "Location"],
  },
  { id: "city", label: "City", rule: "city", examples: ["City", "Town", "City of residence"] },
  { id: "state", label: "State", rule: "state", examples: ["State", "Province", "State or province"] },
  { id: "postal", label: "ZIP code", rule: "postal", examples: ["ZIP code", "Postal code", "Postcode"] },
  { id: "country", label: "Country", rule: "country", examples: ["Country", "Country of residence", "What country do you live in?"] },
  { id: "street", label: "Street address", rule: "street", examples: ["Street address", "Address line 1", "Home address", "Mailing address"] },
  {
    id: "current_employer",
    label: "Current employer",
    rule: "currentCompany",
    examples: ["Current employer", "Most recent company", "Where do you currently work?", "Name of current company", "Current or most recent employer"],
  },
  { id: "current_title", label: "Current title", rule: "currentTitle", examples: ["Current job title", "Current role", "What is your current position?", "Most recent title"] },
  {
    id: "years_experience",
    label: "Years of experience",
    rule: "years",
    examples: ["Years of experience", "How many years of professional experience do you have?", "Total years of relevant experience", "How long have you worked in this field?"],
  },
  { id: "school", label: "School", rule: "school", examples: ["School", "University", "College attended", "Which university did you attend?", "Name of institution"] },
  { id: "degree", label: "Degree", rule: "degree", examples: ["Degree", "Highest level of education", "Degree type", "What degree are you pursuing?"] },
  {
    id: "field_of_study",
    label: "Field of study",
    rule: "major",
    examples: ["Discipline", "Major", "Field of study", "Area of concentration", "Academic program", "What did you study?", "Engineering discipline", "Course of study"],
  },
  { id: "gpa", label: "GPA", rule: "gpa", examples: ["GPA", "Grade point average", "Cumulative GPA"] },
  {
    id: "grad_date",
    label: "Graduation",
    rule: "gradYear",
    examples: ["Graduation year", "Expected graduation date", "When do you graduate?", "Anticipated graduation", "Class year"],
  },
  {
    id: "work_authorized",
    label: "Work authorization",
    rule: "workAuthorized",
    re: /(legally )?(authori[sz]ed|eligible|permitted|entitled) to work|work authori[sz]ation|right to work|work permit/,
    slots: (l, p) => ({ country: questionCountry(l, p) }),
    examples: [
      "Are you legally authorized to work in the United States?",
      "Are you eligible to work in this country?",
      "Do you have the right to work here?",
      "Can you legally work for any employer?",
    ],
  },
  {
    id: "sponsorship",
    label: "Visa sponsorship",
    rule: "sponsorship",
    re: /\bsponsor/,
    slots: (l, p) => ({ country: questionCountry(l, p) }),
    examples: [
      "Will you now or in the future require visa sponsorship?",
      "Do you need an employer to sponsor your work visa?",
      "Will you require H-1B sponsorship?",
    ],
  },
  { id: "citizenship", label: "Citizenship", rule: "citizenship", examples: ["Citizenship", "Visa status", "What is your immigration status?", "Are you a US citizen?"] },
  { id: "over_18", label: "Over 18", rule: "over18", examples: ["Are you at least 18 years old?", "Are you of legal working age?", "Are you over the age of 18?"] },
  { id: "relocate", label: "Relocation", rule: "relocate", examples: ["Are you willing to relocate?", "Would you consider relocating for this role?", "Open to relocation?", "Would you move for this job?"] },
  { id: "drivers_license", label: "Driver's license", rule: "license", examples: ["Do you have a valid driver's license?", "Do you hold a current driving licence?"] },
  { id: "clearance", label: "Security clearance", rule: "clearance", examples: ["Security clearance", "Do you hold an active clearance?", "What level of clearance do you have?"] },
  {
    id: "workplace_pref",
    label: "Workplace preference",
    rule: "workplace",
    examples: ["Preferred work arrangement", "Remote, hybrid, or on-site?", "What work setting do you prefer?"],
  },
  { id: "desired_location", label: "Desired location", rule: "desiredLocation", examples: ["Preferred work location", "Which office would you like to work from?", "Desired locations"] },
  {
    id: "salary",
    label: "Salary",
    rule: "salary",
    examples: ["Desired salary", "Compensation expectations", "What are your salary requirements?", "Expected hourly rate", "Desired pay"],
  },
  {
    id: "start_date",
    label: "Start date",
    rule: "startDate",
    examples: ["When can you start?", "Earliest start date", "Notice period", "Date available", "How soon could you begin?"],
  },
  {
    id: "how_heard",
    label: "How you heard",
    rule: "howHeard",
    examples: ["How did you hear about this position?", "Source", "Where did you find this job?", "How did you learn about us?"],
  },
  { id: "pronouns", label: "Pronouns", rule: "pronouns", examples: ["Pronouns", "What are your pronouns?"] },
  { id: "gender", label: "Gender", rule: "gender", examples: ["Gender", "Gender identity", "Sex"] },
  { id: "race", label: "Race / ethnicity", rule: "race", examples: ["Race", "Ethnicity", "Race/ethnicity"] },
  { id: "hispanic", label: "Hispanic / Latino", rule: "hispanic", examples: ["Are you Hispanic or Latino?"] },
  { id: "veteran", label: "Veteran status", rule: "veteran", examples: ["Veteran status", "Are you a protected veteran?", "Have you served in the military?"] },
  { id: "disability", label: "Disability", rule: "disability", examples: ["Disability status", "Do you have a disability?"] },
  { id: "skills", label: "Skills", rule: "skills", examples: ["Skills", "Technical skills", "List your relevant skills"] },
  { id: "languages", label: "Languages", rule: "languages", examples: ["Languages", "What languages do you speak?", "Language proficiency"] },
  { id: "certifications", label: "Certifications", rule: "certifications", examples: ["Certifications", "Licenses and certifications", "Professional certifications"] },
];

export const FAMILY_BY_ID = new Map(FAMILIES.map((f) => [f.id, f]));

export function familySlots(fam: Family, label: string, p: Profile): Slots {
  return fam.slots ? fam.slots(norm(label), p) : {};
}

/** The family's answer from the profile, if it has one. */
export function deriveAnswer(fam: Family, field: FieldInfo, slots: Slots, p: Profile, ctx: JobCtx): Derived | null {
  if (fam.rule) {
    const v = ruleValue(fam.rule, field, p, ctx);
    return v ? { value: v, sure: true, why: "From your profile" } : null;
  }
  return fam.derive?.(p, slots, ctx, norm(field.label)) ?? null;
}
