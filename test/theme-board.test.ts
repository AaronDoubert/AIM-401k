import { describe, expect, it } from "vitest";
import { BOARD_COLUMNS, callsigns, cardBadge, columnFor, dropStatus, groupForBoard, waitingJobs } from "../src/ui/board";
import type { Job, JobStatus } from "../src/shared/types";

const ALL: JobStatus[] = ["saved", "queued", "running", "needs_you", "ready_to_submit", "submitted", "failed", "skipped", "interviewing", "offer", "rejected"];

const job = (id: string, status: JobStatus, createdAt = 0, updatedAt = 0): Job => ({
  id,
  url: `https://x.test/${id}`,
  company: "",
  title: "",
  location: "",
  ats: "",
  status,
  createdAt,
  updatedAt,
  appliedAt: null,
  lastProgressAt: 0,
  notes: "",
  tabId: null,
  autoTab: false,
  aiDrafted: 0,
  log: [],
});

describe("board columns", () => {
  it("every status maps to exactly one column", () => {
    for (const s of ALL) expect(BOARD_COLUMNS.filter((c) => c.statuses.includes(s)).length, s).toBe(1);
  });

  it("follows the shared stage order, LOST last", () => {
    expect(BOARD_COLUMNS.map((c) => c.id)).toEqual(["targets", "engaged", "hold", "splash", "contact", "secured", "lost"]);
    expect(columnFor("ready_to_submit")).toBe("hold");
    expect(columnFor("failed")).toBe("lost");
  });

  it("groups jobs, newest update first", () => {
    const g = groupForBoard([job("a", "queued", 0, 1), job("b", "saved", 0, 5), job("c", "submitted"), job("d", "skipped")]);
    expect(g.targets.map((j) => j.id)).toEqual(["b", "a"]);
    expect(g.splash.map((j) => j.id)).toEqual(["c"]);
    expect(g.lost.map((j) => j.id)).toEqual(["d"]);
    expect(Object.values(g).flat()).toHaveLength(4);
  });

  it("only allows drops that change status into a manual column", () => {
    expect(dropStatus(job("a", "submitted"), "contact")).toBe("interviewing");
    expect(dropStatus(job("a", "interviewing"), "secured")).toBe("offer");
    expect(dropStatus(job("a", "submitted"), "lost")).toBe("rejected");
    expect(dropStatus(job("a", "queued"), "targets")).toBeNull(); // already there
    expect(dropStatus(job("a", "skipped"), "lost")).toBeNull();
    expect(dropStatus(job("a", "saved"), "engaged")).toBeNull(); // runtime state, not draggable into
    expect(dropStatus(job("a", "submitted"), "hold")).toBeNull();
  });

  it("numbers call signs by creation time", () => {
    const m = callsigns([job("z", "saved", 30), job("y", "saved", 10), job("x", "saved", 20)]);
    expect([m.get("y"), m.get("x"), m.get("z")]).toEqual([1, 2, 3]);
  });
});

describe("board card badges", () => {
  it("shows a badge only for sub-states and exceptions, never the column name", () => {
    expect(ALL.filter((s) => cardBadge(s)).sort()).toEqual(["failed", "queued", "ready_to_submit", "skipped"]);
    for (const s of ["saved", "running", "needs_you", "submitted", "interviewing", "offer", "rejected"] as JobStatus[]) expect(cardBadge(s), s).toBeNull();
  });
});

describe("waiting on you", () => {
  const need = (id: string, jobId: string, createdAt: number) => ({ id, jobId, createdAt });
  it("lists the oldest request first, one job once, and ignores deleted jobs", () => {
    const jobs = [{ id: "a" }, { id: "b" }];
    const w = waitingJobs([need("n3", "b", 30), need("n1", "a", 10), need("n2", "a", 20), need("n0", "gone", 5)], jobs);
    expect(w.needIds).toEqual(["n1", "n2", "n3"]);
    expect(w.jobIds).toEqual(["a", "b"]);
  });
  it("is empty when nothing waits", () => {
    expect(waitingJobs([], [{ id: "a" }])).toEqual({ needIds: [], jobIds: [] });
  });
});
