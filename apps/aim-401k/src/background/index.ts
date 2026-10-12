import { upsertAnswer } from "../core/answerBank";
import { api } from "../shared/api";
import type { ContentContext, ToBackground, ToContent } from "../shared/messages";
import type { Need } from "../shared/types";
import { uid } from "../shared/util";
import { listModels, testConnection } from "./ai";
import {
  ACTIVE,
  broadcast,
  clearNeeds,
  closeTabLater,
  dispatch,
  emit,
  log,
  newJob,
  notify,
  overlayState,
  publicSettings,
  pump,
  replaceNeeds,
  type Sender,
  statusFromNeeds,
  toTab,
} from "./core";
import { getState, mutate } from "./store";
import { draftAnswer, parseResumeWithAi } from "./tasks";
// Feature modules register their own handlers / listeners on import.
import "./data";
import "./feed";
import "./intel";
import "./units";

// ---------------------------------------------------------------------------
// message handling

async function handle(msg: ToBackground, sender: Sender): Promise<unknown> {
  const tabId = sender.tab?.id;
  switch (msg.type) {
    case "hello": {
      const s = await getState();
      const job = tabId != null ? s.jobs.find((j) => j.tabId === tabId && ACTIVE.includes(j.status)) : undefined;
      // Only managed job tabs get the profile (it includes the resume file).
      if (!job) return { managed: false } satisfies Partial<ContentContext>;
      const ctx: ContentContext = {
        managed: true,
        jobId: job.id,
        profile: s.profile,
        answers: s.answers,
        settings: publicSettings(s),
      };
      return ctx;
    }

    case "getOverlayState":
      return overlayState(await getState());

    case "progress":
      await mutate((s) => {
        const job = s.jobs.find((j) => j.id === msg.jobId);
        if (!job) return;
        job.lastProgressAt = Date.now();
        // A stall flagged by the watchdog clears as soon as the page moves again.
        s.needs = s.needs.filter((n) => !(n.jobId === job.id && n.kind === "stalled" && n.frameId === -1));
        if (job.status === "needs_you") job.status = statusFromNeeds(s, job.id);
        log(job, msg.msg);
        emit("progress", { job, msg: msg.msg });
      });
      broadcast();
      return true;

    case "report": {
      const frameId = sender.frameId ?? 0;
      let fresh: Need[] = [];
      let closeTab: number | null = null;
      const s = await mutate((s) => {
        const job = s.jobs.find((j) => j.id === msg.jobId);
        if (!job || job.tabId !== tabId) return s;
        job.lastProgressAt = Date.now();
        if (msg.meta) {
          if (msg.meta.title && (!job.title || frameId === 0)) job.title = msg.meta.title;
          if (msg.meta.company && (!job.company || frameId === 0)) job.company = msg.meta.company;
          if (msg.meta.location && !job.location) job.location = msg.meta.location;
          if (msg.meta.ats && msg.meta.ats !== "generic") job.ats = msg.meta.ats;
        }
        if (msg.aiDrafted != null) job.aiDrafted = Math.max(job.aiDrafted, msg.aiDrafted);
        if (msg.note) log(job, msg.note);

        if (msg.state === "submitted") {
          clearNeeds(s, job.id);
          job.status = "submitted";
          job.appliedAt = Date.now();
          log(job, "Application submitted 🎉");
          emit("delivered", { job });
          if (job.autoTab) closeTab = job.tabId;
          job.tabId = null;
          return s;
        }
        // Any progress clears a watchdog stall.
        s.needs = s.needs.filter((n) => !(n.jobId === job.id && n.frameId === -1));
        fresh = replaceNeeds(s, job.id, frameId, msg.needs);
        job.status = statusFromNeeds(s, job.id);
        for (const n of fresh) log(job, `Needs you: ${n.prompt}`);
        if (fresh.length) emit("needs", { job, needs: fresh });
        return s;
      });
      await notify(s, fresh);
      if (closeTab != null) void closeTabLater(closeTab, 4000);
      broadcast();
      if (msg.state === "submitted") void pump();
      return true;
    }

    case "draft": {
      const s = await getState();
      return draftAnswer(msg.req, s.profile, s.answers, s.settings);
    }

    case "answerNeed": {
      let target: { tabId: number; frameId: number; msg: ToContent } | null = null;
      await mutate((s) => {
        const need = s.needs.find((n) => n.id === msg.needId);
        if (!need) return;
        if (msg.remember && need.fieldKey && ["question", "consent", "signature"].includes(need.kind)) {
          s.answers = upsertAnswer(s.answers, { id: uid("ans_"), question: need.prompt, answer: msg.value, source: "user", updatedAt: Date.now() });
        }
        s.needs = s.needs.filter((n) => n.id !== need.id);
        const job = s.jobs.find((j) => j.id === need.jobId);
        if (job) {
          job.status = statusFromNeeds(s, job.id);
          job.lastProgressAt = Date.now();
          log(job, `You answered: ${need.prompt}`);
          emit("intervened", { job, what: need.prompt });
          if (job.tabId != null && need.fieldKey) {
            target = { tabId: job.tabId, frameId: need.frameId, msg: { type: "applyAnswer", fieldKey: need.fieldKey, value: msg.value, kind: need.kind } };
          }
        }
      });
      if (target) {
        const t = target as { tabId: number; frameId: number; msg: ToContent };
        void toTab(t.tabId, t.msg, t.frameId);
      }
      broadcast();
      return true;
    }

    case "dismissNeed": {
      const s = await mutate((s) => {
        const need = s.needs.find((n) => n.id === msg.needId);
        s.needs = s.needs.filter((n) => n.id !== msg.needId);
        const job = need && s.jobs.find((j) => j.id === need.jobId);
        if (job) {
          job.status = statusFromNeeds(s, job.id);
          job.lastProgressAt = Date.now();
        }
        return { tabId: job?.tabId ?? null };
      });
      if (s.tabId != null) void toTab(s.tabId, { type: "run" });
      broadcast();
      return true;
    }

    case "focusJob": {
      const s = await getState();
      const job = s.jobs.find((j) => j.id === msg.jobId);
      if (!job) return false;
      if (job.tabId != null) {
        try {
          const tab = await api.tabs.update(job.tabId, { active: true });
          if (tab?.windowId != null) await api.windows.update(tab.windowId, { focused: true });
          return true;
        } catch {
          /* tab is gone; fall through */
        }
      }
      await api.tabs.create({ url: job.url, active: true });
      return true;
    }

    case "submitJob": {
      const s = await mutate((s) => {
        const job = s.jobs.find((j) => j.id === msg.jobId);
        if (!job) return null;
        const review = s.needs.find((n) => n.jobId === job.id && n.kind === "review_submit");
        s.needs = s.needs.filter((n) => !(n.jobId === job.id && n.kind === "review_submit"));
        job.status = statusFromNeeds(s, job.id);
        job.lastProgressAt = Date.now();
        log(job, "You approved submission");
        emit("released", { job });
        return { tabId: job.tabId, frameId: review?.frameId ?? 0 };
      });
      if (s?.tabId != null) void toTab(s.tabId, { type: "submit" }, s.frameId);
      broadcast();
      return true;
    }

    case "skipJob": {
      const closeId = await mutate((s) => {
        const job = s.jobs.find((j) => j.id === msg.jobId);
        if (!job) return null;
        clearNeeds(s, job.id);
        job.status = "skipped";
        log(job, "Skipped");
        emit("lost", { job, why: "stood down" });
        const t = job.autoTab ? job.tabId : null;
        job.tabId = null;
        return t;
      });
      if (closeId != null) void api.tabs.remove(closeId).catch(() => undefined);
      broadcast();
      void pump();
      return true;
    }

    case "retryJob": {
      const tab = await mutate((s) => {
        const job = s.jobs.find((j) => j.id === msg.jobId);
        if (!job) return null;
        clearNeeds(s, job.id);
        job.lastProgressAt = Date.now();
        log(job, "Retrying");
        if (job.tabId != null) {
          job.status = "running";
          return job.tabId;
        }
        job.status = "queued";
        return null;
      });
      if (tab != null) await api.tabs.reload(tab).catch(() => undefined);
      broadcast();
      void pump();
      return true;
    }

    case "addJobs": {
      const added = await mutate((s) => {
        const known = new Set(s.jobs.map((j) => j.url));
        let n = 0;
        for (const raw of msg.urls) {
          const url = raw.trim();
          if (!/^https?:\/\//i.test(url) || known.has(url)) continue;
          known.add(url);
          const job = newJob(url, msg.start ? "queued" : "saved", true);
          log(job, msg.start ? "Queued" : "Saved");
          s.jobs.push(job);
          n++;
        }
        return n;
      });
      void pump();
      return added;
    }

    case "adoptTab": {
      const tab = await api.tabs.get(msg.tabId);
      if (!tab.url || !/^https?:/.test(tab.url)) return false;
      await mutate((s) => {
        let job = s.jobs.find((j) => j.tabId === msg.tabId && ACTIVE.includes(j.status)) ?? s.jobs.find((j) => j.url === tab.url);
        if (!job) {
          job = newJob(tab.url!, "running", false);
          s.jobs.push(job);
        }
        clearNeeds(s, job.id);
        job.tabId = msg.tabId;
        job.status = "running";
        job.lastProgressAt = Date.now();
        log(job, "Started on this tab");
      });
      await toTab(msg.tabId, { type: "run" });
      broadcast();
      return true;
    }

    case "markApplied": {
      const tab = await api.tabs.get(msg.tabId);
      await mutate((s) => {
        let job = s.jobs.find((j) => j.tabId === msg.tabId) ?? s.jobs.find((j) => j.url === tab.url);
        if (!job) {
          job = newJob(tab.url ?? "", "submitted", false);
          job.title = tab.title ?? "";
          s.jobs.push(job);
        }
        clearNeeds(s, job.id);
        job.status = "submitted";
        job.appliedAt = Date.now();
        job.tabId = null;
        log(job, "Marked as applied");
        emit("delivered", { job });
      });
      broadcast();
      void pump();
      return true;
    }

    case "setPaused": {
      const s = await mutate((s) => {
        s.settings.paused = msg.paused;
        return s.jobs.filter((j) => ACTIVE.includes(j.status) && j.tabId != null).map((j) => j.tabId!);
      });
      if (!msg.paused) for (const t of s) void toTab(t, { type: "run" });
      broadcast();
      void pump();
      return true;
    }

    case "updateJob": {
      await mutate((s) => {
        const job = s.jobs.find((j) => j.id === msg.jobId);
        if (!job) return;
        const { status, ...rest } = msg.patch;
        Object.assign(job, rest);
        if (status && status !== job.status) {
          if (!ACTIVE.includes(status)) clearNeeds(s, job.id);
          if (status === "submitted" && !job.appliedAt) job.appliedAt = Date.now();
          log(job, `Status → ${status}`);
          emit("status", { job, from: job.status, to: status });
          job.status = status;
        }
        job.updatedAt = Date.now();
      });
      broadcast();
      void pump();
      return true;
    }

    case "deleteJobs": {
      const ids = new Set(msg.jobIds);
      await mutate((s) => {
        s.jobs = s.jobs.filter((j) => !ids.has(j.id));
        s.needs = s.needs.filter((n) => !ids.has(n.jobId));
      });
      broadcast();
      return true;
    }

    case "importJobs": {
      const n = await mutate((s) => {
        const known = new Set(s.jobs.map((j) => j.id));
        // url may be "" for spreadsheet rows without a link (pump() never opens those).
        const incoming = msg.jobs.filter((j) => j && j.id && typeof j.url === "string" && !known.has(j.id));
        for (const j of incoming) {
          j.tabId = null;
          if (ACTIVE.includes(j.status)) j.status = "queued";
        }
        s.jobs.push(...incoming);
        return incoming.length;
      });
      broadcast();
      return n;
    }

    case "kick":
      await pump();
      return true;

    case "testAi":
      return testConnection((await getState()).settings, msg.override);

    case "listModels":
      try {
        return { ok: true, models: await listModels((await getState()).settings, msg.override) };
      } catch (e) {
        return { ok: false, models: [], message: e instanceof Error ? e.message : String(e) };
      }

    case "parseResume":
      try {
        return { ok: true, data: await parseResumeWithAi(msg.text, (await getState()).settings) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }

    case "openOnboarding":
      await api.tabs.create({ url: api.runtime.getURL("onboarding.html") });
      return true;

    default:
      return dispatch(msg, sender);
  }
}

// sendResponse + `return true` works in both Firefox and Chromium.
api.runtime.onMessage.addListener((raw: unknown, sender: Sender, sendResponse: (r: unknown) => void) => {
  handle(raw as ToBackground, sender).then(sendResponse, (e) => sendResponse({ error: String(e) }));
  return true;
});

// ---------------------------------------------------------------------------
// tab lifecycle, watchdog, notifications

api.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    await mutate((s) => {
      for (const job of s.jobs) {
        if (job.tabId !== tabId) continue;
        job.tabId = null;
        if (ACTIVE.includes(job.status)) {
          clearNeeds(s, job.id);
          job.status = "failed";
          log(job, "Tab closed before the application was submitted");
          emit("lost", { job, why: "tab closed" });
        }
      }
    });
    broadcast();
    void pump();
  })();
});

