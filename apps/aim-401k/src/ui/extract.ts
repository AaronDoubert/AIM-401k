import * as pdfjs from "pdfjs-dist";
import { fromJsonResume, isJsonResume, parseResumeText, type ResumeData } from "../core/resumeParse";
import { api } from "../shared/api";

// Reads a resume file entirely in the browser: PDF (pdf.js), DOCX (unzip +
// document.xml), plain text/Markdown, or JSON Resume. Nothing is uploaded.

pdfjs.GlobalWorkerOptions.workerSrc = api.runtime.getURL("pdf.worker.min.mjs");

interface PdfTextItem {
  str: string;
  hasEOL?: boolean;
  transform: number[];
  width: number;
}

async function pdfText(buf: ArrayBuffer): Promise<string> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let out = "";
    let lastY: number | null = null;
    let lastEnd = 0;
    for (const raw of content.items) {
      const item = raw as PdfTextItem;
      if (!("str" in item)) continue;
      const x = item.transform[4] ?? 0;
      const y = item.transform[5] ?? 0;
      if (lastY != null && Math.abs(y - lastY) > 2) out += "\n";
      else if (lastY != null && item.str) {
        // Wide horizontal gaps separate columns ("Title        Mar 2021 – Present").
        const gap = x - lastEnd;
        if (gap > 12) out += "   ";
        else if (gap > 1 && !out.endsWith(" ") && !item.str.startsWith(" ")) out += " ";
      }
      out += item.str;
      lastY = y;
      lastEnd = x + item.width;
      if (item.hasEOL) {
        out += "\n";
        lastY = null;
      }
    }
    pages.push(out);
  }
  await doc.destroy();
  return pages.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}

// --- minimal ZIP reader (enough for .docx) ----------------------------------

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzipEntry(buf: ArrayBuffer, wanted: string): Promise<Uint8Array | null> {
  const v = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) return null;
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    if (name === wanted) {
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const data = new Uint8Array(buf, start, size);
      if (method === 0) return data;
      if (method === 8) return inflateRaw(data);
      return null;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

async function docxText(buf: ArrayBuffer): Promise<string> {
  const xml = await unzipEntry(buf, "word/document.xml");
  if (!xml) throw new Error("Couldn't read this .docx file");
  const s = new TextDecoder().decode(xml);
  const text = s
    .replace(/<w:tab\/>/g, "   ")
    .replace(/<w:br\/>|<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
  return text.replace(/\n{3,}/g, "\n\n");
}

export interface ExtractResult {
  text: string;
  data: ResumeData;
  kind: "pdf" | "docx" | "text" | "json";
}

export async function extractResume(file: File): Promise<ExtractResult> {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  if (name.endsWith(".json")) {
    const json: unknown = JSON.parse(new TextDecoder().decode(buf));
    if (!isJsonResume(json)) throw new Error("That JSON file isn't in JSON Resume format");
    const data = fromJsonResume(json);
    return { text: JSON.stringify(json, null, 2), data, kind: "json" };
  }
  let text: string;
  let kind: ExtractResult["kind"];
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    text = await pdfText(buf);
    kind = "pdf";
  } else if (name.endsWith(".docx")) {
    text = await docxText(buf);
    kind = "docx";
  } else if (name.endsWith(".doc")) {
    throw new Error("Old .doc files can't be read — save it as PDF or .docx");
  } else {
    text = new TextDecoder().decode(buf);
    kind = "text";
  }
  if (text.trim().length < 40) throw new Error("No text found — is this a scanned image? Try exporting the resume as a text-based PDF.");
  return { text, data: parseResumeText(text), kind };
}

export function fileToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
