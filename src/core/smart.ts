import type { AnswerEntry, FamilyRef, Need, Profile, Slots, Suggestion } from "../shared/types";
import { chooseOption } from "./choose";
import { cosine, type Embedder } from "./embed";
import { deriveAnswer, FAMILIES, FAMILY_BY_ID, familySlots, type Derived, type Family } from "./families";
import { countriesIn, fitToField, type FieldInfo, type JobCtx } from "./matcher";
import { cleanLabel, jaccard, norm, tokens } from "./text";

// The second pass for fields the regex rules and exact saved answers missed:
// recognize the question's family (by pattern, then by meaning with the local
// embedding model), answer it from the profile or from a saved answer to any
// wording of it, and otherwise come up with suggestions for the human card.
// Everything here is local; nothing calls an LLM.

/**
 * Similarity cut-offs for potion-base-8M (unit vectors, cosine), set on the
 * held-out wordings in test/smart.test.ts: no wrong family clears SURE (or
 * CLEAR), and no question outside every family clears MAYBE.
 */
export const THRESHOLDS = {
  /** Best family example at least this close → the family is certain… */
  sure: 0.82,
  /** …and at least this far ahead of the next family. */
  margin: 0.05,
  /** Or a clear winner: at least this close… */
  clear: 0.7,
  /** …and this far ahead of every other family. */
  clearMargin: 0.25,
  /** Close enough to offer the family's answer as a suggestion. */
  maybe: 0.62,
  /** A saved answer to a question this close (with matching details) is reused as is. */
  bankSure: 0.93,
  /** A saved answer this close is offered as a suggestion. */
  bankMaybe: 0.6,
  /** An option at least this close and this far ahead of the rest is the one meant (suggestion only). */
  option: 0.5,
  optionMargin: 0.15,
};

export interface Classified {
  family: Family;
  score: number;
  margin: number;
  via: "pattern" | "model";
  sure: boolean;
}

export type { FamilyRef, Suggestion };

export interface SmartResult {
  /** Safe to fill without asking; already fitted to the field. */
  value?: string;
  via?: "family" | "similar";
  family?: FamilyRef;
  /** Best first; already fitted to the field's options. */
  suggestions: Suggestion[];
}

// --- classification --------------------------------------------------------

const exampleVecs = new WeakMap<Embedder, { fam: Family; vec: Float32Array }[]>();

function examples(e: Embedder): { fam: Family; vec: Float32Array }[] {
  let ex = exampleVecs.get(e);
  if (!ex) {
    ex = FAMILIES.flatMap((fam) => fam.examples.map((t) => ({ fam, vec: e.embed(t) })));
    exampleVecs.set(e, ex);
  }
  return ex;
}

/** Open-ended prompts: never answered by a short-answer family's pattern. */
const ESSAY = /^(describe|explain|tell|share|discuss|elaborate|walk us|give (us )?an example|provide an example|why)\b/;

/** The employer's own name, read as "this company" so "Worked at Acme?" is the worked-here question. */
export function genericCompany(question: string, company: string): string {
  const c = norm(company);
  if (c.length < 2) return question;
  const n = ` ${norm(question)} `;
  return n.includes(` ${c} `) ? n.replace(` ${c} `, " this company ").trim() : question;
}

/**
 * Which family a question belongs to. Patterns win; otherwise the nearest
 * example wording, counting wordings the user has answered (saved answers
 * that carry a family) as examples too.
 */
export function classify(question: string, embedder?: Embedder | null, bank: AnswerEntry[] = [], company = ""): Classified | null {
  const text = genericCompany(cleanLabel(question), company);
  const label = norm(text);
  if (!label) return null;
  if (!ESSAY.test(label) && label.split(" ").length <= 25) {
    for (const fam of FAMILIES) {
      if (fam.re?.test(label)) return { family: fam, score: 1, margin: 1, via: "pattern", sure: true };
    }
  }
  if (!embedder) return null;
  const q = embedder.embed(text);
  const best = new Map<Family, number>();
  const consider = (fam: Family, s: number) => {
    if (s > (best.get(fam) ?? -1)) best.set(fam, s);
  };
  for (const { fam, vec } of examples(embedder)) consider(fam, cosine(q, vec));
  for (const e of bank) {
    const fam = e.family ? FAMILY_BY_ID.get(e.family) : undefined;
    if (fam && e.source === "user") consider(fam, cosine(q, embedder.embed(cleanLabel(e.question))));
  }
  const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
  const [top, next] = ranked;
  if (!top || top[1] < THRESHOLDS.maybe) return null;
  const margin = top[1] - (next?.[1] ?? 0);
  const sure = (top[1] >= THRESHOLDS.sure && margin >= THRESHOLDS.margin) || (top[1] >= THRESHOLDS.clear && margin >= THRESHOLDS.clearMargin);
  return { family: top[0], score: top[1], margin, via: "model", sure };
}

