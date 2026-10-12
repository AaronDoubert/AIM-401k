import { isPlaceholderOption } from "../core/choose";
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
    if (["email", "tel", "url", "number", "date"].includes(t)) return t as FieldKind;
    return "text";
  }
  return null;
}

function usable(el: HTMLElement, kind: FieldKind): boolean {
  if ((el as HTMLInputElement).disabled) return false;
  if ((el as HTMLInputElement).readOnly && kind !== "combobox") return false;
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
    const kind = kindOf(el) ?? (el.getAttribute("role") === "combobox" ? "combobox" : null);
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

  // De-duplicate keys (forms sometimes reuse names across sections).
  const counts = new Map<string, number>();
  for (const f of out) {
    const n = counts.get(f.info.key) ?? 0;
    counts.set(f.info.key, n + 1);
    if (n > 0) f.info.key = `${f.info.key}#${n}`;
  }
  return out;
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
