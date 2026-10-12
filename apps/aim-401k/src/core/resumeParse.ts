import { EMPTY_EDU, EMPTY_WORK } from "../shared/defaults";
import type { EducationEntry, Profile, WorkEntry } from "../shared/types";
import { isPresent, parseDate, toIso } from "./dates";

// Turns resume text into profile fields without any AI. It is deliberately
// conservative: anything it isn't fairly sure about is left empty for the
// review screen (or the optional AI pass) to fill.

export type ResumeData = Partial<Omit<Profile, "workHistory" | "education">> & {
  workHistory?: WorkEntry[];
  education?: EducationEntry[];
};

const SECTION_NAMES: Record<string, RegExp> = {
  summary: /^(professional |career )?(summary|profile|objective|about( me)?)$/,
  experience: /^(professional |work |relevant |employment )?(experience|employment|history|work history|employment history)$/,
  education: /^(education|academic background|education (and|&) training)$/,
  skills: /^(technical |core |key )?(skills|competencies|technologies|skills (and|&) (tools|technologies))$/,
  certifications: /^(certifications?|licenses( (and|&) certifications)?)$/,
  languages: /^languages?$/,
  projects: /^(projects|selected projects|personal projects)$/,
  other: /^(awards|honors|publications|volunteer(ing)?( experience)?|interests|references|activities|leadership)$/,
};

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const DATE = `(?:${MONTH}\\s+\\d{4}|\\d{1,2}/\\d{4}|\\d{4}-\\d{2}|\\d{4})`;
const END = `(?:${DATE}|present|current|now|today)`;
const RANGE_RE = new RegExp(`(${DATE})\\s*(?:-|–|—|to|until)\\s*(${END})`, "i");
const SINGLE_DATE_RE = new RegExp(`\\b(${DATE})\\b`, "i");

const BULLET_RE = /^\s*[•▪◦●\-*–·]\s*/;
const COMPANY_HINT = /\b(inc|llc|ltd|corp|corporation|co|company|gmbh|plc|group|labs?|technologies|systems|solutions|university|agency|bank)\b\.?/i;
const SCHOOL_HINT = /\b(university|college|institute|school|academy|polytechnic)\b/i;
const DEGREE_HINT =
  /\b(bachelor|master|associate|doctor|ph\.?\s?d|mba|b\.?\s?s\.?c?|m\.?\s?s\.?c?|b\.?\s?a|m\.?\s?a|b\.?\s?eng|m\.?\s?eng|bfa|mfa|jd|md|diploma|certificate|ged|high school)\b/i;
