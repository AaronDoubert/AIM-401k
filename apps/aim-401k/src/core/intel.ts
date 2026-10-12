// Inbox intel, pure logic: classify job emails, match them to tracked jobs and
// decide which status change they imply. No browser APIs (unit-tested).
import type { IntelKind, Job, JobStatus, RawMail } from "../shared/types";
import { containsWords, norm, tokens } from "./text";

export interface Classification {
  kind: IntelKind;
  /** 0..1 */
  confidence: number;
}

type MailLike = Pick<RawMail, "subject" | "snippet"> & Partial<Pick<RawMail, "from" | "fromEmail">>;

// ---------------------------------------------------------------------------
// classification

/** Mail text for phrase rules: lower case, straight quotes, single spaces. */
function mailText(m: MailLike): string {
  return `${m.subject ?? ""} . ${m.snippet ?? ""}`
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[  \s]+/g, " ")
    .toLowerCase();
}

/** Words that show a mail is about hiring at all. Everything else is "other". */
const JOB_CONTEXT =
  /\b(appl(y|ied|ying|ication|icant)s?|candida(te|tes|ture|cy)|position|role|interview\w*|opportunit(y|ies)|hiring|recruit\w*|careers?|job|offer|resume|cv|talent|vacanc(y|ies)|assessment|onboarding)\b/;

