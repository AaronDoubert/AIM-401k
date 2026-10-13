import type { CopyKey } from "../shared/copy";
import type { Job, JobStatus, Need } from "../shared/types";
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

/** Statuses that earn a badge on a board card: a sub-state inside its column, or an exception. */
const BADGED: JobStatus[] = ["queued", "ready_to_submit", "failed", "skipped"];

/**
 * Status badge for a board card, or null. The column already says Splash, Hold,
 * Contact and so on, so repeating that is noise; only what the column doesn't
 * say is shown: queued (planned), ready, and the exceptions (failed, skipped).
 */
export function cardBadge(status: JobStatus): JobStatus | null {
  return BADGED.includes(status) ? status : null;
}

/**
 * Jobs waiting on the user, oldest request first. `needIds` is what the master
 * caution lamp watches; `jobIds[0]` is where pressing it should land. Needs for
 * jobs that no longer exist are ignored.
 */
export function waitingJobs(needs: Pick<Need, "id" | "jobId" | "createdAt">[], jobs: Pick<Job, "id">[]): { needIds: string[]; jobIds: string[] } {
  const known = new Set(jobs.map((j) => j.id));
  const live = needs.filter((n) => known.has(n.jobId)).sort((a, b) => a.createdAt - b.createdAt);
  return { needIds: live.map((n) => n.id), jobIds: [...new Set(live.map((n) => n.jobId))] };
}