api.alarms.create("watchdog", { periodInMinutes: 1 });
api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "watchdog") return;
  void (async () => {
    const tabs = new Set((await api.tabs.query({})).map((t) => t.id));
    let fresh: Need[] = [];
    const s = await mutate((s) => {
      const limit = Math.max(1, s.settings.stallMinutes) * 60_000;
      for (const job of s.jobs) {
        if (!ACTIVE.includes(job.status)) continue;
        if (job.tabId == null || !tabs.has(job.tabId)) {
          clearNeeds(s, job.id);
          job.tabId = null;
          job.status = "failed";
          log(job, "Lost the application tab");
          emit("lost", { job, why: "tab lost" });
          continue;
        }
        if (job.status === "running" && !s.settings.paused && Date.now() - job.lastProgressAt > limit) {
          fresh = fresh.concat(
            replaceNeeds(s, job.id, -1, [
              { kind: "stalled", prompt: `No progress for ${s.settings.stallMinutes}+ minutes — the page may need a look.` },
            ]),
          );
          job.status = statusFromNeeds(s, job.id);
        }
      }
      return s;
    });
    await notify(s, fresh);
    broadcast();
    void pump();
  })();
});

api.notifications.onClicked.addListener((id) => {
  void (async () => {
    const s = await getState();
    const need = s.needs.find((n) => n.id === id);
    if (need) await handle({ type: "focusJob", jobId: need.jobId }, {} as Sender);
  })();
});

api.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") void api.tabs.create({ url: api.runtime.getURL("onboarding.html") });
});

api.runtime.onStartup?.addListener(() => {
  // Tabs from a previous session are gone; re-queue what was in flight.
  void mutate((s) => {
    for (const job of s.jobs) {
      if (ACTIVE.includes(job.status)) {
        job.status = "queued";
        job.tabId = null;
        log(job, "Browser restarted; re-queued");
      }
    }
    s.needs = [];
  }).then(() => pump());
});

api.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.settings || changes.jobs)) broadcast();
});

broadcast();
