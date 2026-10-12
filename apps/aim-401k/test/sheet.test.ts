import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  autoMap,
  cleanUrl,
  columnIndex,
  columnLabel,
  detectDayFirst,
  detectHeaderRow,
  distinctStatuses,
  excelSerialToIso,
  jobsToXlsx,
  mapStatus,
  parseCsv,
  parseSheetDate,
  readXlsx,
  rowsToJobs,
  sheetCsvUrl,
  sniffDelimiter,
  urlKey,
} from "../src/core/sheet";
import { crc32, zipStore } from "../src/core/zip";
import type { Job, JobStatus } from "../src/shared/types";

const FIX = join(__dirname, "fixtures/sheets");
const NOW = new Date(2026, 9, 12, 9, 0).getTime(); // 2026-10-12, local
const day = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 12).getTime();
};
const isoOf = (t: number | null) => {
  if (t == null) return null;
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function job(over: Partial<Job>): Job {
  return {
    id: over.id ?? "job_x",
    url: "",
    company: "",
    title: "",
    location: "",
    ats: "",
    status: "submitted",
    createdAt: 1,
    updatedAt: 1,
    appliedAt: null,
    lastProgressAt: 1,
    notes: "",
    tabId: null,
    autoTab: false,
    aiDrafted: 0,
    log: [],
    ...over,
  };
}

/** Header + data rows -> plan, the way the import modal drives it. */
function plan(rows: string[][], existing: Job[] = [], opts: Parameters<typeof rowsToJobs>[4] = {}, statusMap: Record<string, JobStatus> = {}) {
  const h = detectHeaderRow(rows);
  const mapping = autoMap(rows[h]!);
  return rowsToJobs(rows.slice(h + 1), mapping, statusMap, existing, { now: NOW, firstRow: h + 2, source: "test.csv", ...opts });
}

// --- CSV -------------------------------------------------------------------------

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, embedded delimiters and newlines", () => {
    expect(parseCsv('a,"b, c","say ""hi""","multi\nline",e')).toEqual([["a", "b, c", 'say "hi"', "multi\nline", "e"]]);
  });
  it("handles CRLF, lone CR, a BOM and a trailing newline", () => {
    expect(parseCsv("﻿h1,h2\r\n1,2\r\n")).toEqual([
      ["h1", "h2"],
      ["1", "2"],
    ]);
    expect(parseCsv("a,b\r1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv('"x\r\ny",z\r\n')).toEqual([["x\r\ny", "z"]]);
  });
  it("keeps ragged rows, empty trailing fields and blank lines", () => {
    expect(parseCsv("a,b,c\n1\n2,3,4,5\n\n6,,\n")).toEqual([["a", "b", "c"], ["1"], ["2", "3", "4", "5"], [""], ["6", "", ""]]);
  });
  it("is lenient with whitespace before a quote and stray quotes mid-field", () => {
    expect(parseCsv('a, "b,c" ,d\n5" screen,x')).toEqual([
      ["a", "b,c ", "d"],
      ['5" screen', "x"],
    ]);
  });
  it("sniffs semicolons, tabs and commas", () => {
    expect(sniffDelimiter("Firma;Stelle;Notizen\nAcme;Dev;Gehalt 60,000\nGlobex;QA;x, y, z")).toBe(";");
    expect(parseCsv("Firma;Stelle\nAcme;Dev, Backend")).toEqual([
      ["Firma", "Stelle"],
      ["Acme", "Dev, Backend"],
    ]);
    expect(sniffDelimiter("Company\tRole\tNotes\nAcme\tDev\tpaid 1,000; maybe more\n")).toBe("\t");
    expect(sniffDelimiter("Company,Role,Notes\nAcme,Dev,a; b; c\nGlobex,QA,\n")).toBe(",");
    expect(sniffDelimiter('a,"x;y;z",b\n1,"2;3;4",5')).toBe(",");
    expect(sniffDelimiter("just one column\nvalue")).toBe(",");
  });
  it("parses tab-separated text pasted from Google Sheets / Excel", () => {
    expect(parseCsv('Company\tRole\tNotes\r\nAcme\tStaff "SWE"\t"line 1\nline 2"\r\n')).toEqual([
      ["Company", "Role", "Notes"],
      ["Acme", 'Staff "SWE"', "line 1\nline 2"],
    ]);
  });
});

// --- headers & mapping ----------------------------------------------------------