/** Polite boilerplate that contains rule words but means nothing. */
const BOILERPLATE = [
  /unfortunately,? (due to [^.]{0,80}?,? )?(we )?(are |will be |may be )?(unable|not able|can'?not|can't) to (personally )?(respond|reply|get back|provide (individual |personal |specific )?feedback)[^.]*/g,
  /unfortunately,? (we|our team) (can'?not|can't|won't be able to) (respond|reply)[^.]*/g,
  /\bif (you are|you're) not selected[^.]*/g,
  /\bdo not reply[^.]*/g,
];

const REJECT_STRONG = [
  /\bnot (be )?moving forward\b/,
  /\bnot to (move|proceed|go) forward\b/,
  /\bwon'?t be (moving|going) forward\b/,
  /\b(move|moving|go|going|proceed|proceeding) forward with (other|another|a different) (candidates?|applicants?|individuals?|people)\b/,
  /\b(decided|chosen|elected|opted) to (pursue|proceed with|go with|move forward with|continue with) (other|another|a different)\b/,
  /\b(position|role|job|vacancy|opening) (has|have) (now )?(already )?been (filled|closed)\b/,
  /\bwill not be proceeding\b/,
  /\bnot (be )?proceeding with your (application|candidacy)\b/,
  /\bdecided not to\b/,
  /\bregret to (inform|let you know|tell you)\b/,
  /\b(were|was|are|is|have|has) not (been )?selected\b/,
  /\bno longer (being )?(considered|under consideration|in consideration)\b/,
  /\bunable to offer you\b/,
  /\bother candidates (whose|who|that)\b/,
  /\boffer (the (position|role) )?to another candidate\b/,
  /\bnot (be )?(progressing|advancing) (your|with your)\b/,
  /\bwill not be (progressing|advancing)\b/,
  /\b(application|candidacy) (was|has been|is) unsuccessful\b/,
  /\bnot (a|the) (right |best )?(fit|match) (for|at) this time\b/,
];
const REJECT_WEAK = [/\bunfortunately\b/, /\bafter careful (consideration|review)\b/];

const OFFER = [
  /\boffer letter\b/,
  /\b(pleased|happy|delighted|excited|thrilled) to (extend|offer you|make you)\b/,
  /\bextend(ing)? (you )?(an? |our )?(formal |verbal |written |official )?offer\b/,
  /\b(formal|verbal|written|official) offer\b/,
  /\boffer of employment\b/,
  /\bemployment offer\b/,
  /\byour (job )?offer (letter|details|package)\b/,
  /\bcongratulations[^.]{0,60}\boffer\b/,
];

const ASSESS_STRONG = [
  /\bcoding (challenge|exercise|test|assessment|task)\b/,
  /\btake[- ]home\b/,
  /\bhackerrank\b/,
  /\bcodesignal\b/,
  /\bcodility\b/,
  /\btestgorilla\b/,
  /\bcodingame\b/,
  /\b(online|technical|skills?|cognitive|aptitude) (assessment|test|evaluation)\b/,
  /\b(complete|start|take|finish) (the|an|your|our|this|a) (short |brief )?(online |technical |skills? )?(assessment|test|challenge|exercise)\b/,
];
const ASSESS_WEAK = [/\bassessment\b/];

const INTERVIEW_STRONG = [
  /\bschedul(e|ing) (a |an |your |the |some |our )?([\w-]+ ){0,3}(interview|call|chat|conversation|meeting|phone screen|screen|time to (talk|chat|speak|meet))\b/,
  /\bphone screen(ing)?\b/,
  /\b(phone|video|zoom|teams|onsite|on-site|in-person|technical|virtual|final|first|initial|recruiter|panel) (interview|call|screen)\b/,
  /\binvit(e|ing) you to (an? |our )?([\w-]+ ){0,2}(interview|call|chat|meet|speak|conversation)/,
  /\binvitation to (an? )?([\w-]+ ){0,2}interview\b/,
  /\binterview (invitation|invite|request)\b/,
  /\b(would|we'd|i'd|we would|i would) (like|love) to (schedule|set up|arrange|invite you|speak|chat|talk|connect|meet|move you forward|learn more about you)\b/,
  /\b(your|share|send|provide|let (me|us) know) (your |some )?availability\b/,
  /\bavailable (times|time slots|slots)\b/,
  /\bcalendly\.com\b/,
  /\bgoodtime\.io\b/,
  /\b(book|pick|choose|select) a (time|slot)\b/,
  /\breschedul/,
  /\binterview (is |has been )?(confirmed|scheduled)\b/,
  /\bmove (you )?forward to the next (round|stage|step)\b/,
  /\bnext (round|stage) of (the |our )?(interview|hiring|recruiting|process)/,
];
const INTERVIEW_WEAK = [/\binterview/, /\bnext steps?\b/, /\bschedule\b/, /\bavailability\b/, /\bchat with\b/, /\bspeak with\b/, /\bconnect with you\b/, /\bhiring manager\b/];

const RECEIVED = [
  /\bthank(s| you) for (applying|your application|submitting)\b/,
  /\bwe(?:'ve| have) (successfully )?received your application\b/,
  /\breceived your application\b/,
  /\bapplication (has been |was |is )?(received|submitted)\b/,
  /\bthank(s| you) (so much )?for (your )?interest in\b/,
  /\bthank(s| you) for your interest\b/,
  /\bapplication (confirmation|acknowledg(e)?ment)\b/,
  /\byour application (to|for|at) [^.]{1,80}?(has been|was) (sent|submitted|received)\b/,
  /\byour application was sent\b/,
  /\bsuccessfully (submitted|applied)\b/,
  /\bwe got your application\b/,
];

/** Language that makes an interview/assessment mention hypothetical ("we'll reach out if…"). */
const CONDITIONAL = [
  /\b(if|should|once|may|might|in the event|whether)\b[^.!?]{0,100}\b(schedul\w*|interview\w*|call|reach out|contact|be in touch|assessment|next steps?)\b/,
  /\b(we|someone|a recruiter|a member of (our|the) team|our (recruiting |hiring |talent )?team|the (hiring )?team|they) (will|'ll|would) (review|reach out|be in touch|contact you|get back)\b/,
];

const PLATFORM = /\b(hackerrank|codesignal|codility|testgorilla|codingame)\b/;

const hits = (rules: RegExp[], t: string) => rules.reduce((n, r) => n + (r.test(t) ? 1 : 0), 0);

/** Assessment platforms and phrases that only show up in hiring mail. */
const HIRING_ONLY = /\b(hackerrank|codesignal|codility|testgorilla|codingame|coding (challenge|exercise|test|assessment)|take[- ]home)\b/;

/**
 * Keyword/phrase classifier. Rejections outrank "thank you for applying".
 * Mail from unknown senders must look like hiring mail first (so "let's
 * schedule a call" sales mail stays "other"); pass `known` when the sender
 * already matched a tracked job.
 */
export function classify(mail: MailLike, opts: { known?: boolean } = {}): Classification {
  const raw = mailText(mail);
  const context = opts.known || JOB_CONTEXT.test(raw) || HIRING_ONLY.test(raw) || JOB_CONTEXT.test((mail.from ?? "").toLowerCase()) || isAtsEmail(mail.fromEmail ?? "");
  if (!context) return { kind: "other", confidence: 0.1 };
  let t = raw;
  for (const b of BOILERPLATE) t = t.replace(b, " ");

  if (hits(REJECT_STRONG, t)) return { kind: "rejection", confidence: 0.9 };
  if (hits(OFFER, t)) return { kind: "offer", confidence: 0.9 };

  const received = hits(RECEIVED, t) > 0;
  const conditional = received && CONDITIONAL.some((r) => r.test(t));
  const assess = hits(ASSESS_STRONG, t);
  const interview = hits(INTERVIEW_STRONG, t);
  if ((assess || interview) && !conditional) {
    if (assess && (!interview || assess > interview || (assess === interview && PLATFORM.test(t)))) return { kind: "assessment", confidence: interview ? 0.8 : 0.85 };
    return { kind: "interview", confidence: assess ? 0.8 : 0.85 };
  }
  if (hits(REJECT_WEAK, t)) return { kind: "rejection", confidence: 0.6 };
  if (received) return { kind: "received", confidence: conditional ? 0.75 : 0.85 };
  if (assess || hits(ASSESS_WEAK, t)) return { kind: "assessment", confidence: 0.5 };
  if (interview || hits(INTERVIEW_WEAK, t)) return { kind: "interview", confidence: 0.5 };
  return { kind: "other", confidence: 0.2 };
}

// ---------------------------------------------------------------------------
// senders, domains, company names

/** Applicant-tracking / job-board mail domains: the domain says nothing about the employer. */
export const ATS_DOMAINS = [
  "greenhouse-mail.io",
  "greenhouse.io",
  "lever.co",
  "hire.lever.co",
  "myworkday.com",
  "myworkdayjobs.com",
  "workday.com",
  "ashbyhq.com",
  "icims.com",
  "smartrecruiters.com",
  "smartrecruiters-mail.com",
  "jobvite.com",
  "workablemail.com",
  "workable.com",
  "bamboohr.com",
  "taleo.net",
  "successfactors.com",
  "jazzhr.com",
  "applytojob.com",
  "recruitee.com",
  "teamtailor.com",
  "teamtailor-mail.com",
  "breezy.hr",
  "rippling.com",
  "dover.com",
  "gem.com",
  "paradox.ai",
  "linkedin.com",
  "indeed.com",
  "indeedemail.com",
  "ziprecruiter.com",
  "glassdoor.com",
  "wellfound.com",
  "hired.com",
];

const FREEMAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "fastmail.com",
  "hey.com",
]);

const domainOf = (email: string) => (email.split("@")[1] ?? "").toLowerCase().trim();
const under = (host: string, d: string) => host === d || host.endsWith(`.${d}`);

export function isAtsEmail(email: string): boolean {
  const d = domainOf(email);
  return !!d && ATS_DOMAINS.some((a) => under(d, a));
}

const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu", "ltd", "plc"]);

/** The registrable name of a host: mail.careers.acme-robotics.co.uk → "acme-robotics". */
export function domainLabel(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (parts.length < 2) return parts[0] ?? "";
  const tld = parts[parts.length - 1]!;
  const sld = parts[parts.length - 2]!;
  if (parts.length >= 3 && tld.length === 2 && SECOND_LEVEL.has(sld)) return parts[parts.length - 3]!;
  return sld;
}

/** Employer label from the sender address, or "" for ATS / webmail / unknown senders. */
export function senderLabel(email: string): string {
  const d = domainOf(email);
  if (!d || FREEMAIL.has(d) || isAtsEmail(email)) return "";
  return domainLabel(d);
}

const CORP_SUFFIX =
  /\b(inc|incorporated|llc|l l c|llp|ltd|limited|corp|corporation|co|company|gmbh|ag|sa|sas|plc|pbc|bv|nv|oy|ab|srl|pty|holdings?|group|technologies|technology|labs?|software|systems)\b/g;
const SENDER_NOISE =
  /\b(the )?(recruiting|recruitment|recruiter|careers?|jobs?|hiring|talent( acquisition)?|people|hr|human resources|team|notifications?|no ?reply|do not reply|donotreply|noreply|applications?|candidates?|support)\b/g;

/** Comparable company name: "Globex Corporation, Inc." → "globex". */
export function companyKey(name: string): string {
  const n = norm(name);
  const core = n.replace(CORP_SUFFIX, " ").replace(/\s+/g, " ").trim();
  return core || n;
}

const compact = (s: string) => s.replace(/[^a-z0-9]+/g, "");
const pretty = (s: string) => s.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase());

/** Company slug from a job URL (ATS board path/subdomain, or the company's own domain). */
export function companyFromUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "";
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host.endsWith(".local") || host === "localhost") return "";
  const path = u.pathname.split("/").filter(Boolean);
  const first = (path[0] ?? "").toLowerCase();
  const sub = host.split(".")[0] ?? "";
  if (under(host, "greenhouse.io")) return first && !["embed", "job_app", "jobs"].includes(first) ? first : (u.searchParams.get("for") ?? "");
  if (["lever.co", "ashbyhq.com", "smartrecruiters.com", "workable.com", "jobvite.com", "applytojob.com"].some((d) => under(host, d))) {
    return ["jobs", "careers", "apply", "j"].includes(first) ? (path[1] ?? "").toLowerCase() : first;
  }
  if (under(host, "myworkdayjobs.com") || under(host, "myworkday.com") || under(host, "bamboohr.com") || under(host, "recruitee.com") || under(host, "breezy.hr") || under(host, "teamtailor.com")) return sub;
  if (under(host, "icims.com")) return sub.replace(/^careers?-|-careers?$/g, "");
  if (["linkedin.com", "indeed.com", "glassdoor.com", "ziprecruiter.com", "wellfound.com"].some((d) => under(host, d))) return "";
  return domainLabel(host);
}

