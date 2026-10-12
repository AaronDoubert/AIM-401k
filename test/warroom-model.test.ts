import { describe, expect, it } from "vitest";
import { copy } from "../src/shared/copy";
import * as wr from "../src/shared/copy/warroom";
import { DEFAULT_SETTINGS } from "../src/shared/defaults";
import type { Job, JobStatus, Need, OpsEvent, OpsKind, UnitState } from "../src/shared/types";
import {
  afkStartFromOps,
  blipPolar,
  clampUnits,
  clock,
  deriveTiles,
  displayPhase,
  hashAngle,
  killSheet,
  logLine,
  matchesFilter,
  mergeOps,
  phosphor,
  polarToXY,
  progressOf,
  RANK_THRESHOLDS,
  rankFor,
  RING_RADIUS,
  ringOf,
  schematicRows,
  shortenUrls,
  SlotMap,
  span,
  stopwatch,
  summarizeSitrep,
  tgtNumber,
  unitCounts,
  zulu,
} from "../src/ui/warroom/model";

const T0 = Date.UTC(2026, 9, 12, 14, 3, 22);

function job(id: string, status: JobStatus, over: Partial<Job> = {}): Job {
  return {
    id,
    url: `https://jobs.example.com/${id}`,
    company: `Co ${id}`,
    title: `Role ${id}`,
    location: "",
    ats: "generic",
    status,
    createdAt: T0,
    updatedAt: T0,
    appliedAt: null,
    lastProgressAt: T0,
    notes: "",
    tabId: 1,
    autoTab: true,
    aiDrafted: 0,
    log: [],
    ...over,
  };
}

function need(id: string, jobId: string, kind: Need["kind"] = "question", createdAt = T0): Need {
  return { id, jobId, kind, prompt: `Q ${id}`, frameId: 0, createdAt };
}

function unit(jobId: string, over: Partial<UnitState> = {}): UnitState {
  return { jobId, phase: "filling", step: 1, fieldsTotal: 10, fieldsDone: 4, currentField: "Email", updatedAt: T0, ...over };
}

const op = (id: string, kind: OpsKind, t: number, jobId?: string): OpsEvent => ({ id, kind, t, text: `${kind} ${id}`, ...(jobId ? { jobId } : {}) });

describe("rank", () => {
  it("starts as RECRUIT with progress toward PRIVATE", () => {
    expect(rankFor(0)).toEqual({ index: 0, next: 1, toNext: 5, progress: 0 });
    expect(rankFor(4)).toMatchObject({ index: 0, toNext: 1, progress: 0.8 });
  });

  it("promotes exactly at each threshold", () => {
    RANK_THRESHOLDS.forEach((min, i) => {
      expect(rankFor(min).index).toBe(i);
      if (i > 0) expect(rankFor(min - 1).index).toBe(i - 1);
    });
    expect(rankFor(35)).toMatchObject({ index: 4, next: 5, toNext: 15, progress: 0 });
    expect(rankFor(42).progress).toBeCloseTo(7 / 15);
  });

  it("caps at GENERAL OF EMPLOYMENT", () => {
    expect(rankFor(250)).toEqual({ index: 9, next: null, toNext: 0, progress: 1 });
    expect(rankFor(10_000).index).toBe(9);
    expect(copy(true, "warroom.rank.9")).toBe("GENERAL OF EMPLOYMENT");
    expect(copy(false, "warroom.rank.9")).toBe("Level 10");
  });

  it("treats junk input as zero", () => {
    expect(rankFor(-3).index).toBe(0);
    expect(rankFor(Number.NaN).index).toBe(0);
  });
});

describe("kill sheet", () => {
  it("counts delivered, contacts, offers and losses from job statuses", () => {
    const jobs = [
      job("a", "submitted", { appliedAt: T0 }),
      job("b", "interviewing", { appliedAt: T0 }),
      job("c", "offer", { appliedAt: T0 }),
      job("d", "rejected"),
      job("e", "failed"),
      job("f", "running"),
      job("g", "skipped"),
    ];
    expect(killSheet(jobs)).toEqual({ delivered: 4, contacts: 2, secured: 1, lost: 2 });
  });
});

