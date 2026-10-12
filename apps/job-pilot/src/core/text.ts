// Text normalization helpers shared by the matcher, option chooser and answer bank.

export function norm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim();
}

/** Strip required markers and boilerplate from a question label. */
export function cleanLabel(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/\(\s*(required|optional)\s*\)/gi, "")
    .replace(/[*✱]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set(
  "a an the of to for in on at and or is are you your do does did have has be this that with what which please if any we our us by as it".split(" "),
);

export function tokens(s: string): string[] {
  return norm(s)
    .split(" ")
    .filter((t) => t && !STOP.has(t));
}

export function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Whole-word containment: does `hay` contain `needle` as a word sequence? */
export function containsWords(hay: string, needle: string): boolean {
  const h = ` ${norm(hay)} `;
  const n = norm(needle);
  return n.length > 0 && h.includes(` ${n} `);
}
