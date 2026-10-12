import type { Job } from "../shared/types";

function cell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const iso = (t: number | null) => (t ? new Date(t).toISOString().slice(0, 10) : "");

export function jobsToCsv(jobs: Job[]): string {
  const header = ["company", "title", "location", "status", "applied", "added", "ats", "url", "notes"];
  const rows = jobs.map((j) => [j.company, j.title, j.location, j.status, iso(j.appliedAt), iso(j.createdAt), j.ats, j.url, j.notes].map(cell).join(","));
  return [header.join(","), ...rows].join("\n");
}

/** Pull http(s) URLs out of pasted text (one per line, or mixed with other text). */
export function extractUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
  return [...new Set(found.map((u) => u.replace(/[),.;]+$/, "")))];
}
