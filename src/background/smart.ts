import { loadEmbedder, type Embedder } from "../core/embed";
import type { FieldInfo, JobCtx } from "../core/matcher";
import { resolveSmart, type SmartResult } from "../core/smart";
import { api } from "../shared/api";
import type { AnswerEntry, Profile } from "../shared/types";

// The embedding model lives in the background so it's loaded once (≈8 MB),
// not per tab and frame. If it can't load, families still match by pattern.

let model: Promise<Embedder | null> | null = null;

export function embedder(): Promise<Embedder | null> {
  model ??= (async () => {
    try {
      const [bin, vocab] = await Promise.all([
        fetch(api.runtime.getURL("models/m2v.bin")).then((r) => r.arrayBuffer()),
        fetch(api.runtime.getURL("models/m2v.vocab.txt")).then((r) => r.text()),
      ]);
      return loadEmbedder(bin, vocab);
    } catch (e) {
      console.warn("AIM-401k: embedding model unavailable; matching by pattern only", e);
      return null;
    }
  })();
  return model;
}

export async function smartResolve(field: FieldInfo, ctx: JobCtx, profile: Profile, bank: AnswerEntry[]): Promise<SmartResult> {
  return resolveSmart(field, profile, bank, ctx, await embedder());
}
