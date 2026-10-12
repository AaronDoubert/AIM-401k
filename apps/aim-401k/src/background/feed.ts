// Turns job lifecycle events into ops-log lines and the few desktop
// notifications worth interrupting for. Copy comes from shared/copy.ts so
// "plain mode" turns the chud off everywhere at once.
import { copy } from "../shared/copy";
import { desktopNotify, jobLabel, on, opsLog } from "./core";
import { getState } from "./store";

async function settings() {
  return (await getState()).settings;
}

on("launched", ({ job }) => void settings().then((s) => opsLog("launch", copy(s, "ops.launch", { job: jobLabel(job) }), job.id)));

on("needs", ({ job, needs }) =>
  void settings().then(async (s) => {
    for (const n of needs) await opsLog("intervene", copy(s, "ops.need", { job: jobLabel(job), what: n.prompt.slice(0, 60) }), job.id);
    const ready = needs.find((n) => n.kind === "review_submit");
    if (ready && s.notifications && !s.afk) await desktopNotify(ready.id, copy(s, "notify.ready.title", { company: job.company || "Target" }), ready.prompt);
  }),
);

on("intervened", ({ job }) => void settings().then((s) => opsLog("intervene", copy(s, "ops.intervened", { job: jobLabel(job) }), job.id)));

on("released", ({ job }) => void settings().then((s) => opsLog("release", copy(s, "ops.released", { job: jobLabel(job) }), job.id)));

on("delivered", ({ job }) =>
  void settings().then(async (s) => {
    await opsLog("deliver", copy(s, "ops.delivered", { job: jobLabel(job) }), job.id);
    if (s.notifications && !s.afk) await desktopNotify(`delivered-${job.id}`, copy(s, "notify.delivered.title", { company: job.company || "Target" }), job.title || job.url);
  }),
);

on("lost", ({ job, why }) => void settings().then((s) => opsLog("lost", copy(s, "ops.lost", { job: jobLabel(job), why }), job.id)));

on("status", ({ job, to }) =>
  void settings().then(async (s) => {
    const key = to === "interviewing" ? "contact" : to === "rejected" ? "rejected" : to === "offer" ? "offer" : null;
    if (key) await opsLog(key === "contact" || key === "offer" ? "contact" : "lost", copy(s, `ops.${key}`, { job: jobLabel(job) }), job.id);
  }),
);