describe("detectHeaderRow", () => {
  it("skips junk rows above the header", () => {
    const rows = [["My job hunt 2026", "", ""], [""], ["Updated weekly", "", ""], ["Company", "Role", "Status"], ["Acme", "Eng", "Applied"]];
    expect(detectHeaderRow(rows)).toBe(3);
  });
  it("does not take a data row for a header and falls back to the first non-blank row", () => {
    expect(detectHeaderRow([["Firm", "Gig"], ["Acme", "https://acme.example/1", "Applied", "Remote", "2026-01-02"]])).toBe(0);
    expect(detectHeaderRow([[""], ["", ""], ["Firm", "Gig"], ["Acme", "Dev"]])).toBe(2);
    expect(detectHeaderRow([])).toBe(0);
  });
  it("only looks at the first 10 rows", () => {
    const rows = [...Array.from({ length: 10 }, () => ["junk"]), ["Company", "Title"]];
    expect(detectHeaderRow(rows)).toBe(0);
  });
});

describe("autoMap", () => {
  it("maps a Google Sheets tracker", () => {
    expect(autoMap(["Company", "Role", "Link", "Status", "Date Applied", "Notes"])).toEqual({ company: 0, title: 1, url: 2, status: 3, appliedAt: 4, notes: 5 });
  });
  it("maps synonyms and picks the most specific column", () => {
    expect(autoMap(["Employer", "Position", "Job Link", "Stage", "Applied On", "City", "Comments", "Compensation", "Recruiter"])).toEqual({
      company: 0,
      title: 1,
      url: 2,
      status: 3,
      appliedAt: 4,
      location: 5,
      notes: 6,
      salary: 7,
      contact: 8,
    });
    expect(autoMap(["Organization", "Job Title", "Application Link", "Outcome", "Application Date", "Remote?", "Next Steps", "Pay", "Email"])).toEqual({
      company: 0,
      title: 1,
      url: 2,
      status: 3,
      appliedAt: 4,
      location: 5,
      notes: 6,
      salary: 7,
      contact: 8,
    });
    expect(autoMap(["org", "job", "posting", "state", "date", "location"])).toEqual({ company: 0, title: 1, url: 2, status: 3, appliedAt: 4, location: 5 });
  });
  it("uses each field and column once, preferring exact names", () => {
    const m = autoMap(["Status", "State", "Company", "Company Website", "Interview Date", "Date Applied", "Job Description", "URL"]);
    expect(m.status).toBe(0);
    expect(m.company).toBe(2);
    expect(m.appliedAt).toBe(5);
    expect(m.url).toBe(7);
    expect(Object.values(m)).not.toContain(4); // "Interview Date" isn't the applied date
    expect(Object.values(m)).not.toContain(6); // "Job Description" isn't the title
  });
  it("maps Notion and Huntr exports", () => {
    expect(autoMap(["Name", "Company", "Position", "Status", "Applied", "URL", "Salary", "Contact", "Location", "Created time"])).toEqual({
      company: 1,
      title: 2,
      status: 3,
      appliedAt: 4,
      url: 5,
      salary: 6,
      contact: 7,
      location: 8,
    });
    expect(autoMap(["Job Title", "Company", "List", "Job URL", "Location", "Salary", "Date Applied", "Notes"])).toEqual({
      title: 0,
      company: 1,
      status: 2,
      url: 3,
      location: 4,
      salary: 5,
      appliedAt: 6,
      notes: 7,
    });
  });
});

describe("mapStatus", () => {
  const table: [string, JobStatus | null][] = [
    ["Applied", "submitted"],
    ["submitted", "submitted"],
    ["Application sent", "submitted"],
    ["Under review", "submitted"],
    ["Interview", "interviewing"],
    ["Phone Screen", "interviewing"],
    ["Recruiter screen", "interviewing"],
    ["Onsite", "interviewing"],
    ["Technical interview", "interviewing"],
    ["Final round", "interviewing"],
    ["Assessment", "interviewing"],
    ["Take-home", "interviewing"],
    ["Offer", "offer"],
    ["Offer accepted", "offer"],
    ["Accepted", "offer"],
    ["Rejected", "rejected"],
    ["Rejected after interview", "rejected"],
    ["Declined", "rejected"],
    ["Offer declined", "rejected"],
    ["No", "rejected"],
    ["Closed", "rejected"],
    ["Not selected", "rejected"],
    ["Withdrew", "rejected"],
    ["Didn't get it", "rejected"],
    ["Ghosted", "submitted"],
    ["No response", "submitted"],
    ["Wishlist", "saved"],
    ["Wish list", "saved"],
    ["Saved", "saved"],
    ["To apply", "saved"],
    ["Interested", "saved"],
    ["Bookmarked", "saved"],
    ["Not applied", "saved"],
    ["Not started", "saved"],
    ["In progress", "saved"],
    ["Applying", "saved"],
    ["Not interested", "skipped"],
    ["", null],
    ["Banana", null],
  ];
  it.each(table)("%s -> %s", (input, want) => expect(mapStatus(input)).toBe(want));

  it("lists distinct values with suggestions (unknown -> applied if dated, else saved)", () => {
    const rows = [
      ["Acme", "Applied", "2026-01-02"],
      ["B", "applied ", ""],
      ["C", "Weird", "2026-01-03"],
      ["D", "Hmm", ""],
      ["E", "", ""],
    ];
    expect(distinctStatuses(rows, 1, 2)).toEqual([
      { key: "applied", raw: "Applied", count: 2, suggested: "submitted" },
      { key: "weird", raw: "Weird", count: 1, suggested: "submitted" },
      { key: "hmm", raw: "Hmm", count: 1, suggested: "saved" },
    ]);
    expect(distinctStatuses(rows, undefined)).toEqual([]);
  });
});