// --- answers saved per family -------------------------------------------------

const yesNoOf = (v: string): "yes" | "no" | null => {
  const w = norm(v).split(" ")[0];
  return w === "yes" || w === "y" || w === "true" ? "yes" : w === "no" || w === "n" || w === "false" ? "no" : null;
};

function sameSlots(a: Slots = {}, b: Slots = {}, skip?: keyof Slots): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof Slots)[]);
  for (const k of keys) if (k !== skip && a[k] !== b[k]) return false;
  return true;
}

/**
 * A saved answer to this family (any wording). Monotone families reason across
 * thresholds: "yes" to 4 office days covers 3; "no" to 3 covers 5.
 */
export function recall(bank: AnswerEntry[], fam: Family, slots: Slots, company: string): Derived | null {
  let mine = bank.filter((e) => e.family === fam.id && e.answer);
  if (fam.perCompany) {
    const c = norm(company);
    const here = mine.filter((e) => c && norm(e.company ?? "") === c);
    if (!here.length) {
      const other = mine[0];
      return other ? { value: other.answer, sure: false, why: other.company ? `Your answer for ${other.company}` : "Your earlier answer" } : null;
    }
    mine = here;
  }
  const dim = fam.monotone;
  mine = mine.filter((e) => sameSlots(e.slots, slots, dim));
  if (!dim) {
    const e = mine[0];
    return e ? { value: e.answer, sure: true, why: `You answered "${e.question.slice(0, 60)}"` } : null;
  }
  const n = slots[dim];
  let guess: AnswerEntry | null = null;
  for (const e of mine) {
    const m = e.slots?.[dim];
    const yn = yesNoOf(e.answer);
    if (n === undefined || m === undefined || m === n) return { value: e.answer, sure: true, why: `You answered "${e.question.slice(0, 60)}"` };
    if ((yn === "yes" && m >= n) || (yn === "no" && m <= n)) return { value: e.answer, sure: true, why: `You said ${e.answer.toLowerCase()} to ${m}${dim === "percent" ? "%" : " days"}` };
    guess ??= e;
  }
  return guess ? { value: guess.answer, sure: false, why: `You said ${guess.answer.toLowerCase()} to ${guess.slots?.[dim]}${dim === "percent" ? "%" : " days"}` } : null;
}

// --- option fitting -------------------------------------------------------------

const CHOICE = new Set(["select", "radio", "combobox", "checkboxGroup"]);

/** Option meant by an answer, by meaning ("Mechanical Engineering" → "ME / Mechanical"). */
export function nearestOption(value: string, options: string[], embedder?: Embedder | null): string | null {
  if (!embedder || !options.length) return null;
  const v = embedder.embed(value);
  const scored = options.map((o) => ({ o, s: cosine(v, embedder.embed(o)) })).sort((a, b) => b.s - a.s);
  const [a, b] = scored;
  return a && a.s >= THRESHOLDS.option && a.s - (b?.s ?? 0) >= THRESHOLDS.optionMargin ? a.o : null;
}

/** Fit a value to a field: exact fit, else (for choices) the nearest option by meaning, as a guess. */
function fit(field: FieldInfo, value: string, embedder?: Embedder | null): { value: string; exact: boolean } | null {
  const exact = fitToField(field, value);
  if (exact) return { value: exact, exact: true };
  if (CHOICE.has(field.kind) && field.kind !== "checkboxGroup") {
    const near = nearestOption(value, field.options, embedder);
    if (near) return { value: near, exact: false };
  }
  return null;
}

// --- details that must match before reusing an answer ---------------------------

const NEG = /\b(not|never|no longer|without|un\w+)\b/g;
const ORD = /\b(first|second|third|previous|prior|former|current|most recent|before)\b/g;

function details(text: string): string {
  const n = norm(text);
  return [...(n.match(/\b\d+\b/g) ?? []), ...countriesIn(n), ...(n.match(NEG) ?? []), ...(n.match(ORD) ?? [])].sort().join("|");
}

