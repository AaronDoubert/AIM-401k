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
