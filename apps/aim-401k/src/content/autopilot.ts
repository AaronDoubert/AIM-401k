import { fitToField, resolveField } from "../core/matcher";
import type { ContentContext, DraftResult, NeedInput, PageState, ToBackground } from "../shared/messages";
import { api } from "../shared/api";
import type { NeedKind, PageMeta, UnitPhase, UnitState } from "../shared/types";
import { sleep } from "../shared/util";
import { queryAll } from "./dom";
import {
  ATS_FRAME_RE,
  extractMeta,
  findApplyButton,
  findNextButton,
  findSubmitButton,
  isConfirmationPage,
  isLoginWall,
  pageErrors,
  visibleCaptcha,
} from "./detect";
import { fillField, press } from "./fill";
import { fieldError, isFilled, scanFields, type ScannedField } from "./scan";

const send = (msg: ToBackground): Promise<unknown> => api.runtime.sendMessage(msg);

const NOISE_RE = /\b(search|keyword|newsletter|subscribe)\b/i;

type UnitReport = Omit<UnitState, "jobId" | "updatedAt" | "thumb">;
const UNIT_THROTTLE_MS = 200;

/**
 * Drives one frame of a managed job tab: fills what it knows, asks the
 * background for AI drafts, advances multi-step forms, and reports anything
 * that needs a human. Each pass is idempotent, so it is safe to re-run on
 * every DOM change.
 */
