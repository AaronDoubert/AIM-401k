// Parsers for the Gmail / Outlook web message lists. Read-only and DOM-only
// (no extension APIs) so they can be unit-tested against saved markup.
// Both webmail UIs change their markup often: every field has fallbacks.
import type { RawMail } from "../shared/types";

export type MailProvider = "gmail" | "outlook";

export const WINDOW_DAYS = 60;
export const MAX_PER_SCAN = 100;
const DAY = 86_400_000;

export function providerFor(host: string): MailProvider | null {
  const h = host.toLowerCase();
  if (h === "mail.google.com") return "gmail";
  if (/^outlook\.(live|office|office365)\.com$/.test(h)) return "outlook";
  return null;
}

/** Only inbox-like views: the Sent / Drafts / Trash / Spam lists are the user's own or junk. */
export function isReadableView(provider: MailProvider, loc: { hash: string; pathname: string }): boolean {
  if (provider === "gmail") return !/^#(sent|drafts?|trash|spam|scheduled|outbox|chats?)\b/i.test(loc.hash);
  return !/\/(sentitems|drafts|deleteditems|junkemail|outbox|archive\/sent)\b/i.test(loc.pathname);
}

/** Small stable hash (FNV-1a, base36) for ids when the markup has none. */
export function hashId(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const clean = (s: string | null | undefined) => (s ?? "").replace(/[  ​\s]+/g, " ").trim();
const text = (el: Element | null | undefined) => clean(el?.textContent);

// ---------------------------------------------------------------------------
// dates as webmail shows them

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const WEEKDAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MON = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";

/**
 * Parse the date strings Gmail and Outlook put in list rows and their tooltips:
 * "Mon, Oct 12, 2026, 9:14 AM", "12 Oct 2026, 09:14", "Oct 3", "9:14 AM",
 * "Mon 10/12/2026 9:14 AM", "10/3/25", "Yesterday", "Sun 3:15 PM", ISO.
 * Returns null when there's nothing date-like.
 */
export function parseMailDate(raw: string, now = Date.now()): number | null {
  const t = clean(raw).toLowerCase();
  if (!t || !/\d|today|yesterday/.test(t)) return null;
  const today = new Date(now);
  let y: number | null = null;
  let mo: number | null = null;
  let d: number | null = null;
  let m: RegExpMatchArray | null;

  if ((m = t.match(/\b(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{2}):(\d{2}))?/))) {
    const iso = Date.parse(m[0].length > 10 ? m[0].replace(" ", "T") : `${m[0]}T00:00`);
    if (Number.isFinite(iso)) return iso;
  }
  if ((m = t.match(new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`)))) {
    mo = MONTHS[m[1]!]!;
    d = +m[2]!;
    y = m[3] ? +m[3] : null;
  } else if ((m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON}(?:,?\\s+(\\d{4}))?`)))) {
    d = +m[1]!;
    mo = MONTHS[m[2]!]!;
    y = m[3] ? +m[3] : null;
  } else if ((m = t.match(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/))) {
    let a = +m[1]!;
    let b = +m[2]!;
    if (a > 12 && b <= 12) [a, b] = [b, a]; // D/M when it can only be that
    mo = a - 1;
    d = b;
    if (m[3]) y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  }

  const tm = t.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)?/);
  let hh = 0;
  let mm = 0;
  if (tm) {
    hh = +tm[1]!;
    mm = +tm[2]!;
    const ap = tm[3]?.[0];
    if (ap === "p" && hh < 12) hh += 12;
    if (ap === "a" && hh === 12) hh = 0;
  }

  if (mo == null || d == null) {
    // No calendar date: relative day, weekday ("Sun 3:15 PM") or a bare time (today).
    let back = 0;
    if (/\byesterday\b/.test(t)) back = 1;
    else {
      const wd = t.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/);
      if (wd) back = (today.getDay() - WEEKDAYS[wd[1]!]! + 7) % 7 || (tm ? 0 : 7);
      else if (!tm && !/\btoday\b/.test(t)) return null;
    }
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back, hh, mm);
    let ts = day.getTime();
    if (ts > now + 3600_000) ts -= DAY; // a time "later today" is really yesterday's
    return ts;
  }

  if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  let ts = new Date(y ?? today.getFullYear(), mo, d, hh, mm).getTime();
  // No year shown means "this year", unless that lands in the future.
  if (y == null && ts > now + 2 * DAY) ts = new Date(today.getFullYear() - 1, mo, d, hh, mm).getTime();
  return Number.isFinite(ts) ? ts : null;
}

// ---------------------------------------------------------------------------
// Gmail

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;

/** The signed-in address, from the tab title ("Inbox (3) - ada@example.com - Gmail"). */
export function gmailSelf(title: string): string {
  return title.match(EMAIL_RE)?.[0]?.toLowerCase() ?? "";
}

