// Which frames of an application tab may receive the profile and fill forms.

/** Hosts of application systems that are commonly embedded in an iframe on a careers page. */
export const ATS_FRAME_RE = /greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|smartrecruiters\.com|icims\.com|jobvite\.com|workable\.com/;

const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu"]);

/** Registrable domain, roughly: careers.acme.co.uk → acme.co.uk. */
export function siteOf(host: string): string {
  const parts = host.toLowerCase().split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const tld = parts[parts.length - 1]!;
  const sld = parts[parts.length - 2]!;
  const n = tld.length === 2 && SECOND_LEVEL.has(sld) ? 3 : 2;
  return parts.slice(-n).join(".");
}

/**
 * The top frame, frames on the same site, and known ATS frames may fill.
 * Third-party iframes (ads, chat widgets, newsletter embeds) never get the profile.
 */
export function frameMayFill(frameUrl: string, topUrl: string, frameId: number): boolean {
  if (frameId === 0) return true;
  try {
    const f = new URL(frameUrl);
    if (ATS_FRAME_RE.test(f.hostname)) return true;
    return siteOf(f.hostname) === siteOf(new URL(topUrl).hostname);
  } catch {
    return false;
  }
}
