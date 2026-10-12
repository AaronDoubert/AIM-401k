import { DEFAULT_PROFILE } from "../src/shared/defaults";
import type { Profile } from "../src/shared/types";
import type { FieldInfo } from "../src/core/matcher";

export const profile: Profile = {
  ...DEFAULT_PROFILE,
  firstName: "Ada",
  lastName: "Lovelace",
  preferredName: "",
  email: "ada@example.com",
  phone: "555-0100",
  city: "Austin",
  state: "Texas",
  postalCode: "78701",
  country: "United States",
  linkedin: "https://linkedin.com/in/ada",
  github: "https://github.com/ada",
  workHistory: [
    { company: "Analytical Engines", title: "Engineer", location: "London", startDate: "2019-03", endDate: "", current: true, description: "Built the engine." },
    { company: "Babbage & Co", title: "Junior Engineer", location: "London", startDate: "2016-06", endDate: "2019-02", current: false, description: "" },
  ],
  education: [{ school: "University of London", degree: "Bachelor of Science", field: "Mathematics", startDate: "2012-09", endDate: "2016-05", gpa: "3.9" }],
  noticePeriod: "2 weeks",
  workAuthorized: "yes",
  requiresSponsorship: "no",
  coverLetterTemplate: "Dear {company}, I want the {title} role. — {firstName}",
  resume: { name: "ada.pdf", type: "application/pdf", data: "JVBERi0=" },
};

export function field(label: string, over: Partial<FieldInfo> = {}): FieldInfo {
  return { key: label, kind: "text", label, attrs: "", autocomplete: "", placeholder: "", required: true, options: [], ...over };
}

export const ctx = { company: "Acme", title: "Staff Engineer" };