// --- dates -----------------------------------------------------------------------

describe("dates", () => {
  it("converts Excel serials (1900 and 1904 systems)", () => {
    expect(excelSerialToIso(45658)).toBe("2025-01-01");
    expect(excelSerialToIso(46279.75)).toBe("2026-09-14");
    expect(excelSerialToIso(45658 - 1462, true)).toBe("2025-01-01");
  });
  it("parses the spellings spreadsheets produce", () => {
    const p = (s: string, dayFirst?: boolean) => isoOf(parseSheetDate(s, { now: NOW, ...(dayFirst != null ? { dayFirst } : {}) }));
    expect(p("2026-09-14")).toBe("2026-09-14");
    expect(p("2026-09-14T00:00:00.000Z".slice(0, 10))).toBe("2026-09-14");
    expect(p("2026-09-14 10:22:01")).toBe("2026-09-14");
    expect(p("9/14/2026")).toBe("2026-09-14");
    expect(p("9/14/2026 10:22 AM")).toBe("2026-09-14");
    expect(p("09/04/2026")).toBe("2026-09-04");
    expect(p("09/04/2026", true)).toBe("2026-04-09");
    expect(p("14.09.2026")).toBe("2026-09-14");
    expect(p("September 14, 2026")).toBe("2026-09-14");
    expect(p("Mon, Sep 14, 2026")).toBe("2026-09-14");
    expect(p("October 1, 2026 9:15 AM")).toBe("2026-10-01");
    expect(p("14 Sep 2026")).toBe("2026-09-14");
    expect(p("46279")).toBe("2026-09-14");
    expect(p("20260914")).toBe("2026-09-14");
    expect(p("2026-09")).toBe("2026-09-01");
  });
  it("rejects non-dates, out-of-range serials and future dates", () => {
    const p = (s: string) => parseSheetDate(s, { now: NOW });
    expect(p("")).toBeNull();
    expect(p("Remote")).toBeNull();
    expect(p("185000")).toBeNull();
    expect(p("12")).toBeNull();
    expect(p("2 weeks ago")).toBeNull();
    expect(p("2027-01-01")).toBeNull();
  });
  it("detects day-first columns", () => {
    expect(detectDayFirst(["01/02/2026", "13/02/2026"])).toBe(true);
    expect(detectDayFirst(["01/02/2026", "02/13/2026"])).toBe(false);
    expect(detectDayFirst(["01/02/2026"])).toBe(false);
    expect(detectDayFirst(["01.02.2026"])).toBe(true);
  });
});

// --- rows -> jobs -----------------------------------------------------------------

