import type { PageMeta } from "../shared/types";
import { truncate } from "../shared/util";
import { isVisible, queryAll, textOf } from "./dom";

export function detectAts(host = location.hostname): string {
  const h = host.toLowerCase();
  const table: [RegExp, string][] = [
    [/greenhouse\.io$/, "greenhouse"],
    [/lever\.co$/, "lever"],
    [/ashbyhq\.com$/, "ashby"],
    [/myworkdayjobs\.com$|workday\.com$/, "workday"],
    [/smartrecruiters\.com$/, "smartrecruiters"],
    [/icims\.com$/, "icims"],
    [/jobvite\.com$/, "jobvite"],
    [/bamboohr\.com$/, "bamboohr"],
    [/workable\.com$/, "workable"],
    [/linkedin\.com$/, "linkedin"],
    [/indeed\.com$/, "indeed"],
  ];
  for (const [re, name] of table) if (re.test(h)) return name;
  return "generic";
}

/** Hosts that commonly embed the real application form in an iframe. */
export const ATS_FRAME_RE = /greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|smartrecruiters\.com|icims\.com|jobvite\.com|workable\.com/;

function metaContent(name: string): string {
  const el = document.querySelector<HTMLMetaElement>(`meta[property="${name}"], meta[name="${name}"]`);
  return el?.content?.trim() ?? "";
}

function companyFromUrl(ats: string): string {
  const parts = location.pathname.split("/").filter(Boolean);
  const sub = location.hostname.split(".")[0] ?? "";
  const pretty = (s: string) => s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  switch (ats) {
    case "greenhouse":
      return parts[0] && parts[0] !== "embed" ? pretty(parts[0]) : "";
    case "lever":
    case "ashby":
    case "smartrecruiters":
    case "workable":
      return parts[0] ? pretty(parts[0]) : "";
    case "workday":
    case "bamboohr":
    case "icims":
      return pretty(sub.replace(/^careers-?/, ""));
    default:
      return "";
  }
}

export function extractMeta(): PageMeta {
  const ats = detectAts();
  const h1 = textOf(document.querySelector("h1"));
  const ogTitle = metaContent("og:title");
  const title = truncate(h1 || ogTitle || document.title.split(/[|\-–]/)[0]?.trim() || "", 140);
  const company =
    textOf(document.querySelector(".company-name, [data-automation-id=company], .main-header-logo img")) ||
    document.querySelector<HTMLImageElement>(".main-header-logo img, header img[alt]")?.alt?.replace(/ logo$/i, "") ||
    companyFromUrl(ats) ||
    metaContent("og:site_name") ||
    location.hostname.replace(/^www\./, "");
  const location_ =
    textOf(document.querySelector(".location, .posting-categories .location, [data-automation-id=locations], .job__location")) || "";
  const main = document.querySelector<HTMLElement>("main, article, #content, .content, [role=main]") ?? document.body;
  const description = truncate(visibleText(main), 8000);
  return { title, company: truncate(company, 80), location: truncate(location_, 80), ats, description };
}

/** Rendered text only (innerText skips <script>/<style> and hidden nodes). */
function visibleText(el: HTMLElement | null): string {
  if (!el) return "";
  return (el.innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function isConfirmationPage(): boolean {
  const body = visibleText(document.body).slice(0, 6000).toLowerCase();
  return /thank(s| you) for (applying|your application|submitting)|application (has been |was )?(received|submitted|sent|complete)|we('| ha)ve received your application|successfully (submitted|applied)|your application is (in|complete)/.test(
    body,
  );
}

/** A CAPTCHA the human must solve (invisible/score-based ones are ignored). */
export function visibleCaptcha(): boolean {
  const frames = queryAll<HTMLIFrameElement>(
    "iframe[src*='recaptcha'], iframe[src*='hcaptcha.com'], iframe[src*='challenges.cloudflare.com'], iframe[src*='arkoselabs'], iframe[title*='captcha' i]",
  );
  return frames.some((f) => {
    if (/size=invisible/.test(f.src)) return false;
    if (!isVisible(f)) return false;
    const r = f.getBoundingClientRect();
    return r.width > 60 && r.height > 40 && !f.closest(".grecaptcha-badge");
  });
}

export function isLoginWall(fieldCount: number): boolean {
  const pw = queryAll<HTMLInputElement>("input[type=password]").filter(isVisible);
  return pw.length > 0 && fieldCount <= 4;
}

const CLICKABLE = "button, input[type=submit], input[type=button], a[role=button], [role=button], a";

function label(el: HTMLElement): string {
  return (textOf(el) || (el as HTMLInputElement).value || el.getAttribute("aria-label") || "").trim();
}

function findClickable(re: RegExp, exclude?: RegExp): HTMLElement | null {
  const cands = queryAll<HTMLElement>(CLICKABLE).filter((el) => {
    if (!isVisible(el) || (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return false;
    if (el.closest("#jobpilot-root")) return false;
    const t = label(el);
    return t.length > 0 && t.length < 60 && re.test(t) && !(exclude && exclude.test(t));
  });
  // Prefer real buttons over links, and later (bottom-of-form) buttons over header ones.
  const buttons = cands.filter((el) => el.tagName !== "A");
  const pool = buttons.length ? buttons : cands;
  return pool[pool.length - 1] ?? null;
}

const THIRD_PARTY = /linkedin|indeed|google|facebook|github|seek|glassdoor|sign in|log in/i;

export function findApplyButton(): HTMLElement | null {
  return (
    findClickable(/^apply manually$/i) ||
    findClickable(/^(apply|apply now|apply for this (job|position|role)|apply to this job|i'?m interested|start (your )?application|apply here)$/i, THIRD_PARTY)
  );
}

export function findNextButton(): HTMLElement | null {
  return findClickable(/^(next|continue|save (and|&) continue|next step|proceed|save and next)\b/i, /submit/i);
}

export function findSubmitButton(): HTMLElement | null {
  return findClickable(/^(submit( application| my application)?|send application|complete application|finish|apply|submit & apply)$/i, THIRD_PARTY);
}

/** Page-level error banners shown after a failed submit/next. */
export function pageErrors(): string[] {
  return queryAll<HTMLElement>("[role=alert], .error-message, .field-error, .error:not(input), [data-automation-id=errorMessage]")
    .filter((e) => isVisible(e) && !e.closest("#jobpilot-root"))
    .map(textOf)
    .filter((t) => t && t.length < 300)
    .slice(0, 5);
}
