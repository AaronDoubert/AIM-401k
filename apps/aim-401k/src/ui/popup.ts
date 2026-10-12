import { extractUrls } from "../core/csv";
import { api } from "../shared/api";
import { copy } from "../shared/copy";
import { normalizeProfile, normalizeSettings, STORAGE_KEYS } from "../shared/defaults";
import type { OverlayState } from "../shared/messages";
import type { Job, NeedKind, Settings } from "../shared/types";
import { $, applyCopy, h, pad, send, setUi, toast } from "./common";

let settings: Settings = normalizeSettings(undefined);
const c = (key: Parameters<typeof copy>[1], vars?: Record<string, string | number>) => copy(settings, key, vars);

async function activeTab(): Promise<browser.tabs.Tab | undefined> {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  return tab;
}

const KIND_CODE: Record<NeedKind, string> = {
  question: "QRY",
  consent: "CNS",
  signature: "SIG",
  captcha: "CAP",
  login: "AUTH",
  review_submit: "REL",
  stalled: "STL",
  error: "ERR",
};

function setStat(id: string, n: number): void {
  $(`#n-${id}`).textContent = pad(n);
  $(`#st-${id}`).classList.toggle("zero", n === 0);
}

async function render(): Promise<void> {
  const state = await send<OverlayState>({ type: "getOverlayState" });
  const raw = (await api.storage.local.get([STORAGE_KEYS.jobs, STORAGE_KEYS.profile, STORAGE_KEYS.settings])) as {
    jobs?: Job[];
    profile?: unknown;
    settings?: unknown;
  };
  const jobs = raw.jobs ?? [];
  settings = normalizeSettings(raw.settings);
  applyCopy(settings);
  const p = normalizeProfile(raw.profile);
  $("#setup").style.display = !settings.onboarded && !(p.firstName && p.email) ? "block" : "none";
  setStat("needs", state.needs.length);
  setStat("running", state.running);
  setStat("queued", state.queued);
  setStat("applied", jobs.filter((j) => j.status === "submitted").length);
  $("#pause").textContent = state.paused ? c("theme.resume") : c("theme.pause");
  $("#pause").classList.toggle("primary", state.paused);
  $("#sub").textContent = state.paused ? c("theme.run.paused") : state.running ? c("theme.run.active", { n: state.running }) : c("theme.run.idle");
  $("#pip").className = `pip ${state.paused ? "off" : state.needs.length ? "alert" : state.running ? "" : "off"}`;
  $("#clock").textContent = new Date().toISOString().slice(11, 16) + "Z";
  $<HTMLInputElement>("#ui-plain").checked = !settings.ui.chud;
  $<HTMLInputElement>("#ui-sound").checked = settings.ui.sound;

  const label = $("#holding-label");
  label.hidden = !state.needs.length;
  label.textContent = c("theme.popup.holding", { n: pad(state.needs.length) });

  const list = $("#needs");
  list.replaceChildren();
  for (const n of state.needs) {
    const job = state.jobs[n.jobId];
    const row = h(
      "button",
      { type: "button", className: `need ${n.kind === "review_submit" ? "ok" : ""}` },
      h("span", { className: "code", textContent: KIND_CODE[n.kind] }),
      h("small", { textContent: job ? [job.company, job.title].filter(Boolean).join(" · ") : "" }),
      h("span", { className: "msg", textContent: n.prompt }),
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
  toast(ok ? c("theme.toast.filling") : c("theme.toast.cantRun"));
  if (ok) setTimeout(() => window.close(), 600);
});

$("#queue-tab").addEventListener("click", async () => {
  const tab = await activeTab();
  if (!tab?.url) return;
  const n = await send<number>({ type: "addJobs", urls: [tab.url], start: true });
  toast(n ? c("theme.toast.queued") : c("theme.toast.tracked"));
  await render();
});

$("#applied").addEventListener("click", async () => {
  const tab = await activeTab();
  if (tab?.id == null) return;
  await send({ type: "markApplied", tabId: tab.id });
  toast(c("theme.toast.markedApplied"));
  await render();
});

$("#add").addEventListener("click", async () => {
  const urls = extractUrls($<HTMLTextAreaElement>("#urls").value);
  if (!urls.length) return toast(c("theme.toast.noUrls"));
  const n = await send<number>({ type: "addJobs", urls, start: true });
  $<HTMLTextAreaElement>("#urls").value = "";
  const k = urls.length - n;
  toast(c("theme.toast.armed", { n, s: n === 1 ? "" : "s", dup: k > 0 ? c("theme.toast.dup", { k }) : "" }));
  await render();
});

const openSetup = () => void send({ type: "openOnboarding" }).then(() => window.close());
$("#setup").addEventListener("click", openSetup);
$("#setup").addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && openSetup());
$("#warroom").addEventListener("click", () => void send({ type: "openWarRoom" }).then(() => window.close()));
$("#tracker").addEventListener("click", () => void api.tabs.create({ url: api.runtime.getURL("tracker.html") }).then(() => window.close()));
$("#options").addEventListener("click", () => void api.runtime.openOptionsPage().then(() => window.close()));
$<HTMLInputElement>("#ui-plain").addEventListener("change", async (e) => {
  settings = await setUi({ chud: !(e.target as HTMLInputElement).checked });
  await render();
});
$<HTMLInputElement>("#ui-sound").addEventListener("change", async (e) => {
  settings = await setUi({ sound: (e.target as HTMLInputElement).checked });
});

void render();
setInterval(() => void render(), 2000);