describe("rowsToJobs", () => {
  it("builds full Job objects", () => {
    const rows = [
      ["Company", "Role", "Link", "Status", "Date Applied", "Location", "Notes", "Salary", "Recruiter"],
      ["Acme", "Staff Engineer", "https://boards.greenhouse.io/acme/jobs/1", "Phone screen", "9/14/2026", "Austin, TX", "Great team", "$200k", "jane@acme.example"],
    ];
    const { create, update, skipped } = plan(rows);
    expect(update).toEqual([]);
    expect(skipped).toEqual([]);
    expect(create).toHaveLength(1);
    const j = create[0]!;
    expect(j).toMatchObject({
      url: "https://boards.greenhouse.io/acme/jobs/1",
      company: "Acme",
      title: "Staff Engineer",
      location: "Austin, TX",
      ats: "boards.greenhouse.io",
      status: "interviewing",
      createdAt: NOW,
      lastProgressAt: NOW,
      notes: "Great team\nSalary: $200k\nContact: jane@acme.example",
      tabId: null,
      autoTab: false,
      aiDrafted: 0,
      log: [{ t: NOW, msg: "Imported from test.csv" }],
    });
    expect(j.id).toMatch(/^job_/);
    expect(isoOf(j.appliedAt)).toBe("2026-09-14");
  });

  it("keeps rows without a link (url '') and fills defaults", () => {
    const { create } = plan([
      ["Company", "Title", "Link", "Status", "Applied"],
      ["NoLink Co", "Dev", "LinkedIn", "", "9/1/2026"],
      ["Later Co", "Dev", "", "", ""],
      ["Bare Co", "Dev", "jobs.lever.co/bare/1", "", ""],
    ]);
    expect(create.map((j) => [j.company, j.url, j.ats, j.status])).toEqual([
      ["NoLink Co", "", "sheet", "submitted"],
      ["Later Co", "", "sheet", "saved"],
      ["Bare Co", "https://jobs.lever.co/bare/1", "jobs.lever.co", "saved"],
    ]);
    expect(create[0]!.notes).toBe("Link: LinkedIn");
  });

  it("skips empty rows silently and rows with nothing to identify", () => {
    const { create, skipped } = plan([["Company", "Title", "Notes"], ["", "", ""], ["", "", "just a note"], ["Acme", "", ""]]);
    expect(create.map((j) => j.company)).toEqual(["Acme"]);
    expect(skipped).toEqual([{ row: 3, reason: "missing", label: "#3" }]);
  });

  it("skips duplicate rows inside the sheet", () => {
    const { create, skipped } = plan([
      ["Company", "Title", "Link"],
      ["Acme", "Dev", "https://www.acme.example/jobs/1/?utm_source=x"],
      ["Acme", "Dev", "https://acme.example/jobs/1"],
      ["ACME, Inc.", "dev", ""],
    ]);
    expect(create).toHaveLength(1);
    expect(skipped.map((s) => [s.row, s.reason])).toEqual([
      [3, "duplicate"],
      [4, "duplicate"],
    ]);
  });

  it("matches tracked jobs by normalized URL, else company + title", () => {
    const existing = [
      job({ id: "a", url: "https://jobs.lever.co/acme/123?lever-source=x", company: "Acme", title: "Dev", status: "submitted", appliedAt: day("2026-09-01") }),
      job({ id: "b", url: "https://example.com/apply", company: "Globex Corporation", title: "Staff Engineer", status: "saved" }),
    ];
    const { create, update } = plan(
      [
        ["Company", "Title", "Link", "Status", "Applied"],
        ["Acme (renamed)", "Something", "http://jobs.lever.co/acme/123/", "Interview", "9/1/2026"],
        ["globex corp", "staff  engineer", "https://other.example/posting", "Applied", "9/20/2026"],
      ],
      existing,
    );
    expect(create).toEqual([]);
    expect(update).toEqual([
      { jobId: "a", patch: { status: "interviewing" }, label: "Acme (renamed) · Something" },
      { jobId: "b", patch: { status: "submitted", appliedAt: day("2026-09-20") }, label: "globex corp · staff  engineer" },
    ]);
  });

  it("never downgrades and only patches what adds information", () => {
    const existing = [
      job({ id: "int", url: "https://a.example/1", company: "A", title: "Dev", status: "interviewing", notes: "Call on Monday" }),
      job({ id: "off", url: "https://b.example/1", company: "B", title: "Dev", status: "offer" }),
      job({ id: "run", url: "https://c.example/1", company: "C", title: "Dev", status: "needs_you" }),
      job({ id: "rej", url: "https://d.example/1", company: "", title: "", status: "rejected" }),
      job({ id: "same", url: "https://e.example/1", company: "E", title: "Dev", status: "submitted", appliedAt: day("2026-09-01") }),
    ];
    const { update, skipped } = plan(
      [
        ["Company", "Title", "Link", "Status", "Applied", "Notes", "Location"],
        ["A", "Dev", "https://a.example/1", "Applied", "9/1/2026", "Call on Monday", ""],
        ["B", "Dev", "https://b.example/1", "Rejected", "", "", ""],
        ["C", "Dev", "https://c.example/1", "Offer", "", "", ""],
        ["D", "Dev", "https://d.example/1", "Interviewing", "", "", "Remote"],
        ["E", "Dev", "https://e.example/1", "Applied", "9/3/2026", "", ""],
      ],
      existing,
    );
    expect(update).toEqual([
      // Status stays "interviewing"; only the missing applied date is filled in.
      { jobId: "int", patch: { appliedAt: day("2026-09-01") }, label: "A · Dev" },
      { jobId: "rej", patch: { company: "D", title: "Dev", location: "Remote" }, label: "D · Dev" },
    ]);
    expect(skipped.map((s) => [s.row, s.reason])).toEqual([
      [3, "unchanged"],
      [4, "unchanged"],
      [6, "unchanged"],
    ]);
  });

  it("appends new notes and moves rejected/offer forward", () => {
    const existing = [
      job({ id: "s", url: "https://a.example/1", status: "interviewing", notes: "old" }),
      job({ id: "t", url: "https://b.example/1", status: "rejected" }),
    ];
    const { update } = plan(
      [
        ["Link", "Status", "Notes"],
        ["https://a.example/1", "Rejected", "new info"],
        ["https://b.example/1", "Offer", ""],
      ],
      existing,
    );
    expect(update.map((u) => u.patch)).toEqual([{ status: "rejected", notes: "old\nnew info" }, { status: "offer" }]);
  });

  it("applies status overrides, ghosting notes and the queue option", () => {
    const rows = [
      ["Company", "Title", "Link", "Status", "Applied"],
      ["A", "Dev", "https://a.example/1", "Wishlist", ""],
      ["B", "Dev", "", "Wishlist", ""],
      ["C", "Dev", "https://c.example/1", "Ghosted", "8/1/2026"],
      ["D", "Dev", "https://d.example/1", "Maybe later??", ""],
      ["E", "Dev", "https://e.example/1", "Yolo", "8/2/2026"],
    ];
    const { create } = plan(rows, [], { queueSaved: true }, { "maybe later??": "skipped" });
    expect(create.map((j) => [j.company, j.status])).toEqual([
      ["A", "queued"],
      ["B", "saved"],
      ["C", "submitted"],
      ["D", "skipped"],
      ["E", "submitted"],
    ]);
    expect(create[2]!.notes).toBe("Sheet status: Ghosted");
    // A queued mapping without a link can't be auto-applied.
    const { create: c2 } = plan(rows.slice(0, 3), [], {}, { wishlist: "queued" });
    expect(c2.map((j) => j.status)).toEqual(["queued", "saved"]);
  });

  it("treats yes/x in an Applied column as applied without a date, and keeps unparsed dates in notes", () => {
    const { create } = plan([
      ["Company", "Title", "Applied?"],
      ["A", "Dev", "Yes"],
      ["B", "Dev", "x"],
      ["C", "Dev", "last spring"],
    ]);
    expect(create.map((j) => [j.status, j.appliedAt, j.notes])).toEqual([
      ["submitted", null, ""],
      ["submitted", null, ""],
      ["saved", null, "Applied: last spring"],
    ]);
  });

  it("reads EU dates when the column says so, and uses row hyperlinks", () => {
    const { create } = plan(
      [
        ["Company", "Title", "Date applied"],
        ["A", "Dev", "03/04/2026"],
        ["B", "Dev", "25/04/2026"],
      ],
      [],
      { links: ["https://a.example/job", undefined] },
    );
    expect(create.map((j) => [isoOf(j.appliedAt), j.url])).toEqual([
      ["2026-04-03", "https://a.example/job"],
      ["2026-04-25", ""],
    ]);
  });

  it("keeps the sheet's order in the tracker (newest updatedAt first)", () => {
    const { create } = plan([["Company", "Title"], ["A", "x"], ["B", "x"], ["C", "x"]]);
    expect([...create].sort((a, b) => b.updatedAt - a.updatedAt).map((j) => j.company)).toEqual(["A", "B", "C"]);
  });
});

