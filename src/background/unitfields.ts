// Validation for the field checklist a content script reports with its unit state.
import type { FieldCheck } from "../shared/types";

export const MAX_UNIT_FIELDS = 30;
export const MAX_FIELD_LABEL = 60;
const STATES = new Set<FieldCheck["state"]>(["ok", "ai", "need", "todo"]);

/** Untrusted input → a clean checklist, or undefined when nothing usable was sent. */
export function sanitizeFields(raw: unknown): FieldCheck[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: FieldCheck[] = [];
  for (const item of raw) {
    if (out.length >= MAX_UNIT_FIELDS) break;
    if (!item || typeof item !== "object") continue;
    const { label, state } = item as { label?: unknown; state?: unknown };
    if (typeof label !== "string" || !STATES.has(state as FieldCheck["state"])) continue;
    const text = label.replace(/\s+/g, " ").trim().slice(0, MAX_FIELD_LABEL);
    if (text) out.push({ label: text, state: state as FieldCheck["state"] });
  }
  return out.length ? out : undefined;
}
