import { EMPTY_EDU, EMPTY_WORK } from "../shared/defaults";
import type { EducationEntry, Profile, WorkEntry } from "../shared/types";
import { isPresent, parseDate, toIso } from "./dates";
import { isKnownCity } from "./geo";

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
const SEASON = "(?:spring|summer|fall|autumn|winter)";
const DATE = `(?:${MONTH}\\s*\\d{4}|${SEASON}\\s+\\d{4}|\\d{1,2}/\\d{4}|\\d{4}-\\d{2}|\\d{4})`;
const END = `(?:${DATE}|present|current|now|today|ongoing)`;
// PDFs spell the range dash many ways: hyphen, en/em dash, minus, figure dash, "--", "to".
const DASH = "(?:--|[-‐‑‒–—―−~]|to|until|through)";
const RANGE_RE = new RegExp(`(${DATE})\\s*${DASH}\\s*(${END})`, "i");
const SINGLE_DATE_RE = new RegExp(`\\b(${DATE})\\b`, "i");

const BULLET_RE = /^\s*[•▪◦●○■□➢►▸‣⁃\-*–·]\s*/;
const COMPANY_HINT = /\b(inc|llc|ltd|corp|corporation|co|company|gmbh|plc|group|labs?|technologies|systems|solutions|university|agency|bank|associates|partners|motors|consulting|studios?|creatives?|industries|enterprises|holdings|ventures|services|foundation|hospital|institute|lab|laborator(y|ies))\b\.?/i;
const TITLE_HINT =
  /\b(intern(ship)?|engineer(ing)?|developer|manager|analyst|assistant|designer|lead|director|specialist|consultant|coordinator|associate|technician|researcher|scientist|officer|representative|president|founder|co-?founder|fellow|tutor|teacher|instructor|volunteer|administrator|architect|programmer|accountant|advisor|editor|writer|operator|supervisor|head|vp|cto|ceo|clerk|cashier|mentor|captain|member|student)\b/i;
const SCHOOL_HINT = /\b(university|college|institute|school|academy|polytechnic)\b/i;
const DEGREE_HINT =
  /\b(bachelor|master|associate|doctor|ph\.?\s?d|mba|b\.?\s?s\.?c?|m\.?\s?s\.?c?|b\.?\s?a|m\.?\s?a|b\.?\s?eng|m\.?\s?eng|bfa|mfa|jd|md|diploma|certificate|ged|high school)\b/i;
const CITY_STATE = /\b([A-Z][a-zA-Z.'\- ]{1,30}),\s*([A-Z]{2}|[A-Z][a-z]+(?: [A-Z][a-z]+)?)\b(?:\s+(\d{5}))?/;
/** Words that start a two-word city ("Port Washington", "San Jose", "Fort Worth"). */
const CITY_PREFIX = new Set(
  "port new san santa los las fort ft st st. saint east west north south lake mount mt mt. el palo grand long ann baton cedar coral corpus des del glen great green little oak rock round sioux silver white winston bowling college jersey kansas oklahoma daly elk iowa boca cape chapel menlo mountain redwood royal sugar thousand upper beverly culver huntington newport overland palm pompano red cherry falls king queens staten bay".split(" "),
);
/** Words that end a two-word city ("Kansas City", "Palm Beach", "Overland Park"). */
const CITY_SUFFIX = /^(city|beach|park|springs|falls|heights|hills|valley|village|island|harbor|point|rapids|creek|grove|station|lake|junction|gardens|bluffs|plains|county|township)$/i;
const US_STATE_ABBR = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split(" "),
);

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
  const season = s.match(/^(spring|summer|fall|autumn|winter)\s+(\d{4})$/i);
  if (season) return `${season[2]}-${{ spring: "03", summer: "06", fall: "09", autumn: "09", winter: "01" }[season[1]!.toLowerCase()]}`;
  const d = parseDate(s.replace(/\.$/, "").replace(/^([a-z]+)\.?\s*(\d{4})$/i, "$1 $2"));
  return d ? toIso({ y: d.y, ...(d.m ? { m: d.m } : {}) }) : "";
}

