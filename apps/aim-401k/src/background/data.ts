// Data & privacy: storage report, wipe, forget AI keys; plus the small AI
// helpers the setup screen asks for (local model detection, requests today).
// OWNER: Privacy agent.
import { api } from "../shared/api";
import type { StorageReport, WipeResult } from "../shared/messages";
import { normalizeProfile, normalizeSettings, STORAGE_KEYS } from "../shared/defaults";
import { preset } from "../shared/providers";
import type { Settings } from "../shared/types";
import { AI_USAGE_KEY, detectLocalAi, getAiUsage, resetAiUsage } from "./ai";
import { broadcast, register, toPages } from "./core";
import { mutate } from "./store";

export type KeepKey = "profile" | "answers" | "settings";

/** Storage keys that go with settings (kept when settings are kept). */
const WITH_SETTINGS = [AI_USAGE_KEY];

/** Approximate size of a stored value: the length of its JSON. */
export function approxBytes(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

/** Build the report from a raw `storage.local.get(null)` snapshot (pure, unit-tested). */
export function buildStorageReport(raw: Record<string, unknown>): StorageReport {
  const bytes: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) bytes[k] = approxBytes(v);
  const len = (k: string) => (Array.isArray(raw[k]) ? (raw[k] as unknown[]).length : 0);
  const settings: Settings = normalizeSettings(raw[STORAGE_KEYS.settings]);
  const profile = raw[STORAGE_KEYS.profile] as { resume?: unknown } | undefined;
  return {
    bytes,
    counts: { jobs: len(STORAGE_KEYS.jobs), answers: len(STORAGE_KEYS.answers), intel: len(STORAGE_KEYS.intel), ops: len(STORAGE_KEYS.ops) },
    hasResume: !!profile?.resume,
    aiProvider: settings.llmMode === "off" ? null : preset(settings.aiProvider).name,
  };
}

export async function storageReport(): Promise<StorageReport> {
  return buildStorageReport((await api.storage.local.get(null)) as Record<string, unknown>);
}

/** Which storage keys a wipe removes, given everything stored and what to keep. */
export function keysToClear(stored: string[], keep: KeepKey[]): string[] {
  const kept = new Set<string>(keep);
  if (kept.has("settings")) for (const k of WITH_SETTINGS) kept.add(k);
  return stored.filter((k) => !kept.has(k));
}

/**
 * Clear everything except what's listed in `keep`. Job tabs the extension
 * opened are closed. The background's state cache is reset through `mutate`
 * so it stays coherent with storage (no stale jobs written back later).
 */
export async function wipeAll(keep: KeepKey[] = []): Promise<WipeResult> {
  const kept = new Set(keep);
  const tabs = await mutate((s) => {
    const open = s.jobs.filter((j) => j.autoTab && j.tabId != null).map((j) => j.tabId!);
    s.jobs = [];
    s.needs = [];
    s.ops = [];
    s.intel = [];
    if (!kept.has("profile")) s.profile = normalizeProfile(undefined);
    if (!kept.has("answers")) s.answers = [];
    // API keys live in settings, so they go with them.
    if (!kept.has("settings")) s.settings = normalizeSettings(undefined);
    return open;
  });
  // Remove the keys outright (the cache above already holds the empty defaults),
  // including ones other features stored outside the shared state.
  const stored = Object.keys((await api.storage.local.get(null)) as Record<string, unknown>);
  const cleared = keysToClear(stored, keep);
  if (cleared.length) await api.storage.local.remove(cleared);
  if (cleared.includes(AI_USAGE_KEY)) resetAiUsage();
  // Close tabs after the jobs are gone, so tabs.onRemoved finds nothing to mark failed.
  let closedTabs = 0;
  for (const id of tabs) {
    try {
      await api.tabs.remove(id);
      closedTabs++;
    } catch {
      /* already closed */
    }
  }
  toPages({ type: "units", units: [] });
  toPages({ type: "intel", items: [] });
  broadcast();
  return { cleared, closedTabs };
}

/** Remove every stored AI API key (provider choice and models stay). */
export async function forgetAiKeys(): Promise<{ removed: number }> {
  return mutate((s) => {
    const removed = Object.values(s.settings.apiKeys).filter(Boolean).length;
    s.settings.apiKeys = {};
    return { removed };
  });
}

register({
  getStorageReport: () => storageReport(),
  wipeAll: (msg) => wipeAll(msg.keep ?? []),
  forgetAiKeys: () => forgetAiKeys(),
  detectLocalAi: () => detectLocalAi(),
  getAiUsage: () => getAiUsage(),
});
