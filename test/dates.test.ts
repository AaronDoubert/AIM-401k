import { describe, expect, it } from "vitest";
import { formatDate, isMonthList, monthOption, parseDate, patternFromHint, relativeToDate, toIso } from "../src/core/dates";

const today = new Date(2026, 9, 12); // 12 Oct 2026

describe("parseDate", () => {
  it.each([
    ["2024-03-05", "2024-03-05"],
    ["2024-3", "2024-03"],
    ["03/05/2024", "2024-03-05"],
    ["25/12/2024", "2024-12-25"],
    ["3/2021", "2021-03"],
    ["2019", "2019"],
    ["March 2021", "2021-03"],
    ["Sept. 2020", "2020-09"],
    ["Mar 5, 2021", "2021-03-05"],
    ["5 March 2021", "2021-03-05"],
    ["immediately", "2026-10-12"],
    ["2 weeks notice", "2026-10-26"],
    ["one month", "2026-11-11"],
  ])("%s → %s", (input, iso) => {
    expect(toIso(parseDate(input, today)!)).toBe(iso);
  });
  it("rejects junk", () => {
    expect(parseDate("not a date", today)).toBeNull();
    expect(parseDate("13/13/2020", today)).toBeNull();
    expect(relativeToDate("whenever", today)).toBeNull();
  });
});

describe("formatDate", () => {
  const d = { y: 2024, m: 3, d: 5 };
  it.each([
    ["MM/DD/YYYY", "03/05/2024"],
    ["DD/MM/YYYY", "05/03/2024"],
    ["YYYY-MM-DD", "2024-03-05"],
    ["MM/YYYY", "03/2024"],
    ["MMM YYYY", "Mar 2024"],
    ["MMMM D, YYYY", "March 5, 2024"],
    ["M/D/YY", "3/5/24"],
  ])("%s", (pattern, out) => expect(formatDate(d, pattern)).toBe(out));
  it("defaults missing day/month to the first", () => expect(formatDate({ y: 2020 }, "MM/DD/YYYY")).toBe("01/01/2020"));
});

describe("hints and option lists", () => {
  it("finds format hints", () => {
    expect(patternFromHint("mm/dd/yyyy")).toBe("MM/DD/YYYY");
    expect(patternFromHint("Start date (MM/YYYY)")).toBe("MM/YYYY");
    expect(patternFromHint("Enter your name")).toBeNull();
    expect(patternFromHint("MM")).toBeNull();
  });
  it("recognizes month pickers", () => {
    const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    expect(isMonthList(names)).toBe(true);
    expect(isMonthList(names.map((n) => n.slice(0, 3)))).toBe(true);
    expect(isMonthList(["Yes", "No"])).toBe(false);
    expect(monthOption(["Jan", "Feb", "Mar"], 3)).toBe(2);
    expect(monthOption(["01", "02", "03"], 2)).toBe(1);
  });
});
