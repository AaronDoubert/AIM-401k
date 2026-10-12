import { parseDate, toIso } from "../core/dates";
import { EMPTY_EDU, EMPTY_WORK } from "../shared/defaults";
import type { EducationEntry, Profile, WorkEntry } from "../shared/types";
import { h } from "./common";

// Form building blocks shared by the onboarding wizard and the settings page.

export type FieldType = "text" | "textarea" | "yesno" | "select" | "checkbox" | "number" | "password" | "date" | "email" | "tel" | "url" | "month";

export interface FieldSpec {
  key: string;
  label: string;
  type?: FieldType;
  options?: string[];
  wide?: boolean;
  hint?: string;
  placeholder?: string;
}

const yesNo: FieldSpec["type"] = "yesno";

export const PROFILE_GROUPS: Record<string, FieldSpec[]> = {
  basics: [
    { key: "firstName", label: "First name" },
    { key: "middleName", label: "Middle name" },
    { key: "lastName", label: "Last name" },
    { key: "preferredName", label: "Preferred name" },
    { key: "pronouns", label: "Pronouns", placeholder: "e.g. she/her" },
    { key: "email", label: "Email", type: "email" },
    { key: "phone", label: "Phone", type: "tel" },
    { key: "street", label: "Street address" },
    { key: "addressLine2", label: "Apt / suite" },
    { key: "city", label: "City" },
    { key: "state", label: "State / province" },
    { key: "postalCode", label: "ZIP / postal code" },
    { key: "country", label: "Country" },
  ],
  links: [
    { key: "linkedin", label: "LinkedIn URL", type: "url" },
    { key: "github", label: "GitHub URL", type: "url" },
    { key: "portfolio", label: "Portfolio / website", type: "url" },
  ],
  skills: [
    { key: "yearsExperience", label: "Years of experience", hint: "Leave blank to compute from your work history", placeholder: "auto" },
    { key: "skills", label: "Skills (comma-separated)", type: "textarea", wide: true },
    { key: "certifications", label: "Certifications", wide: true },
    { key: "languages", label: "Languages spoken", placeholder: "English (native), Spanish (conversational)", wide: true },
    { key: "summary", label: "Professional summary (used by AI drafting)", type: "textarea", wide: true },
  ],
  eligibility: [
    { key: "workAuthorized", label: "Legally authorized to work in your country?", type: yesNo },
    { key: "requiresSponsorship", label: "Need visa sponsorship now or later?", type: yesNo },
    { key: "citizenship", label: "Citizenship / visa status", placeholder: "e.g. US citizen, Green card, H-1B" },
    { key: "over18", label: "18 or older?", type: yesNo },
    { key: "driversLicense", label: "Valid driver's license?", type: yesNo },
    { key: "securityClearance", label: "Security clearance", placeholder: "None" },
  ],
  preferences: [
    { key: "desiredTitles", label: "Target job titles", placeholder: "Backend Engineer, Platform Engineer" },
    { key: "desiredLocations", label: "Preferred locations", placeholder: "Austin, Remote (US)" },
    { key: "workplacePreference", label: "Workplace", type: "select", options: ["", "Remote", "Hybrid", "On-site", "Any"] },
    { key: "willingToRelocate", label: "Willing to relocate?", type: yesNo },
    { key: "salaryExpectation", label: "Salary expectation", placeholder: "$140,000" },
    { key: "earliestStartDate", label: "Earliest start date", type: "date", hint: "Or leave blank and set a notice period" },
    { key: "noticePeriod", label: "Notice period", placeholder: "2 weeks" },
    { key: "howDidYouHear", label: "Default answer to “How did you hear about us?”" },
  ],
  eeo: [
    { key: "gender", label: "Gender" },
    { key: "race", label: "Race / ethnicity" },
    { key: "hispanicLatino", label: "Hispanic or Latino" },
    { key: "veteranStatus", label: "Veteran status" },
    { key: "disabilityStatus", label: "Disability status" },
  ],
  documents: [
    { key: "resumeText", label: "Resume as plain text (used by AI drafting)", type: "textarea", wide: true },
    { key: "coverLetterTemplate", label: "Cover letter template — placeholders: {company} {title} {firstName} {name}", type: "textarea", wide: true },
  ],
};

type Obj = Record<string, unknown>;

/** Normalize anything date-like typed into a "YYYY-MM" box. */
function normalizeMonth(v: string): string {
  if (!v.trim() || /^present$/i.test(v.trim())) return "";
  const d = parseDate(v);
  return d ? toIso({ y: d.y, ...(d.m ? { m: d.m } : {}) }) : v;
}

