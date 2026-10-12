import { api } from "../shared/api";
import type { ToBackground } from "../shared/messages";

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

export const STATUS_LABEL: Record<string, string> = {
  saved: "Saved",
  queued: "Queued",
  running: "Applying",
  needs_you: "Needs you",
  ready_to_submit: "Ready to submit",
  submitted: "Applied",
  failed: "Failed",
  skipped: "Skipped",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Rejected",
};

export function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
