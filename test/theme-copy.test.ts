import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { copy, COPY_MAPS, isCopyKey } from "../src/shared/copy";
import * as theme from "../src/shared/copy/theme";
import type { JobStatus, NeedKind } from "../src/shared/types";

const { chud: CHUD, plain: PLAIN } = COPY_MAPS;
/** Grammatical helpers a variant may use without the other ("need{s} you"). */
const GRAMMAR = new Set(["s"]);
const vars = (t: string) => new Set([...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).filter((v) => !GRAMMAR.has(v)));

describe("copy coverage", () => {
  it("every CHUD key has a PLAIN key and vice versa", () => {
    expect(Object.keys(PLAIN).sort()).toEqual(Object.keys(CHUD).sort());
  });

  it("variants use the same {vars}", () => {
    const bad = Object.keys(CHUD).filter((k) => {
      const a = vars(CHUD[k as keyof typeof CHUD]);
      const b = vars(PLAIN[k as keyof typeof PLAIN]);
      return a.size !== b.size || [...a].some((v) => !b.has(v));
    });
    expect(bad).toEqual([]);
  });

  it("no empty strings", () => {
    for (const [k, v] of [...Object.entries(CHUD), ...Object.entries(PLAIN)]) expect(v.trim(), k).not.toBe("");
  });

  it("theme keys are prefixed and complete", () => {
    expect(Object.keys(theme.CHUD).every((k) => k.startsWith("theme."))).toBe(true);
    expect(Object.keys(theme.PLAIN).sort()).toEqual(Object.keys(theme.CHUD).sort());
  });

  it("covers every job status and need kind", () => {
    const statuses: JobStatus[] = ["saved", "queued", "running", "needs_you", "ready_to_submit", "submitted", "failed", "skipped", "interviewing", "offer", "rejected"];
    const kinds: NeedKind[] = ["question", "consent", "signature", "captcha", "login", "review_submit", "stalled", "error"];
    for (const s of statuses) expect(isCopyKey(`status.${s}`), s).toBe(true);
    for (const k of kinds) expect(isCopyKey(`theme.kind.${k}`), k).toBe(true);
  });

  it("chud labels stay short", () => {
    const labels = Object.entries(CHUD).filter(([k]) => /^(status\.|theme\.(kind|board|stat|col|view|filter|popup\.stat)\.)/.test(k));
    expect(labels.length).toBeGreaterThan(20);
    for (const [k, v] of labels) expect(v.length, `${k} = ${v}`).toBeLessThanOrEqual(18);
  });

  it("keys referenced from static HTML exist", () => {
    const dir = join(__dirname, "..", "static");
    const missing: string[] = [];
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".html"))) {
      const html = readFileSync(join(dir, f), "utf8");
      for (const m of html.matchAll(/data-copy(?:-plain|-ph|-label)?="([^"]+)"/g)) if (!isCopyKey(m[1]!)) missing.push(`${f}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });
});

describe("copy()", () => {
  it("switches on settings.ui.chud and interpolates", () => {
    expect(copy({ ui: { chud: true } }, "status.submitted")).toBe("SPLASH");
    expect(copy({ ui: { chud: false } }, "status.submitted")).toBe("Applied");
    expect(copy(true, "theme.ov.pill.needs", { n: 2, s: "" })).toBe("2 HOLDING");
    expect(copy(false, "theme.ov.pill.needs", { n: 1, s: "s" })).toBe("1 needs you");
    expect(copy(false, "theme.tgt", { n: "0042" })).toBe("#0042");
    expect(copy(true, "theme.tgt", { n: "0042" })).toBe("TGT-0042");
  });
  it("leaves unknown vars visible rather than blank", () => {
    expect(copy(true, "theme.ov.job", { company: "ACME" })).toBe("TGT · ACME · {title}");
  });
});