const NAME = "([A-Z0-9][\\w&.'-]*(?:\\s+[A-Z0-9][\\w&.'-]*){0,3})";
const ATS_NAME = /^(me|ats|greenhouse|lever|workday|ashby|icims|smartrecruiters|jobvite|workable|linkedin|indeed|glassdoor|ziprecruiter)$/i;

/** Best guess at the employer an (unmatched) email is from, for display. */
export function guessCompany(mail: Pick<RawMail, "from" | "fromEmail" | "subject">): string {
  const label = senderLabel(mail.fromEmail);
  const name = (mail.from ?? "").replace(/["]/g, "").trim();
  const right = name.match(new RegExp(`(?:\\bfrom|\\bat|@)\\s+${NAME}`));
  if (right) return right[1]!.trim();
  const freemail = FREEMAIL.has(domainOf(mail.fromEmail));
  let display = "";
  if (!freemail) {
    for (const part of name.replace(/\s+via\s+.*$/i, "").split(/\s+[-|·–—:]\s+|\s*[|·]\s*/)) {
      const cleaned = part.replace(new RegExp(SENDER_NOISE.source, "gi"), " ").replace(/\s+/g, " ").trim();
      if (cleaned && !ATS_NAME.test(cleaned)) {
        display = cleaned;
        break;
      }
    }
  }
  // The company's own domain is the best evidence; its display name spells it nicer ("piedpiper" → "Pied Piper").
  if (label) return display && compact(display.toLowerCase()) === compact(label) ? display : pretty(label);
  if (display) return display;
  for (const word of ["at", "with", "to", "from"]) {
    const m = mail.subject.match(new RegExp(`\\b${word}\\s+${NAME}`));
    if (m) return m[1]!.replace(/[.,!:]+$/, "");
  }
  return freemail ? name : "";
}

// ---------------------------------------------------------------------------
// matching

export type JobRef = Pick<Job, "id" | "company" | "title" | "url" | "status"> & { appliedAt?: number | null };

export interface JobMatch {
  jobId: string;
  company: string;
  confidence: number;
  /**
   * The sender itself vouches for the company: its own domain, a Workday
   * tenant address, or a known ATS mailer. A display name alone ("Acme
   * Careers" <x@gmail.com>) is weak evidence and is never enough to
   * auto-apply a rejection or an offer.
   */
  strong: boolean;
}

const APPLIED: JobStatus[] = ["submitted", "interviewing", "offer", "rejected"];
const IN_FLIGHT: JobStatus[] = ["running", "needs_you", "ready_to_submit"];

/** How strongly one company name shows up in the mail (0 = not at all). */
function nameSignals(key: string, mail: MailLike & { fromEmail: string; from: string }, hint: string): number[] {
  const c = compact(key);
  if (c.length < 2) return [];
  const single = !key.includes(" ");
  const shortWord = single && c.length <= 3;
  const text = (s: number) => (shortWord ? s * 0.7 : s);
  const out: number[] = [];

  const label = compact(senderLabel(mail.fromEmail));
  if (label) {
    if (label === c) out.push(0.9);
    else if (c.length >= 4 && label.length >= 4 && (c.startsWith(label) || label.startsWith(c))) out.push(0.75);
    else if (label === compact(key.split(" ")[0] ?? "") && label.length >= 4) out.push(0.75);
  }
  const domain = domainOf(mail.fromEmail);
  if (under(domain, "myworkday.com")) {
    const local = compact(mail.fromEmail.split("@")[0]!.toLowerCase());
    if (local === c || (c.length >= 4 && local.startsWith(c))) out.push(0.85);
  }
  if (mail.from && containsWords(mail.from, key)) out.push(text(0.85));
  else if (mail.from && c.length >= 5 && compact(norm(mail.from)).includes(c)) out.push(0.8);
  if (containsWords(mail.subject, key)) out.push(text(0.8));
  if (containsWords(mail.snippet, key)) out.push(text(0.7));
  if (hint) {
    const hk = companyKey(hint);
    if (hk === key) out.push(0.85);
    else if (containsWords(hint, key) || containsWords(key, hk)) out.push(0.75);
  }
  return out;
}

/**
 * Which tracked job an email is about. Compares company names (and the slug
 * from the job URL) with the sender, sender domain, subject and preview;
 * job title words and "already applied" break ties. Returns null when nothing
 * matches or when two jobs tie — never a wild guess.
 */
export function matchJob(mail: MailLike, jobs: JobRef[], hint = ""): JobMatch | null {
  const m = { ...mail, from: mail.from ?? "", fromEmail: (mail.fromEmail ?? "").toLowerCase() };
  const mailTokens = new Set(tokens(`${m.subject} ${m.snippet}`));
  const scored: { job: JobRef; base: number; total: number; name: string }[] = [];
  for (const job of jobs) {
    const slug = companyFromUrl(job.url);
    const keys = [...new Set([companyKey(job.company), companyKey(pretty(slug))].filter((k) => compact(k).length >= 2))];
    let base = 0;
    let count = 0;
    for (const k of keys) {
      const sig = nameSignals(k, m, hint);
      if (!sig.length) continue;
      const best = Math.max(...sig);
      if (best > base) base = best;
      count = Math.max(count, sig.filter((x) => x >= 0.5).length);
    }
    if (base < 0.6) continue;
    base = Math.min(0.95, base + 0.05 * Math.min(2, count - 1));
    const tt = tokens(job.title);
    const titleHit = tt.length ? tt.filter((t) => mailTokens.has(t)).length / tt.length : 0;
    const status = APPLIED.includes(job.status) || job.appliedAt ? 0.06 : IN_FLIGHT.includes(job.status) ? 0.03 : 0;
    scored.push({ job, base, total: base + 0.1 * titleHit + status, name: job.company || pretty(slug) });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.total - a.total);
  const [best, second] = scored;
  if (second && best!.total - second.total < 0.02) return null;
  return {
    jobId: best!.job.id,
    company: best!.name,
    confidence: Math.min(0.99, Math.round(best!.total * 100) / 100),
    strong: senderVouches(m.fromEmail, best!.job),
  };
}

/** Does the sender address itself point at this job's company (see JobMatch.strong)? */
function senderVouches(fromEmail: string, job: JobRef): boolean {
  if (isAtsEmail(fromEmail)) return true;
  const keys = [companyKey(job.company), companyKey(pretty(companyFromUrl(job.url)))].map(compact).filter((k) => k.length >= 2);
  const label = compact(senderLabel(fromEmail));
  if (label && keys.some((k) => k === label || (k.length >= 4 && label.length >= 4 && (k.startsWith(label) || label.startsWith(k))))) return true;
  if (under(domainOf(fromEmail), "myworkday.com")) {
    const local = compact(fromEmail.split("@")[0]!.toLowerCase());
    return keys.some((k) => local === k || (k.length >= 4 && local.startsWith(k)));
  }
  return false;
}

/** Cheap pre-filter before asking an AI: does this look like it could be about a job at all? */
export function looksJobRelated(mail: MailLike, jobs: JobRef[]): boolean {
  return JOB_CONTEXT.test(mailText(mail)) || isAtsEmail(mail.fromEmail ?? "") || matchJob(mail, jobs) !== null;
}

// ---------------------------------------------------------------------------
// status

/**
 * The status an email implies for a job, or null for "leave it". Never moves
 * a job backwards (an old "thanks for applying" can't undo an interview) and
 * never downgrades an offer.
 */
export function nextStatus(current: JobStatus, kind: IntelKind): JobStatus | null {
  switch (kind) {
    case "received":
      return APPLIED.includes(current) ? null : "submitted";
    case "assessment":
    case "interview":
      return current === "interviewing" || current === "offer" || current === "rejected" ? null : "interviewing";
    case "offer":
      return current === "offer" ? null : "offer";
    case "rejection":
      return current === "offer" || current === "rejected" ? null : "rejected";
    default:
      return null;
  }
}

/** Same email seen through two sources (tab + API) has the same fingerprint. */
export function fingerprint(m: Pick<RawMail, "from" | "fromEmail" | "subject" | "snippet">): string {
  return [norm(m.fromEmail || m.from), norm(m.subject), norm(m.snippet).slice(0, 60)].join("|");
}
