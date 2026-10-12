import { isPlaceholderOption } from "../core/choose";
import { isMonthList, isYearList, patternFromHint } from "../core/dates";
import type { FieldInfo, FieldKind } from "../core/matcher";
import { cleanLabel, norm } from "../core/text";
import { controlLabel, groupLabel, humanizeAttr, isVisible, optionLabel, queryAll, textOf } from "./dom";

export interface ScannedField {
  info: FieldInfo;
  /** The control, or every member of a radio/checkbox group. */
  els: HTMLElement[];
}

const SKIP_TYPES = new Set(["hidden", "submit", "button", "reset", "image", "password", "search", "range", "color"]);

function isRequired(el: HTMLElement, label: string): boolean {
  return (
    (el as HTMLInputElement).required ||
    el.getAttribute("aria-required") === "true" ||
    /\*|\(required\)/i.test(label) ||
    !!el.closest("[aria-required=true], .required, [data-required=true]")
  );
}

function kindOf(el: HTMLElement): FieldKind | null {
  if (el instanceof HTMLSelectElement) return "select";
  if (el instanceof HTMLTextAreaElement) return "textarea";
  if (el instanceof HTMLButtonElement) return el.getAttribute("aria-haspopup") === "listbox" ? "combobox" : null;
  if (el instanceof HTMLInputElement) {
    const t = (el.type || "text").toLowerCase();
    if (SKIP_TYPES.has(t)) return el.getAttribute("role") === "combobox" ? "combobox" : null;
    if (el.getAttribute("role") === "combobox" || el.getAttribute("aria-autocomplete") === "list") return "combobox";
    if (t === "radio" || t === "checkbox" || t === "file") return t as FieldKind;
    if (t === "date" || t === "month" || t === "datetime-local") return "date";
    if (["email", "tel", "url", "number"].includes(t)) return t as FieldKind;
    return "text";
  }
  return null;
}

const DATE_ATTR_RE = /date|datepicker|calendar|\bdob\b|birthday/i;

/** Text box that wants a date: returns its format, e.g. "MM/DD/YYYY". */
function textDatePattern(el: HTMLElement, label: string): string | null {
  const hint =
    patternFromHint(el.getAttribute("placeholder") ?? "") ||
    patternFromHint(label) ||
    patternFromHint(el.getAttribute("aria-label") ?? "") ||
    patternFromHint(el.getAttribute("title") ?? "") ||
    patternFromHint(el.getAttribute("data-date-format") ?? "");
  if (hint) return hint;
  const attrs = `${el.id} ${el.getAttribute("name") ?? ""} ${el.className} ${el.getAttribute("data-automation-id") ?? ""} ${el.getAttribute("autocomplete") ?? ""}`;
  if (DATE_ATTR_RE.test(attrs) || (/\bdate\b/i.test(label) && !/update/i.test(label))) return "MM/DD/YYYY";
  return null;
}

function nativeDatePattern(el: HTMLInputElement): string {
  return el.type === "month" ? "YYYY-MM" : el.type === "datetime-local" ? "YYYY-MM-DDT09:00" : "YYYY-MM-DD";
}

function usable(el: HTMLElement, kind: FieldKind): boolean {
  if ((el as HTMLInputElement).disabled) return false;
  // Read-only text boxes are skipped, except date pickers (filled via the picker or by typing).
  if ((el as HTMLInputElement).readOnly && kind !== "combobox" && kind !== "date") return false;
  if (el.closest("[aria-hidden=true]") && kind !== "file") return false;
  // File inputs and styled radios/checkboxes are often visually hidden behind a
  // custom widget; judge those by their label instead.
  if (kind === "file") return true;
  if (kind === "radio" || kind === "checkbox") {
    const lab = (el as HTMLInputElement).labels?.[0];
    return isVisible(el) || (!!lab && isVisible(lab));
  }
  return isVisible(el);
}

