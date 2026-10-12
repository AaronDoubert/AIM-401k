import { mergeResume, type ResumeData } from "../core/resumeParse";
import { api } from "../shared/api";
import { normalizeProfile, normalizeSettings, STORAGE_KEYS } from "../shared/defaults";
import type { AnswerEntry, Profile, Settings } from "../shared/types";
import { $, h, send, toast } from "./common";
import { extractResume, fileToBase64 } from "./extract";
import { PROFILE_GROUPS, renderAiSetup, renderEducation, renderFields, renderWork } from "./profileForm";

let profile: Profile;
let settings: Settings;
let step = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const steps = Array.from(document.querySelectorAll<HTMLElement>("section.step"));

async function load(): Promise<void> {
  const raw = (await api.storage.local.get([STORAGE_KEYS.profile, STORAGE_KEYS.settings])) as { profile?: unknown; settings?: unknown };
  profile = normalizeProfile(raw.profile);
  settings = normalizeSettings(raw.settings);
}

/** Debounced autosave so closing the tab mid-way loses nothing. */
function changed(): void {
  $("#saved").textContent = "Saving…";
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void save(), 400);
}

async function save(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  // Keep the runner's pause flag; everything else on these pages is ours.
  const cur = normalizeSettings(((await api.storage.local.get(STORAGE_KEYS.settings)) as { settings?: unknown }).settings);
  await api.storage.local.set({ profile, settings: { ...settings, paused: cur.paused } });
  $("#saved").textContent = "Saved";
}

function renderAll(): void {
  for (const box of document.querySelectorAll<HTMLElement>("[data-group]")) {
    const specs = PROFILE_GROUPS[box.dataset.group!];
    if (specs) renderFields(box, specs, profile as unknown as Record<string, unknown>, changed);
  }
  renderWork($("#work"), profile, changed);
  renderEducation($("#edu"), profile, changed);
  renderAiSetup($("#ai"), settings, changed, renderReparse);
  renderReparse();
}

function show(i: number): void {
  step = Math.max(0, Math.min(steps.length - 1, i));
  steps.forEach((s, j) => s.classList.toggle("on", j === step));
  $("#steps").replaceChildren(...steps.map((s, j) => h("span", { className: j === step ? "on" : j < step ? "done" : "", textContent: `${j + 1}. ${s.dataset.step}` })));
  $<HTMLButtonElement>("#back").disabled = step === 0;
  $("#next").textContent = step === steps.length - 2 ? "Finish" : step === steps.length - 1 ? "Close" : "Next";
  window.scrollTo({ top: 0 });
}

function summarize(d: ResumeData): string[] {
  const out: string[] = [];
  const name = [d.firstName, d.lastName].filter(Boolean).join(" ");
  if (name) out.push(`Name: ${name}`);
  if (d.email) out.push(`Email: ${d.email}`);
  if (d.phone) out.push(`Phone: ${d.phone}`);
  if (d.city) out.push(`Location: ${[d.city, d.state].filter(Boolean).join(", ")}`);
  const links = [d.linkedin && "LinkedIn", d.github && "GitHub", d.portfolio && "website"].filter(Boolean);
  if (links.length) out.push(`Links: ${links.join(", ")}`);
  if (d.workHistory?.length) out.push(`${d.workHistory.length} job${d.workHistory.length > 1 ? "s" : ""}: ${d.workHistory.map((w) => w.company || w.title).filter(Boolean).join(", ")}`);
  if (d.education?.length) out.push(`${d.education.length} school${d.education.length > 1 ? "s" : ""}: ${d.education.map((e) => e.school).join(", ")}`);
  if (d.skills) out.push(`Skills: ${d.skills.split(",").length}`);
  return out;
}

async function importFile(file: File): Promise<void> {
  const found = $("#found");
  found.replaceChildren(h("p", { className: "muted", textContent: `Reading ${file.name}…` }));
  try {
    const res = await extractResume(file);
    profile = mergeResume(profile, res.data, true);
    profile.resumeText = res.kind === "json" ? profile.resumeText : res.text.trim();
    if (res.kind === "pdf" || res.kind === "docx") {
      profile.resume = { name: file.name, type: file.type || (res.kind === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), data: fileToBase64(await file.arrayBuffer()) };
    }
    await save();
    renderAll();
    const lines = summarize(res.data);
    found.replaceChildren(
      h("div", { className: "card" }, h("b", { textContent: `✓ Imported ${file.name}` }), h("ul", {}, ...lines.map((l) => h("li", { textContent: l }))), h("p", { className: "muted", textContent: settings.llmMode !== "off" ? "Tip: the AI helper step can re-read it for better accuracy." : "Click Next to review. You can connect an AI helper later to read it more accurately." })),
    );
  } catch (e) {
    found.replaceChildren(h("p", { className: "status bad", textContent: e instanceof Error ? e.message : String(e) }));
  }
}

/** "Re-read with AI" — shown once a provider is connected and there's resume text. */
function renderReparse(): void {
  const box = $("#reparse");
  if (!profile.resumeText || settings.llmMode === "off") {
    box.replaceChildren();
    return;
  }
  const btn = h("button", { type: "button", textContent: "Re-read my resume with AI" });
  const status = h("span", { className: "muted" });
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    status.textContent = " Reading…";
    await save();
    const res = await send<{ ok: boolean; data?: ResumeData; message?: string }>({ type: "parseResume", text: profile.resumeText });
    btn.disabled = false;
    if (!res.ok || !res.data) {
      status.textContent = ` ✗ ${res.message ?? "failed"}`;
      return;
    }
    const replaceLists = !profile.workHistory.length || confirm("Replace your work history and education with what the AI found? (Cancel keeps yours and only fills empty fields.)");
    const data = replaceLists ? res.data : { ...res.data, workHistory: [], education: [] };
    profile = mergeResume(profile, data, false);
    if (replaceLists) {
      if (res.data.workHistory?.length) profile.workHistory = res.data.workHistory;
      if (res.data.education?.length) profile.education = res.data.education;
    }
    await save();
    renderAll();
    status.textContent = " ✓ Updated — review it in the earlier steps.";
  });
  box.replaceChildren(h("div", { className: "row" }, btn, status));
}

// --- wiring ------------------------------------------------------------------

const drop = $("#drop");
const fileInput = $<HTMLInputElement>("#file");
fileInput.addEventListener("change", () => fileInput.files?.[0] && void importFile(fileInput.files[0]));
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  const f = e.dataTransfer?.files?.[0];
  if (f) void importFile(f);
});

$<HTMLInputElement>("#backup").addEventListener("change", async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text()) as { profile?: unknown; settings?: Partial<Settings>; answers?: AnswerEntry[] };
    if (data.profile) profile = normalizeProfile(data.profile);
    if (data.settings) settings = normalizeSettings({ ...data.settings, apiKeys: settings.apiKeys });
    if (data.answers) await api.storage.local.set({ answers: data.answers });
    await save();
    renderAll();
    toast("Backup imported");
    show(1);
  } catch (err) {
    toast(`Import failed: ${String(err)}`);
  }
});

$("#back").addEventListener("click", () => show(step - 1));
$("#next").addEventListener("click", async () => {
  await save();
  if (step === steps.length - 2) {
    settings.onboarded = true;
    await save();
  }
  if (step === steps.length - 1) window.close();
  else show(step + 1);
});
$("#go-tracker").addEventListener("click", () => void api.tabs.create({ url: api.runtime.getURL("tracker.html") }));
$("#go-settings").addEventListener("click", () => void api.runtime.openOptionsPage());

await load();
renderAll();
show(0);
