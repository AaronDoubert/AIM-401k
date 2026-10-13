import type { CopyKey } from "../shared/copy";
import type { Job, JobStatus } from "../shared/types";
import { type StageId, STAGES } from "./stages";

// Tracker board view: pure grouping logic (unit-tested), no DOM.

export interface BoardColumn {
  id: StageId;
  title: CopyKey;
  statuses: JobStatus[];
  /** Status a card gets when dropped here; null = not a drop target (runtime state). */
  drop: JobStatus | null;
}

/** Board columns are the shared stages (src/ui/stages.ts), plus drop rules. */
const DROP: Record<StageId, JobStatus | null> = {
  targets: "saved",
  engaged: null,
  hold: null,
  splash: "submitted",
  contact: "interviewing",
  secured: "offer",
  lost: "rejected",
};

export const BOARD_COLUMNS: BoardColumn[] = STAGES.map((s) => ({ id: s.id, title: s.title, statuses: s.statuses, drop: DROP[s.id] }));

export function columnFor(status: JobStatus): BoardColumn["id"] {
  return (BOARD_COLUMNS.find((c) => c.statuses.includes(status)) ?? BOARD_COLUMNS[0]!).id;
}

/** Jobs per column, most recently updated first. Every job lands in exactly one column. */
export function groupForBoard(jobs: Job[]): Record<BoardColumn["id"], Job[]> {
  const out = Object.fromEntries(BOARD_COLUMNS.map((c) => [c.id, [] as Job[]])) as Record<BoardColumn["id"], Job[]>;
  for (const j of [...jobs].sort((a, b) => b.updatedAt - a.updatedAt)) out[columnFor(j.status)].push(j);
  return out;
}

/** Status to set when a card is dropped on a column, or null when the drop is a no-op / not allowed. */
export function dropStatus(job: Pick<Job, "status">, column: BoardColumn["id"]): JobStatus | null {
  const col = BOARD_COLUMNS.find((c) => c.id === column);
  if (!col?.drop || col.statuses.includes(job.status)) return null;
  return col.drop;
}

/**
 * Stable per-job call sign number ("TGT-0007"): position by creation time, 1-based.
 * Deleted jobs leave their number to the next one created; it's a label, not an id.
 */
export function callsigns(jobs: Pick<Job, "id" | "createdAt">[]): Map<string, number> {
  const sorted = [...jobs].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return new Map(sorted.map((j, i) => [j.id, i + 1]));
}
