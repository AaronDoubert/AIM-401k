// The one dataset behind every demo screenshot (scripts/demo.mjs).
//
// Fictional person, fictional (movie/TV) companies, real US cities, realistic ATS
// URLs. Nothing here is a localhost or an IP address. Every timestamp is
// computed from `now`, so DTG clocks, hold timers and "x min ago" look live no
// matter when the script runs.
//
// Shapes follow src/shared/types.ts (Job, Need, OpsEvent, Settings, Profile, AnswerEntry).
// Settings are deliberately partial: every reader runs them through normalizeSettings.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Mirrors STAGES in src/ui/stages.ts (that file is TypeScript; this script is plain node).
export const STAGE_STATUSES = {
  targets: ["saved", "queued"],
  engaged: ["running"],
  hold: ["needs_you", "ready_to_submit"],
  splash: ["submitted"],
  contact: ["interviewing"],
  secured: ["offer"],
  lost: ["rejected", "failed", "skipped"],
};

export function stageCounts(jobs) {
  const out = {};
  for (const [stage, statuses] of Object.entries(STAGE_STATUSES)) out[stage] = jobs.filter((j) => statuses.includes(j.status)).length;
  return out;
}

// --- Jobs --------------------------------------------------------------------
// ago*: when things happened, relative to now. `tab` marks jobs that are live in
// a browser tab (engaged + on hold); demo.mjs opens a real extension tab for each so the
// background watchdog and the live unit telemetry treat them as genuinely in flight.