const CITY_STATE = /\b([A-Z][a-zA-Z.'\- ]{1,30}),\s*([A-Z]{2}|[A-Z][a-z]+(?: [A-Z][a-z]+)?)\b(?:\s+(\d{5}))?/;

function headingOf(line: string): string | null {
  const t = line.trim().replace(/[:\s]+$/, "");
  if (!t || t.length > 40 || /\d{3}/.test(t)) return null;
  const n = t.toLowerCase().replace(/[^a-z& ]/g, "").replace(/\s+/g, " ").trim();
  for (const [name, re] of Object.entries(SECTION_NAMES)) if (re.test(n)) return name;
  return null;
}

function splitSections(lines: string[]): { header: string[]; sections: Record<string, string[]> } {
  const sections: Record<string, string[]> = {};
  const header: string[] = [];
  let cur: string | null = null;
  for (const line of lines) {
    const h = headingOf(line);
    if (h) {
      cur = h;
      sections[cur] ??= [];
      continue;
    }
    if (cur) sections[cur]!.push(line);
    else header.push(line);
  }
  return { header, sections };
}

function ym(s: string): string {
  if (isPresent(s)) return "";
  const d = parseDate(s.replace(/\.$/, ""));
  return d ? toIso({ y: d.y, ...(d.m ? { m: d.m } : {}) }) : "";
}

/** Split "Title — Company, City, ST" style text into its pieces. */
function pieces(s: string): string[] {
  return s
    .split(/\s*(?:\||—|–|·|•|\t| {3,}| - | at |, (?=[A-Z][a-z]+,? [A-Z]{2}\b))\s*/)
    .map((p) => p.replace(/^[,;\s]+|[,;\s]+$/g, "").trim())
    .filter(Boolean);
}

function parseWork(lines: string[]): WorkEntry[] {
  const clean = lines.map((l) => l.trim()).filter(Boolean);
  const anchors = clean.map((l, i) => (RANGE_RE.test(l) && !BULLET_RE.test(l) ? i : -1)).filter((i) => i >= 0);
  // Each entry's header = up to 2 short non-bullet lines right above its date line.
  const headStart = anchors.map((ai, k) => {
    const floor = k > 0 ? anchors[k - 1]! + 1 : 0;
    let h = ai;
    while (h > floor && ai - h < 2 && !BULLET_RE.test(clean[h - 1]!) && clean[h - 1]!.length < 90) h--;
    // The previous entry needs at least its own body; never steal its first line when it has no bullets.
    return k > 0 && h === floor && ai - floor > 1 ? h + 1 : h;
  });
  return anchors.map((ai, k) => {
    const line = clean[ai]!;
    const m = line.match(RANGE_RE)!;
    const rest = line.replace(m[0], " ").replace(/[()]/g, " ");
    const parts = [...clean.slice(headStart[k], ai).flatMap(pieces), ...pieces(rest)];
    const location = parts.find((p) => CITY_STATE.test(p) || /^remote$/i.test(p)) ?? "";
    const names = parts.filter((p) => p !== location);
    let [title = "", company = ""] = names;
    if (COMPANY_HINT.test(title) && !COMPANY_HINT.test(company)) [title, company] = [company, title];
    const bodyEnd = k + 1 < anchors.length ? headStart[k + 1]! : clean.length;
    const description = clean
      .slice(ai + 1, bodyEnd)
      .map((l) => l.replace(BULLET_RE, "").trim())
      .join("\n");
    return {
      ...EMPTY_WORK,
      title,
      company,
      location,
      startDate: ym(m[1]!),
      endDate: ym(m[2]!),
      current: isPresent(m[2]!),
      description,
    };
  });
}

function parseEducation(lines: string[]): EducationEntry[] {
  const out: EducationEntry[] = [];
  const clean = lines.map((l) => l.trim()).filter(Boolean);
  let cur: EducationEntry | null = null;
  for (const line of clean) {
    if (BULLET_RE.test(line) && !DEGREE_HINT.test(line)) continue;
    const range = line.match(RANGE_RE);
    const single = !range ? line.match(SINGLE_DATE_RE) : null;
    const gpa = line.match(/\bGPA:?\s*([0-4]\.\d{1,2})/i);
    const text = line.replace(range?.[0] ?? single?.[0] ?? "", " ").replace(/\bGPA:?\s*[0-4]\.\d{1,2}(\s*\/\s*4\.0)?/i, " ");
    const ps = pieces(text);
    const school = ps.find((p) => SCHOOL_HINT.test(p));
    const degreePart = ps.find((p) => DEGREE_HINT.test(p) && p !== school);
    if (school && (!cur || cur.school)) {
      cur = { ...EMPTY_EDU, school };
      out.push(cur);
    } else if (school && cur) cur.school = school;
    if (degreePart) {
      if (!cur) {
        cur = { ...EMPTY_EDU };
        out.push(cur);
      }
      const [deg, field] = degreePart.split(/\s+in\s+(?=[A-Z])|,\s*/);
      if (!cur.degree) {
        cur.degree = (deg ?? degreePart).trim();
        if (field && !cur.field) cur.field = field.trim();
      }
    }
    if (cur) {
      if (range) {
        cur.startDate = ym(range[1]!);
        cur.endDate = ym(range[2]!);
      } else if (single && !cur.endDate) cur.endDate = ym(single[1]!);
      if (gpa) cur.gpa = gpa[1]!;
    }
  }
  return out.filter((e) => e.school || e.degree);
}

function listText(lines: string[]): string {
  return lines
    .map((l) => l.replace(BULLET_RE, "").replace(/^[A-Za-z /&]+:\s*/, "").trim())
    .join(", ")
    .split(/\s*[,•|·;]\s*/)
    .filter((s) => s && s.length < 60)
    .filter((s, i, a) => a.indexOf(s) === i)
    .join(", ");
}

export function parseResumeText(text: string): ResumeData {
  const lines = text.replace(/\r/g, "").split("\n");
  const { header, sections } = splitSections(lines);
  const all = text;
  const top = (header.length ? header : lines.slice(0, 8)).map((l) => l.trim()).filter(Boolean);
  const out: ResumeData = {};

  const email = all.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (email) out.email = email[0];
  const phone = all.match(/(?:\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/);
  if (phone) out.phone = phone[0].trim();
  const url = (re: RegExp) => {
    const m = all.match(re);
    return m ? (m[0].startsWith("http") ? m[0] : `https://${m[0]}`).replace(/[).,;]+$/, "") : "";
  };
  out.linkedin = url(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[\w\-%]+\/?/i);
  out.github = url(/(?:https?:\/\/)?(?:www\.)?github\.com\/[\w-]+\/?/i);
  const other = (all.match(/(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.(?:dev|io|me|com|net|org|design|site|page)(?:\/[\w\-./]*)?/gi) ?? []).find(
    (u) => !/linkedin|github|gmail|yahoo|outlook|hotmail|icloud|proton/i.test(u) && !all.includes(`@${u}`),
  );
  if (other) out.portfolio = other.startsWith("http") ? other : `https://${other}`;

  const nameLine = top.find((l) => /^[A-Z][a-zA-Z'’.-]+(?:\s+[A-Z][a-zA-Z'’.-]*){1,3}$/.test(l) && !headingOf(l) && l.length < 40);
  if (nameLine) {
    const parts = nameLine.split(/\s+/);
    out.firstName = parts[0]!;
    out.lastName = parts[parts.length - 1]!;
    if (parts.length > 2) out.middleName = parts.slice(1, -1).join(" ");
  }

  for (const l of top) {
    const m = l.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/, "").match(CITY_STATE);
    if (m && !/university|college/i.test(m[1]!)) {
      out.city = m[1]!.trim().replace(/^.*[|•·]\s*/, "");
      out.state = m[2]!;
      if (m[3]) out.postalCode = m[3];
      break;
    }
  }

  if (sections.summary) out.summary = sections.summary.map((l) => l.trim()).filter(Boolean).join(" ");
  if (sections.experience) out.workHistory = parseWork(sections.experience);
  if (sections.education) out.education = parseEducation(sections.education);
  if (sections.skills) out.skills = listText(sections.skills);
  if (sections.certifications) out.certifications = listText(sections.certifications);
  if (sections.languages) out.languages = listText(sections.languages);
  out.resumeText = text.trim();
  return out;
}

// ---------------------------------------------------------------------------
// JSON Resume (https://jsonresume.org/schema)

interface JsonResume {
  basics?: {
    name?: string;
    email?: string;
    phone?: string;
    url?: string;
    summary?: string;
    label?: string;
    location?: { address?: string; postalCode?: string; city?: string; region?: string; countryCode?: string };
    profiles?: { network?: string; url?: string; username?: string }[];
  };
  work?: { name?: string; company?: string; position?: string; location?: string; startDate?: string; endDate?: string; summary?: string; highlights?: string[] }[];
  education?: { institution?: string; area?: string; studyType?: string; startDate?: string; endDate?: string; score?: string }[];
  skills?: { name?: string; keywords?: string[] }[];
  languages?: { language?: string }[];
  certificates?: { name?: string }[];
}

export function isJsonResume(v: unknown): v is JsonResume {
  return !!v && typeof v === "object" && ("basics" in v || "work" in v);
}

export function fromJsonResume(r: JsonResume): ResumeData {
  const b = r.basics ?? {};
  const names = (b.name ?? "").trim().split(/\s+/);
  const prof = (net: RegExp) => b.profiles?.find((p) => net.test(p.network ?? "") || net.test(p.url ?? ""))?.url ?? "";
  return {
    firstName: names[0] ?? "",
    lastName: names.length > 1 ? names[names.length - 1]! : "",
    middleName: names.length > 2 ? names.slice(1, -1).join(" ") : "",
    email: b.email ?? "",
    phone: b.phone ?? "",
    portfolio: b.url ?? "",
    summary: b.summary ?? "",
    street: b.location?.address ?? "",
    city: b.location?.city ?? "",
    state: b.location?.region ?? "",
    postalCode: b.location?.postalCode ?? "",
    country: b.location?.countryCode === "US" ? "United States" : (b.location?.countryCode ?? ""),
    linkedin: prof(/linkedin/i),
    github: prof(/github/i),
    workHistory: (r.work ?? []).map((w) => ({
      ...EMPTY_WORK,
      company: w.name ?? w.company ?? "",
      title: w.position ?? "",
      location: w.location ?? "",
      startDate: (w.startDate ?? "").slice(0, 7),
      endDate: (w.endDate ?? "").slice(0, 7),
      current: !w.endDate,
      description: [w.summary, ...(w.highlights ?? [])].filter(Boolean).join("\n"),
    })),
    education: (r.education ?? []).map((e) => ({
      ...EMPTY_EDU,
      school: e.institution ?? "",
      degree: e.studyType ?? "",
      field: e.area ?? "",
      startDate: (e.startDate ?? "").slice(0, 7),
      endDate: (e.endDate ?? "").slice(0, 7),
      gpa: e.score ?? "",
    })),
    skills: (r.skills ?? []).flatMap((s) => (s.keywords?.length ? s.keywords : [s.name ?? ""])).filter(Boolean).join(", "),
    languages: (r.languages ?? []).map((l) => l.language ?? "").filter(Boolean).join(", "),
    certifications: (r.certificates ?? []).map((c) => c.name ?? "").filter(Boolean).join(", "),
  };
}

/**
 * Merge imported data into a profile. Scalars only fill empty fields unless
 * `overwrite`; work/education lists are replaced when the import has any.
 */
export function mergeResume(p: Profile, data: ResumeData, overwrite = false): Profile {
  const next: Profile = { ...p };
  for (const [k, v] of Object.entries(data)) {
    if (k === "workHistory" || k === "education") continue;
    if (typeof v !== "string" || !v.trim()) continue;
    const cur = (next as unknown as Record<string, unknown>)[k];
    if (overwrite || !cur || (k === "country" && cur === "United States")) (next as unknown as Record<string, unknown>)[k] = v.trim();
  }
  if (data.workHistory?.length && (overwrite || !p.workHistory.length)) next.workHistory = data.workHistory;
  if (data.education?.length && (overwrite || !p.education.length)) next.education = data.education;
  return next;
}
