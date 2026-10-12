import { api } from "../shared/api";
import { copy, type CopyKey, isCopyKey } from "../shared/copy";
import { normalizeSettings, STORAGE_KEYS } from "../shared/defaults";
import type { ToBackground } from "../shared/messages";
import type { JobStatus, Settings, UiSettings } from "../shared/types";

export const send = <T = unknown>(msg: ToBackground): Promise<T> => api.runtime.sendMessage(msg) as Promise<T>;

export const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

type Props<K extends keyof HTMLElementTagNameMap> = Partial<Omit<HTMLElementTagNameMap[K], "style">> & { style?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props<K> = {}, ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  const { style, ...rest } = props;
  Object.assign(e, rest);
  if (style) e.setAttribute("style", style);
  for (const k of kids) e.append(k);
  return e;
}

export function toast(msg: string): void {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1800);
}

// --- copy / status labels ----------------------------------------------------

type Mode = { ui: { chud: boolean } } | boolean;

/** Every job status, in pipeline order. */
export const JOB_STATUSES: JobStatus[] = ["saved", "queued", "running", "needs_you", "ready_to_submit", "submitted", "interviewing", "offer", "rejected", "failed", "skipped"];

/** Display label for a job status (CHUD or plain, per settings.ui.chud). */
export function statusLabel(mode: Mode, status: JobStatus | string): string {
  const key = `status.${status}`;
  return isCopyKey(key) ? copy(mode, key) : String(status);
}

/** @deprecated Plain labels only; use statusLabel(settings, status). Kept for older imports. */
export const STATUS_LABEL: Record<string, string> = Object.fromEntries(JOB_STATUSES.map((s) => [s, statusLabel(false, s)]));

/**
 * Apply copy to static markup:
 * - `data-copy="key"`        → textContent = copy(mode, key)
 * - `data-copy-plain="key"`  → the plain variant, shown only in CHUD mode (a subtitle under a call sign)
 * - `data-copy-ph="key"`     → placeholder
 * - `data-copy-label="key"`  → aria-label + title
 * Also sets `<html data-chud="1|0">` so CSS can adapt (e.g. uppercase data lines).
 */
export function applyCopy(mode: Mode, root: ParentNode = document): void {
  const chud = typeof mode === "boolean" ? mode : mode.ui.chud;
  document.documentElement.dataset.chud = chud ? "1" : "0";
  const key = (el: Element, attr: string): CopyKey | null => {
    const k = el.getAttribute(attr);
    return k && isCopyKey(k) ? k : null;
  };
  for (const el of root.querySelectorAll<HTMLElement>("[data-copy]")) {
    const k = key(el, "data-copy");
    if (k) el.textContent = copy(chud, k);
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-copy-plain]")) {
    const k = key(el, "data-copy-plain");
    if (!k) continue;
    const plain = copy(false, k);
    el.textContent = plain;
    el.hidden = !chud || plain.toLowerCase() === copy(true, k).toLowerCase();
  }
  for (const el of root.querySelectorAll<HTMLInputElement>("[data-copy-ph]")) {
    const k = key(el, "data-copy-ph");
    if (k) el.placeholder = copy(chud, k);
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-copy-label]")) {
    const k = key(el, "data-copy-label");
    if (!k) continue;
    el.setAttribute("aria-label", copy(chud, k));
    el.title = copy(chud, k);
  }
}

/** Zero-padded number for HUD readouts ("03"). */
export const pad = (n: number, width = 2): string => String(Math.max(0, Math.trunc(n))).padStart(width, "0");

export async function loadSettings(): Promise<Settings> {
  const raw = (await api.storage.local.get(STORAGE_KEYS.settings)) as { settings?: unknown };
  return normalizeSettings(raw.settings);
}

/** Read-modify-write of settings.ui only, so it never clobbers other settings. */
export async function setUi(patch: Partial<UiSettings>): Promise<Settings> {
  const raw = (await api.storage.local.get(STORAGE_KEYS.settings)) as { settings?: Record<string, unknown> };
  const cur = normalizeSettings(raw.settings);
  const ui = { ...cur.ui, ...patch };
  await api.storage.local.set({ settings: { ...(raw.settings ?? {}), ui } });
  return { ...cur, ui };
}

export function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
