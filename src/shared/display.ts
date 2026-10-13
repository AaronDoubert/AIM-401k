// Display helpers shared by every page (and the background, for log text).
// Pure functions: no DOM, no browser APIs.

/** Dotted-quad IPv4, IPv6 (bare or bracketed) and localhost names: never a company. */
export function isLocalOrIpHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return false;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  return h.includes(":") && /^[0-9a-f:.]+$/.test(h);
}

/** "https://www.acme.com/jobs/1" → "acme.com"; "" for junk. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * The company to show for a job: what the page told us, else the site's host.
 * An IP address or localhost is never shown as a company ("Localhost" instead).
 */
export function companyName(job: { company: string; url: string }): string {
  const c = job.company.trim();
  if (c) return isLocalOrIpHost(c.replace(/:\d+$/, "")) ? "Localhost" : c;
  const host = hostOf(job.url);
  return isLocalOrIpHost(host) ? "Localhost" : host;
}

/** Shorten to at most `max` characters at a word boundary, ending in "…". */
export function clip(text: string, max: number): string {
  const s = text.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, Math.max(1, max - 1));
  const space = cut.lastIndexOf(" ");
  // Keep whole words unless that would throw away most of the line.
  const head = space > max * 0.6 ? cut.slice(0, space) : cut;
  return `${head.replace(/[\s,.;:·–—-]+$/, "")}…`;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const pad = (n: number) => String(n).padStart(2, "0");

/** Date-time group (UTC): "121736ZOCT26" = the 12th, 17:36Z, October 2026. */
export function dtg(t: number): string {
  const d = new Date(t);
  return `${dtgShort(t)}${MONTHS[d.getUTCMonth()]}${pad(d.getUTCFullYear() % 100)}`;
}

/** Short date-time group for log lines (UTC): "121736Z". */
export function dtgShort(t: number): string {
  const d = new Date(t);
  return `${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}Z`;
}

const NATO = [
  "ALPHA", "BRAVO", "CHARLIE", "DELTA", "ECHO", "FOXTROT", "GOLF", "HOTEL", "INDIA", "JULIETT", "KILO", "LIMA", "MIKE",
  "NOVEMBER", "OSCAR", "PAPA", "QUEBEC", "ROMEO", "SIERRA", "TANGO", "UNIFORM", "VICTOR", "WHISKEY", "XRAY", "YANKEE", "ZULU",
];

/** Unit call sign for a 1-based slot: 1 → "ALPHA", 2 → "BRAVO", 27 → "ALPHA 2". */
export function callsign(slot: number): string {
  const i = Math.max(1, Math.floor(slot || 1)) - 1;
  const name = NATO[i % NATO.length]!;
  const lap = Math.floor(i / NATO.length);
  return lap ? `${name} ${lap + 1}` : name;
}
