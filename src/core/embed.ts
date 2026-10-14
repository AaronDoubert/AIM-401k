// Local sentence embeddings with a Model2Vec static model (potion-base-8M, MIT).
//
// A static model is a lookup table: one vector per WordPiece token, distilled
// from a sentence transformer. A sentence vector is the mean of its tokens'
// vectors, normalized, so "embedding" a question costs a tokenize and a few
// dozen array adds: no WASM, no network, well under a millisecond. Files are
// produced by scripts/make-m2v.mjs.

export interface Embedder {
  /** Unit-length vector for a piece of text (cached). Empty text → zero vector. */
  embed(text: string): Float32Array;
  readonly dims: number;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

// BERT basic tokenization (bge's tokenizer is bert-base-uncased style): drop
// control characters, lowercase, strip accents, split on whitespace and
// punctuation, put spaces around CJK ideographs.
const PUNCT = /[\p{P}!-/:-@[-`{-~]/u;
const CJK = /[一-鿿㐀-䶿\u{20000}-\u{2A6DF}\u{2A700}-\u{2B73F}\u{2B740}-\u{2B81F}\u{2B820}-\u{2CEAF}豈-﫿\u{2F800}-\u{2FA1F}]/u;

export function basicTokens(text: string): string[] {
  const clean = text
    .replace(/[\u0000�]|\p{Cc}/gu, (c) => (/\s/.test(c) ? " " : ""))
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");
  const out: string[] = [];
  let word = "";
  const flush = () => {
    if (word) out.push(word);
    word = "";
  };
  for (const ch of clean) {
    if (/\s/.test(ch)) flush();
    else if (PUNCT.test(ch) || CJK.test(ch)) {
      flush();
      out.push(ch);
    } else word += ch;
  }
  flush();
  return out;
}

export class StaticEmbedder implements Embedder {
  readonly dims: number;
  private readonly ids = new Map<string, number>();
  private readonly cache = new Map<string, Float32Array>();

  constructor(
    vocab: string[],
    dims: number,
    private readonly scales: Float32Array,
    private readonly data: Int8Array,
  ) {
    this.dims = dims;
    vocab.forEach((t, i) => this.ids.set(t, i));
  }

  /** WordPiece: greedy longest-prefix match; a word that can't be fully split is unknown (dropped). */
  tokenIds(text: string): number[] {
    const out: number[] = [];
    for (const word of basicTokens(text)) {
      if (word.length > 100) continue;
      const pieces: number[] = [];
      let start = 0;
      let ok = true;
      while (start < word.length) {
        let end = word.length;
        let found = -1;
        while (start < end) {
          const sub = (start > 0 ? "##" : "") + word.slice(start, end);
          const id = this.ids.get(sub);
          if (id !== undefined) {
            found = id;
            break;
          }
          end--;
        }
        if (found < 0) {
          ok = false;
          break;
        }
        pieces.push(found);
        start = end;
      }
      if (ok) out.push(...pieces);
    }
    return out;
  }

  embed(text: string): Float32Array {
    const hit = this.cache.get(text);
    if (hit) return hit;
    const v = new Float32Array(this.dims);
    const ids = this.tokenIds(text);
    for (const id of ids) {
      const s = this.scales[id]!;
      const row = id * this.dims;
      for (let d = 0; d < this.dims; d++) v[d]! += this.data[row + d]! * s;
    }
    let n = 0;
    for (let d = 0; d < this.dims; d++) n += v[d]! * v[d]!;
    n = Math.sqrt(n);
    if (n > 0) for (let d = 0; d < this.dims; d++) v[d]! /= n;
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(text, v);
    return v;
  }
}

/** Build an embedder from the files written by scripts/make-m2v.mjs. */
export function loadEmbedder(bin: ArrayBuffer, vocabText: string): StaticEmbedder {
  const view = new DataView(bin);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "M2V1") throw new Error("Not a Model2Vec model file");
  const rows = view.getUint32(4, true);
  const dims = view.getUint32(8, true);
  const scales = new Float32Array(bin.slice(12, 12 + rows * 4));
  const data = new Int8Array(bin, 12 + rows * 4, rows * dims);
  const vocab = vocabText.split("\n");
  if (vocab.length !== rows) throw new Error(`Model has ${rows} rows but ${vocab.length} vocab entries`);
  return new StaticEmbedder(vocab, dims, scales, data);
}