export function control(spec: FieldSpec, value: unknown, onChange: (v: unknown) => void): HTMLElement {
  let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  const t = spec.type ?? "text";
  if (t === "textarea") {
    input = h("textarea", { rows: 5 });
    input.value = String(value ?? "");
  } else if (t === "yesno" || t === "select") {
    input = h("select");
    const opts = t === "yesno" ? [["", "—"], ["yes", "Yes"], ["no", "No"]] : (spec.options ?? []).map((o) => [o, o || "—"]);
    for (const [v, txt] of opts) input.append(h("option", { value: v!, textContent: txt! }));
    input.value = String(value ?? "");
  } else if (t === "checkbox") {
    input = h("input", { type: "checkbox", checked: !!value });
  } else if (t === "month") {
    input = h("input", { type: "text", value: String(value ?? ""), placeholder: spec.placeholder ?? "YYYY-MM" });
  } else {
    input = h("input", { type: t, value: String(value ?? "") });
    if (t === "password") input.autocomplete = "off";
  }
  if (spec.placeholder && "placeholder" in input && t !== "month") input.placeholder = spec.placeholder;
  const read = () => (t === "checkbox" ? (input as HTMLInputElement).checked : t === "number" ? Number(input.value) || 0 : input.value);
  input.addEventListener("input", () => onChange(read()));
  input.addEventListener("change", () => {
    if (t === "month") input.value = normalizeMonth(input.value);
    onChange(read());
  });
  const label = h("label", { className: `f ${t === "checkbox" ? "check" : ""} ${spec.wide ? "wide" : ""}` });
  if (t === "checkbox") label.append(input, spec.label);
  else label.append(spec.label, input);
  if (spec.hint) label.append(h("span", { className: "muted", textContent: spec.hint }));
  return label;
}

export function renderFields(box: Element, specs: FieldSpec[], obj: Obj, onChange: () => void): void {
  box.replaceChildren(
    ...specs.map((s) =>
      control(s, obj[s.key], (v) => {
        obj[s.key] = v;
        onChange();
      }),
    ),
  );
}

const WORK_SPECS: FieldSpec[] = [
  { key: "title", label: "Job title" },
  { key: "company", label: "Company" },
  { key: "location", label: "Location" },
  { key: "startDate", label: "Start (YYYY-MM)", type: "month", placeholder: "2021-03 or Mar 2021" },
  { key: "endDate", label: "End (YYYY-MM)", type: "month", placeholder: "blank if current" },
  { key: "current", label: "I currently work here", type: "checkbox" },
  { key: "description", label: "What you did (one bullet per line)", type: "textarea", wide: true },
];

const EDU_SPECS: FieldSpec[] = [
  { key: "school", label: "School" },
  { key: "degree", label: "Degree", placeholder: "Bachelor of Science" },
  { key: "field", label: "Field of study" },
  { key: "startDate", label: "Start (YYYY-MM)", type: "month" },
  { key: "endDate", label: "Graduation (YYYY-MM)", type: "month", placeholder: "expected date is fine" },
  { key: "gpa", label: "GPA (optional)" },
];

function renderList<T extends object>(
  box: Element,
  items: T[],
  specs: FieldSpec[],
  empty: T,
  noun: string,
  title: (t: T) => string,
  onChange: () => void,
): void {
  const draw = () => {
    box.replaceChildren();
    items.forEach((item, i) => {
      const fields = h("div", { className: "grid" });
      renderFields(fields, specs, item as Obj, () => {
        head.textContent = title(item) || `${noun} ${i + 1}`;
        onChange();
      });
      const head = h("b", { textContent: title(item) || `${noun} ${i + 1}` });
      const tools = h("div", { className: "row" });
      const btn = (label: string, fn: () => void, cls = "") => {
        const b = h("button", { textContent: label, className: cls, type: "button" });
        b.addEventListener("click", fn);
        tools.append(b);
      };
      if (i > 0)
        btn("↑", () => {
          [items[i - 1], items[i]] = [items[i]!, items[i - 1]!];
          onChange();
          draw();
        });
      btn(
        "Remove",
        () => {
          items.splice(i, 1);
          onChange();
          draw();
        },
        "danger",
      );
      box.append(h("div", { className: "card entry" }, h("div", { className: "row spread" }, head, tools), fields));
    });
    const add = h("button", { textContent: `+ Add ${noun.toLowerCase()}`, type: "button" });
    add.addEventListener("click", () => {
      items.push({ ...empty });
      onChange();
      draw();
    });
    box.append(add);
  };
  draw();
}

export function renderWork(box: Element, p: Profile, onChange: () => void): void {
  renderList<WorkEntry>(box, p.workHistory, WORK_SPECS, EMPTY_WORK, "Job", (w) => [w.title, w.company].filter(Boolean).join(" · "), onChange);
}

export function renderEducation(box: Element, p: Profile, onChange: () => void): void {
  renderList<EducationEntry>(box, p.education, EDU_SPECS, EMPTY_EDU, "School", (e) => [e.degree, e.school].filter(Boolean).join(" · "), onChange);
}

