// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { resolveField } from "../src/core/matcher";
import { fillField } from "../src/content/fill";
import { scanFields } from "../src/content/scan";
import { ctx, profile } from "./helpers";

const today = new Date(2026, 9, 12);

beforeEach(() => {
  const html = readFileSync(join(__dirname, "fixtures", "dates.html"), "utf8");
  document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, "");
});

const byId = (id: string) => document.getElementById(id) as HTMLInputElement;

describe("date fields", () => {
  it("detects date inputs, split dates and sections", () => {
    const f = Object.fromEntries(scanFields().map((x) => [x.info.label, x.info]));
    expect(f["Available start date"]).toMatchObject({ kind: "date", datePattern: "YYYY-MM-DD" });
    expect(f["Date"]).toMatchObject({ kind: "date", datePattern: "MM/DD/YYYY" });
    expect(f["Earliest start date"]).toMatchObject({ kind: "date" });
    expect(f["From"]).toMatchObject({ kind: "dateParts", parts: ["m", "y"], section: "Work Experience 1", sectionIndex: 0 });
    expect(f["Graduation date"]).toMatchObject({ kind: "dateParts", parts: ["m", "y"], section: "Education" });
    const titles = scanFields().filter((x) => x.info.label === "Job Title").map((x) => x.info.sectionIndex);
    expect(titles).toEqual([0, 1]);
  });

  it("fills every date in the right format from the profile", async () => {
    for (const f of scanFields()) {
      const r = resolveField(f.info, profile, [], ctx, today);
      if (r.type === "value") await fillField(f, r.value, null);
    }
    expect(byId("avail").value).toBe("2026-10-26"); // notice period: 2 weeks
    expect(byId("signed").value).toBe("10/12/2026"); // today
    expect(byId("dob").value).toBe(""); // never guessed
    expect(byId("pick").value).toBe("2026-10-26".replace(/(\d+)-(\d+)-(\d+)/, "$2/$3/$1")); // read-only picker
    expect(byId("pick").hasAttribute("readonly")).toBe(true);
    expect(byId("w1t").value).toBe("Engineer");
    expect(byId("w1c").value).toBe("Analytical Engines");
    const [m, y] = Array.from(document.querySelectorAll<HTMLInputElement>("[data-automation-id^=dateSection]"));
    expect([m!.value, y!.value]).toEqual(["03", "2019"]);
    expect(byId("w1cur").checked).toBe(true);
    expect(byId("w2t").value).toBe("Junior Engineer");
    expect(byId("w2c").value).toBe("Babbage & Co");
    expect(byId("w2from").value).toBe("06/2016");
    expect(byId("w2to").value).toBe("02/2019");
    expect(byId("sch").value).toBe("University of London");
    const gm = document.querySelector<HTMLSelectElement>("select[name=grad_month]")!;
    const gy = document.querySelector<HTMLSelectElement>("select[name=grad_year]")!;
    expect([gm.value, gy.value]).toEqual(["5", "2016"]);
  });

  it("asks the human for a date of birth", () => {
    const dob = scanFields().find((x) => x.info.label === "Date of birth")!;
    expect(resolveField(dob.info, profile, [], ctx, today)).toMatchObject({ type: "human" });
  });
});
