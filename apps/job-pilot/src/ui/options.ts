import { upsertAnswer } from "../core/answerBank";
import { api } from "../shared/api";
import { DECLINE, DEFAULT_PROFILE, DEFAULT_SETTINGS, STORAGE_KEYS } from "../shared/defaults";
import type { AnswerEntry, Job, Profile, Settings } from "../shared/types";
import { uid } from "../shared/util";
import { $, download, h, send, toast } from "./common";

type FieldSpec = {
  key: string;
  label: string;
  type?: "text" | "textarea" | "yesno" | "select" | "checkbox" | "number" | "password";
  options?: string[];
  wide?: boolean;
  hint?: string;
};

const P: Record<string, FieldSpec[]> = {
  profile: [
    { key: "firstName", label: "First name" },
    { key: "lastName", label: "Last name" },
    { key: "preferredName", label: "Preferred name" },
    { key: "pronouns", label: "Pronouns" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "street", label: "Street address" },
    { key: "city", label: "City" },
    { key: "state", label: "State / province" },
    { key: "postalCode", label: "ZIP / postal code" },
    { key: "country", label: "Country" },
    { key: "linkedin", label: "LinkedIn URL" },
    { key: "github", label: "GitHub URL" },
    { key: "portfolio", label: "Portfolio / website" },
    { key: "currentTitle", label: "Current title" },
    { key: "currentCompany", label: "Current company" },
    { key: "yearsExperience", label: "Years of experience" },
    { key: "school", label: "School" },
    { key: "degree", label: "Degree" },
    { key: "major", label: "Major / field" },
    { key: "graduationYear", label: "Graduation year" },
    { key: "summary", label: "Short professional summary (used by AI)", type: "textarea", wide: true },
  ],
  resume: [
    { key: "resumeText", label: "Resume as plain text (used by AI drafting)", type: "textarea", wide: true },
    {
      key: "coverLetterTemplate",
      label: "Cover letter template — placeholders: {company} {title} {firstName} {name}",
      type: "textarea",
      wide: true,
    },
  ],
  eligibility: [
    { key: "workAuthorized", label: "Authorized to work in your country?", type: "yesno" },
    { key: "requiresSponsorship", label: "Need visa sponsorship?", type: "yesno" },
    { key: "over18", label: "18 or older?", type: "yesno" },
    { key: "willingToRelocate", label: "Willing to relocate?", type: "yesno" },
    { key: "salaryExpectation", label: "Salary expectation" },
    { key: "startDate", label: "Start date / notice period" },
    { key: "howDidYouHear", label: "How did you hear about us (default)" },
  ],
  eeo: [
    { key: "gender", label: "Gender" },
    { key: "race", label: "Race / ethnicity" },
    { key: "hispanicLatino", label: "Hispanic or Latino" },
    { key: "veteranStatus", label: "Veteran status" },
    { key: "disabilityStatus", label: "Disability status" },
  ],
};

const S: Record<string, FieldSpec[]> = {
  automation: [
    { key: "autoAdvance", label: "Click Next / Continue on multi-step forms", type: "checkbox" },
    { key: "autoSubmit", label: "Submit automatically when nothing needs review (otherwise you get a 'Ready' ping)", type: "checkbox" },
    { key: "fillOptional", label: "Fill optional questions when the answer is known", type: "checkbox" },
    { key: "notifications", label: "Desktop notifications when I'm needed", type: "checkbox" },
    { key: "concurrency", label: "Jobs filling at once", type: "number" },
    { key: "maxOpenTabs", label: "Max job tabs open (incl. waiting on you)", type: "number" },
    { key: "stallMinutes", label: "Flag a job as stuck after (minutes)", type: "number" },
  ],
  ai: [
    { key: "llmMode", label: "Mode", type: "select", options: ["off", "draft", "auto"], hint: "draft = fill & highlight for review; auto = also allow auto-submit with AI answers" },
    { key: "anthropicApiKey", label: "Anthropic API key", type: "password" },
    { key: "model", label: "Model", type: "select", options: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] },
    { key: "effort", label: "Effort", type: "select", options: ["low", "medium", "high"] },
  ],
};

let profile: Profile = { ...DEFAULT_PROFILE };
let settings: Settings = { ...DEFAULT_SETTINGS };
let answers: AnswerEntry[] = [];
let dirty = false;

function markDirty(): void {
  dirty = true;
  $("#dirty").textContent = "Unsaved changes";
}

