import { containsWords, jaccard, norm, tokens } from "./text";

const DECLINE_RE = /decline|prefer not|dont wish|do not wish|not wish to|choose not|not to (say|answer|disclose|self identify)|rather not|no answer/;
const PLACEHOLDER_RE = /^(select|choose|please select|please choose|select one|select an option|none selected|)$/;

export function isPlaceholderOption(text: string): boolean {
  const n = norm(text);
  return PLACEHOLDER_RE.test(n) || /^(select|choose)\b.*\.\.\.$/.test(text.trim().toLowerCase()) || /^-+$/.test(text.trim());
}

function yesNo(n: string): "yes" | "no" | null {
  const first = n.split(" ")[0];
  if (first === "yes" || first === "y" || first === "true") return "yes";
  if (first === "no" || first === "n" || first === "false") return "no";
  return null;
}

/**
 * Pick the option that best matches a desired answer. Returns the option
 * index or -1 if nothing is a confident match (caller should ask the human).
 */
export function chooseOption(answer: string, options: string[]): number {
  const a = norm(answer);
  if (!a || !options.length) return -1;
  const opts = options.map(norm);

  // 1. exact
  let i = opts.indexOf(a);
  if (i >= 0) return i;

  // 2. yes / no answers map onto "Yes, I am…" / "No, I will not…"
  const yn = yesNo(a);
  if (yn) {
    i = opts.findIndex((o) => yesNo(o) === yn);
    if (i >= 0) return i;
  }

  // 3. "decline to answer" family
  if (DECLINE_RE.test(a)) {
    i = opts.findIndex((o) => DECLINE_RE.test(o));
    if (i >= 0) return i;
  }

  // 4. whole-word containment either way; prefer the tightest fit
  let best = -1;
  let bestScore = Infinity;
  opts.forEach((o, idx) => {
    if (!o) return;
    if (containsWords(o, a) || containsWords(a, o)) {
      const score = Math.abs(o.length - a.length);
      if (score < bestScore) {
        bestScore = score;
        best = idx;
      }
    }
  });
  if (best >= 0) return best;

  // 5. token overlap
  const at = tokens(answer);
  let bestJ = 0;
  options.forEach((o, idx) => {
    const j = jaccard(at, tokens(o));
    if (j > bestJ) {
      bestJ = j;
      best = idx;
    }
  });
  return bestJ >= 0.5 ? best : -1;
}