function keyFor(el: HTMLElement, kind: FieldKind, label: string): string {
  const id = el.getAttribute("name") || el.id || el.getAttribute("data-automation-id") || norm(label).slice(0, 60);
  return `${kind}:${id}`;
}

function selectOptions(el: HTMLSelectElement): string[] {
  return Array.from(el.options)
    .map((o) => o.text.trim())
    .filter((t) => t && !isPlaceholderOption(t));
}

function comboOptions(el: HTMLElement): string[] {
  const id = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
  const list = id ? el.ownerDocument.getElementById(id) : null;
  if (!list) return [];
  return Array.from(list.querySelectorAll("[role=option]")).map(textOf).filter(Boolean);
}

/** Find every fillable control on the page and describe it. */
export function scanFields(root: Document | ShadowRoot = document): ScannedField[] {
  const out: ScannedField[] = [];
  const groups = new Map<string, HTMLInputElement[]>();
  const containerIds = new Map<Element, number>();
  const push = (info: FieldInfo, els: HTMLElement[]) => out.push({ info, els });

  const controls = queryAll<HTMLElement>(
    "input, select, textarea, [role=combobox]:not(input), button[aria-haspopup=listbox]",
    root,
  );
  for (const el of controls) {
    let kind = kindOf(el) ?? (el.getAttribute("role") === "combobox" ? "combobox" : null);
    let datePattern: string | undefined;
    if (kind === "date") datePattern = nativeDatePattern(el as HTMLInputElement);
    else if (kind === "text") {
      const pat = textDatePattern(el, controlLabel(el));
      if (pat) {
        kind = "date";
        datePattern = pat;
      }
    }
    if (!kind || !usable(el, kind)) continue;

    if (kind === "radio" || kind === "checkbox") {
      const input = el as HTMLInputElement;
      const container = input.closest("fieldset, [role=radiogroup], [role=group]");
      let gk = "";
      if (input.name) gk = `${kind}|name|${input.name}`;
      else if (container) {
        if (!containerIds.has(container)) containerIds.set(container, containerIds.size);
        gk = `${kind}|box|${containerIds.get(container)}`;
      }
      if (gk) {
        // Keep group insertion order: create a placeholder now, fill later.
        const existing = groups.get(gk);
        if (existing) {
          existing.push(input);
          continue;
        }
        groups.set(gk, [input]);
        out.push({ info: { key: gk, kind, label: "", attrs: "", autocomplete: "", placeholder: "", required: false, options: [] }, els: [input] });
        continue;
      }
    }

    const label = cleanLabel(controlLabel(el));
    const rawLabel = controlLabel(el);
    push(
      {
        key: keyFor(el, kind, label),
        kind,
        label,
        attrs: humanizeAttr(el.getAttribute("name") || el.id),
        autocomplete: (el.getAttribute("autocomplete") || "").toLowerCase(),
        placeholder: el.getAttribute("placeholder") || "",
        required: isRequired(el, rawLabel),
        options: el instanceof HTMLSelectElement ? selectOptions(el) : kind === "combobox" ? comboOptions(el) : [],
        ...(datePattern ? { datePattern } : {}),
      },
      [el],
    );
  }

  // Resolve radio / checkbox groups now that all members are known.
  for (let i = 0; i < out.length; i++) {
    const entry = out[i]!;
    const members = groups.get(entry.info.key);
    if (!members) continue;
    const kind = entry.info.kind;
    const first = members[0]!;
    if (kind === "checkbox" && members.length === 1) {
      const raw = controlLabel(first);
      const label = cleanLabel(raw) || cleanLabel(groupLabel(members));
      entry.info = {
        key: keyFor(first, "checkbox", label),
        kind: "checkbox",
        label,
        attrs: humanizeAttr(first.name || first.id),
        autocomplete: "",
        placeholder: "",
        required: isRequired(first, raw),
        options: [],
      };
      entry.els = members;
      continue;
    }
    const raw = groupLabel(members);
    const label = cleanLabel(raw);
    entry.info = {
      key: `${kind === "radio" ? "radio" : "checkboxGroup"}:${first.name || norm(label).slice(0, 60)}`,
      kind: kind === "radio" ? "radio" : "checkboxGroup",
      label,
      attrs: humanizeAttr(first.name),
      autocomplete: "",
      placeholder: "",
      required: members.some((m) => isRequired(m, raw)),
      options: members.map((m) => cleanLabel(optionLabel(m))),
    };
    entry.els = members;
  }

  const merged = groupDateParts(out);
  annotateSections(merged, root);

  // De-duplicate keys (forms sometimes reuse names across sections).
  const counts = new Map<string, number>();
  for (const f of merged) {
    const n = counts.get(f.info.key) ?? 0;
    counts.set(f.info.key, n + 1);
    if (n > 0) f.info.key = `${f.info.key}#${n}`;
  }
  return merged;
}

