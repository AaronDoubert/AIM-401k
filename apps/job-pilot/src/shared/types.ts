// Shared data model. Everything persisted lives in browser.storage.local under
// the keys in STORAGE_KEYS; the background script is the only writer.

export type YesNo = "yes" | "no" | "";

export interface ResumeFile {
  name: string;
  type: string;
  /** base64 (no data: prefix) */
  data: string;
}

export interface WorkEntry {
  company: string;
  title: string;
  location: string;
  /** "YYYY-MM" (or "YYYY") */
  startDate: string;
  /** "YYYY-MM"; empty when current */
  endDate: string;
  current: boolean;
  description: string;
}

export interface EducationEntry {
  school: string;
  degree: string;
  field: string;
  /** "YYYY-MM" (or "YYYY") */
  startDate: string;
  endDate: string;
  gpa: string;
}

export interface Profile {
  firstName: string;
  middleName: string;
  lastName: string;
  preferredName: string;
  pronouns: string;
  email: string;
  phone: string;
  street: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  linkedin: string;
  github: string;
  portfolio: string;
  /** Most recent first. */
  workHistory: WorkEntry[];
  /** Most recent / highest first. */
  education: EducationEntry[];
  yearsExperience: string;
  skills: string;
  certifications: string;
  languages: string;
  workAuthorized: YesNo;
  requiresSponsorship: YesNo;
  /** Free text, e.g. "US Citizen", "Green card", "H-1B (transfer)". */
  citizenship: string;
  over18: YesNo;
  willingToRelocate: YesNo;
  driversLicense: YesNo;
  securityClearance: string;
  /** "Remote" | "Hybrid" | "On-site" | "Any" */
  workplacePreference: string;
  desiredTitles: string;
  desiredLocations: string;
  salaryExpectation: string;
  /** Earliest start, "YYYY-MM-DD". Empty = derive from notice period. */
  earliestStartDate: string;
  /** Free text, e.g. "2 weeks". Used for text start-date questions. */
  noticePeriod: string;
  howDidYouHear: string;
  gender: string;
  race: string;
  hispanicLatino: string;
  veteranStatus: string;
  disabilityStatus: string;
  /** Short bio / summary the AI may use as context. */
  summary: string;
  /** Plain-text resume the AI may use as context. */
  resumeText: string;
  coverLetterTemplate: string;
  resume: ResumeFile | null;
}

export interface AnswerEntry {
  id: string;
  question: string;
  answer: string;
  source: "user" | "ai";
  updatedAt: number;
}

export type LlmMode = "off" | "draft" | "auto";

export interface Settings {
  /** Global pause for the queue runner. */
  paused: boolean;
  /** Click Next/Continue on multi-step forms automatically. */
  autoAdvance: boolean;
  /** Click the final Submit button without asking. Off by default. */
  autoSubmit: boolean;
  /** How many job tabs may be actively filling at once. */
  concurrency: number;
  /** Cap on managed tabs open at once (incl. ones waiting on you). */
  maxOpenTabs: number;
  /** Minutes without progress before a job is flagged as stalled. */
  stallMinutes: number;
  notifications: boolean;
  /** Fill optional (non-required) questions too when we know the answer. */
  fillOptional: boolean;
  llmMode: LlmMode;
  aiProvider: ProviderId;
  /** API key per provider (only read by the background script). */
  apiKeys: Partial<Record<ProviderId, string>>;
  /** Model per provider. */
  models: Partial<Record<ProviderId, string>>;
  /** Base URL for the "custom" / "ollama" providers. */
  customBaseUrl: string;
  effort: "low" | "medium" | "high";
  /** Set once the onboarding wizard has been completed or dismissed. */
  onboarded: boolean;
}

export type ProviderId = "gemini" | "groq" | "openrouter" | "github" | "mistral" | "ollama" | "anthropic" | "custom";

export type JobStatus =
  | "saved"
  | "queued"
  | "running"
  | "needs_you"
  | "ready_to_submit"
  | "submitted"
  | "failed"
  | "skipped"
  | "interviewing"
  | "offer"
  | "rejected";

export interface LogEntry {
  t: number;
  msg: string;
}

export interface Job {
  id: string;
  url: string;
  company: string;
  title: string;
  location: string;
  ats: string;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  appliedAt: number | null;
  lastProgressAt: number;
  notes: string;
  tabId: number | null;
  /** Tab was opened by the runner (so we may close it when done). */
  autoTab: boolean;
  aiDrafted: number;
  log: LogEntry[];
}

export type NeedKind =
  | "question"
  | "consent"
  | "signature"
  | "captcha"
  | "login"
  | "review_submit"
  | "stalled"
  | "error";

export interface Need {
  id: string;
  jobId: string;
  kind: NeedKind;
  /** The question/field label (also the answer-bank key). */
  prompt: string;
  /** Extra context, e.g. a validation error or why the AI declined. */
  detail?: string;
  /** Which frame of the job tab raised it (-1 = background). */
  frameId: number;
  /** Stable key of the field this need is about (question/consent/signature). */
  fieldKey?: string;
  inputType?: "text" | "textarea" | "choice" | "multi" | "date";
  options?: string[];
  createdAt: number;
}

export interface PageMeta {
  title: string;
  company: string;
  location: string;
  ats: string;
  description: string;
}
