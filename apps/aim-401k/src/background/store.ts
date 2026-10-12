import { api } from "../shared/api";
import { normalizeProfile, normalizeSettings, STORAGE_KEYS } from "../shared/defaults";
import type { AnswerEntry, IntelItem, Job, Need, OpsEvent, Profile, Settings } from "../shared/types";

export interface State {
  profile: Profile;
  settings: Settings;
  jobs: Job[];
  answers: AnswerEntry[];
  needs: Need[];
  /** War Room terminal, newest last, capped. */
  ops: OpsEvent[];
  /** Inbox / spreadsheet signals, newest first, capped. */
  intel: IntelItem[];
}

type Key = keyof State;
const KEYS = Object.keys(STORAGE_KEYS) as Key[];

let cache: State | null = null;
let lock: Promise<unknown> = Promise.resolve();
/** JSON of what we last wrote per key, so our own storage.onChanged echoes are ignored. */
const lastWritten: Partial<Record<Key, string>> = {};

async function readAll(): Promise<State> {
  const raw = (await api.storage.local.get(KEYS)) as Partial<State>;
  return {
    profile: normalizeProfile(raw.profile),
    settings: normalizeSettings(raw.settings),
    jobs: raw.jobs ?? [],
    answers: raw.answers ?? [],
    needs: raw.needs ?? [],
    ops: raw.ops ?? [],
    intel: raw.intel ?? [],
  };
}

export async function getState(): Promise<State> {
  await lock;
  cache ??= await readAll();
  return cache;
}

/**
 * Serialized read-modify-write. The background is an event page that can be
 * woken by several messages at once; the lock keeps updates from interleaving.
 * Only keys whose content changed are written back.
 */
export function mutate<T>(fn: (s: State) => T | Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    cache ??= await readAll();
    const before = Object.fromEntries(KEYS.map((k) => [k, JSON.stringify(cache![k])]));
    const result = await fn(cache);
    const changed: Partial<State> = {};
    for (const k of KEYS) {
      const json = JSON.stringify(cache[k]);
      if (json !== before[k]) {
        (changed as Record<string, unknown>)[k] = cache[k];
        lastWritten[k] = json;
      }
    }
    if (Object.keys(changed).length) await api.storage.local.set(changed);
    return result;
  };
  const p = lock.then(run, run);
  lock = p.catch(() => undefined);
  return p;
}

// Options/tracker pages write profile/settings/answers directly; fold those
// external writes into the cache. Echoes of our own writes are skipped, and
// updates go through the lock so they can't land in the middle of a mutate.
api.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const external = KEYS.filter((k) => {
    const c = changes[k];
    return c && "newValue" in c && JSON.stringify(c.newValue) !== lastWritten[k];
  });
  if (!external.length) return;
  const apply = () => {
    if (!cache) return;
    for (const k of external) {
      const v = changes[k]!.newValue;
      lastWritten[k] = JSON.stringify(v);
      const c = cache as unknown as Record<string, unknown>;
      if (k === "profile") c[k] = normalizeProfile(v);
      else if (k === "settings") c[k] = normalizeSettings(v);
      else c[k] = v ?? [];
    }
  };
  lock = lock.then(apply, apply);
});
