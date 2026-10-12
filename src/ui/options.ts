import { upsertAnswer } from "../core/answerBank";
import { mergeResume } from "../core/resumeParse";
import { api } from "../shared/api";
import { normalizeProfile, normalizeSettings, STORAGE_KEYS } from "../shared/defaults";
import type { AnswerEntry, Job, Profile, Settings } from "../shared/types";
import { uid } from "../shared/util";
import { renderAiSetup } from "./aiSetup";
import { copy } from "../shared/copy";
import { mergeById, mergeEdits, snapshot } from "../shared/merge";
import { $, applyCopy, download, h, send, setUi, toast } from "./common";
import { extractResume, fileToBase64 } from "./extract";
import { renderIntelSettings } from "./intelSettings";
import { renderPrivacy } from "./privacy";
import { control, type FieldSpec, PROFILE_GROUPS, renderEducation, renderFields, renderWork } from "./profileForm";

const AUTOMATION: FieldSpec[] = [
  { key: "autoAdvance", label: "Click Next / Continue on multi-step forms", type: "checkbox" },
  { key: "autoSubmit", label: "Submit automatically when nothing needs review (otherwise you get a 'Ready' ping)", type: "checkbox" },
  { key: "fillOptional", label: "Fill optional questions when the answer is known", type: "checkbox" },
  { key: "notifications", label: "Desktop notifications when I'm needed", type: "checkbox" },
  { key: "concurrency", label: "Jobs filling at once", type: "number" },
  { key: "maxOpenTabs", label: "Max job tabs open (incl. waiting on you)", type: "number" },
  { key: "stallMinutes", label: "Flag a job as stuck after (minutes)", type: "number" },
];

const AI_MODE: FieldSpec[] = [
  { key: "llmMode", label: "AI drafting", type: "select", options: ["off", "draft", "auto"], hint: "draft = fill & highlight for your review · auto = also allow auto-submit with AI answers" },
  { key: "effort", label: "Effort (Claude only)", type: "select", options: ["low", "medium", "high"] },
];

let profile: Profile;
let settings: Settings;
let answers: AnswerEntry[] = [];
let dirty = false;
// What this page loaded (or last saved): saves write only the differences, so
// changes made elsewhere meanwhile (AFK, units, Gmail, forgotten keys, answers
// remembered from the overlay) survive.
let baseProfile: Profile;
let baseSettings: Settings;
let baseAnswers: AnswerEntry[] = [];

function markDirty(): void {
  dirty = true;
  $("#dirty").textContent = copy(settings, "theme.dirty");
}

/** Interface toggles (settings.ui). Saved immediately, so every page switches wording at once. */
function renderUi(): void {
  // Update locally first so our own storage echo doesn't trigger a re-render.
  const plain = control({ key: "plain", label: "Plain mode: normal wording instead of military call signs", type: "checkbox" }, !settings.ui.chud, (v) => {
    settings.ui = { ...settings.ui, chud: !v };
    applyCopy(settings);
    if (dirty) markDirty();
    void setUi({ chud: !v });
  });
  const sound = control({ key: "sound", label: "Sound: alert tones in the War Room", type: "checkbox" }, settings.ui.sound, (v) => {
    settings.ui = { ...settings.ui, sound: !!v };
    void setUi({ sound: !!v });
  });
  plain.querySelector("input")!.id = "opt-plain";
  sound.querySelector("input")!.id = "opt-sound";
  $("#ui-fields").replaceChildren(plain, sound);
}

function renderForms(): void {
  for (const box of document.querySelectorAll<HTMLElement>("[data-group]")) {
    const specs = PROFILE_GROUPS[box.dataset.group!];
    if (specs) renderFields(box, specs, profile as unknown as Record<string, unknown>, markDirty);
  }
  renderWork($("#work"), profile, markDirty);
  renderEducation($("#edu"), profile, markDirty);
  renderFields($("#automation-fields"), AUTOMATION, settings as unknown as Record<string, unknown>, markDirty);
  renderUi();
  renderFields($("#ai-mode"), AI_MODE, settings as unknown as Record<string, unknown>, markDirty);
  renderAiSetup($("#ai-setup"), settings, markDirty, () => renderFields($("#ai-mode"), AI_MODE, settings as unknown as Record<string, unknown>, markDirty));
  $("#resume-name").textContent = profile.resume ? `Saved: ${profile.resume.name}` : "No file saved";
  renderIntelSettings($("#intel-settings"), settings, markDirty);
  renderPrivacy($("#privacy-panel"));
}

function renderAnswers(): void {
  const q = $<HTMLInputElement>("#ans-filter").value.toLowerCase();
  const body = $("#ans-body");
  body.replaceChildren();
  for (const a of answers) {
    if (q && !`${a.question} ${a.answer}`.toLowerCase().includes(q)) continue;
    const qa = h("textarea", { value: a.question, rows: 2 });
    const an = h("textarea", { value: a.answer, rows: 2 });
    qa.addEventListener("input", () => {
      a.question = qa.value;
      a.updatedAt = Date.now();
      markDirty();
    });
    an.addEventListener("input", () => {
      a.answer = an.value;
      a.source = "user";
      a.updatedAt = Date.now();
      markDirty();
    });
    const del = h("button", { className: "danger", textContent: "Delete" });
    del.addEventListener("click", () => {
      answers = answers.filter((x) => x !== a);
      markDirty();
      renderAnswers();
    });
    body.append(h("tr", {}, h("td", { style: "width:45%" }, qa), h("td", {}, an), h("td", { style: "width:70px" }, del)));
  }
  if (!body.children.length) body.append(h("tr", {}, h("td", { className: "muted", textContent: "No saved answers yet." })));
}