describe("links", () => {
  it("normalizes URLs for matching", () => {
    expect(urlKey("https://www.Example.com/jobs/1/?utm_source=li&gh_jid=5#apply")).toBe("example.com/jobs/1?gh_jid=5");
    expect(urlKey("http://example.com/jobs/1")).toBe(urlKey("https://example.com/jobs/1/"));
    expect(cleanUrl(" <https://a.example/x> ")).toBe("https://a.example/x");
    expect(cleanUrl("www.a.example/x")).toBe("https://www.a.example/x");
    expect(cleanUrl("Referral from Bob")).toBe("");
    expect(cleanUrl("LinkedIn")).toBe("");
    expect(cleanUrl("javascript:alert(1)")).toBe("");
  });
  it("turns Google Sheets links into CSV URLs", () => {
    expect(sheetCsvUrl("https://docs.google.com/spreadsheets/d/e/2PACX-abc_123/pubhtml?gid=0&single=true")).toBe(
      "https://docs.google.com/spreadsheets/d/e/2PACX-abc_123/pub?gid=0&single=true&output=csv",
    );
    expect(sheetCsvUrl("https://docs.google.com/spreadsheets/d/e/2PACX-abc/pub?output=csv")).toBe("https://docs.google.com/spreadsheets/d/e/2PACX-abc/pub?output=csv");
    expect(sheetCsvUrl("https://docs.google.com/spreadsheets/d/1AbC-dEf/edit#gid=42")).toBe("https://docs.google.com/spreadsheets/d/1AbC-dEf/export?format=csv&gid=42");
    expect(sheetCsvUrl("https://docs.google.com/spreadsheets/d/1AbC-dEf/edit?usp=sharing")).toBe("https://docs.google.com/spreadsheets/d/1AbC-dEf/export?format=csv");
    expect(sheetCsvUrl("https://docs.google.com/spreadsheets/d/1AbC/export?format=csv&gid=7")).toBe("https://docs.google.com/spreadsheets/d/1AbC/export?format=csv&gid=7");
    expect(sheetCsvUrl("https://docs.google.com/spreadsheets/u/1/d/1AbC/edit#gid=3")).toBe("https://docs.google.com/spreadsheets/d/1AbC/export?format=csv&gid=3");
    expect(sheetCsvUrl("https://docs.google.com/spreadsheets/d/1AbC/gviz/tq?sheet=Jobs")).toBe("https://docs.google.com/spreadsheets/d/1AbC/gviz/tq?sheet=Jobs&tqx=out%3Acsv");
    expect(sheetCsvUrl("https://example.com/tracker.csv")).toBe("https://example.com/tracker.csv");
    expect(sheetCsvUrl("file:///etc/passwd")).toBeNull();
    expect(sheetCsvUrl("not a url")).toBeNull();
  });
});