/* prettier-ignore */
const JOBS = [
  // TARGETS (saved)
  { key: "weyland", company: "Weyland-Yutani", title: "Staff Platform Engineer", location: "Huntsville, AL", ats: "lever", url: "https://jobs.lever.co/weyland-yutani/3f9c1a52-8b7e-4d1e-9a64-2c5e7b0d41aa", status: "saved", created: 26 * HOUR, notes: "Building Better Worlds. Referral from a former teammate." },
  { key: "aperture", company: "Aperture Science", title: "Senior Test Infrastructure Engineer", location: "Remote - US", ats: "ashby", url: "https://jobs.ashbyhq.com/aperture-science/8a1d7e52-41c0-4d3b-b7e9-65f0a2c1d9e3", status: "saved", created: 20 * HOUR, notes: "" },
  { key: "stark", company: "Stark Industries", title: "Staff Software Engineer, Simulation", location: "Los Angeles, CA", ats: "greenhouse", url: "https://boards.greenhouse.io/starkindustries/jobs/5120893", status: "saved", created: 5 * HOUR, notes: "Hybrid, 3 days on site." },

  // ENGAGED (running, live)
  { key: "massive", company: "Massive Dynamic", title: "Senior Backend Engineer", location: "Boston, MA", ats: "greenhouse", url: "https://boards.greenhouse.io/massivedynamic/jobs/4488213", status: "running", created: 3 * HOUR, progress: 20_000, tab: true, notes: "",
    log: [[14 * MIN, "Opened application tab"], [13 * MIN, "Reading the form"], [11 * MIN, "Filled 9 fields from your profile"], [20_000, "Selecting work authorization"]] },
  { key: "hooli", company: "Hooli", title: "Senior Software Engineer, Search Infrastructure", location: "San Francisco, CA", ats: "ashby", url: "https://jobs.ashbyhq.com/hooli/c41e9b27-5d8a-4f06-8e13-7b2a90f6d5c8", status: "running", created: 3 * HOUR, progress: 35_000, tab: true, notes: "",
    log: [[3 * MIN, "Opened application tab"], [2 * MIN, "Reading the form"], [35_000, "Uploading resume"]] },

  // HOLD (needs you / ready to submit, live)
  { key: "initech", company: "Initech", title: "Backend Engineer", location: "Austin, TX", ats: "greenhouse", url: "https://boards.greenhouse.io/initech/jobs/4012345", status: "needs_you", created: 3 * HOUR, progress: 5 * MIN, tab: true, aiDrafted: 2, notes: "Bill Lumbergh's team. Mention the TPS reports pipeline work.",
    log: [[9 * MIN, "Opened application tab"], [8 * MIN, "Reading the form"], [7 * MIN, "Filled 11 fields from your profile"], [7 * MIN, "AI drafted 2 answers (review them)"], [5 * MIN, "Waiting on you: 1 question"]] },
  { key: "rekall", company: "Rekall Incorporated", title: "Senior Software Engineer, Memory Systems", location: "Denver, CO", ats: "lever", url: "https://jobs.lever.co/rekall/7d2f6e19-0b34-4a85-9c71-e8a35b1f4026", status: "ready_to_submit", created: 3 * HOUR, progress: 3 * MIN, tab: true, aiDrafted: 3, notes: "",
    log: [[8 * MIN, "Opened application tab"], [7 * MIN, "Reading the form"], [5 * MIN, "Filled 9 fields from your profile"], [5 * MIN, "AI drafted 3 answers (review them)"], [3 * MIN, "Everything filled: review and submit"]] },

  // SPLASH (submitted)
  { key: "ocp", company: "Omni Consumer Products", title: "Senior Systems Engineer", location: "Detroit, MI", ats: "greenhouse", url: "https://boards.greenhouse.io/omniconsumerproducts/jobs/4301177", status: "submitted", created: 8 * DAY, applied: 182 * MIN, notes: "Delta City division. Your move, creep.", aiDrafted: 1 },
  { key: "cyberdyne", company: "Cyberdyne Systems", title: "Senior ML Platform Engineer", location: "Arlington, VA", ats: "lever", url: "https://jobs.lever.co/cyberdyne/b94a7c30-2e51-48d6-a0f7-13c5e6d8a2b9", status: "submitted", created: 7 * DAY, applied: 171 * MIN, notes: "Skynet team is hiring; no, it is fine.", aiDrafted: 2 },
  { key: "tyrell", company: "Tyrell Corporation", title: "Staff Backend Engineer", location: "Seattle, WA", ats: "ashby", url: "https://jobs.ashbyhq.com/tyrell/5e08c3a1-96d7-4b24-8f1a-d70b4c92e6f3", status: "submitted", created: 6 * DAY, applied: 150 * MIN, notes: "More human than human.", aiDrafted: 0 },
  { key: "piedpiper", company: "Pied Piper", title: "Senior Software Engineer, Compression", location: "Palo Alto, CA", ats: "ashby", url: "https://jobs.ashbyhq.com/pied-piper/2c9f6b40-7a13-4e85-b0d8-91e4f5a3c7d2", status: "submitted", created: 4 * DAY, applied: 40 * MIN, notes: "Middle-out.", aiDrafted: 1 },

  // CONTACT (interviewing)
  { key: "wayne", company: "Wayne Enterprises", title: "Principal Engineer, Security Platform", location: "New York, NY", ats: "greenhouse", url: "https://boards.greenhouse.io/wayneenterprises/jobs/4755021", status: "interviewing", created: 11 * DAY, applied: 8 * DAY, updated: 95 * MIN, notes: "Recruiter (L. Fox) wants a call Thursday. Panel with the CTO after.", aiDrafted: 2 },

  // SECURED (offer)
  { key: "soylent", company: "Soylent Corp", title: "Senior Backend Engineer", location: "Remote - US", ats: "lever", url: "https://jobs.lever.co/soylent/e5a1d8f2-3c76-49b0-82e4-0a7b9c61d345", status: "offer", created: 15 * DAY, applied: 11 * DAY, updated: 60 * MIN, notes: "Offer received. Decide by Friday.", aiDrafted: 1 },

  // LOST (rejected)
  { key: "umbrella", company: "Umbrella Corporation", title: "Senior Software Engineer", location: "Raleigh, NC", ats: "greenhouse", url: "https://boards.greenhouse.io/umbrellacorp/jobs/4199402", status: "rejected", created: 12 * DAY, applied: 9 * DAY, updated: 80 * MIN, notes: "", aiDrafted: 0 },
];

/** Live field checklists for the units in flight (jobKey → unit state, minus jobId/updatedAt). */
/* prettier-ignore */
const UNITS = {
  massive: { phase: "filling", step: 2, fieldsTotal: 14, fieldsDone: 9, currentField: "Work authorization", fields: [
    { label: "First name", state: "ok" }, { label: "Last name", state: "ok" }, { label: "Email", state: "ok" }, { label: "Phone", state: "ok" },
    { label: "Resume", state: "ok" }, { label: "LinkedIn profile", state: "ok" }, { label: "Current company", state: "ok" }, { label: "City", state: "ok" },
    { label: "Years of experience", state: "ok" }, { label: "Work authorization", state: "todo" }, { label: "Visa sponsorship", state: "todo" },
    { label: "Earliest start date", state: "todo" }, { label: "How did you hear about us?", state: "todo" }, { label: "Gender", state: "todo" } ] },
  hooli: { phase: "filling", step: 1, fieldsTotal: 8, fieldsDone: 3, currentField: "Resume", fields: [
    { label: "Full name", state: "ok" }, { label: "Email", state: "ok" }, { label: "Phone", state: "ok" }, { label: "Resume", state: "todo" },
    { label: "LinkedIn", state: "todo" }, { label: "Location", state: "todo" }, { label: "Work authorization", state: "todo" }, { label: "Salary expectation", state: "todo" } ] },
  initech: { phase: "holding", step: 2, fieldsTotal: 12, fieldsDone: 11, currentField: "Why do you want to work at Initech?", fields: [
    { label: "First name", state: "ok" }, { label: "Last name", state: "ok" }, { label: "Email", state: "ok" }, { label: "Phone", state: "ok" },
    { label: "Resume", state: "ok" }, { label: "LinkedIn", state: "ok" }, { label: "Work authorization", state: "ok" }, { label: "Visa sponsorship", state: "ok" },
    { label: "Notice period", state: "ok" }, { label: "Describe a system you scaled", state: "ai" }, { label: "Salary expectation", state: "ok" },
    { label: "Why do you want to work at Initech?", state: "need" } ] },
  rekall: { phase: "holding", step: 3, fieldsTotal: 9, fieldsDone: 9, currentField: "", fields: [
    { label: "Full name", state: "ok" }, { label: "Email", state: "ok" }, { label: "Phone", state: "ok" }, { label: "Resume", state: "ok" },
    { label: "Current location", state: "ok" }, { label: "Work authorization", state: "ok" }, { label: "Tell us about a hard debugging story", state: "ai" },
    { label: "What draws you to memory systems?", state: "ai" }, { label: "Anything else?", state: "ai" } ] },
};

