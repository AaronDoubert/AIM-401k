// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { resolveField } from "../src/core/matcher";
import { fillField } from "../src/content/fill";
import { isFilled, scanFields } from "../src/content/scan";
import { ctx, profile } from "./helpers";

function load(name: string): void {
  const html = readFileSync(join(__dirname, "fixtures", name), "utf8");
  document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/^<!doctype html>/i, "");
}

describe("scanFields on a Greenhouse-style form", () => {
  beforeEach(() => load("apply.html"));

  it("finds every question with the right label, kind and required flag", () => {
    const fields = scanFields();
    const byLabel = Object.fromEntries(fields.map((f) => [f.info.label, f.info]));
    expect(byLabel["First Name"]).toMatchObject({ kind: "text", required: true });
    expect(byLabel["Phone"]).toMatchObject({ kind: "tel", required: false });
    expect(byLabel["Resume/CV"]).toMatchObject({ kind: "file", required: true });
    expect(byLabel["Will you now or in the future require sponsorship for employment visa status?"]).toMatchObject({
      kind: "radio",
      options: ["Yes", "No"],
      required: true,
    });
    expect(byLabel["Are you legally authorized to work in the United States?"]?.options).toEqual(["Yes", "No"]);
    expect(byLabel["I certify that the information provided is true and complete."]).toMatchObject({ kind: "checkbox", required: true });
  });

  it("fills resolvable fields so they read back as filled", async () => {
    for (const f of scanFields()) {
      const r = resolveField(f.info, profile, [], ctx);
      if (r.type === "value") expect(await fillField(f, r.value, profile.resume)).toBe(true);
    }
    const after = Object.fromEntries(scanFields().map((f) => [f.info.label, isFilled(f)]));
    expect(after["First Name"]).toBe(true);
    expect(after["Email"]).toBe(true);
    expect(after["Will you now or in the future require sponsorship for employment visa status?"]).toBe(true);
    expect((document.querySelector("input[name=sponsor]:checked") as HTMLInputElement).value).toBe("n");
    expect(after["Why do you want to work at Acme Robotics?"]).toBe(false);
  });

  it("fires input/change events that controlled components listen for", async () => {
    const seen: string[] = [];
    const el = document.getElementById("email")!;
    el.addEventListener("input", () => seen.push("input"));
    el.addEventListener("change", () => seen.push("change"));
    const f = scanFields().find((x) => x.info.label === "Email")!;
    await fillField(f, "ada@example.com", null);
    expect(seen).toEqual(["input", "change"]);
  });
});
