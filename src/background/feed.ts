// Turns job lifecycle events into ops-log lines and the few desktop
// notifications worth interrupting for. Copy comes from shared/copy.ts so
// "plain mode" turns the chud off everywhere at once.
import { copy } from "../shared/copy";
import { clip } from "../shared/display";
import { preset } from "../shared/providers";
import { localDay, onQuotaSpent } from "./ai";
import { desktopNotify, jobLabel, on, opsLog } from "./core";
import { createBingoGate, lostKind, shouldWinchester } from "./feedrules";
import { getState } from "./store";

async function settings() {
  return (await getState()).settings;
}

on("launched", ({ job }) => void settings().then((s) => opsLog("launch", copy(s, "ops.launch", { job: jobLabel(job) }), job.id)));

on("needs", ({ job, needs }) =>
  void settings().then(async (s) => {
    for (const n of needs) await opsLog("intervene", copy(s, "ops.need", { job: jobLabel(job), what: clip(n.prompt, 72) }), job.id);
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

on("lost", ({ job, why }) => void settings().then((s) => opsLog(lostKind(why), copy(s, "ops.lost", { job: jobLabel(job), why }), job.id)));

on("status", ({ job, to }) =>
  void settings().then(async (s) => {
    const key = to === "interviewing" ? "contact" : to === "rejected" ? "rejected" : to === "offer" ? "offer" : null;
    if (to === "submitted" || to === "saved") {
      await opsLog("system", copy(s, "ops.moved", { job: jobLabel(job), status: copy(s, `status.${to}`) }), job.id);
    }
    if (key) await opsLog(key === "contact" || key === "offer" ? "contact" : "lost", copy(s, `ops.${key}`, { job: jobLabel(job) }), job.id);
  }),
);

// WINCHESTER: the runner has drained the queue. Armed by a launch, so a fresh
// start with an empty queue stays quiet; fires once until the next launch.
let winchesterArmed = false;
on("launched", () => {
  winchesterArmed = true;
});
function checkQueueDrained(): void {
  if (!winchesterArmed) return;
  void getState()
    .then(async (st) => {
      if (!winchesterArmed || !shouldWinchester(winchesterArmed, st.jobs)) return;
      winchesterArmed = false;
      await opsLog("system", copy(st.settings, "ops.winchester"));
    })
    .catch(() => undefined);
}
on("delivered", checkQueueDrained);
on("needs", checkQueueDrained);
on("lost", checkQueueDrained);

// BINGO: a provider's daily quota is spent. Once per provider per local day.
const bingoGate = createBingoGate();
onQuotaSpent((provider) => {
  if (!bingoGate(provider, localDay())) return;
  void settings()
    .then((s) => opsLog("system", copy(s, "ops.bingo", { provider: preset(provider).name })))
    .catch(() => undefined);
});
