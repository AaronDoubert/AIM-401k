import { describe, expect, it } from "vitest";
import { fromJsonResume, mergeResume, parseResumeText } from "../src/core/resumeParse";
import { DEFAULT_PROFILE } from "../src/shared/defaults";
// @ts-expect-error plain .mjs fixture shared with the e2e run
import { SAMPLE as SAMPLE_RESUME } from "./fixtures/sample-resume.mjs";


describe("parseResumeText", () => {
  const r = parseResumeText(SAMPLE_RESUME);
  it("reads contact details", () => {
    expect(r).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      phone: "(512) 555-0100",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
      linkedin: "https://linkedin.com/in/ada-lovelace",
      github: "https://github.com/ada",
      portfolio: "https://ada.dev",
    });
    expect(r.summary).toMatch(/^Platform engineer/);
  });
  it("reads work history", () => {
    expect(r.workHistory).toHaveLength(2);
    expect(r.workHistory![0]).toMatchObject({
      title: "Senior Platform Engineer",
      company: "Analytical Engines Inc",
      location: "Austin, TX",
      startDate: "2021-03",
      endDate: "",
      current: true,
    });
    expect(r.workHistory![0]!.description).toBe("Led migration of 40 services to Kubernetes\nCut p99 latency 35%");
    expect(r.workHistory![1]).toMatchObject({ title: "Software Engineer", company: "Babbage & Co", startDate: "2016-06", endDate: "2021-02", current: false });
  });
  it("reads education, skills and certifications", () => {
    expect(r.education![0]).toMatchObject({ school: "University of London", degree: "Bachelor of Science", field: "Mathematics", startDate: "2012", endDate: "2016", gpa: "3.9" });
    expect(r.skills).toBe("Go, Python, TypeScript, Kubernetes, Terraform, Postgres");
    expect(r.certifications).toBe("AWS Certified Solutions Architect");
  });
});

describe("JSON Resume + merge", () => {
  it("maps the JSON Resume schema", () => {
    const d = fromJsonResume({
      basics: { name: "Ada King Lovelace", email: "a@x.io", location: { city: "Austin", region: "TX", countryCode: "US" }, profiles: [{ network: "LinkedIn", url: "https://linkedin.com/in/ada" }] },
      work: [{ name: "Acme", position: "Engineer", startDate: "2020-01-15", highlights: ["Did things"] }],
      education: [{ institution: "MIT", studyType: "BS", area: "CS", endDate: "2016-06-01" }],
      skills: [{ name: "Backend", keywords: ["Go", "SQL"] }],
    });
    expect(d).toMatchObject({ firstName: "Ada", middleName: "King", lastName: "Lovelace", city: "Austin", country: "United States", linkedin: "https://linkedin.com/in/ada", skills: "Go, SQL" });
    expect(d.workHistory![0]).toMatchObject({ company: "Acme", startDate: "2020-01", current: true, description: "Did things" });
    expect(d.education![0]).toMatchObject({ school: "MIT", endDate: "2016-06" });
  });
  it("only fills empty fields unless overwriting", () => {
    const p = { ...DEFAULT_PROFILE, email: "keep@me.com" };
    const merged = mergeResume(p, { email: "new@x.com", firstName: "Ada", country: "Canada" });
    expect(merged).toMatchObject({ email: "keep@me.com", firstName: "Ada", country: "Canada" });
    expect(mergeResume(p, { email: "new@x.com" }, true).email).toBe("new@x.com");
  });
});

describe("parseResumeText: common resume templates", () => {
  const work = (body: string) => parseResumeText(`Jane Doe\njane@x.io\n\nEXPERIENCE\n${body}\nEDUCATION\nStony Brook University\n`).workHistory!;

  it("company and location on one line with no gap, title and dates below (PDF text)", () => {
    const w = work(`Highland Associates Manhattan, NY
Mechanical Engineering Intern – Controls May 2026 – Aug 2026
• Designed building automation control drawings in Revit across 6 data center projects, each
integrating 400+ pieces of equipment
• Built a VBA tool to parse Sequence of Operations documents from OCR'd specification text,
standardizing control narrative markup across multi-hundred-page submittals
Dacora Motors Port Washington, NY
Mechanical Engineering Intern May 2025 – Aug 2025
• Owned full development of a retracting coffee brewer
DC Creatives Port Washington, NY
Engineering Intern, Dec. 2024 − Jan. 2025
• Did stuff`);
    expect(w).toHaveLength(3);
    expect(w[0]).toMatchObject({ title: "Mechanical Engineering Intern – Controls", company: "Highland Associates", location: "Manhattan, NY", startDate: "2026-05", endDate: "2026-08" });
    expect(w[0]!.description.split("\n")).toEqual([
      "Designed building automation control drawings in Revit across 6 data center projects, each integrating 400+ pieces of equipment",
      "Built a VBA tool to parse Sequence of Operations documents from OCR'd specification text, standardizing control narrative markup across multi-hundred-page submittals",
    ]);
    expect(w[1]).toMatchObject({ title: "Mechanical Engineering Intern", company: "Dacora Motors", location: "Port Washington, NY" });
    expect(w[2]).toMatchObject({ title: "Engineering Intern", company: "DC Creatives", location: "Port Washington, NY", startDate: "2024-12", endDate: "2025-01" });
  });

  it("title and dates first, company and location on the line below", () => {
    const w = work(`Software Engineering Intern   June 2024 -- Present
Initech   Austin, TX
• Shipped the TPS report service
Research Assistant   Summer 2023 - Fall 2023
Stony Brook University   Stony Brook, NY
• Ran experiments`);
    expect(w).toHaveLength(2);
    expect(w[0]).toMatchObject({ title: "Software Engineering Intern", company: "Initech", location: "Austin, TX", startDate: "2024-06", current: true, description: "Shipped the TPS report service" });
    expect(w[1]).toMatchObject({ title: "Research Assistant", company: "Stony Brook University", location: "Stony Brook, NY", startDate: "2023-06", endDate: "2023-09" });
  });

  it("company first when the title names the role", () => {
    const w = work(`Acme Corp | Backend Developer | Remote   Jan 2020 – Dec 2021
- Built APIs`);
    expect(w[0]).toMatchObject({ title: "Backend Developer", company: "Acme Corp", location: "Remote" });
  });
});
