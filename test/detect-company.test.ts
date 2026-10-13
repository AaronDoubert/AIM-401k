// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { companyFromTitle, extractMeta } from "../src/content/detect";

function page(url: string, title: string, body = "<main><h1>Backend Engineer</h1></main>"): void {
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(url);
  document.documentElement.innerHTML = `<head><title>${title}</title></head><body>${body}</body>`;
}

describe("companyFromTitle", () => {
  it.each([
    ["Backend Engineer at Initech", "Initech"],
    ["Backend Engineer - Initech", "Initech"],
    ["Initech | Careers", "Initech"],
    ["Careers at Initech", "Initech"],
    ["Jobs – Initech", "Initech"],
    ["Backend Engineer at Initech | Careers", "Initech"],
    ["Data Engineer | Globex Careers", "Globex"],
    ["Careers", ""],
    ["Apply", ""],
    ["", ""],
  ])("%s -> %s", (title, want) => expect(companyFromTitle(title)).toBe(want));
});

describe("extractMeta company on local hosts", () => {
  it("uses the title for an IP host", () => {
    page("http://127.0.0.1:8080/jobs/1", "Backend Engineer at Initech");
    expect(extractMeta().company).toBe("Initech");
  });
  it("falls back to Localhost, never the IP", () => {
    page("http://127.0.0.1:8080/jobs/1", "Apply");
    expect(extractMeta().company).toBe("Localhost");
    page("http://localhost:3000/", "");
    expect(extractMeta().company).toBe("Localhost");
  });
  it("keeps the host for real sites", () => {
    page("https://www.example-corp.com/jobs/1", "Backend Engineer at Initech");
    expect(extractMeta().company).toBe("example-corp.com");
  });
  it("still prefers og:site_name on a fixture served locally", () => {
    const html = readFileSync(join(__dirname, "fixtures", "apply.html"), "utf8").replace(/<script[\s\S]*?<\/script>/g, "").replace(/^<!doctype html>/i, "");
    (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL("http://127.0.0.1:9000/apply.html");
    document.documentElement.innerHTML = html;
    expect(extractMeta().company).toBe("Acme Robotics");
  });
});