// --- XLSX ------------------------------------------------------------------------

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function xlsx(sheets: { name: string; xml: string; rels?: string; hidden?: boolean }[], extra: Record<string, string> = {}, workbookPr = ""): Uint8Array {
  const files: { name: string; data: string }[] = [
    {
      name: "xl/workbook.xml",
      data: `<workbook ${NS}>${workbookPr}<sheets>${sheets
        .map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ""} r:id="rId${i + 1}"/>`)
        .join("")}</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map(
          (_s, i) =>
            // Mix relative and absolute targets, as different writers do.
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${i % 2 ? "/xl/" : ""}worksheets/sheet${i + 1}.xml"/>`,
        )
        .join("")}</Relationships>`,
    },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: `<worksheet ${NS}><sheetData>${s.xml}</sheetData>${s.rels ? s.rels.split("|")[0] : ""}</worksheet>` })),
    ...sheets.filter((s) => s.rels).map((s) => ({ name: `xl/worksheets/_rels/sheet${sheets.indexOf(s) + 1}.xml.rels`, data: s.rels!.split("|")[1]! })),
    ...Object.entries(extra).map(([name, data]) => ({ name, data })),
  ];
  return zipStore(files);
}

const STYLES = `<styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="164" formatCode="[$-409]mmm d, yyyy;@"/><numFmt numFmtId="165" formatCode="&quot;$&quot;#,##0"/></numFmts>
<cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/><xf numFmtId="164"><alignment wrapText="1"/></xf><xf numFmtId="165"/></cellXfs></styleSheet>`;

describe("readXlsx", () => {
  it("reads shared, inline, formula, number, boolean and date cells, with gaps", async () => {
    const sst = `<sst ${NS} count="4"><si><t>Company</t></si><si><t>Applied</t></si><si><r><t xml:space="preserve">Acme </t></r><r><rPr><b/></rPr><t>&amp; Sons</t></r><rPh><t>アクメ</t></rPh></si><si><t>line_x000D_
two</t></si></sst>`;
    const sheet = `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Salary</t></is></c></row>
