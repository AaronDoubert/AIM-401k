// Display copy. The joke lives here and only here: every user-facing string
// that has a "full send" military flavour also has a plain version, chosen by
// settings.ui.chud. Internals (statuses, storage, code) stay plain.
//
// Rule of thumb: chud lines are SHORT — a callsign-style lead, then the facts.

import * as intel from "./copy/intel";
import * as privacy from "./copy/privacy";
import * as sheet from "./copy/sheet";
import * as theme from "./copy/theme";
import * as warroom from "./copy/warroom";

type Vars = Record<string, string | number>;

// Feature areas keep their strings in ./copy/<area>.ts so they can evolve independently.
const BASE_CHUD = {
  "app.name": "AIM-401k",
  "app.tagline": "Autonomous Employment Acquisition System",

  "status.saved": "SAVED",
  "status.queued": "QUEUED",
  "status.running": "ENGAGED",
  "status.needs_you": "HOLD",
  "status.ready_to_submit": "READY",
  "status.submitted": "SPLASH",
  "status.failed": "FAILED",
  "status.skipped": "SKIPPED",
  "status.interviewing": "CONTACT",
  "status.offer": "SECURED",
  "status.rejected": "LOST",

  "notify.need.title": "HOLD. {company} needs you",
  "notify.ready.title": "READY. {company} awaits release",
  "notify.delivered.title": "SPLASH. {company}",
  "notify.contact.title": "CONTACT. {company} wants to talk",
  "notify.rejected.title": "LOST. {company} passed",
  "notify.offer.title": "SECURED. Offer from {company}",
  "notify.sitrep.title": "SITREP",

  "ops.launch": "{job}",
  "ops.need": "HOLD · {what} · {job}",
  "ops.intervened": "COPY, RESUMING · {job}",
  "ops.released": "{job}",
  "ops.delivered": "{job}",
  "ops.lost": "{job} · {why}",
  "ops.contact": "{job}",
  "ops.rejected": "REJECTED · {job}",
  "ops.offer": "SECURED · {job}",
  "ops.afk.on": "OPERATOR AWAY · PROMPTS WILL HOLD",
  "ops.afk.off": "OPERATOR BACK ON STATION",
  "ops.moved": "MOVED · {job} → {status}",
  "ops.winchester": "WINCHESTER · QUEUE EMPTY",
  "ops.bingo": "BINGO · {provider} DAILY AI QUOTA SPENT",

  // Stages: the one pipeline vocabulary every view uses (board, totals, popup).
  "stage.targets": "TARGETS",
  "stage.engaged": "ENGAGED",
  "stage.hold": "HOLD",
  "stage.splash": "SPLASH",
  "stage.contact": "CONTACT",
  "stage.secured": "SECURED",
  "stage.lost": "LOST",
} as const;

const CHUD = { ...BASE_CHUD, ...theme.CHUD, ...warroom.CHUD, ...intel.CHUD, ...sheet.CHUD, ...privacy.CHUD };

export type CopyKey = keyof typeof CHUD;

const BASE_PLAIN: Record<keyof typeof BASE_CHUD, string> = {
  "app.name": "AIM-401k",
  "app.tagline": "Job application autopilot",

  "status.saved": "Saved",
  "status.queued": "Queued",
  "status.running": "Applying",
  "status.needs_you": "Needs you",
  "status.ready_to_submit": "Ready to submit",
  "status.submitted": "Applied",
  "status.failed": "Failed",
  "status.skipped": "Skipped",
  "status.interviewing": "Interviewing",
  "status.offer": "Offer",
  "status.rejected": "Rejected",

  "notify.need.title": "{company} needs your input",
  "notify.ready.title": "{company} is ready to submit",
  "notify.delivered.title": "Applied to {company}",
  "notify.contact.title": "{company} wants to talk",
  "notify.rejected.title": "{company} declined",
  "notify.offer.title": "Offer from {company}",
  "notify.sitrep.title": "While you were away",

  "ops.launch": "{job}",
  "ops.need": "Needs you: {what} · {job}",
  "ops.intervened": "You answered · {job}",
  "ops.released": "{job}",
  "ops.delivered": "{job}",
  "ops.lost": "{job} · {why}",
  "ops.contact": "Interview request · {job}",
  "ops.rejected": "Rejected · {job}",
  "ops.offer": "Offer · {job}",
  "ops.afk.on": "Away mode on",
  "ops.afk.off": "Away mode off",
  "ops.moved": "Moved · {job} → {status}",
  "ops.winchester": "Queue empty: nothing left to apply to",
  "ops.bingo": "{provider} daily AI limit reached",

  "stage.targets": "Queued",
  "stage.engaged": "Applying",
  "stage.hold": "Needs you",
  "stage.splash": "Applied",
  "stage.contact": "Interviewing",
  "stage.secured": "Offer",
  "stage.lost": "Closed",
};

const PLAIN: Record<CopyKey, string> = { ...BASE_PLAIN, ...theme.PLAIN, ...warroom.PLAIN, ...intel.PLAIN, ...sheet.PLAIN, ...privacy.PLAIN };

/** Both variant maps, for coverage tests. */
export const COPY_MAPS: { chud: Record<CopyKey, string>; plain: Record<CopyKey, string> } = { chud: CHUD, plain: PLAIN };

export function isCopyKey(key: string): key is CopyKey {
  return key in CHUD;
}

/** Accepts settings (anything with ui.chud) or a boolean. */
export function copy(mode: { ui: { chud: boolean } } | boolean, key: CopyKey, vars: Vars = {}): string {
  const chud = typeof mode === "boolean" ? mode : mode.ui.chud;
  const template = (chud ? (CHUD as Record<CopyKey, string>) : PLAIN)[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