type Part = "m" | "d" | "y";

/** Is this control one piece of a split date (a Month box, a Year select…)? */
function datePart(f: ScannedField): Part | null {
  const el = f.els[0];
  if (!el || !["text", "number", "select", "combobox", "date"].includes(f.info.kind)) return null;
  const auto = el.getAttribute("data-automation-id") ?? "";
  const wd = auto.match(/dateSection(Month|Day|Year)/i);
  if (wd) return wd[1]!.toLowerCase()[0] as Part;
  const own = norm(`${el.getAttribute("aria-label") ?? ""} ${(el as HTMLInputElement).labels?.[0]?.textContent ?? ""}`);
  const attr = norm(humanizeAttr(el.getAttribute("name") || el.id));
  const ph = (el.getAttribute("placeholder") ?? "").trim().toUpperCase();
  const word = (re: RegExp) => re.test(own) || re.test(attr) || re.test(norm(f.info.label));
  if (el instanceof HTMLSelectElement) {
    if (isMonthList(f.info.options)) return "m";
    if (isYearList(f.info.options) && word(/\byear\b|\byyyy\b/)) return "y";
    if (f.info.options.length >= 28 && f.info.options.length <= 31 && word(/\bday\b/)) return "d";
    return null;
  }
  if (ph === "MM" || /^(month|mm)$/.test(own) || /\bmonth$/.test(attr)) return "m";
  if (ph === "DD" || /^(day|dd)$/.test(own) || /\bday$/.test(attr)) return "d";
  if (ph === "YYYY" || /^(year|yyyy)$/.test(own) || /\byear$/.test(attr)) return "y";
  return null;
}

/** Merge Month/Day/Year controls that sit together into one "dateParts" field. */
function groupDateParts(fields: ScannedField[]): ScannedField[] {
  const out: ScannedField[] = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!;
    const part = datePart(f);
    if (!part) {
      out.push(f);
      continue;
    }
    const members: { f: ScannedField; part: Part }[] = [{ f, part }];
    for (let j = i + 1; j < fields.length && members.length < 3; j++) {
      const g = fields[j]!;
      const p = datePart(g);
      if (!p || members.some((m) => m.part === p) || !near(f.els[0]!, g.els[0]!)) break;
      members.push({ f: g, part: p });
    }
    if (members.length < 2) {
      out.push(f);
      continue;
    }
    i += members.length - 1;
    const els = members.map((m) => m.f.els[0]!);
    const raw = groupLabel(els) || members.map((m) => m.f.info.label).join(" ");
    const label = cleanLabel(raw.replace(/\b(month|day|year|mm|dd|yyyy)\b/gi, " "));
    out.push({
      info: {
        key: `dateParts:${f.info.key}`,
        kind: "dateParts",
        label,
        attrs: f.info.attrs,
        autocomplete: "",
        placeholder: "",
        required: members.some((m) => m.f.info.required) || /\*/.test(raw),
        options: [],
        parts: members.map((m) => m.part),
      },
      els,
    });
  }
  return out;
}

