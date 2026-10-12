// Save only what a page actually changed. Settings/profile pages hold a copy
// loaded when they opened; other surfaces (War Room AFK + units, Gmail connect,
// "forget AI keys", answers remembered from the overlay) change storage in the
// meantime. Writing the stale copy back would undo those changes.

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Three-way merge: apply the differences between `base` (what the page loaded)
 * and `edited` (what it holds now) onto `current` (what's in storage now).
 * Nested plain objects merge key by key; arrays and scalars are replaced whole.
 */
export function mergeEdits<T>(base: T, edited: T, current: T): T {
  const b = base as unknown as Obj;
  const e = edited as unknown as Obj;
  const out: Obj = { ...(current as unknown as Obj) };
  for (const k of new Set([...Object.keys(b), ...Object.keys(e)])) {
    if (same(b[k], e[k])) continue;
    if (isObj(b[k]) && isObj(e[k]) && isObj(out[k])) out[k] = mergeEdits(b[k], e[k], out[k]);
    else if (e[k] === undefined) delete out[k];
    else out[k] = e[k];
  }
  return out as T;
}

/** Same idea for lists of records with ids (saved answers): adds, edits and deletes by id. */
export function mergeById<T extends { id: string }>(base: T[], edited: T[], current: T[]): T[] {
  const baseById = new Map(base.map((x) => [x.id, x]));
  const editedIds = new Set(edited.map((x) => x.id));
  const deleted = new Set(base.filter((x) => !editedIds.has(x.id)).map((x) => x.id));
  const changed = edited.filter((x) => !same(baseById.get(x.id), x));
  const changedIds = new Set(changed.map((x) => x.id));
  // Newly added/edited first (matches the editor's order), then the rest of storage.
  return [...changed, ...current.filter((x) => !deleted.has(x.id) && !changedIds.has(x.id))];
}

export const snapshot = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