function gmailRows(root: ParentNode): Element[] {
  const rows = [...root.querySelectorAll("tr.zA")];
  if (rows.length) return rows;
  // Fallback when the obfuscated class names change: the list is an ARIA grid.
  return [...new Set(root.querySelectorAll('table[role="grid"] tr[role="row"], [role="main"] tr[role="row"]'))].filter((r) => r.querySelector("[email]"));
}

function gmailRow(row: Element, now: number, self: string): RawMail | null {
  const scoped = [...row.querySelectorAll(".yW [email], .yX [email]")];
  const people = scoped.length ? scoped : [...row.querySelectorAll("[email]")];
  const isSelf = (p: Element) => {
    const email = (p.getAttribute("email") ?? "").toLowerCase();
    const name = (p.getAttribute("name") ?? text(p)).toLowerCase();
    return (!!self && email === self) || name === "me";
  };
  const sender = people.find((p) => !isSelf(p)) ?? people[0];
  const from = clean(sender?.getAttribute("name")) || text(sender) || text(row.querySelector(".yW, .yX"));
  const fromEmail = (sender?.getAttribute("email") ?? text(sender).match(EMAIL_RE)?.[0] ?? "").toLowerCase();

  const subject = text(row.querySelector(".bog")) || text(row.querySelector(".bqe")) || text(row.querySelector("[data-thread-id], [data-legacy-thread-id]")) || text(row.querySelector(".y6 span"));
  const snippet = text(row.querySelector(".y2")).replace(/^[-–—\s]+/, "");
  if (!subject && !snippet) return null;

  // (querySelector with a list returns the first in document order, so try in priority order)
  const timeEl = ["td.xW span[title]", ".xW [title]", "td.xW", ".xW", "td [title][aria-label]"].map((s) => row.querySelector(s)).find(Boolean);
  const timeTitle = clean(timeEl?.getAttribute("title"));
  const receivedAt = parseMailDate(timeTitle, now) ?? parseMailDate(text(timeEl), now) ?? parseMailDate(clean(timeEl?.getAttribute("aria-label")), now);

  // Gmail's legacy ids are the same message/thread ids the Gmail API uses.
  const attr = (name: string) => row.querySelector(`[${name}]`)?.getAttribute(name) ?? "";
  const lastMsg = attr("data-legacy-last-message-id");
  const thread = attr("data-legacy-thread-id") || attr("data-thread-id").replace(/^#?thread-[a-z]:/i, "");
  const messageId = lastMsg || (thread ? `${thread}#${hashId(`${subject}|${snippet}`)}` : `h:${hashId([fromEmail || from, subject, snippet, timeTitle].join("|"))}`);

  return { messageId, from, fromEmail, subject, snippet, receivedAt: receivedAt ?? now };
}

export function parseGmail(root: ParentNode, now = Date.now(), self = ""): RawMail[] {
  const out: RawMail[] = [];
  for (const row of gmailRows(root)) {
    const m = gmailRow(row, now, self.toLowerCase());
    if (m) out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Outlook on the web

const OUTLOOK_NOISE =
  /^(unread|read|flagged|pinned|has attachments?|attachments?|important|high importance|low importance|external|draft|\[draft\]|replied|forwarded|meeting|focused|other|mark as (un)?read|delete|archive|flag( this message)?|pin|select( a conversation)?|selected|collapsed|expanded|no preview is available\.?|reply|reply all|forward|more( actions)?)$/i;

interface Chunk {
  el: Element;
  text: string;
}

/** Visible-ish text pieces of an item, in document order, one per element. */
function chunks(root: Element): Chunk[] {
  const out: Chunk[] = [];
  const walk = (el: Element) => {
    const tag = el.tagName.toUpperCase();
    if (["SCRIPT", "STYLE", "SVG", "BUTTON", "NOSCRIPT", "TEMPLATE", "I"].includes(tag)) return;
    const role = el.getAttribute("role");
    if (role === "button" || role === "checkbox" || role === "img") return;
    let own = "";
    const flush = () => {
      const s = clean(own);
      if (s) out.push({ el, text: s });
      own = "";
    };
    for (const n of el.childNodes) {
      if (n.nodeType === 3) own += n.textContent ?? "";
      else if (n.nodeType === 1) {
        flush();
        walk(n as Element);
      }
    }
    flush();
  };
  walk(root);
  return out.filter((c) => !OUTLOOK_NOISE.test(c.text) && !/^[A-Z]{1,2}$/.test(c.text) && !/^\(?\d{1,3}\)?$/.test(c.text));
}

function outlookItems(root: ParentNode): Element[] {
  const items = new Set<Element>();
  for (const el of root.querySelectorAll('[role="listbox"] [role="option"]')) items.add(el);
  for (const el of root.querySelectorAll("[data-convid]")) {
    const option = el.closest('[role="option"]');
    if (option && items.has(option)) continue;
    // Skip a [data-convid] nested inside another one already taken.
    if ([...items].some((i) => i.contains(el) || el.contains(i))) continue;
    items.add(el);
  }
  return [...items];
}

/** A string that is only a date/time ("Mon 10/12/2026 9:14 AM", "Yesterday", "Oct 3"), not a subject that mentions one. */
export function isDateOnly(s: string): boolean {
  const t = clean(s).toLowerCase();
  if (!t || t.length > 48 || !/\d|yesterday|today/.test(t)) return false;
  const rest = t.replace(
    /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?|\b(a\.?m\.?|p\.?m\.?|at|yesterday|today|utc|gmt)\b|\d+(st|nd|rd|th)?|[:/.,\s-]/g,
    "",
  );
  return rest.length <= 1;
}

function outlookItem(item: Element, now: number): RawMail | null {
  const parts = chunks(item);
  const used = new Set<Chunk>();

  // Sender: the element whose tooltip is an address ("Acme Robotics" title="jobs@acme.com").
  let from = "";
  let fromEmail = "";
  const senderEl = [...item.querySelectorAll("[title]")].find((e) => EMAIL_RE.test(e.getAttribute("title") ?? "") && text(e));
  if (senderEl) {
    fromEmail = (senderEl.getAttribute("title")!.match(EMAIL_RE)?.[0] ?? "").toLowerCase();
    from = text(senderEl);
    for (const c of parts) if (c.el === senderEl || senderEl.contains(c.el)) used.add(c);
  } else {
    const first = parts.find((c) => !isDateOnly(c.text));
    if (first) {
      from = first.text;
      fromEmail = from.match(EMAIL_RE)?.[0]?.toLowerCase() ?? "";
      used.add(first);
    }
  }

  // Time: a tooltip with a full date, else a short date/time text.
  let receivedAt: number | null = null;
  let timeKey = "";
  for (const e of item.querySelectorAll("[title]")) {
    const title = clean(e.getAttribute("title"));
    if (e === senderEl || !isDateOnly(title)) continue;
    const ts = parseMailDate(title, now);
    if (ts == null) continue;
    receivedAt = ts;
    timeKey = title;
    for (const c of parts) if (c.el === e || e.contains(c.el)) used.add(c);
    break;
  }
  if (receivedAt == null) {
    const c = parts.find((p) => !used.has(p) && isDateOnly(p.text) && parseMailDate(p.text, now) != null);
    if (c) {
      receivedAt = parseMailDate(c.text, now);
      timeKey = c.text;
      used.add(c);
    }
  }

  const rest = parts.filter((c) => !used.has(c));
  let subject = rest[0]?.text ?? "";
  const others = rest.slice(1);
  let snippet = others.reduce((best, c) => (c.text.length > best.length ? c.text : best), "");
  if (!subject) {
    // Last resort: the item's accessible name ("Unread Acme Robotics Next steps 9:14 AM Hi Ada…").
    subject = clean(item.getAttribute("aria-label")).replace(/^(unread|flagged|pinned|has attachments?)\s+/gi, "");
    if (from && subject.startsWith(from)) subject = subject.slice(from.length).trim();
  }
  if (!subject && !snippet) return null;
  if (snippet === subject) snippet = "";

  const convId = item.getAttribute("data-convid") ?? item.querySelector("[data-convid]")?.getAttribute("data-convid") ?? item.closest("[data-convid]")?.getAttribute("data-convid") ?? "";
  const base = convId || item.getAttribute("id") || "";
  const messageId = base ? `${base}#${hashId(`${subject}|${snippet}`)}` : `h:${hashId([fromEmail || from, subject, snippet, timeKey].join("|"))}`;
  return { messageId, from, fromEmail, subject, snippet, receivedAt: receivedAt ?? now };
}

export function parseOutlook(root: ParentNode, now = Date.now()): RawMail[] {
  const out: RawMail[] = [];
  for (const item of outlookItems(root)) {
    const m = outlookItem(item, now);
    if (m) out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------------------

/** Keep the last `days` days, newest first, at most `max`, no duplicate ids. */
export function recentMails(mails: RawMail[], now = Date.now(), days = WINDOW_DAYS, max = MAX_PER_SCAN): RawMail[] {
  const since = now - days * DAY;
  const seen = new Set<string>();
  return mails
    .filter((m) => m.receivedAt >= since && !seen.has(m.messageId) && seen.add(m.messageId))
    .sort((a, b) => b.receivedAt - a.receivedAt)
    .slice(0, max);
}