function control(spec: FieldSpec, value: unknown, onChange: (v: unknown) => void): HTMLElement {
  let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  if (spec.type === "textarea") {
    input = h("textarea", { rows: 6 });
    input.value = String(value ?? "");
  } else if (spec.type === "yesno" || spec.type === "select") {
    input = h("select");
    const opts = spec.type === "yesno" ? [["", "—"], ["yes", "Yes"], ["no", "No"]] : (spec.options ?? []).map((o) => [o, o]);
    for (const [v, t] of opts) input.append(h("option", { value: v!, textContent: t! }));
    input.value = String(value ?? "");
  } else if (spec.type === "checkbox") {
    input = h("input", { type: "checkbox", checked: !!value });
  } else {
    input = h("input", { type: spec.type ?? "text", value: String(value ?? "") });
    if (spec.type === "password") input.autocomplete = "off";
  }
  const read = () => (spec.type === "checkbox" ? (input as HTMLInputElement).checked : spec.type === "number" ? Number(input.value) || 0 : input.value);
  input.addEventListener("input", () => {
    onChange(read());
    markDirty();
  });
  input.addEventListener("change", () => {
    onChange(read());
    markDirty();
  });
  if (spec.key in DEFAULT_PROFILE && (profile as unknown as Record<string, unknown>)[spec.key] === DECLINE) input.title = "Declines by default";
  const label = h("label", { className: `f ${spec.type === "checkbox" ? "check" : ""} ${spec.wide ? "wide" : ""}` });
  if (spec.type === "checkbox") label.append(input, spec.label);
  else label.append(spec.label, input);
  if (spec.hint) label.append(h("span", { className: "muted", textContent: spec.hint }));
  return label;
}

function renderForms(): void {
  for (const [group, specs] of Object.entries(P)) {
    const box = document.querySelector(`[data-group=${group}]`)!;
    box.replaceChildren(...specs.map((s) => control(s, (profile as unknown as Record<string, unknown>)[s.key], (v) => ((profile as unknown as Record<string, unknown>)[s.key] = v))));
  }
  for (const [group, specs] of Object.entries(S)) {
    const box = document.querySelector(`[data-group=${group}]`)!;
    box.replaceChildren(...specs.map((s) => control(s, (settings as unknown as Record<string, unknown>)[s.key], (v) => ((settings as unknown as Record<string, unknown>)[s.key] = v))));
  }
  $("#resume-name").textContent = profile.resume ? `Saved: ${profile.resume.name}` : "No file saved";
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
    profile?: Profile;
    settings?: Settings;
    answers?: AnswerEntry[];
  };
  profile = { ...DEFAULT_PROFILE, ...(raw.profile ?? {}) };
  settings = { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) };
  answers = raw.answers ?? [];
  renderForms();
  renderAnswers();
}

async function save(): Promise<void> {
  // Don't clobber the pause toggle, which the popup/overlay own.
  const cur = ((await api.storage.local.get(STORAGE_KEYS.settings)) as { settings?: Settings }).settings;
  const merged: Settings = { ...settings, paused: cur?.paused ?? settings.paused };
  const cleaned = answers.filter((a) => a.question.trim() && a.answer.trim());
  await api.storage.local.set({ profile, settings: merged, answers: cleaned });
  answers = cleaned;
  dirty = false;
  $("#dirty").textContent = "";
  toast("Saved");
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

$<HTMLInputElement>("#resume-file").addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) return toast("Resume is over 8 MB");
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  profile.resume = { name: file.name, type: file.type || "application/pdf", data: btoa(bin) };
  if (!profile.resumeText && file.type.startsWith("text/")) profile.resumeText = await file.text();
  renderForms();
  markDirty();
});
$("#resume-clear").addEventListener("click", () => {
  profile.resume = null;
  renderForms();
  markDirty();
});

$("#ans-filter").addEventListener("input", renderAnswers);
$("#ans-add").addEventListener("click", () => {
  answers = upsertAnswer(answers, { id: uid("ans_"), question: "New question", answer: "", source: "user", updatedAt: Date.now() });
  renderAnswers();
  markDirty();
});

$("#export").addEventListener("click", async () => {
  const raw = (await api.storage.local.get([STORAGE_KEYS.profile, STORAGE_KEYS.settings, STORAGE_KEYS.answers, STORAGE_KEYS.jobs])) as {
    settings?: Settings;
  } & Record<string, unknown>;
  const { anthropicApiKey: _k, ...safeSettings } = { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) };
  const data = { app: "jobpilot", version: 1, exportedAt: new Date().toISOString(), ...raw, settings: safeSettings };
  download(`jobpilot-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), "application/json");
});

$<HTMLInputElement>("#import").addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text()) as { profile?: Profile; settings?: Partial<Settings>; answers?: AnswerEntry[]; jobs?: Job[] };
    if (data.profile) profile = { ...DEFAULT_PROFILE, ...data.profile };
    if (data.settings) settings = { ...settings, ...data.settings, anthropicApiKey: settings.anthropicApiKey };
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

void load();
