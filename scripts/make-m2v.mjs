#!/usr/bin/env node
// Converts a Model2Vec static embedding model (https://github.com/MinishLab/model2vec)
// into the small files the extension ships in static/models/. Run once at authoring
// time; the output is checked in.
//
//   M=minishlab/potion-base-8M; mkdir -p /tmp/m2v
//   for f in tokenizer.json model.safetensors; do curl -sSL -o /tmp/m2v/$f https://huggingface.co/$M/resolve/main/$f; done
//   node scripts/make-m2v.mjs /tmp/m2v [out-dir]
//
// Output:
//   static/models/m2v.vocab.txt  one WordPiece token per line, in id order
//   static/models/m2v.bin        "M2V1", u32 rows, u32 dims, f32[rows] scales, i8[rows*dims]
//
// Each row is quantized to int8 with its own scale (|x| max / 127): a quarter of
// the float32 size, with cosine similarities within ~0.002 of the original.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const src = resolve(process.argv[2] || "/tmp/m2v");
const out = resolve(process.argv[3] || join(dirname(fileURLToPath(import.meta.url)), "..", "static", "models"));

const tok = JSON.parse(readFileSync(join(src, "tokenizer.json"), "utf8"));
if (tok.model?.type !== "WordPiece") throw new Error(`Expected a WordPiece tokenizer, got ${tok.model?.type}`);
const vocab = Object.entries(tok.model.vocab).sort((a, b) => a[1] - b[1]);
vocab.forEach(([, id], i) => {
  if (id !== i) throw new Error(`Vocab ids are not contiguous at ${i}`);
});
if (vocab.some(([t]) => t.includes("\n"))) throw new Error("A token contains a newline");

const st = readFileSync(join(src, "model.safetensors"));
const headerLen = Number(st.readBigUInt64LE(0));
const header = JSON.parse(st.subarray(8, 8 + headerLen).toString("utf8"));
const t = header.embeddings;
if (!t || t.dtype !== "F32") throw new Error("Expected an F32 'embeddings' tensor");
const [rows, dims] = t.shape;
if (rows !== vocab.length) throw new Error(`Embedding rows (${rows}) != vocab size (${vocab.length})`);
const base = 8 + headerLen + t.data_offsets[0];
const f32 = new Float32Array(st.buffer.slice(st.byteOffset + base, st.byteOffset + base + rows * dims * 4));

const scales = new Float32Array(rows);
const q = new Int8Array(rows * dims);
for (let r = 0; r < rows; r++) {
  let max = 0;
  for (let d = 0; d < dims; d++) max = Math.max(max, Math.abs(f32[r * dims + d]));
  const s = max / 127 || 1;
  scales[r] = s;
  for (let d = 0; d < dims; d++) q[r * dims + d] = Math.round(f32[r * dims + d] / s);
}

const head = Buffer.alloc(12);
head.write("M2V1", 0, "ascii");
head.writeUInt32LE(rows, 4);
head.writeUInt32LE(dims, 8);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "m2v.bin"), Buffer.concat([head, Buffer.from(scales.buffer), Buffer.from(q.buffer)]));
writeFileSync(join(out, "m2v.vocab.txt"), vocab.map(([w]) => w).join("\n"));
console.log(`wrote ${rows}×${dims} model to ${out}`);