async function load(): Promise<void> {
  const raw = (await api.storage.local.get([STORAGE_KEYS.profile, STORAGE_KEYS.settings, STORAGE_KEYS.answers])) as {
    profile?: unknown;
    settings?: unknown;
    answers?: AnswerEntry[];
  };
  profile = normalizeProfile(raw.profile);
  settings = normalizeSettings(raw.settings);
  answers = raw.answers ?? [];
  baseProfile = snapshot(profile);
  baseSettings = snapshot(settings);
  baseAnswers = snapshot(answers);
  applyCopy(settings);
  renderForms();
  renderAnswers();
}

async function save(): Promise<void> {
  const raw = (await api.storage.local.get([STORAGE_KEYS.profile, STORAGE_KEYS.settings, STORAGE_KEYS.answers])) as {
    profile?: unknown;
    settings?: unknown;
    answers?: AnswerEntry[];
  };
  const cleaned = answers.filter((a) => a.question.trim() && a.answer.trim());
  const nextProfile = mergeEdits(baseProfile, profile, normalizeProfile(raw.profile));
  const nextSettings = mergeEdits(baseSettings, settings, normalizeSettings(raw.settings));
  const nextAnswers = mergeById(baseAnswers, cleaned, raw.answers ?? []);
  await api.storage.local.set({ profile: nextProfile, settings: nextSettings, answers: nextAnswers });
  // Adopt what was merged in from elsewhere into the page's own objects (form controls are
  // bound to them), re-rendering only if something actually came in.
  const external = JSON.stringify(nextProfile) !== JSON.stringify(profile) || JSON.stringify(nextSettings) !== JSON.stringify(settings);
  Object.assign(profile, nextProfile);
  Object.assign(settings, nextSettings);
  answers = nextAnswers;
  baseProfile = snapshot(profile);
  baseSettings = snapshot(settings);
  baseAnswers = snapshot(answers);
  if (external) renderForms();
  renderAnswers();
  dirty = false;
  $("#dirty").textContent = "";
  toast(copy(settings, "theme.toast.saved"));
  void send({ type: "kick" });
}

$("#save").addEventListener("click", () => void save());
window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
    e.preventDefault();
    void save();
  }
});
window.addEventListener("beforeunload", (e) => {
  if (dirty) e.preventDefault();
});
$("#wizard").addEventListener("click", () => void send({ type: "openOnboarding" }));

$<HTMLInputElement>("#resume-file").addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) return toast("Resume is over 8 MB");
  try {
    const res = await extractResume(file);
    profile = mergeResume(profile, res.data, false);
    if (res.kind !== "json") profile.resumeText = res.text.trim();
    if (res.kind === "pdf" || res.kind === "docx") profile.resume = { name: file.name, type: file.type || "application/pdf", data: fileToBase64(await file.arrayBuffer()) };
    renderForms();
    markDirty();
    toast("Resume read — empty fields filled. Review and Save.");
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err));
  }
});
$("#resume-clear").addEventListener("click", () => {
  profile.resume = null;
  renderForms();
  markDirty();
});

// Plain mode / sound can also be flipped from the popup while this page is open.
api.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.settings || !settings) return;
  const ui = normalizeSettings(changes.settings.newValue).ui;
  if (ui.chud === settings.ui.chud && ui.sound === settings.ui.sound) return;
  settings.ui = ui;
  applyCopy(settings);
  renderUi();
  if (dirty) markDirty();
});

$("#ans-filter").addEventListener("input", renderAnswers);
$("#ans-add").addEventListener("click", () => {
  answers = upsertAnswer(answers, { id: uid("ans_"), question: "New question", answer: "", source: "user", updatedAt: Date.now() });
  renderAnswers();
  markDirty();
});

$("#export").addEventListener("click", async () => {
  const raw = (await api.storage.local.get([STORAGE_KEYS.profile, STORAGE_KEYS.settings, STORAGE_KEYS.answers, STORAGE_KEYS.jobs])) as Record<string, unknown>;
  const { apiKeys: _k, ...safeSettings } = normalizeSettings(raw.settings);
  const data = { app: "aim-401k", version: 2, exportedAt: new Date().toISOString(), ...raw, settings: safeSettings };
  download(`aim-401k-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), "application/json");
});

$<HTMLInputElement>("#import").addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text()) as { profile?: unknown; settings?: Partial<Settings>; answers?: AnswerEntry[]; jobs?: Job[] };
    if (data.profile) profile = normalizeProfile(data.profile);
    if (data.settings) settings = normalizeSettings({ ...data.settings, apiKeys: settings.apiKeys });
    if (data.answers) for (const a of data.answers) answers = upsertAnswer(answers, a);
    await save();
    if (data.jobs?.length) {
      const n = await send<number>({ type: "importJobs", jobs: data.jobs });
      toast(`Imported profile, answers and ${n} jobs`);
    }
    renderForms();
    renderAnswers();
  } catch (err) {
    toast(`Import failed: ${String(err)}`);
  }
});

await load();
