import type { AnswerEntry } from "../shared/types";
import { cleanLabel, jaccard, norm, tokens } from "./text";

export function questionKey(q: string): string {
  return norm(cleanLabel(q));
}

/**
 * Find a previously saved answer for a question. Exact (normalized) matches
 * win; otherwise a near-identical wording (high token overlap) is accepted so
 * "Are you legally authorized to work in the US?" and "Are you legally
 * authorized to work in the United States?" don't both need a human.
 */
export function findAnswer(question: string, bank: AnswerEntry[]): AnswerEntry | null {
  const key = questionKey(question);
  if (!key) return null;
  let best: AnswerEntry | null = null;
  let bestScore = 0;
  const qt = tokens(question);
  for (const e of bank) {
    if (questionKey(e.question) === key) return e;
    const et = tokens(e.question);
    if (qt.length < 3 || et.length < 3) continue;
    const s = jaccard(qt, et);
    if (s > bestScore) {
      bestScore = s;
      best = e;
    }
  }
  return bestScore >= 0.8 ? best : null;
}

export function upsertAnswer(bank: AnswerEntry[], entry: AnswerEntry): AnswerEntry[] {
  const key = questionKey(entry.question);
  const rest = bank.filter((e) => questionKey(e.question) !== key);
  return [entry, ...rest];
}
