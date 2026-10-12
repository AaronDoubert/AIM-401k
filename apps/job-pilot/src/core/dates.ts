// Date parsing/formatting for application forms. Values are carried around in
// ISO-ish form ("YYYY-MM-DD", "YYYY-MM", "YYYY") and formatted for each field
// at fill time (native date inputs, MM/DD/YYYY text boxes, month selects…).

export interface DateParts {
  y: number;
  m?: number; // 1-12
  d?: number; // 1-31
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export function monthFromName(s: string): number | null {
  const t = s.trim().toLowerCase().replace(/[.,]$/, "");
  if (t.length < 3 || !/^[a-z]+$/.test(t)) return null;
  const i = MONTHS.findIndex((m) => m.startsWith(t));
  return i >= 0 ? i + 1 : null;
}

function valid(p: DateParts): DateParts | null {
  if (p.y < 1900 || p.y > 2200) return null;
  if (p.m != null && (p.m < 1 || p.m > 12)) return null;
  if (p.d != null && (p.d < 1 || p.d > 31)) return null;
  return p;
}

const fourDigit = (y: number) => (y < 100 ? (y > 50 ? 1900 + y : 2000 + y) : y);

export function addDays(today: Date, n: number): DateParts {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n);
  return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() };
}

export function todayParts(today = new Date()): DateParts {
  return addDays(today, 0);
}

/** "2 weeks", "immediately", "1 month notice", "30 days" → a concrete date. */
export function relativeToDate(text: string, today = new Date()): DateParts | null {
  const t = text.toLowerCase();
  if (/\b(immediate(ly)?|asap|right away|now|today|available now)\b/.test(t)) return todayParts(today);
  const m = t.match(/(\d+|one|two|three|four|six)\s*(day|week|month)s?/);
  if (!m) return null;
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, six: 6 };
  const n = words[m[1]!] ?? Number(m[1]);
  const unit = m[2] === "day" ? 1 : m[2] === "week" ? 7 : 30;
  return addDays(today, n * unit);
}

export function isPresent(text: string): boolean {
  return /^(present|current|now|ongoing|today)$/i.test(text.trim());
}

/** Parse most human/ISO date spellings. Ambiguous a/b/yyyy is read as US M/D unless a > 12. */
export function parseDate(input: string, today = new Date()): DateParts | null {
  const s = input.trim();
  if (!s) return null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?(?:T.*)?$/))) {
    return valid({ y: +m[1]!, m: +m[2]!, ...(m[3] ? { d: +m[3] } : {}) });
  }
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) {
    const a = +m[1]!;
    const b = +m[2]!;
    const y = fourDigit(+m[3]!);
    return a > 12 ? valid({ y, m: b, d: a }) : valid({ y, m: a, d: b });
  }
  if ((m = s.match(/^(\d{1,2})[-/.](\d{4})$/))) return valid({ y: +m[2]!, m: +m[1]! });
  if ((m = s.match(/^(\d{4})$/))) return valid({ y: +m[1]! });
  // "March 2021", "Mar 5, 2021", "Mar. 2021"
  if ((m = s.match(/^([A-Za-z]{3,}\.?)\s+(?:(\d{1,2})(?:st|nd|rd|th)?,?\s+)?(\d{4})$/))) {
    const mo = monthFromName(m[1]!);
    if (mo) return valid({ y: +m[3]!, m: mo, ...(m[2] ? { d: +m[2] } : {}) });
  }
  // "5 March 2021"
  if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,}\.?),?\s+(\d{4})$/))) {
    const mo = monthFromName(m[2]!);
    if (mo) return valid({ y: +m[3]!, m: mo, d: +m[1]! });
  }
  return relativeToDate(s, today);
}

const pad = (n: number) => String(n).padStart(2, "0");

export function toIso(p: DateParts): string {
  return p.m == null ? `${p.y}` : p.d == null ? `${p.y}-${pad(p.m)}` : `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/**
 * Format with a pattern made of YYYY, YY, MMMM, MMM, MM, M, DD, D and any
 * separators. Missing parts default to the 1st of the month / January.
 */
export function formatDate(p: DateParts, pattern: string): string {
  const m = p.m ?? 1;
  const d = p.d ?? 1;
  return pattern.replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D/g, (tok) => {
    switch (tok) {
      case "YYYY":
        return String(p.y);
      case "YY":
        return pad(p.y % 100);
      case "MMMM":
        return cap(MONTHS[m - 1]!);
      case "MMM":
        return cap(MONTHS[m - 1]!.slice(0, 3));
      case "MM":
        return pad(m);
      case "M":
        return String(m);
      case "DD":
        return pad(d);
      default:
        return String(d);
    }
  });
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** Find a date format hint like "MM/DD/YYYY" or "(mm/yyyy)" in placeholder/label text. */
export function patternFromHint(text: string): string | null {
  const m = text.toUpperCase().match(/\b((?:[MDY]{1,4}[/.\- ]){1,2}[MDY]{1,4})\b/);
  if (!m) return null;
  const pat = m[1]!;
  // Must contain a year or month token and only sane token lengths.
  if (!/Y/.test(pat) || !/^(?:(?:YYYY|YY|MM|M|DD|D)[/.\- ]?)+$/.test(pat)) return null;
  return pat;
}

/** Options look like a month picker ("January", "Jan", "01"…)? */
export function isMonthList(options: string[]): boolean {
  const named = options.filter((o) => monthFromName(o) != null).length;
  const numeric = options.filter((o) => /^(0?[1-9]|1[0-2])$/.test(o.trim())).length;
  return named >= 12 || (numeric >= 12 && options.length <= 13);
}

/** Pick the option index for a month (works for "March", "Mar", "03", "3"). */
export function monthOption(options: string[], month: number): number {
  return options.findIndex((o) => monthFromName(o) === month || (/^\d{1,2}$/.test(o.trim()) && +o.trim() === month));
}

export function isYearList(options: string[]): boolean {
  return options.length >= 3 && options.filter((o) => /^(19|20|21)\d{2}$/.test(o.trim())).length >= options.length * 0.8;
}