describe("radar geometry", () => {
  it("maps phases to rings", () => {
    expect(["queued", "opening", "recon"].map((p) => ringOf(p as never))).toEqual(["outer", "outer", "outer"]);
    expect(ringOf("filling")).toBe("mid");
    expect(ringOf("advancing")).toBe("mid");
    expect(ringOf("holding")).toBe("inner");
    expect(ringOf("releasing")).toBe("inner");
    expect(ringOf("delivered")).toBe("core");
    expect(ringOf("lost")).toBe("edge");
    expect(RING_RADIUS.outer).toBeGreaterThan(RING_RADIUS.mid);
    expect(RING_RADIUS.mid).toBeGreaterThan(RING_RADIUS.inner);
  });

  it("gives each job a stable bearing in [0, 2π)", () => {
    const a = hashAngle("job_abc123");
    expect(hashAngle("job_abc123")).toBe(a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(Math.PI * 2);
    const spread = new Set(Array.from({ length: 50 }, (_, i) => Math.round(hashAngle(`job_${i}`) * 10)));
    expect(spread.size).toBeGreaterThan(30);
  });

  it("keeps the bearing and moves the range as the phase changes", () => {
    const outer = blipPolar("job_x", "recon");
    const mid = blipPolar("job_x", "filling");
    const inner = blipPolar("job_x", "holding");
    expect(outer.angle).toBe(mid.angle);
    expect(mid.angle).toBe(inner.angle);
    expect(outer.r).toBeGreaterThan(mid.r);
    expect(mid.r).toBeGreaterThan(inner.r);
    expect(Math.abs(mid.r - RING_RADIUS.mid)).toBeLessThanOrEqual(0.05);
  });

  it("projects bearings clockwise from north", () => {
    const n = polarToXY(0, 1, 100, 100, 50);
    expect(n.x).toBeCloseTo(100);
    expect(n.y).toBeCloseTo(50);
    const e = polarToXY(Math.PI / 2, 1, 100, 100, 50);
    expect(e.x).toBeCloseTo(150);
    expect(e.y).toBeCloseTo(100);
  });

  it("phosphor glow peaks right behind the sweep and decays to a floor", () => {
    expect(phosphor(1, 1)).toBeCloseTo(1);
    expect(phosphor(1 + Math.PI, 1)).toBeCloseTo(0.5);
    expect(phosphor(1 - 0.01, 1, 0.3)).toBe(0.3);
  });
});

describe("time formatting", () => {
  it("formats UTC clocks", () => {
    expect(clock(T0, true)).toBe("14:03:22");
    expect(zulu(T0)).toBe("14:03:22Z");
  });

  it("formats holding timers and spans", () => {
    expect(stopwatch(0)).toBe("00:00");
    expect(stopwatch(133_000)).toBe("02:13");
    expect(stopwatch(3_725_000)).toBe("1:02:05");
    expect(span(45_000)).toBe("45s");
    expect(span(12 * 60_000)).toBe("12m");
    expect(span(65 * 60_000)).toBe("1h 05m");
    expect(span(50 * 3_600_000)).toBe("2d 2h");
  });
});

describe("ops log", () => {
  it("filters by kind family", () => {
    expect(matchesFilter("launch", "all")).toBe(true);
    expect(matchesFilter("launch", "ops")).toBe(true);
    expect(matchesFilter("intel", "ops")).toBe(false);
    expect(matchesFilter("contact", "intel")).toBe(true);
    expect(matchesFilter("error", "errors")).toBe(true);
    expect(matchesFilter("lost", "errors")).toBe(true);
    expect(matchesFilter("deliver", "errors")).toBe(false);
  });

  it("formats a line with time, tone and shortened URLs", () => {
    const l = logLine({ id: "1", t: T0, kind: "launch", text: "UNIT EN ROUTE · https://www.acme.com/careers/123?gh_src=abc" }, true);
    expect(l).toMatchObject({ time: "14:03:22", kind: "launch", tone: "ok", text: "UNIT EN ROUTE · acme.com/careers/123" });
    expect(logLine(op("2", "lost", T0)).tone).toBe("alert");
    expect(logLine(op("3", "intervene", T0)).tone).toBe("warn");
    expect(logLine(op("4", "release", T0)).tone).toBe("fire");
  });

  it("shortens long URLs and leaves other text alone", () => {
    expect(shortenUrls("see http://127.0.0.1:8080/warroom/apply.html?wr=1 now")).toBe("see 127.0.0.1:8080/warroom/apply.html now");
    expect(shortenUrls(`x https://a.io/${"p".repeat(80)}`, 20)).toBe(`x a.io/${"p".repeat(14)}…`);
    expect(shortenUrls("DELIVERED · Acme · Engineer")).toBe("DELIVERED · Acme · Engineer");
  });

  it("merges events deduped, ordered and capped", () => {
    const base = [op("a", "launch", 1), op("b", "deliver", 3)];
    const merged = mergeOps(base, [op("b", "deliver", 3), op("c", "lost", 2), op("d", "afk", 4)]);
    expect(merged.map((e) => e.id)).toEqual(["a", "c", "b", "d"]);
    const big = Array.from({ length: 10 }, (_, i) => op(`x${i}`, "system", i));
    expect(mergeOps([], big, 4).map((e) => e.id)).toEqual(["x6", "x7", "x8", "x9"]);
  });
});

describe("sitrep", () => {
  const since = T0;
  const now = T0 + 3_600_000;
  const ops = [
    op("old", "deliver", since - 10, "j0"),
    op("d1", "deliver", since + 10, "j1"),
    op("d1b", "deliver", since + 20, "j1"),
    op("c1", "contact", since + 30, "j2"),
    op("l1", "lost", since + 40, "j3"),
    op("l2", "lost", since + 50, "j4"),
    op("l2b", "lost", since + 60, "j4"),
    op("future", "deliver", now + 10, "j9"),
  ];
  const jobs = [job("j1", "submitted", { appliedAt: since + 10 }), job("j5", "submitted", { appliedAt: since + 100 }), job("j0", "submitted", { appliedAt: since - 10 })];
  const needs = [need("n1", "j6"), need("n2", "j6", "consent"), need("n3", "j7", "review_submit")];

  it("summarizes what happened while AFK", () => {
    expect(summarizeSitrep({ ops, jobs, needs, since, now })).toEqual({ since, until: now, delivered: 2, holding: 2, contacts: 1, lost: 2 });
  });

  it("is empty when nothing happened", () => {
    expect(summarizeSitrep({ ops: [], jobs: [], needs: [], since, now })).toMatchObject({ delivered: 0, holding: 0, contacts: 0, lost: 0 });
  });

  it("recovers the AFK start from the ops log", () => {
    expect(afkStartFromOps([op("a", "afk", 5), op("b", "launch", 9)])).toBe(5);
    expect(afkStartFromOps([op("b", "launch", 9)])).toBeNull();
  });
});

describe("unit tiles", () => {
  it("derives the display phase from job, needs and the live unit", () => {
    expect(displayPhase(job("a", "submitted"), unit("a"), [])).toBe("delivered");
    expect(displayPhase(job("a", "skipped"), undefined, [])).toBe("lost");
    expect(displayPhase(job("a", "queued"), undefined, [])).toBe("queued");
    expect(displayPhase(job("a", "needs_you"), unit("a", { phase: "filling" }), [need("n", "a")])).toBe("holding");
    expect(displayPhase(job("a", "running"), undefined, [])).toBe("opening");
    expect(displayPhase(job("a", "running"), unit("a", { phase: "advancing" }), [])).toBe("advancing");
    expect(displayPhase(job("a", "running"), unit("a", { phase: "lost" }), [])).toBe("opening");
    expect(displayPhase(job("a", "running"), unit("a", { phase: "holding" }), [])).toBe("filling");
  });

  it("lists active jobs plus recently finished ones, finished last", () => {
    const now = T0 + 5_000;
    const jobs = [
      job("done", "submitted", { createdAt: T0 - 50 }),
      job("old", "submitted", { createdAt: T0 - 40, updatedAt: T0 - 60_000 }),
      job("run", "running", { createdAt: T0 - 30 }),
      job("hold", "ready_to_submit", { createdAt: T0 - 20 }),
      job("q", "queued", { createdAt: T0 - 10 }),
      job("seen", "failed", { createdAt: T0 - 5, updatedAt: T0 }),
    ];
    const units = new Map([
      ["done", unit("done", { phase: "delivered", updatedAt: T0 })],
      ["old", unit("old", { phase: "delivered", updatedAt: T0 - 60_000 })],
      ["run", unit("run", { step: 2, fieldsDone: 3, fieldsTotal: 6 })],
    ]);
    const needs = [need("r", "hold", "review_submit", T0 - 1000)];
    const tiles = deriveTiles(jobs, needs, units, now, new Set(["seen"]));
    expect(tiles.map((t) => [t.jobId, t.phase])).toEqual([
      ["run", "filling"],
      ["hold", "holding"],
      ["done", "delivered"],
      ["seen", "lost"],
    ]);
    const run = tiles[0]!;
    expect(run).toMatchObject({ step: 2, fieldsDone: 3, fieldsTotal: 6, currentField: "Email", ready: false, holdingSince: null });
    expect(tiles[1]).toMatchObject({ ready: true, holdingSince: T0 - 1000 });
    expect(tiles[2]!.fieldsDone).toBe(10);
    expect(tgtNumber("run")).toMatch(/^\d{4}$/);
    expect(run.tgt).toBe(tgtNumber("run"));
  });

  it("computes progress and schematic rows", () => {
    expect(progressOf({ fieldsDone: 3, fieldsTotal: 6, phase: "filling" })).toBe(0.5);
    expect(progressOf({ fieldsDone: 0, fieldsTotal: 0, phase: "filling" })).toBe(0);
    expect(progressOf({ fieldsDone: 0, fieldsTotal: 0, phase: "delivered" })).toBe(1);
    expect(schematicRows({ fieldsDone: 3, fieldsTotal: 6, phase: "filling" }, 6)).toEqual({ filled: 3, active: 3 });
    expect(schematicRows({ fieldsDone: 3, fieldsTotal: 6, phase: "holding" }, 6)).toEqual({ filled: 3, active: -1 });
    expect(schematicRows({ fieldsDone: 6, fieldsTotal: 6, phase: "filling" }, 6)).toEqual({ filled: 6, active: -1 });
  });

  it("keeps UNIT numbers stable and reuses freed slots", () => {
    const slots = new SlotMap();
    expect([...slots.assign(["a", "b", "c"])]).toEqual([["a", 1], ["b", 2], ["c", 3]]);
    const next = slots.assign(["a", "c", "d"]);
    expect(next.get("a")).toBe(1);
    expect(next.get("c")).toBe(3);
    expect(next.get("d")).toBe(2);
  });

  it("counts header totals and clamps the UNITS stepper", () => {
    expect(unitCounts([job("a", "running"), job("b", "needs_you"), job("c", "ready_to_submit"), job("d", "queued"), job("e", "submitted")])).toEqual({
      active: 1,
      holding: 2,
      queued: 1,
    });
    expect([0, 1, 3.4, 6, 9, Number.NaN].map(clampUnits)).toEqual([1, 1, 3, 6, 6, 1]);
  });
});

describe("warroom copy", () => {
  it("has identical, prefixed keys in CHUD and PLAIN", () => {
    const chud = Object.keys(wr.CHUD).sort();
    const plain = Object.keys(wr.PLAIN).sort();
    expect(plain).toEqual(chud);
    for (const k of chud) expect(k.startsWith("warroom.")).toBe(true);
    for (const k of chud) expect((wr.PLAIN as Record<string, string>)[k]!.length).toBeGreaterThan(0);
  });

  it("switches wording with settings.ui.chud", () => {
    const chud = DEFAULT_SETTINGS;
    const plain = { ...DEFAULT_SETTINGS, ui: { ...DEFAULT_SETTINGS.ui, chud: false } };
    expect(copy(chud, "warroom.title")).toBe("OPERATION GAINFUL");
    expect(copy(plain, "warroom.title")).toBe("Dashboard");
    expect(copy(chud, "warroom.op.title")).toBe("OPERATOR INPUT REQUIRED");
    expect(copy(plain, "warroom.op.title")).toBe("Needs your input");
    expect(copy(plain, "warroom.sitrep.line", { dur: "1h 05m", delivered: 3, holding: 1, contacts: 0, lost: 2 })).toBe(
      "While you were away (1h 05m): 3 applied, 1 need you, 0 replies, 2 stopped",
    );
  });
});
