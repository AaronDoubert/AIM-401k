// Shared data model. Everything persisted lives in browser.storage.local under
// the keys in STORAGE_KEYS; the background script is the only writer.

export type YesNo = "yes" | "no" | "";

export interface ResumeFile {
  name: string;
  type: string;
  /** base64 (no data: prefix) */
  data: string;
}

export interface Profile {
  firstName: string;
  lastName: string;
  preferredName: string;
  pronouns: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  linkedin: string;
  github: string;
  portfolio: string;
  currentTitle: string;
  currentCompany: string;
  yearsExperience: string;
  school: string;
  degree: string;
  major: string;
  graduationYear: string;
  workAuthorized: YesNo;
  requiresSponsorship: YesNo;
  over18: YesNo;
  willingToRelocate: YesNo;
  salaryExpectation: string;
  startDate: string;
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
  anthropicApiKey: string;
  model: string;
  effort: "low" | "medium" | "high";
}

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
  inputType?: "text" | "textarea" | "choice" | "multi";
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
