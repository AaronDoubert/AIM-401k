import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MARK_OFFWHITE_SVG } from "../src/shared/brand";

const brand = (f: string) => readFileSync(join(__dirname, "../brand", f), "utf8").trim();

describe("brand artwork", () => {
  it("the inlined overlay mark is the supplied artwork, unchanged", () => {
    expect(MARK_OFFWHITE_SVG).toBe(brand("aim401k-mark-offwhite-transparent.svg"));
  });

  it("extension pages show the wordmark artwork, never a typed logo", () => {
    for (const page of ["popup", "tracker", "options", "onboarding", "warroom"]) {
      const html = readFileSync(join(__dirname, "../static", `${page}.html`), "utf8");
      expect(html, page).toContain('src="brand/aim401k-wordmark-offwhite.svg"');
      expect(html, page).not.toMatch(/<(h1|span)[^>]*>\s*AIM-401k\b/);
    }
  });
});
