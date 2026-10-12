// Copy for the intel area. Keys must be prefixed "intel." and exist in both maps.
export const CHUD = {
  "intel.kind.received": "ACK",
  "intel.kind.interview": "CONTACT",
  "intel.kind.assessment": "TRIAL",
  "intel.kind.offer": "SECURED",
  "intel.kind.rejection": "LOST",
  "intel.kind.other": "NOISE",

  "intel.ops": 'INTEL · {company} · "{subject}" → {kind}',
  "intel.ops.unmatched": 'INTEL · {company} · "{subject}" → {kind} · NO TGT',
  "intel.ops.gmail.up": "INTEL · GMAIL LINK UP",
  "intel.ops.gmail.lost": "INTEL · GMAIL LINK LOST. Reconnect in Settings",
  "intel.notify.gmail.lost": "GMAIL LINK LOST",

  "intel.feed.title": "SIGINT",
  "intel.feed.count": "{n} intercepts · {u} unassigned",
  "intel.feed.empty": "No intel yet. Open Gmail or Outlook in a tab and the inbox list is read here, locally.",
  "intel.feed.off": "Inbox intel is off. Settings → Inbox intel.",
  "intel.feed.assign": "Assign to…",
  "intel.feed.change": "Reassign",
  "intel.feed.unassign": "— Unassigned —",
  "intel.feed.more": "Show {n} more",
  "intel.feed.less": "Show less",
  "intel.feed.assigned": "ASSIGNED. {company}",
  "intel.feed.statusApplied": "Status updated",
} as const;

export const PLAIN: Record<keyof typeof CHUD, string> = {
  "intel.kind.received": "Received",
  "intel.kind.interview": "Interview",
  "intel.kind.assessment": "Assessment",
  "intel.kind.offer": "Offer",
  "intel.kind.rejection": "Rejected",
  "intel.kind.other": "Other",

  "intel.ops": 'Email · {company} · "{subject}" → {kind}',
  "intel.ops.unmatched": 'Email · {company} · "{subject}" → {kind} (not matched to a job)',
  "intel.ops.gmail.up": "Gmail connected",
  "intel.ops.gmail.lost": "Gmail disconnected. Reconnect in Settings → Inbox intel",
  "intel.notify.gmail.lost": "Gmail disconnected",

  "intel.feed.title": "From your inbox",
  "intel.feed.count": "{n} emails · {u} not matched",
  "intel.feed.empty": "No inbox updates yet. Keep Gmail or Outlook open in a tab and AIM-401k reads the message list locally to update statuses.",
  "intel.feed.off": "Inbox updates are off. Turn them on in Settings → Inbox intel.",
  "intel.feed.assign": "Assign to job…",
  "intel.feed.change": "Change",
  "intel.feed.unassign": "— Not about a tracked job —",
  "intel.feed.more": "Show {n} more",
  "intel.feed.less": "Show less",
  "intel.feed.assigned": "Assigned to {company}",
  "intel.feed.statusApplied": "Status updated",
};