/** Two controls share a small common container (same date widget). */
function near(a: Element, b: Element): boolean {
  let p: Element | null = a.parentElement;
  for (let d = 0; p && d < 4; d++, p = p.parentElement) if (p.contains(b)) return true;
  return false;
}

const HEADING_SEL = "h2, h3, h4, h5, h6, legend, [role=heading], .section-title, .section-header";

/** A legend only names a section when its fieldset holds a block of fields, not a single radio question. */
function isSectionHeading(h: HTMLElement): boolean {
  if (h.tagName !== "LEGEND") return true;
  const fs = h.parentElement;
  return !!fs && fs.querySelectorAll("input:not([type=radio]):not([type=checkbox]), select, textarea").length >= 3;
}

/** Tag each field with the nearest heading above it and its repeat index ("Work Experience 2" → 1). */
function annotateSections(fields: ScannedField[], root: Document | ShadowRoot): void {
  const headings = queryAll<HTMLElement>(HEADING_SEL, root).filter((h) => !h.closest("#jobpilot-root") && textOf(h).length < 80 && isSectionHeading(h));
  if (!headings.length) return;
  const seen = new Map<HTMLElement, number>();
  const counts = new Map<string, number>();
  for (const h of headings) {
    const t = textOf(h);
    const m = t.match(/\b(\d{1,2})\b/);
    const base = norm(t.replace(/\d+/g, ""));
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    seen.set(h, m ? Math.max(0, Number(m[1]) - 1) : n);
  }
  for (const f of fields) {
    const el = f.els[0];
    if (!el) continue;
    let best: HTMLElement | null = null;
    for (const h of headings) {
      // heading precedes the field in document order (or contains it, e.g. a legend's fieldset)
      if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) best = h;
      else break;
    }
    if (best) {
      f.info.section = textOf(best);
      f.info.sectionIndex = seen.get(best) ?? 0;
    }
  }
}

/** Whether the control already holds a value (ours or the user's). */
export function isFilled(f: ScannedField): boolean {
  const el = f.els[0];
  if (!el) return false;
  switch (f.info.kind) {
    case "radio":
    case "checkboxGroup":
      return f.els.some((e) => (e as HTMLInputElement).checked);
    case "checkbox":
      return (el as HTMLInputElement).checked;
    case "file":
      return ((el as HTMLInputElement).files?.length ?? 0) > 0 || el.dataset.jobpilotUploaded === "1";
    case "select": {
      const s = el as HTMLSelectElement;
      const opt = s.options[s.selectedIndex];
      return !!opt && !!s.value && !isPlaceholderOption(opt.text);
    }
    case "dateParts":
      return f.els.every((e) => (e instanceof HTMLSelectElement ? !!e.value && !isPlaceholderOption(e.options[e.selectedIndex]?.text ?? "") : !!(e as HTMLInputElement).value?.trim()));
    case "combobox":
      if (el instanceof HTMLButtonElement) return !isPlaceholderOption(textOf(el)) && !/select one/i.test(textOf(el));
      return !!(el as HTMLInputElement).value?.trim() || el.dataset.jobpilotFilled === "1";
    default:
      return !!(el as HTMLInputElement).value?.trim();
  }
}

/** Visible validation error attached to a field, if any. */
export function fieldError(f: ScannedField): string {
  for (const el of f.els) {
    if (el.getAttribute("aria-invalid") !== "true") continue;
    const described = el.getAttribute("aria-describedby") || el.getAttribute("aria-errormessage");
    if (described) {
      const t = described
        .split(/\s+/)
        .map((id) => textOf(el.ownerDocument.getElementById(id)))
        .join(" ")
        .trim();
      if (t) return t;
    }
    return "This field is invalid";
  }
  return "";
}
