import type { AnswerEntry, Job, Need, NeedKind, PageMeta, Profile, ProviderId, Settings } from "./types";

/** A need as reported by a content script (ids/timestamps assigned by background). */
export interface NeedInput {
  kind: NeedKind;
  prompt: string;
  detail?: string;
  fieldKey?: string;
  inputType?: Need["inputType"];
  options?: string[];
}

export type PageState =
  | "filling" // still working
  | "blocked" // waiting on the human (needs non-empty)
  | "ready" // everything filled, final submit pending human review
  | "submitted"; // confirmation page detected

/** Settings as content scripts see them: no API keys, just whether AI is usable. */
export type PublicSettings = Omit<Settings, "apiKeys"> & { hasApiKey: boolean };

export interface AiOverride {
  provider?: ProviderId;
  key?: string;
  model?: string;
  baseUrl?: string;
}

export interface ContentContext {
  managed: boolean;
  jobId: string | null;
  profile: Profile;
  answers: AnswerEntry[];
  settings: PublicSettings;
}

export interface DraftRequest {
  question: string;
  inputType: string;
  options: string[];
  required: boolean;
  meta: PageMeta;
}

export interface DraftResult {
  answer: string | null;
  needsHuman: boolean;
  reason: string;
}

// content/popup/pages -> background
export type ToBackground =
  | { type: "hello"; top: boolean; url: string }
  | { type: "report"; jobId: string; state: PageState; needs: NeedInput[]; meta?: PageMeta; note?: string; aiDrafted?: number }
  | { type: "progress"; jobId: string; msg: string }
  | { type: "draft"; req: DraftRequest }
  | { type: "getOverlayState" }
  | { type: "answerNeed"; needId: string; value: string; remember: boolean }
  | { type: "dismissNeed"; needId: string }
  | { type: "focusJob"; jobId: string }
  | { type: "submitJob"; jobId: string }
  | { type: "skipJob"; jobId: string }
  | { type: "retryJob"; jobId: string }
  | { type: "addJobs"; urls: string[]; start: boolean }
  | { type: "adoptTab"; tabId: number }
  | { type: "markApplied"; tabId: number }
  | { type: "setPaused"; paused: boolean }
  | { type: "updateJob"; jobId: string; patch: Partial<Pick<Job, "status" | "notes" | "company" | "title" | "location">> }
  | { type: "deleteJobs"; jobIds: string[] }
  | { type: "importJobs"; jobs: Job[] }
  | { type: "kick" }
  | { type: "testAi"; override?: AiOverride }
  | { type: "listModels"; override?: AiOverride }
  | { type: "parseResume"; text: string }
  | { type: "openOnboarding" };

export interface OverlayState {
  needs: Need[];
  jobs: Record<string, Pick<Job, "id" | "company" | "title" | "status" | "tabId">>;
  paused: boolean;
  running: number;
  queued: number;
}

// background -> content
export type ToContent =
  | { type: "overlay"; state: OverlayState }
  | { type: "applyAnswer"; fieldKey: string; value: string; kind: NeedKind }
  | { type: "submit" }
  | { type: "run" };
