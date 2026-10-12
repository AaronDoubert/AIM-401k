import type { EducationEntry, Profile, Settings, WorkEntry } from "./types";

export const DECLINE = "Decline to self-identify";

export const EMPTY_WORK: WorkEntry = { company: "", title: "", location: "", startDate: "", endDate: "", current: false, description: "" };
export const EMPTY_EDU: EducationEntry = { school: "", degree: "", field: "", startDate: "", endDate: "", gpa: "" };

export const DEFAULT_PROFILE: Profile = {
  firstName: "",
  middleName: "",
  lastName: "",
  preferredName: "",
  pronouns: "",
  email: "",
  phone: "",
  street: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "United States",
  linkedin: "",
  github: "",
  portfolio: "",
  workHistory: [],
  education: [],
  yearsExperience: "",
  skills: "",
  certifications: "",
  languages: "",
  workAuthorized: "",
  requiresSponsorship: "",
  citizenship: "",
  over18: "yes",
  willingToRelocate: "",
  driversLicense: "",
  securityClearance: "",
  workplacePreference: "",
  desiredTitles: "",
  desiredLocations: "",
  salaryExpectation: "",
  earliestStartDate: "",
  noticePeriod: "",
  howDidYouHear: "Company website",
  gender: DECLINE,
  race: DECLINE,
  hispanicLatino: DECLINE,
  veteranStatus: DECLINE,
  disabilityStatus: DECLINE,
  summary: "",
  resumeText: "",
  coverLetterTemplate: "",
  resume: null,
};

export const DEFAULT_SETTINGS: Settings = {
  paused: false,
  autoAdvance: true,
  autoSubmit: false,
  concurrency: 1,
  maxOpenTabs: 6,
  stallMinutes: 4,
  notifications: true,
  fillOptional: true,
  llmMode: "off",
  aiProvider: "gemini",
  apiKeys: {},
  models: {},
  customBaseUrl: "",
  effort: "medium",
  onboarded: false,
  ui: { chud: true, sound: false },
  afk: false,
  intel: { gmailTab: true, outlookTab: true, gmailApi: false, gmailClientId: "", autoStatus: true, useAi: false, lastSync: 0 },
};

export const STORAGE_KEYS = {
  profile: "profile",
  settings: "settings",
  jobs: "jobs",
  answers: "answers",
  needs: "needs",
  ops: "ops",
  intel: "intel",
} as const;

type Raw = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

/** Fill defaults and migrate v1 profiles (flat current job / school fields). */
export function normalizeProfile(raw: unknown): Profile {
  const r = (raw && typeof raw === "object" ? raw : {}) as Raw;
  const p: Profile = { ...DEFAULT_PROFILE, ...(r as Partial<Profile>) };
  p.workHistory = Array.isArray(r.workHistory) ? (r.workHistory as WorkEntry[]).map((w) => ({ ...EMPTY_WORK, ...w })) : [];
  p.education = Array.isArray(r.education) ? (r.education as EducationEntry[]).map((e) => ({ ...EMPTY_EDU, ...e })) : [];
  if (!p.workHistory.length && (r.currentCompany || r.currentTitle)) {
    p.workHistory = [{ ...EMPTY_WORK, company: str(r.currentCompany), title: str(r.currentTitle), current: true }];
  }
  if (!p.education.length && (r.school || r.degree)) {
    p.education = [{ ...EMPTY_EDU, school: str(r.school), degree: str(r.degree), field: str(r.major), endDate: str(r.graduationYear) }];
  }
  if (!p.noticePeriod && r.startDate) p.noticePeriod = str(r.startDate);
  for (const k of ["currentCompany", "currentTitle", "school", "degree", "major", "graduationYear", "startDate"]) delete (p as unknown as Raw)[k];
  return p;
}

/** Fill defaults and migrate v1 settings (single Anthropic key). */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Raw;
  const s: Settings = { ...DEFAULT_SETTINGS, ...(r as Partial<Settings>) };
  s.apiKeys = { ...((r.apiKeys as Settings["apiKeys"]) ?? {}) };
  s.models = { ...((r.models as Settings["models"]) ?? {}) };
  s.ui = { ...DEFAULT_SETTINGS.ui, ...((r.ui as Partial<Settings["ui"]>) ?? {}) };
  s.intel = { ...DEFAULT_SETTINGS.intel, ...((r.intel as Partial<Settings["intel"]>) ?? {}) };
  if (r.anthropicApiKey && !s.apiKeys.anthropic) {
    s.apiKeys.anthropic = str(r.anthropicApiKey);
    if (!r.aiProvider) s.aiProvider = "anthropic";
  }
  if (r.model && !s.models.anthropic && str(r.model).startsWith("claude")) s.models.anthropic = str(r.model);
  delete (s as unknown as Raw).anthropicApiKey;
  delete (s as unknown as Raw).model;
  return s;
}

/** Most relevant job: the current one, else the most recent. */
export function currentJob(p: Profile): WorkEntry | undefined {
  return p.workHistory.find((w) => w.current) ?? p.workHistory[0];
}