/** Split "Title — Company, City, ST" style text into its pieces. */
function pieces(s: string): string[] {
  return s
    .split(/\s*(?:\||—|–|·|•|\t| {3,}| - | at |, (?=[A-Z][a-z]+,? [A-Z]{2}\b))\s*/)
    .map((p) => p.replace(/^[,;\s]+|[,;\s]+$/g, "").trim())
    .filter(Boolean);
}

/** Only the strong column separators: keeps "Mechanical Engineering Intern – Controls" whole. */
function columns(s: string): string[] {
  return s
    .split(/\s*(?:\||·|•|\t| {3,}| at )\s*/)
    .map((p) => p.replace(/^[,;\s]+|[,;\s]+$/g, "").trim())
    .filter(Boolean);
}

/**
 * Pull a trailing "City, ST" (or "Remote") off a header line. PDF text often loses the
 * gap between a left-aligned company and a right-aligned location ("Highland Associates
 * Manhattan, NY"), so the city is read back from the end: a known city, a two-word
 * city ("Port Washington", "Kansas City"), else the last word.
 */
export function splitPlace(line: string): { rest: string; place: string } {
  const t = line.trim().replace(/[,;\s]+$/, "");
  const remote = t.match(/^(.*?)[\s,|·•–—-]*\(?\b(remote|hybrid|remote, us|remote \(us\))\)?$/i);
  if (remote) return { rest: remote[1]!.trim(), place: remote[2]![0]!.toUpperCase() + remote[2]!.slice(1).toLowerCase() };
  const m = t.match(/^(.*?)[\s,]*\b((?:[A-Z][\w.'’-]*\s+){0,3}[A-Z][\w.'’-]*),\s*([A-Z]{2}|[A-Z][a-z]+(?: [A-Z][a-z]+)?)(?:\s+\d{5})?$/);
  if (!m) return { rest: t, place: "" };
  const state = m[3]!;
  if (/^[A-Z]{2}$/.test(state) ? !US_STATE_ABBR.has(state) : false) return { rest: t, place: "" };
  const before = m[1]!.trim();
  const words = m[2]!.split(/\s+/);
  // A gap the PDF kept (3+ spaces) already marks where the location column starts.
  const gap = t.match(/^(.*\S) {3,}(\S.*)$/);
  let k = 1;
  if (gap && gap[2]!.endsWith(`${state}`) && gap[2]!.split(",")[0]!.split(/\s+/).length <= 4) {
    k = Math.min(words.length, gap[2]!.split(",")[0]!.trim().split(/\s+/).length);
  } else {
    for (let n = Math.min(3, words.length); n >= 1; n--) {
      if (isKnownCity(words.slice(-n).join(" "), state)) {
        k = n;
        break;
      }
    }
    if (k === 1 && words.length >= 2) {
      const prev = words[words.length - 2]!.toLowerCase();
      if (CITY_PREFIX.has(prev) || CITY_SUFFIX.test(words[words.length - 1]!)) k = 2;
      if (k === 2 && words.length >= 3 && CITY_SUFFIX.test(words[words.length - 2]!)) k = 3; // Salt Lake City
    }
    // Nothing before the city? Then the whole thing is the place ("New York, NY").
    if (!before && words.length <= 3 && !COMPANY_HINT.test(m[2]!)) k = words.length;
  }
  const city = words.slice(-k).join(" ");
  const rest = [before, ...words.slice(0, words.length - k)].join(" ").replace(/[\s,|·•–—-]+$/, "").trim();
  return { rest, place: `${city}, ${state}` };
}

/** Wrapped text from the line above, not a new header: "standardizing control narrative…". */
const isContinuation = (line: string) => /^[a-z(&+]/.test(line) || /^(and|or|of|to|for|with|in)\b/.test(line);

function parseWork(lines: string[]): WorkEntry[] {
  const clean = lines.map((l) => l.trim()).filter(Boolean);
  const isBullet = (i: number) => BULLET_RE.test(clean[i] ?? "");
  const anchors = clean.map((l, i) => (RANGE_RE.test(l) && !isBullet(i) && l.length < 140 ? i : -1)).filter((i) => i >= 0);
  const headerish = (i: number) => {
    const l = clean[i];
    return !!l && !isBullet(i) && !isContinuation(l) && l.length < 90 && !(l.length > 40 && /[.!?]$/.test(l)) && !RANGE_RE.test(l);
  };
  // Each entry's header = up to 2 short lines above its date line, plus (for templates
  // that put "Company   City, ST" under "Title   Dates") one such line just below it.
  const above = anchors.map((ai, k) => {
    const floor = k > 0 ? anchors[k - 1]! + 1 : 0;
    let h = ai;
    while (h > floor && ai - h < 2 && headerish(h - 1)) h--;
    // The previous entry needs at least its own body; never steal its first line when it has no bullets.
    return k > 0 && h === floor && ai - floor > 1 ? h + 1 : h;
  });
  const below = anchors.map((ai, k) => {
    const next = k + 1 < anchors.length ? above[k + 1]! : clean.length;
    const i = ai + 1;
    if (i >= next || !headerish(i) || above[k]! < ai) return ai;
    // Only when the body (bullets or prose) follows it.
    return i + 1 >= next || isBullet(i + 1) || !headerish(i + 1) ? i : ai;
  });

  return anchors.map((ai, k) => {
    const line = clean[ai]!;
    const m = line.match(RANGE_RE)!;
    const dateRest = line.replace(m[0], "   ").replace(/[()]/g, " ").replace(/\s*[,|·•–—-]\s*$/, "").trim();
    const headLines = [...clean.slice(above[k], ai), ...(dateRest ? [dateRest] : []), ...clean.slice(ai + 1, below[k]! + 1)];

    let location = "";
    const names: string[] = [];
    for (const hl of headLines) {
      const { rest, place } = location ? { rest: hl, place: "" } : splitPlace(hl);
      if (place) location = place;
      names.push(...columns(rest));
    }
    // One line only ("Engineer – Initech – Austin, TX"): fall back to every separator.
    const parts = names.length === 1 && headLines.length === 1 ? pieces(names[0]!) : names;
    const placeIdx = location ? -1 : parts.findIndex((p) => CITY_STATE.test(p) || /^remote$/i.test(p));
    if (placeIdx >= 0) location = parts.splice(placeIdx, 1)[0]!;

    let title = "";
    let company = "";
    const titled = parts.filter((p) => TITLE_HINT.test(p) && !COMPANY_HINT.test(p));
    const companied = parts.filter((p) => COMPANY_HINT.test(p) && !TITLE_HINT.test(p));
    if (titled.length === 1) title = titled[0]!;
    if (companied.length === 1 && companied[0] !== title) company = companied[0]!;
    const left = parts.filter((p) => p !== title && p !== company);
    if (!title && !company) {
      // Unhinted: the text on the date line is the title (most templates); else first = title.
      const onDate = dateRest ? columns(dateRest)[0] : undefined;
      title = onDate && left.includes(onDate) && headLines.length > 1 ? onDate : (left[0] ?? "");
      company = left.find((p) => p !== title) ?? "";
    } else if (!title) title = left[0] ?? "";
    else if (!company) company = left[0] ?? "";

    const bodyEnd = k + 1 < anchors.length ? above[k + 1]! : clean.length;
    const body = clean.slice(below[k]! + 1, bodyEnd);
    const hasBullets = body.some((l) => BULLET_RE.test(l));
    const items: string[] = [];
    for (const l of body) {
      const text = l.replace(BULLET_RE, "").trim();
      const prev = items[items.length - 1];
      const joins = prev != null && !BULLET_RE.test(l) && (hasBullets || isContinuation(text) || /[,;:&/-]$/.test(prev));
      if (joins) items[items.length - 1] = prev.endsWith("-") && !prev.endsWith(" -") ? prev + text : `${prev} ${text}`;
      else items.push(text);
    }
    return {
      ...EMPTY_WORK,
      title,
      company,
      location,
      startDate: ym(m[1]!),
      endDate: ym(m[2]!),
      current: isPresent(m[2]!),
      description: items.join("\n"),
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