<row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3" t="b"><v>1</v></c><c r="C3" s="1"><v>46279</v></c><c r="D3" s="3"><v>185000.5</v></c><c r="E3" t="str"><f>A3&amp;"!"</f><v>Acme &amp; Sons!</v></c></row>
<row r="4"><c r="A4" t="s"><v>3</v></c><c r="C4" s="2"><v>45658</v></c><c r="D4"><v>0.30000000000000004</v></c><c r="AA4" t="e"><v>#N/A</v></c></row>`;
    const wb = await readXlsx(xlsx([{ name: "Jobs", xml: sheet }], { "xl/sharedStrings.xml": sst, "xl/styles.xml": STYLES }));
    expect(wb.sheets).toHaveLength(1);
    const rows = wb.sheets[0]!.rows;
    expect(rows[0]).toEqual(["Company", "", "Applied", "Salary"]);
    expect(rows[1]).toEqual([]);
    expect(rows[2]).toEqual(["Acme & Sons", "TRUE", "2026-09-14", "185000.5", "Acme & Sons!"]);
    expect(rows[3]![0]).toBe("line\r\ntwo");
    expect(rows[3]![2]).toBe("2025-01-01");
    expect(rows[3]![3]).toBe("0.3");
    expect(rows[3]![26]).toBe("#N/A");
    expect(rows[3]).toHaveLength(27);
  });

  it("handles the 1904 date system, prefixed namespaces and cells without refs", async () => {
    const sheet = `<x:row><x:c t="inlineStr"><x:is><x:t>Date</x:t></x:is></x:c><x:c s="1"><x:v>44196</x:v></x:c></x:row><x:row r="3"><x:c r="B3"><x:v>7</x:v></x:c></x:row>`;
    const wb = await readXlsx(
      xlsx([{ name: "S", xml: sheet.replace(/<x:sheetData>/, "") }], { "xl/styles.xml": STYLES }, '<workbookPr date1904="1"/>'),
    );
    expect(wb.sheets[0]!.rows).toEqual([["Date", "2025-01-01"], [], ["", "7"]]);
  });

  it("lists every sheet with names, hidden flags and cell hyperlinks", async () => {
    const linkRels =
      '<hyperlinks><hyperlink ref="B2" r:id="rId9"/><hyperlink ref="A3" location="Sheet2!A1"/></hyperlinks>|<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://jobs.example/9" TargetMode="External"/></Relationships>';
    const wb = await readXlsx(
      xlsx([
        { name: "2026", xml: '<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c></row>' },
        { name: "Old &amp; done", xml: '<row r="2"><c r="B2" t="inlineStr"><is><t>Posting</t></is></c></row>', rels: linkRels },
        { name: "Lists", xml: "", hidden: true },
      ]),
    );
    expect(wb.sheets.map((s) => [s.name, !!s.hidden])).toEqual([
      ["2026", false],
      ["Old & done", false],
      ["Lists", true],
    ]);
    expect(wb.sheets[1]!.links).toEqual({ 1: "https://jobs.example/9" });
    expect(wb.sheets[2]!.rows).toEqual([]);
  });

  it("rejects files that aren't ZIPs", async () => {
    await expect(readXlsx(new TextEncoder().encode("Company,Role\n"))).rejects.toThrow();
  });

  it("reads a real Excel-shaped workbook (deflated, shared strings, styles, links)", async () => {
    const wb = await readXlsx(readFileSync(join(FIX, "job-tracker.xlsx")));
    expect(wb.sheets.map((s) => [s.name, !!s.hidden])).toEqual([
      ["Applications", false],
      ["Archive 2025", false],
      ["Lists", true],
    ]);
    const s = wb.sheets[0]!;
    expect(s.rows[0]![0]).toBe("Job Search 2026");
    const h = detectHeaderRow(s.rows);
    expect(h).toBe(2);
    expect(s.rows[h]).toEqual(["Company", "Job Title", "Status", "Date Applied", "Link", "Salary", "Remote?", "Notes"]);
    expect(s.rows[3]).toEqual(["Globex Corporation", "Staff Engineer", "Phone Screen", "2026-09-14", "https://boards.greenhouse.io/globex/jobs/4242", "185000", "TRUE", "Referred by Hank"]);
    expect(s.rows[5]![4]).toBe("apply here");
    expect(s.rows[8]![3]).toBe("46266"); // a date typed as a plain number
    expect(s.links).toEqual({ 4: "https://jobs.lever.co/initech/abc-123", 5: "https://umbrella.example/careers/77" });

    const mapping = autoMap(s.rows[h]!);
    expect(mapping).toEqual({ company: 0, title: 1, status: 2, appliedAt: 3, url: 4, salary: 5, location: 6, notes: 7 });
    const data = s.rows.slice(h + 1);
    const existing = [
      job({ id: "acme", url: "http://127.0.0.1:9/posting.html", company: "Acme Robotics", title: "Senior Platform Engineer", status: "interviewing", appliedAt: day("2026-10-02"), location: "Austin" }),
    ];
    const p = rowsToJobs(data, mapping, {}, existing, { now: NOW, links: data.map((_r, i) => s.links?.[h + 1 + i]), firstRow: h + 2 });
    expect(p.create.map((j) => [j.company, j.status, isoOf(j.appliedAt), j.url])).toEqual([
      ["Globex Corporation", "interviewing", "2026-09-14", "https://boards.greenhouse.io/globex/jobs/4242"],
      ["Initech", "rejected", "2026-08-30", "https://jobs.lever.co/initech/abc-123"],
      ["Umbrella Health", "saved", null, "https://umbrella.example/careers/77"],
      ["Hooli", "offer", "2026-07-02", "https://hooli.example/jobs/9"],
      ["Black Mesa", "interviewing", "2026-09-01", "https://blackmesa.example/jobs/3"],
    ]);
    expect(p.create[0]!.notes).toBe("Referred by Hank\nSalary: 185000");
    expect(p.create.map((j) => j.location)).toEqual(["Remote", "", "Remote", "", ""]); // "Remote?" TRUE/FALSE
    expect(p.skipped).toEqual([{ row: 8, reason: "unchanged", label: "Acme Robotics · Senior Platform Engineer" }]);

    const archive = wb.sheets[1]!;
    expect(archive.rows).toEqual([
      ["Company", "Role", "Stage", "Applied"],
      ["Vandelay Industries", "Importer/Exporter", "Ghosted", "2025-03-03"],
      ["Kramerica", "Intern", "Declined", "2025-02-01"],
    ]);
  });
});

// --- CSV fixtures end to end -------------------------------------------------------

