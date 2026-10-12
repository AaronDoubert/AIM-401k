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

  "status.saved": "Marked",
  "status.queued": "Targeted",
  "status.running": "Engaged",
  "status.needs_you": "Operator req.",
  "status.ready_to_submit": "Awaiting release",
  "status.submitted": "Delivered",
  "status.failed": "Lost",
  "status.skipped": "Stood down",
  "status.interviewing": "Contact",
  "status.offer": "Objective secured",
  "status.rejected": "Target lost",

  "notify.need.title": "OPERATOR. {company} needs you",
  "notify.ready.title": "RELEASE AUTH. {company} is ready",
  "notify.delivered.title": "DELIVERED. {company}",
  "notify.contact.title": "CONTACT. {company} wants to talk",
  "notify.rejected.title": "TARGET LOST. {company} passed",
  "notify.offer.title": "OBJECTIVE SECURED. {company}",
  "notify.sitrep.title": "SITREP",

  "ops.launch": "UNIT EN ROUTE · {job}",
  "ops.need": "OPERATOR REQ · {job} · {what}",
  "ops.intervened": "COPY. RESUMING · {job}",
  "ops.released": "RELEASE AUTHORIZED · {job}",
  "ops.delivered": "DELIVERED · {job}",
  "ops.lost": "UNIT LOST · {job} · {why}",
  "ops.contact": "CONTACT · {job}",
  "ops.rejected": "TARGET LOST · {job}",
  "ops.offer": "OBJECTIVE SECURED · {job}",
  "ops.afk.on": "OPERATOR AFK. AUTONOMY ENGAGED",
  "ops.afk.off": "OPERATOR ON STATION",
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

  "ops.launch": "Started · {job}",
  "ops.need": "Needs you · {job} · {what}",
  "ops.intervened": "You answered · {job}",
  "ops.released": "Submitting · {job}",
  "ops.delivered": "Applied · {job}",
  "ops.lost": "Stopped · {job} · {why}",
  "ops.contact": "Interview request · {job}",
  "ops.rejected": "Rejected · {job}",
  "ops.offer": "Offer · {job}",
  "ops.afk.on": "Away mode on",
  "ops.afk.off": "Away mode off",
};

const PLAIN: Record<CopyKey, string> = { ...BASE_PLAIN, ...theme.PLAIN, ...warroom.PLAIN, ...intel.PLAIN, ...sheet.PLAIN, ...privacy.PLAIN };

/** Accepts settings (anything with ui.chud) or a boolean. */
export function copy(mode: { ui: { chud: boolean } } | boolean, key: CopyKey, vars: Vars = {}): string {
  const chud = typeof mode === "boolean" ? mode : mode.ui.chud;
  const template = (chud ? (CHUD as Record<CopyKey, string>) : PLAIN)[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