/** Keys of the jobs that need a live tab (engaged + on hold), in a stable order. */
export const LIVE_KEYS = JOBS.filter((j) => j.tab).map((j) => j.key);

/** Unit telemetry for a live job, shaped for the `unit` runtime message. */
export const unitFor = (key) => UNITS[key];

const id = (key) => `job_demo_${key}`;

/**
 * Build the whole dataset.
 * @param {number} now     Date.now() at seed time
 * @param {Record<string, number>} tabIds  jobKey → real tab id, for LIVE_KEYS
 * @param {boolean} chud   War Room wording the ops log is written for
 */
export function buildDataset(now, tabIds = {}, chud = true) {
  const jobs = JOBS.map((j) => {
    const applied = j.applied == null ? null : now - j.applied;
    const progress = j.progress != null ? now - j.progress : now - (j.updated ?? j.created);
    return {
      id: id(j.key),
      url: j.url,
      company: j.company,
      title: j.title,
      location: j.location,
      ats: j.ats,
      status: j.status,
      createdAt: now - j.created,
      updatedAt: j.updated != null ? now - j.updated : progress,
      appliedAt: applied,
      lastProgressAt: progress,
      notes: j.notes ?? "",
      tabId: j.tab ? (tabIds[j.key] ?? null) : null,
      autoTab: !!j.tab,
      aiDrafted: j.aiDrafted ?? 0,
      log: (j.log ?? defaultLog(j, now)).map(([ago, msg]) => ({ t: now - ago, msg })),
    };
  });

  const needs = [
    {
      id: "need_demo_initech_q",
      jobId: id("initech"),
      kind: "question",
      prompt: "Why do you want to work at Initech?",
      detail: "Open-ended, 500 characters max. The AI declined to guess.",
      frameId: 0,
      fieldKey: "question_4012345_why",
      inputType: "textarea",
      createdAt: now - 5 * MIN,
    },
    {
      id: "need_demo_rekall_review",
      jobId: id("rekall"),
      kind: "review_submit",
      prompt: "Review the filled application and submit",
      detail: "3 answers were drafted by AI.",
      frameId: 0,
      createdAt: now - 3 * MIN,
    },
  ];

  const co = (key) => {
    const j = JOBS.find((x) => x.key === key);
    return `${j.company} · ${j.title}`;
  };
  const ev = (n, ago, kind, text, key) => ({ id: `ops_demo_${String(n).padStart(2, "0")}`, t: now - ago, kind, text, ...(key ? { jobId: id(key) } : {}) });
  const need = (what, key) => (chud ? `HOLD · ${what} · ${co(key)}` : `Needs you: ${what} · ${co(key)}`);
  const ops = [
    ev(1, 184 * MIN, "launch", co("ocp"), "ocp"),
    ev(2, 182 * MIN, "deliver", co("ocp"), "ocp"),
    ev(3, 174 * MIN, "launch", co("cyberdyne"), "cyberdyne"),
    ev(4, 172 * MIN, "intervene", chud ? `COPY, RESUMING · ${co("cyberdyne")}` : `You answered · ${co("cyberdyne")}`, "cyberdyne"),
    ev(5, 171 * MIN, "deliver", co("cyberdyne"), "cyberdyne"),
    ev(6, 152 * MIN, "launch", co("tyrell"), "tyrell"),
    ev(7, 150 * MIN, "deliver", co("tyrell"), "tyrell"),
    ev(8, 95 * MIN, "contact", chud ? co("wayne") : `Interview request · ${co("wayne")}`, "wayne"),
    ev(9, 80 * MIN, "lost", chud ? `REJECTED · ${co("umbrella")}` : `Rejected · ${co("umbrella")}`, "umbrella"),
    ev(10, 60 * MIN, "contact", chud ? `SECURED · ${co("soylent")}` : `Offer · ${co("soylent")}`, "soylent"),
    ev(11, 42 * MIN, "launch", co("piedpiper"), "piedpiper"),
    ev(12, 40 * MIN, "deliver", co("piedpiper"), "piedpiper"),
    ev(13, 14 * MIN, "launch", co("massive"), "massive"),
    ev(14, 9 * MIN, "launch", co("initech"), "initech"),
    ev(15, 8 * MIN, "launch", co("rekall"), "rekall"),
    ev(16, 5 * MIN, "intervene", need("Why do you want to work at Initech?", "initech"), "initech"),
    ev(17, 3 * MIN, "release", co("rekall"), "rekall"),
    ev(18, 3 * MIN - 1000, "intervene", chud ? `HOLD · REVIEW AND RELEASE · ${co("rekall")}` : `Needs you: review and submit · ${co("rekall")}`, "rekall"),
    ev(19, 3 * MIN - 3000, "launch", co("hooli"), "hooli"),
  ].sort((a, b) => a.t - b.t);

  const profile = {
    firstName: "Dana",
    lastName: "Whitfield",
    preferredName: "Dana",
    pronouns: "she/her",
    email: "dana.whitfield@example.com",
    phone: "(512) 555-0147",
    street: "1200 Barton Springs Rd",
    city: "Austin",
    state: "Texas",
    postalCode: "78704",
    country: "United States",
    linkedin: "https://www.linkedin.com/in/dana-whitfield",
    github: "https://github.com/dwhitfield",
    portfolio: "https://danawhitfield.dev",
    workHistory: [
      { company: "Globex Corporation", title: "Senior Software Engineer", location: "Austin, TX", startDate: "2021-02", endDate: "", current: true, description: "Own the order-routing services (Go, Postgres, Kafka). Cut p99 latency 40% and led a 4-person team." },
      { company: "Vandelay Industries", title: "Software Engineer", location: "New York, NY", startDate: "2018-06", endDate: "2021-01", current: false, description: "Built the importer/exporter platform and its internal tooling." },
    ],
    education: [{ school: "University of Texas at Austin", degree: "Bachelor of Science", field: "Computer Science", startDate: "2014-08", endDate: "2018-05", gpa: "3.7" }],
    yearsExperience: "8",
    skills: "Go, TypeScript, PostgreSQL, Kafka, Kubernetes, distributed systems",
    workAuthorized: "yes",
    requiresSponsorship: "no",
    citizenship: "US Citizen",
    willingToRelocate: "no",
    workplacePreference: "Hybrid",
    desiredTitles: "Senior Backend Engineer, Staff Engineer",
    desiredLocations: "Austin, Remote",
    salaryExpectation: "$185,000",
    noticePeriod: "2 weeks",
    summary: "Backend engineer with 8 years building high-throughput services. Prefers small teams and boring technology.",
  };

  const answers = [
    ["Are you legally authorized to work in the United States?", "Yes"],
    ["Will you now or in the future require sponsorship?", "No"],
    ["What are your salary expectations?", "$185,000 base, flexible for the right team."],
    ["How did you hear about this role?", "Company website"],
    ["Earliest start date?", "Two weeks after an offer."],
  ].map(([question, answer], i) => ({ id: `ans_demo_${i + 1}`, question, answer, source: "user", updatedAt: now - (i + 2) * DAY }));

  const settings = {
    onboarded: true,
    ui: { chud, sound: false },
    paused: false,
    afk: false,
    notifications: false, // no desktop pings while screenshotting
    concurrency: 2,
    maxOpenTabs: 6,
    stallMinutes: 240, // the watchdog must not flag the in-flight rows mid-shoot
    autoAdvance: true,
    autoSubmit: false,
    llmMode: "draft",
    aiProvider: "gemini",
  };

  return { settings, profile, jobs, needs, ops, answers };
}

function defaultLog(j, now) {
  const applied = j.applied ?? null; // already "ms ago"
  const out = [[j.created, "Added from the browser"]];
  if (applied != null) {
    out.push([applied + 6 * MIN, "Opened application tab"], [applied + 4 * MIN, "Filled the form from your profile"], [applied, "Submitted"]);
  }
  if (j.status === "interviewing") out.push([j.updated, "Moved to interviewing"]);
  if (j.status === "offer") out.push([j.updated + 2 * DAY, "Moved to interviewing"], [j.updated, "Moved to offer"]);
  if (j.status === "rejected") out.push([j.updated, "Moved to rejected"]);
  return out;
}