describe("CSV fixtures", () => {
  it("imports a Google Sheets tracker export", () => {
    const rows = parseCsv(readFileSync(join(FIX, "google-tracker.csv"), "utf8"));
    expect(detectHeaderRow(rows)).toBe(2);
    const existing = [
      job({ id: "acme", url: "http://127.0.0.1:5555/posting.html", company: "Acme Robotics", title: "Senior Platform Engineer", status: "submitted", appliedAt: day("2026-10-02") }),
    ];
    const p = plan(rows, existing);
    expect(p.update).toEqual([
      { jobId: "acme", patch: { status: "interviewing", notes: 'Recruiter Wile E. said "expect a call, next week"' }, label: "Acme Robotics · Senior Platform Engineer" },
    ]);
    expect(p.create.map((j) => [j.company, j.status, isoOf(j.appliedAt), j.url])).toEqual([
      ["Stark Industries", "submitted", "2026-09-28", "https://jobs.lever.co/stark/fe-001?utm_source=linkedin"],
      ["Wayne Enterprises", "rejected", "2026-09-15", "https://boards.greenhouse.io/wayne/jobs/555"],
      ["Cyberdyne Systems", "submitted", "2026-08-20", ""],
      ["Soylent", "saved", null, "https://soylent.example/jobs/12"],
    ]);
    expect(p.create[1]!.notes).toBe("Two rounds,\nthen a form rejection");
    expect(p.create[2]!.notes).toBe("Sheet status: Ghosted");
    expect(p.skipped).toEqual([{ row: 9, reason: "duplicate", label: "Stark Industries · Frontend Engineer (= row 5)" }]);
  });

  it("imports a Notion export (BOM, CRLF, long dates) and dedupes against earlier imports", () => {
    const rows = parseCsv(readFileSync(join(FIX, "notion-export.csv"), "utf8"));
    expect(rows[0]![0]).toBe("Name");
    const existing = [job({ id: "hooli", url: "https://hooli.example/jobs/9", company: "Hooli", title: "Platform Engineer", status: "offer", appliedAt: day("2026-07-02") })];
    const p = plan(rows, existing);
    expect(p.create.map((j) => [j.company, j.title, j.status, isoOf(j.appliedAt), j.location])).toEqual([
      ["Initrode", "Staff Software Engineer", "submitted", "2026-10-03", "Austin, TX"],
      ["Massive Dynamic", "Engineering Manager", "interviewing", "2026-09-21", "Remote"],
      ["Pied Piper", "Backend Engineer", "saved", null, "Palo Alto, CA"],
      ["Aviato", "Founding Engineer", "rejected", "2026-08-12", ""],
    ]);
    expect(p.create[0]!.notes).toBe("Salary: $180,000 - $200,000\nContact: jane@initrode.example");
    expect(p.update).toEqual([{ jobId: "hooli", patch: { location: "Remote", notes: "Salary: $210k" }, label: "Hooli · Platform Engineer" }]);
  });
});

// --- export ------------------------------------------------------------------------

describe("jobsToXlsx", () => {
  it("writes a workbook that reads back (and re-imports as unchanged)", async () => {
    const jobs = [
      job({ id: "1", company: "Acme & Co <Labs>", title: 'Staff "SWE"', url: "https://a.example/1", status: "interviewing", appliedAt: day("2026-09-14"), createdAt: day("2026-09-10"), notes: "line 1\nline 2\u0001", ats: "a.example" }),
      job({ id: "2", company: "Globex", title: "QA", status: "saved", createdAt: day("2026-10-01") }),
    ];
    const label = (s: JobStatus) => ({ interviewing: "Interviewing", saved: "Saved" })[s as "saved"] ?? s;
    const bytes = jobsToXlsx(jobs, label);
    const wb = await readXlsx(bytes);
    expect(wb.sheets.map((s) => s.name)).toEqual(["Applications"]);
    const rows = wb.sheets[0]!.rows;
    expect(rows).toEqual([
      ["Company", "Title", "Location", "Status", "Applied", "Added", "Source", "Link", "Notes"],
      ["Acme & Co <Labs>", 'Staff "SWE"', "", "Interviewing", "2026-09-14", "2026-09-10", "a.example", "https://a.example/1", "line 1\nline 2"],
      ["Globex", "QA", "", "Saved", "", "2026-10-01"],
    ]);
    const p = rowsToJobs(rows.slice(1), autoMap(rows[0]!), {}, jobs, { now: NOW });
    expect(p.create).toEqual([]);
    expect(p.update).toEqual([]);
    expect(p.skipped.map((s) => s.reason)).toEqual(["unchanged", "unchanged"]);
  });
});

describe("zip + helpers", () => {
  it("crc32 and column letters", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect([0, 25, 26, 27, 701, 702].map(columnLabel)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
    expect(["A1", "Z9", "AA10", "ab3", "AAA1"].map(columnIndex)).toEqual([0, 25, 26, 27, 702]);
  });
});