export class Autopilot {
  private busy = false;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private checkTimer: ReturnType<typeof setTimeout> | null = null;
  private done = false;
  private applyClicks = 0;
  private lastAdvanceSig = "";
  private sameSigCount = 0;
  private lastPassSig = "";
  private aiDrafted = new Set<string>();
  private drafts = new Map<string, DraftResult>();
  private lastReport = "";
  // War Room unit state (cosmetic telemetry; never allowed to break filling).
  private unitState: UnitReport = { phase: "recon", step: 1, fieldsTotal: 0, fieldsDone: 0, currentField: "" };
  private unitSentAt = 0;
  private unitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private ctx: ContentContext,
    private readonly top: boolean,
  ) {}

  get jobId(): string {
    return this.ctx.jobId ?? "";
  }

  schedule(delay = 800): void {
    if (this.done) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), delay);
  }

  /** Cheap check used by the MutationObserver: only re-run when the form changed. */
  maybeRerun(): void {
    if (this.busy || this.done || this.checkTimer) return;
    // Throttled: busy pages mutate constantly and a scan isn't free.
    this.checkTimer = setTimeout(() => {
      this.checkTimer = null;
      if (this.busy || this.done) return;
      if (this.signature() !== this.lastPassSig || isConfirmationPage()) this.schedule(400);
    }, 500);
  }

  private signature(): string {
    return location.href + "|" + scanFields().map((f) => f.info.key + (isFilled(f) ? "+" : "-")).join(",");
  }

  async tick(): Promise<void> {
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    try {
      await this.pass();
    } catch (e) {
      this.unit({ phase: "holding" });
      await this.report("blocked", [{ kind: "error", prompt: `AIM-401k hit an error: ${String(e)}` }]);
    } finally {
      this.busy = false;
      this.lastPassSig = this.signature();
      if (this.again) {
        this.again = false;
        this.schedule(300);
      }
    }
  }

  private async refreshCtx(): Promise<void> {
    const ctx = (await send({ type: "hello", top: this.top, url: location.href })) as ContentContext | undefined;
    if (ctx?.managed) this.ctx = ctx;
    else if (ctx) this.ctx = { ...this.ctx, managed: false };
  }

  private async report(state: PageState, needs: NeedInput[], note?: string, meta?: PageMeta): Promise<void> {
    const sig = JSON.stringify([state, needs, note]);
    if (sig === this.lastReport && state !== "submitted") return;
    this.lastReport = sig;
    await send({ type: "report", jobId: this.jobId, state, needs, note, meta, aiDrafted: this.aiDrafted.size });
  }

  /**
   * Report this frame's progress to the War Room. Phase changes go out at
   * once; field-by-field updates are throttled (a trailing send keeps the last).
   */
  private unit(patch: Partial<UnitReport>): void {
    if (!this.jobId) return;
    const phaseChanged = patch.phase != null && patch.phase !== this.unitState.phase;
    this.unitState = { ...this.unitState, ...patch };
    const fire = () => {
      if (this.unitTimer) clearTimeout(this.unitTimer);
      this.unitTimer = null;
      this.unitSentAt = Date.now();
      try {
        void send({ type: "unit", jobId: this.jobId, state: { ...this.unitState } }).catch(() => undefined);
      } catch {
        /* extension context gone; the War Room is optional */
      }
    };
    const wait = UNIT_THROTTLE_MS - (Date.now() - this.unitSentAt);
    if (phaseChanged || wait <= 0) fire();
    else this.unitTimer ??= setTimeout(fire, wait);
  }

  private get unitPhase(): UnitPhase {
    return this.unitState.phase;
  }

  private formFields(): ScannedField[] {
    return scanFields().filter((f) => !(f.info.kind === "text" && NOISE_RE.test(`${f.info.label} ${f.info.attrs} ${f.info.placeholder}`)));
  }

  private async pass(): Promise<void> {
    await this.refreshCtx();
    if (!this.ctx.managed || this.done) return;
    if (this.ctx.settings.paused) return;

    if (isConfirmationPage()) {
      this.done = true;
      this.unit({ phase: "delivered", currentField: "" });
      await this.report("submitted", [], "Confirmation page detected", extractMeta());
      return;
    }

    const meta = extractMeta();
    const fields = this.formFields();
    const meaningful = fields.filter((f) => f.info.kind !== "checkbox" || f.info.required);

    // --- No form here: find the way in. ---------------------------------
    if (meaningful.length < 2 && !fields.some((f) => f.info.kind === "file")) {
      if (!this.top) return; // sub-frames without a form have nothing to do
      const atsFrame = queryAll<HTMLIFrameElement>("iframe").some((f) => ATS_FRAME_RE.test(f.src));
      if (atsFrame) {
        await this.report("filling", [], "Application form is in an embedded frame", meta);
        return;
      }
      if (isLoginWall(fields.length)) {
        this.unit({ phase: "holding" });
        await this.report("blocked", [{ kind: "login", prompt: "Sign in or create an account on this site, then I'll continue." }], undefined, meta);
        return;
      }
      // Between steps (just clicked Next / Submit) the form is briefly gone: that's not recon.
      if (this.unitPhase !== "advancing" && this.unitPhase !== "releasing") this.unit({ phase: "recon", currentField: "" });
      const apply = findApplyButton();
      if (apply && this.applyClicks < 3) {
        this.applyClicks++;
        await send({ type: "progress", jobId: this.jobId, msg: "Clicked Apply" });
        press(apply);
        this.schedule(2000);
        return;
      }
      await this.report("filling", [], "Looking for the application form…", meta);
      return;
    }

    if (this.top && isLoginWall(meaningful.length)) {
      this.unit({ phase: "holding" });
      await this.report("blocked", [{ kind: "login", prompt: "Sign in or create an account on this site, then I'll continue." }], undefined, meta);
      return;
    }

    // --- Fill pass ---------------------------------------------------------
    const needs: NeedInput[] = [];
    const { profile, answers, settings } = this.ctx;
    const jobCtx = { company: meta.company, title: meta.title };
    const useAi = settings.llmMode !== "off" && settings.hasApiKey;
    const counted = fields.filter((f) => f.info.required || settings.fillOptional);
    let done = counted.filter(isFilled).length;
    this.unit({ phase: "filling", fieldsTotal: counted.length, fieldsDone: done, currentField: "" });

    const askHuman = (f: ScannedField, kind: NeedKind, detail = "") => {
      for (const el of f.els) el.dataset.aim = "need";
      const isChoice = ["select", "radio", "combobox", "checkboxGroup"].includes(f.info.kind) && f.info.options.length > 0;
      needs.push({
        kind,
        prompt: f.info.label || f.info.attrs || "Unlabeled field",
        detail: detail || undefined,
        fieldKey: f.info.key,
        inputType:
          f.info.kind === "file"
            ? undefined
            : f.info.kind === "date" || f.info.kind === "dateParts"
              ? "date"
            : kind === "consent"
              ? undefined
              : isChoice
                ? f.info.kind === "checkboxGroup"
                  ? "multi"
                  : "choice"
                : f.info.kind === "textarea"
                  ? "textarea"
                  : "text",
        options: isChoice ? f.info.options : undefined,
      });
    };

    for (const f of fields) {
      if (isFilled(f)) continue;
      if (!f.info.required && !settings.fillOptional) continue;
      const r = resolveField(f.info, profile, answers, jobCtx);
      if (r.type === "skip") continue;

      if (r.type === "value" || r.type === "resume") {
        this.unit({ currentField: f.info.label || f.info.attrs });
        const ok = await fillField(f, r.type === "value" ? r.value : "", profile.resume);
        if (ok) this.unit({ fieldsDone: ++done });
        if (!ok && f.info.required) askHuman(f, "question", "Couldn't fill this automatically");
        continue;
      }
      if (r.type === "human") {
        if (f.info.required || r.kind === "signature") askHuman(f, r.kind);
        continue;
      }
      // unknown
      if (!f.info.required) continue;
      if (useAi && f.info.kind !== "file" && f.info.kind !== "checkbox") {
        this.unit({ currentField: f.info.label || f.info.attrs });
        let d = this.drafts.get(f.info.key);
        if (!d) {
          await send({ type: "progress", jobId: this.jobId, msg: `Drafting answer: ${f.info.label.slice(0, 80)}` });
          d = (await send({
            type: "draft",
            req: { question: f.info.label, inputType: f.info.kind, options: f.info.options, required: f.info.required, meta },
          })) as DraftResult;
          this.drafts.set(f.info.key, d);
        }
        const fitted = d.answer && !d.needsHuman ? fitToField(f.info, d.answer) : null;
        if (fitted && (await fillField(f, fitted, profile.resume))) {
          this.unit({ fieldsDone: ++done });
          this.aiDrafted.add(f.info.key);
          for (const el of f.els) el.dataset.aim = "ai";
          continue;
        }
        askHuman(f, "question", d.reason);
        continue;
      }
      askHuman(f, f.info.kind === "checkbox" ? "consent" : "question");
    }

    // Surface validation errors on fields we thought were fine.
    await sleep(400);
    const neededKeys = new Set(needs.map((n) => n.fieldKey));
    for (const f of this.formFields()) {
      const err = fieldError(f);
      if (err && !neededKeys.has(f.info.key)) askHuman(f, "question", err);
    }

    this.unit({ fieldsDone: counted.filter(isFilled).length });

    if (needs.length) {
      this.unit({ phase: "holding" });
      await this.report("blocked", needs, undefined, meta);
      return;
    }

    // --- Advance or hand over for submit ----------------------------------
    const next = findNextButton();
    const submit = findSubmitButton();
    const sig = location.href + "|" + this.formFields().map((f) => f.info.key).join(",");

    if (next && settings.autoAdvance) {
      if (!this.stepGuard(sig)) return this.reportStuck(meta);
      await send({ type: "progress", jobId: this.jobId, msg: "Filled step; clicking Next" });
      this.unit({ phase: "advancing", step: this.unitState.step + 1, currentField: "" });
      press(next);
      this.schedule(1800);
      return;
    }

    if (submit) {
      const captcha = visibleCaptcha();
      const canAutoSubmit = settings.autoSubmit && !captcha && (this.aiDrafted.size === 0 || settings.llmMode === "auto");
      if (canAutoSubmit) {
        if (!this.stepGuard(sig)) return this.reportStuck(meta);
        await send({ type: "progress", jobId: this.jobId, msg: "Submitting application" });
        this.unit({ phase: "releasing", currentField: "" });
        press(submit);
        this.schedule(3000);
        return;
      }
      const bits = ["Everything is filled — review and submit."];
      if (this.aiDrafted.size) bits.push(`${this.aiDrafted.size} AI-drafted answer(s) are highlighted in amber.`);
      if (captcha) bits.push("There's a CAPTCHA to solve first.");
      this.unit({ phase: "holding" });
      await this.report("ready", [{ kind: "review_submit", prompt: bits.join(" ") }], undefined, meta);
      return;
    }

    if (next) {
      this.unit({ phase: "holding" });
      await this.report("ready", [{ kind: "review_submit", prompt: "This step is filled. Click Next (auto-advance is off)." }], undefined, meta);
      return;
    }

    this.unit({ phase: "holding" });
    await this.report(
      "blocked",
      [{ kind: "stalled", prompt: "I filled what I could but can't find a Next or Submit button." }],
      undefined,
      meta,
    );
  }

  /** Returns false when we've clicked through the same step repeatedly without it changing. */
  private stepGuard(sig: string): boolean {
    this.sameSigCount = sig === this.lastAdvanceSig ? this.sameSigCount + 1 : 0;
    this.lastAdvanceSig = sig;
    return this.sameSigCount < 2;
  }

  private async reportStuck(meta: PageMeta): Promise<void> {
    const errs = pageErrors();
    this.unit({ phase: "holding" });
    await this.report(
      "blocked",
      [{ kind: "stalled", prompt: `Stuck on this step${errs.length ? `: ${errs.join(" · ")}` : " (the page didn't advance)"}` }],
      undefined,
      meta,
    );
  }

  /** The human answered a question from the overlay/popup. */
  async applyAnswer(fieldKey: string, value: string, kind: NeedKind): Promise<boolean> {
    const f = scanFields().find((x) => x.info.key === fieldKey);
    if (!f) return false;
    const v = kind === "consent" ? "checked" : (fitToField(f.info, value) ?? value);
    const ok = await fillField(f, v, this.ctx.profile.resume);
    this.lastReport = "";
    this.schedule(400);
    return ok;
  }

  async submit(): Promise<boolean> {
    const btn = findSubmitButton() ?? findNextButton();
    if (!btn) return false;
    await send({ type: "progress", jobId: this.jobId, msg: "Submitting (you approved)" });
    this.unit({ phase: "releasing", currentField: "" });
    press(btn);
    this.lastReport = "";
    this.schedule(3000);
    return true;
  }
}