// --- the resolver ----------------------------------------------------------------

/**
 * Resolve a field the plain rules couldn't, using families, saved answers and
 * (when loaded) the embedding model. Returns a value only when it's as safe as
 * a profile rule; everything else comes back as suggestions for the human.
 */
export function resolveSmart(
  field: FieldInfo,
  profile: Profile,
  bank: AnswerEntry[],
  ctx: JobCtx,
  embedder?: Embedder | null,
): SmartResult {
  const question = cleanLabel(field.label) || `${field.attrs} ${field.placeholder}`.trim();
  const out: SmartResult = { suggestions: [] };
  if (!question || field.kind === "file") return out;

  const add = (value: string, why: string) => {
    const f = fit(field, value, embedder);
    const v = f ? f.value : CHOICE.has(field.kind) && field.options.length ? null : value;
    if (v && !out.suggestions.some((s) => norm(s.value) === norm(v))) out.suggestions.push({ value: v, why });
  };

  const c = classify(question, embedder, bank, ctx.company);
  if (c) {
    const fam = c.family;
    const slots = familySlots(fam, question, profile);
    out.family = { id: fam.id, label: fam.label, slots, sure: c.sure, company: fam.perCompany ? ctx.company || undefined : undefined };
    const mem = recall(bank, fam, slots, ctx.company);
    const prof = deriveAnswer(fam, field, slots, profile, ctx);
    // Per-company families: this company's answer, then the profile, then other companies' answers.
    const order = fam.perCompany && mem && !mem.sure ? [prof, mem] : [mem, prof];
    for (const d of order) {
      if (!d) continue;
      if (c.sure && d.sure && !out.value) {
        const f = fit(field, d.value, embedder);
        if (f?.exact) {
          out.value = f.value;
          out.via = "family";
          continue;
        }
      }
      add(d.value, `${fam.label} · ${d.why}`);
    }
    if (out.value) return out;
  }

  // Saved answers to similar wordings.
  const scored = bank
    .filter((e) => e.answer)
    .map((e) => ({
      e,
      s: embedder ? cosine(embedder.embed(question), embedder.embed(cleanLabel(e.question))) : jaccard(tokens(question), tokens(e.question)),
    }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 3);
  for (const { e, s } of scored) {
    if (s < (embedder ? THRESHOLDS.bankMaybe : 0.5)) break;
    const sameFamily = !c || !e.family || e.family === c.family.id;
    if (embedder && s >= THRESHOLDS.bankSure && sameFamily && details(question) === details(e.question) && !out.value) {
      const f = fit(field, e.answer, embedder);
      if (f?.exact) {
        out.value = f.value;
        out.via = "similar";
        return out;
      }
    }
    add(e.answer, `Your answer to "${cleanLabel(e.question).slice(0, 60)}"`);
  }
  out.suggestions = out.suggestions.slice(0, 3);
  return out;
}

// --- remembering ----------------------------------------------------------------

/**
 * The entry "Remember" saves for an answered need. It's filed under the
 * question's family when the family is certain, or when the user took the
 * family's own suggestion (which confirms both the family and the answer).
 */
export function rememberedEntry(need: Need, value: string, base: AnswerEntry): AnswerEntry {
  const fam = need.family;
  const confirmed = fam && (fam.sure || need.suggestions?.[0]?.value === value);
  if (!fam || !confirmed || !FAMILY_BY_ID.has(fam.id)) return base;
  return { ...base, family: fam.id, slots: fam.slots, ...(fam.company ? { company: fam.company } : {}) };
}

/** Other open needs the saved answers now settle (same family, possibly another tab). */
export function settledNeeds(needs: Need[], bank: AnswerEntry[]): { need: Need; value: string }[] {
  const out: { need: Need; value: string }[] = [];
  for (const n of needs) {
    const fam = n.family && FAMILY_BY_ID.get(n.family.id);
    if (!fam || !n.family?.sure || n.kind !== "question" || !n.fieldKey) continue;
    const d = recall(bank, fam, n.family.slots, n.family.company ?? "");
    if (!d?.sure) continue;
    if (n.inputType === "choice" || n.inputType === "multi") {
      const i = n.options?.length ? chooseOption(d.value, n.options) : -1;
      if (i >= 0) out.push({ need: n, value: n.options![i]! });
    } else out.push({ need: n, value: d.value });
  }
  return out;
}
