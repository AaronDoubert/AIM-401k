import type { CopyKey } from "../shared/copy";
import type { Job, JobStatus } from "../shared/types";

// The pipeline, once. Board columns, Tracker totals, War Room totals and the
// popup all read these names, this order and these counts, so they always agree.

export type StageId = "targets" | "engaged" | "hold" | "splash" | "contact" | "secured" | "lost";

/** Color doctrine: amber = needs you · cyan advisory · white status · grey closed. Green is kept for the win (an offer). */
export type StageTone = "status" | "ok" | "warn" | "advisory" | "dim";

export interface Stage {
  id: StageId;
  title: CopyKey;
  statuses: JobStatus[];
  tone: StageTone;
}

export const STAGES: Stage[] = [
  { id: "targets", title: "stage.targets", statuses: ["saved", "queued"], tone: "status" },
  { id: "engaged", title: "stage.engaged", statuses: ["running"], tone: "status" },
  { id: "hold", title: "stage.hold", statuses: ["needs_you", "ready_to_submit"], tone: "warn" },
  { id: "splash", title: "stage.splash", statuses: ["submitted"], tone: "status" },
  { id: "contact", title: "stage.contact", statuses: ["interviewing"], tone: "advisory" },
  { id: "secured", title: "stage.secured", statuses: ["offer"], tone: "ok" },
  { id: "lost", title: "stage.lost", statuses: ["rejected", "failed", "skipped"], tone: "dim" },
];

export function stageOf(status: JobStatus): StageId {
  return (STAGES.find((s) => s.statuses.includes(status)) ?? STAGES[0]!).id;
}

/** Jobs per stage. Every job lands in exactly one stage. */
export function stageCounts(jobs: Pick<Job, "status">[]): Record<StageId, number> {
  const out = Object.fromEntries(STAGES.map((s) => [s.id, 0])) as Record<StageId, number>;
  for (const j of jobs) out[stageOf(j.status)]++;
  return out;
}

/** Applications that went out (anything past release), for "this week" and the rank. */
export function appliedCount(jobs: Pick<Job, "status" | "appliedAt">[], since = 0): number {
  return jobs.filter((j) => (j.appliedAt ?? 0) > since || (!since && ["submitted", "interviewing", "offer", "rejected"].includes(j.status))).length;
}

/**
 * The stage strip: one row of label/number pairs, no boxes. `only` limits it to
 * a prefix of the pipeline (the popup shows the first four).
 */
export function stageStrip(counts: Record<StageId, number>, label: (k: CopyKey) => string, only = STAGES.length): HTMLElement {
  const root = document.createElement("dl");
  root.className = "stages";
  for (const s of STAGES.slice(0, only)) {
    const item = document.createElement("div");
    item.className = `stage tone-${s.tone}`;
    item.dataset.stage = s.id;
    if (!counts[s.id]) item.classList.add("zero");
    const dt = document.createElement("dt");
    dt.textContent = label(s.title);
    const dd = document.createElement("dd");
    dd.textContent = String(counts[s.id]);
    item.append(dt, dd);
    root.append(item);
  }
  return root;
}
