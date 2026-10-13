// Free-text job location -> a place on the offline USA map. Pure; no network, no geocoder.
// Resolution order: foreign -> city (known table) -> state centroid -> remote -> unknown.
import { CITIES, STATES } from "./usmap.data";

export interface Place {
  kind: "city" | "state" | "remote" | "foreign" | "unknown";
  /** Stable grouping key: "city:austin-tx", "state:TX", "remote", "foreign", "unknown". */
  key: string;
  label: string;
  state?: string;
  x?: number;
  y?: number;
}

const UNKNOWN: Place = { kind: "unknown", key: "unknown", label: "Unknown" };
const REMOTE: Place = { kind: "remote", key: "remote", label: "Remote" };
const FOREIGN: Place = { kind: "foreign", key: "foreign", label: "Outside the US" };

/** 2-letter tokens that are also common English words: states only after a comma or alone. */
const AMBIGUOUS = new Set(["IN", "OR", "ME", "HI", "OK", "ID", "DE", "AL"]);

const COUNTRY_US = new Set(["us", "usa", "united states", "united states of america", "america", "u s", "u s a"]);

const FOREIGN_WORDS = new Set(
  [
    "uk", "united kingdom", "england", "scotland", "wales", "canada", "germany", "france", "india", "ireland",
    "australia", "netherlands", "spain", "italy", "poland", "israel", "singapore", "japan", "china", "brazil",
    "mexico", "sweden", "switzerland", "norway", "denmark", "finland", "portugal", "romania", "ukraine",
    "argentina", "colombia", "philippines", "uae", "united arab emirates", "south korea", "korea", "taiwan",
    "new zealand", "south africa", "nigeria", "kenya", "egypt", "vietnam", "thailand", "indonesia", "pakistan",
    "bangladesh", "turkey", "czech republic", "czechia", "austria", "belgium", "hungary", "greece", "emea",
    "apac", "latam", "europe", "asia",
    "london", "toronto", "berlin", "paris", "dublin", "bangalore", "bengaluru", "hyderabad", "tel aviv",
    "vancouver", "montreal", "sydney", "amsterdam", "munich", "zurich", "tokyo", "mumbai", "pune", "ottawa",
    "calgary", "melbourne australia", "stockholm", "madrid", "barcelona", "lisbon", "warsaw", "krakow",
  ].map(norm),
);

const REMOTE_RE = /\b(remote|work from home|wfh|telecommute|anywhere|distributed)\b/;
const MODE_RE = /\b(hybrid|on ?site|in ?office|in person|office|based|flexible|multiple locations?|various)\b/g;

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.]/g, " ")
    .replace(/\bsaint\b/g, "st")
    .replace(/\s+/g, " ")
    .trim();
}

const slug = (s: string) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const STATE_BY_NAME = new Map<string, string>();
for (const [code, s] of Object.entries(STATES)) STATE_BY_NAME.set(norm(s.name), code);
STATE_BY_NAME.set("washington dc", "DC");
STATE_BY_NAME.set("washington d c", "DC");
STATE_BY_NAME.set("pr", "PR");
STATE_BY_NAME.set("puerto rico", "PR");
const STATE_NAMES_BY_LENGTH = [...STATE_BY_NAME.keys()].sort((a, b) => b.length - a.length);

const CITY_BY_KEY = new Map<string, (typeof CITIES)[number]>();
const CITY_NAME_STATES = new Map<string, string[]>();
for (const c of CITIES) {
  CITY_BY_KEY.set(`${norm(c[0])}|${c[1]}`, c);
  const arr = CITY_NAME_STATES.get(norm(c[0])) ?? [];
  arr.push(c[1]);
  CITY_NAME_STATES.set(norm(c[0]), arr);
}

/** Colloquial names: whole-string aliases to a [city, state] in CITIES. */
const ALIASES: Record<string, [string, string]> = {
  nyc: ["New York", "NY"],
  "new york": ["New York", "NY"],
  "new york city": ["New York", "NY"],
  manhattan: ["New York", "NY"],
  sf: ["San Francisco", "CA"],
  "bay area": ["San Francisco", "CA"],
  "san francisco bay area": ["San Francisco", "CA"],
  "silicon valley": ["San Jose", "CA"],
  la: ["Los Angeles", "CA"],
  dc: ["Washington", "DC"],
  "washington dc": ["Washington", "DC"],
  "washington d c": ["Washington", "DC"],
  dmv: ["Washington", "DC"],
  "twin cities": ["Minneapolis", "MN"],
  "research triangle": ["Raleigh", "NC"],
  dfw: ["Dallas", "TX"],
  "dallas fort worth": ["Dallas", "TX"],
  "salt lake": ["Salt Lake City", "UT"],
  slc: ["Salt Lake City", "UT"],
  philly: ["Philadelphia", "PA"],
};

