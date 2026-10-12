import type { CopyKey } from "../shared/copy";
import type { Job, JobStatus } from "../shared/types";

// Tracker board view: pure grouping logic (unit-tested), no DOM.

export interface BoardColumn {
  id: "targeted" | "engaged" | "holding" | "delivered" | "contact" | "secured" | "lost";
  title: CopyKey;
  statuses: JobStatus[];
  /** Status a card gets when dropped here; null = not a drop target (runtime state). */
  drop: JobStatus | null;
  /** Rendered as a narrow strip until expanded. */
  collapsed?: boolean;
}

export const BOARD_COLUMNS: BoardColumn[] = [
  { id: "targeted", title: "theme.board.targeted", statuses: ["saved", "queued"], drop: "saved" },
  { id: "engaged", title: "theme.board.engaged", statuses: ["running"], drop: null },
  { id: "holding", title: "theme.board.holding", statuses: ["needs_you", "ready_to_submit"], drop: null },
  { id: "delivered", title: "theme.board.delivered", statuses: ["submitted"], drop: "submitted" },
  { id: "contact", title: "theme.board.contact", statuses: ["interviewing"], drop: "interviewing" },
  { id: "secured", title: "theme.board.secured", statuses: ["offer"], drop: "offer" },
  { id: "lost", title: "theme.board.lost", statuses: ["rejected", "failed", "skipped"], drop: "rejected", collapsed: true },
];

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
