import { extractUrls } from "../core/csv";
import { api } from "../shared/api";
import { normalizeProfile, normalizeSettings, STORAGE_KEYS } from "../shared/defaults";
import type { OverlayState } from "../shared/messages";
import type { Job } from "../shared/types";
import { $, h, send, toast } from "./common";

async function activeTab(): Promise<browser.tabs.Tab | undefined> {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function render(): Promise<void> {
  const state = await send<OverlayState>({ type: "getOverlayState" });
  const { jobs = [], profile, settings } = (await api.storage.local.get([STORAGE_KEYS.jobs, STORAGE_KEYS.profile, STORAGE_KEYS.settings])) as {
    jobs?: Job[];
    profile?: unknown;
    settings?: unknown;
  };
  const p = normalizeProfile(profile);
  $("#setup").style.display = !normalizeSettings(settings).onboarded && !(p.firstName && p.email) ? "block" : "none";
  $("#n-needs").textContent = String(state.needs.length);
  $("#n-running").textContent = String(state.running);
  $("#n-queued").textContent = String(state.queued);
  $("#n-applied").textContent = String(jobs.filter((j) => j.status === "submitted").length);
  $("#pause").textContent = state.paused ? "Resume" : "Pause";
  $("#sub").textContent = state.paused ? "Paused" : state.running ? "Working in background tabs" : "Idle";

  const list = $("#needs");
  list.replaceChildren();
  for (const n of state.needs) {
    const job = state.jobs[n.jobId];
    const row = h(
      "div",
      { className: `need ${n.kind === "review_submit" ? "ok" : ""}` },
      h("small", { textContent: job ? `${job.company} — ${job.title}` : "" }),
      n.prompt,
    );
    row.addEventListener("click", () => void send({ type: "focusJob", jobId: n.jobId }).then(() => window.close()));
    list.append(row);
  }
}

$("#pause").addEventListener("click", async () => {
  const state = await send<OverlayState>({ type: "getOverlayState" });
  await send({ type: "setPaused", paused: !state.paused });
  await render();
});

$("#fill").addEventListener("click", async () => {
  const tab = await activeTab();
  if (tab?.id == null) return;
  const ok = await send<boolean>({ type: "adoptTab", tabId: tab.id });
  toast(ok ? "Filling this tab…" : "Can't run on this page");
  if (ok) setTimeout(() => window.close(), 600);
});

$("#queue-tab").addEventListener("click", async () => {
  const tab = await activeTab();
  if (!tab?.url) return;
  const n = await send<number>({ type: "addJobs", urls: [tab.url], start: true });
  toast(n ? "Queued" : "Already tracked");
  await render();
});

$("#applied").addEventListener("click", async () => {
  const tab = await activeTab();
  if (tab?.id == null) return;
  await send({ type: "markApplied", tabId: tab.id });
  toast("Marked as applied");
  await render();
});

$("#add").addEventListener("click", async () => {
  const urls = extractUrls($<HTMLTextAreaElement>("#urls").value);
  if (!urls.length) return toast("No URLs found");
  const n = await send<number>({ type: "addJobs", urls, start: true });
  $<HTMLTextAreaElement>("#urls").value = "";
  toast(`Queued ${n} job${n === 1 ? "" : "s"}`);
  await render();
});

$("#setup").addEventListener("click", () => void send({ type: "openOnboarding" }).then(() => window.close()));
$("#tracker").addEventListener("click", () => void api.tabs.create({ url: api.runtime.getURL("tracker.html") }).then(() => window.close()));
$("#options").addEventListener("click", () => void api.runtime.openOptionsPage().then(() => window.close()));

void render();
setInterval(() => void render(), 2000);