function cityPlace(c: (typeof CITIES)[number]): Place {
  return { kind: "city", key: `city:${slug(c[0])}-${c[1].toLowerCase()}`, label: `${c[0]}, ${c[1]}`, state: c[1], x: c[2], y: c[3] };
}

function statePlace(code: string): Place {
  const s = STATES[code];
  if (!s) return { ...UNKNOWN, state: code };
  return { kind: "state", key: `state:${code}`, label: s.name, state: code, x: s.x, y: s.y };
}

/** Strip area suffixes/prefixes so "Greater Seattle Area" and "Seattle Metro" read as "seattle". */
function cleanCityName(n: string): string {
  return n
    .replace(/^greater\s+/, "")
    .replace(/\s+(metropolitan area|metro area|metro|area|region|bay area)$/, (m) => (m.trim() === "bay area" ? m : ""))
    .trim();
}

function lookupCity(name: string, state?: string): Place | null {
  const n = cleanCityName(name);
  const alias = ALIASES[n];
  if (alias && (!state || state === alias[1])) {
    const c = CITY_BY_KEY.get(`${norm(alias[0])}|${alias[1]}`);
    if (c) return cityPlace(c);
  }
  if (state) {
    const c = CITY_BY_KEY.get(`${n}|${state}`);
    return c ? cityPlace(c) : null;
  }
  const states = CITY_NAME_STATES.get(n);
  if (states && states.length === 1) {
    const c = CITY_BY_KEY.get(`${n}|${states[0]}`);
    if (c) return cityPlace(c);
  }
  return null;
}

/** "texas", "tx" -> code. Ambiguous abbreviations only when `allowAmbiguous`. */
function stateCode(token: string, allowAmbiguous: boolean): string | null {
  const t = token.trim();
  if (!t) return null;
  if (/^[a-z]{2}$/.test(t)) {
    const up = t.toUpperCase();
    if (!STATES[up]) return null;
    if (AMBIGUOUS.has(up) && !allowAmbiguous) return null;
    return up;
  }
  return STATE_BY_NAME.get(t) ?? null;
}

/** Resolve one cleaned (no remote/hybrid words) alternative to a physical place, or null. */
function physical(text: string): Place | null {
  const parts = text
    .split(",")
    .map((p) => p.replace(/\b\d{5}(?:-\d{4})?\b/g, "").replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, "").trim())
    .map(norm)
    .filter((p) => p && !COUNTRY_US.has(p));
  if (!parts.length) return null;

  // "City, ST" / "City, State"
  if (parts.length >= 2) {
    const st = stateCode(parts[1] as string, true) ?? stateCode(parts[parts.length - 1] as string, true);
    if (st) {
      const first = parts[0] as string;
      return lookupCity(first, st) ?? statePlace(st);
    }
    return lookupCity(parts[0] as string);
  }

  const only = parts[0] as string;
  const whole = lookupCity(only);
  if (whole) return whole;
  const st = stateCode(only, true);
  if (st) return statePlace(st);

  // "Austin TX" / "Austin Texas" (no comma): ambiguous abbreviations don't count here.
  const m = /^(.+?)\s+([a-z]{2})$/.exec(only);
  if (m) {
    const s2 = stateCode(m[2] as string, false);
    if (s2) return lookupCity(m[1] as string, s2) ?? statePlace(s2);
  }
  for (const name of STATE_NAMES_BY_LENGTH) {
    if (name.length > 2 && only.endsWith(` ${name}`)) {
      const code = STATE_BY_NAME.get(name) as string;
      return lookupCity(only.slice(0, -name.length - 1), code) ?? statePlace(code);
    }
  }
  return null;
}

function isForeign(text: string): boolean {
  const parts = text.split(",").map((p) => norm(p.replace(/\b\d{4,}\b/g, "")));
  return parts.some((p) => FOREIGN_WORDS.has(p));
}

export function parseLocation(text: string): Place {
  const raw = (text ?? "").trim();
  if (!raw) return UNKNOWN;
  const alternatives = raw.split(/\s+or\s+|\s*[|;]\s*|\s+\/\s+|\s*\/\s*/i);

  let remote = false;
  let foreign = false;
  for (const alt of alternatives) {
    let t = norm(alt.replace(/[()]/g, " , ")).replace(/\s*,\s*(,\s*)+/g, ", ");
    const isRemote = REMOTE_RE.test(t);
    t = t.replace(REMOTE_RE, " ").replace(MODE_RE, " ");
    t = t.replace(/\s+-\s+|\s+–\s+/g, ", ").replace(/\s+/g, " ");
    if (isForeign(t)) {
      foreign = true;
      remote ||= isRemote;
      continue;
    }
    const p = physical(t);
    if (p) return p;
    remote ||= isRemote;
  }
  if (remote) return REMOTE;
  if (foreign) return FOREIGN;
  return UNKNOWN;
}
