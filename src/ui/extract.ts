import * as pdfjs from "pdfjs-dist";
import { fromJsonResume, isJsonResume, parseResumeText, type ResumeData } from "../core/resumeParse";
import { unzipEntry } from "../core/zip";
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
      // Whitespace-only items span the gap between columns; skipping them keeps the gap
      // measurable, so "Company      City, ST" doesn't collapse into one run of words.
      if (!item.str.trim() && !item.hasEOL) continue;
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
