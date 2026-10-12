// Copy for the privacy area. Keys must be prefixed "privacy." and exist in both maps.
// The privacy panel stays plain and trustworthy: the chud only shows in headings.
export const CHUD = {
  "privacy.heading": "OPSEC · Where your data lives",
  "privacy.guard.heading": "OPSEC · AI privacy guard",
  "privacy.inventory.heading": "Inventory · What's stored",
  "privacy.actions.heading": "Burn bag · Export or erase",

  "privacy.btn.refresh": "Refresh",
  "privacy.btn.export": "Export backup (JSON)",
  "privacy.btn.clearHistory": "Clear application history",
  "privacy.btn.forgetKeys": "Forget AI keys",
  "privacy.btn.erase": "Erase everything",

  "privacy.confirm.clearHistory":
    "Delete all tracked jobs, open prompts, the activity log and inbox intel?\n\nYour profile, saved answers and settings stay. Job tabs AIM-401k opened will close.",
  "privacy.confirm.forgetKeys": "Remove every saved AI API key from this browser?\n\nAI drafting stops until you add a key again (a local model like Ollama keeps working).",
  "privacy.confirm.erase":
    "Erase everything AIM-401k stored in this browser: profile, resume, saved answers, jobs, settings and API keys?\n\nExport a backup first if you might want any of it back.",
  "privacy.confirm.eraseType": "Type ERASE to confirm. This can't be undone.",

  "privacy.done.clearHistory": "Application history cleared. Closed {tabs} job tab(s).",
  "privacy.done.forgetKeys": "Removed {n} AI key(s) from this browser.",
  "privacy.done.erase": "Everything erased. AIM-401k is back to a fresh install.",
  "privacy.done.eraseCancelled": "Nothing erased (ERASE wasn't typed).",
  "privacy.done.failed": "That didn't work: {error}",
} as const;

export const PLAIN: Record<keyof typeof CHUD, string> = {
  "privacy.heading": "Where your data lives",
  "privacy.guard.heading": "AI privacy guard",
  "privacy.inventory.heading": "What's stored",
  "privacy.actions.heading": "Export or erase",

  "privacy.btn.refresh": "Refresh",
  "privacy.btn.export": "Export backup (JSON)",
  "privacy.btn.clearHistory": "Clear application history",
  "privacy.btn.forgetKeys": "Forget AI keys",
  "privacy.btn.erase": "Erase everything",

  "privacy.confirm.clearHistory":
    "Delete all tracked jobs, open prompts, the activity log and inbox intel?\n\nYour profile, saved answers and settings stay. Job tabs AIM-401k opened will close.",
  "privacy.confirm.forgetKeys": "Remove every saved AI API key from this browser?\n\nAI drafting stops until you add a key again (a local model like Ollama keeps working).",
  "privacy.confirm.erase":
    "Erase everything AIM-401k stored in this browser: profile, resume, saved answers, jobs, settings and API keys?\n\nExport a backup first if you might want any of it back.",
  "privacy.confirm.eraseType": "Type ERASE to confirm. This can't be undone.",

  "privacy.done.clearHistory": "Application history cleared. Closed {tabs} job tab(s).",
  "privacy.done.forgetKeys": "Removed {n} AI key(s) from this browser.",
  "privacy.done.erase": "Everything erased. AIM-401k is back to a fresh install.",
  "privacy.done.eraseCancelled": "Nothing erased (ERASE wasn't typed).",
  "privacy.done.failed": "That didn't work: {error}",
};
