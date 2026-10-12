import { describe, expect, it } from "vitest";
import { resolveField } from "../src/core/matcher";
import { ctx, field, profile } from "./helpers";
import type { AnswerEntry } from "../src/shared/types";

const val = (label: string, over = {}, bank: AnswerEntry[] = []) => {
  const r = resolveField(field(label, over), profile, bank, ctx);
  return r.type === "value" ? r.value : r.type;
};

describe("resolveField", () => {
  it("fills identity fields from the profile", () => {
    expect(val("First Name *")).toBe("Ada");
    expect(val("Last name (required)")).toBe("Lovelace");
    expect(val("Full name")).toBe("Ada Lovelace");
    expect(val("Name")).toBe("Ada Lovelace");
    expect(val("Preferred first name")).toBe("Ada");
    expect(val("Email address")).toBe("ada@example.com");
    expect(val("Phone")).toBe("555-0100");
    expect(val("LinkedIn Profile")).toBe("https://linkedin.com/in/ada");
    expect(val("Current company")).toBe("Analytical Engines");
    expect(val("Location (City)")).toBe("Austin, Texas");
  });

  it("uses autocomplete attributes when the label is unhelpful", () => {
    expect(val("", { autocomplete: "given-name" })).toBe("Ada");
    expect(val("", { attrs: "last name" })).toBe("Lovelace");
  });

  it("maps yes/no profile answers onto option text", () => {
    const opts = ["Yes, I am authorized", "No, I am not authorized"];
    expect(val("Are you legally authorized to work in the United States?", { kind: "radio", options: opts })).toBe(
      "Yes, I am authorized",
    );
    expect(val("Will you now or in the future require visa sponsorship?", { kind: "select", options: ["Yes", "No"] })).toBe("No");
  });

  it("does not assume work authorization for other countries", () => {
    expect(val("Are you authorized to work in Canada?", { kind: "select", options: ["Yes", "No"] })).toBe("unknown");
  });

  it("picks decline options for EEO questions", () => {
    expect(
      val("Gender", { kind: "select", options: ["Male", "Female", "Non-binary", "I don't wish to answer"] }),
    ).toBe("I don't wish to answer");
    expect(val("Veteran Status", { kind: "radio", options: ["I am a veteran", "I am not a veteran", "Prefer not to say"] })).toBe(
      "Prefer not to say",
    );
  });

  it("does not answer choice questions it cannot map", () => {
    expect(val("Have you attended college?", { kind: "radio", options: ["Yes", "No"] })).toBe("unknown");
  });

  it("routes signatures and consent to the human", () => {
    expect(resolveField(field("Signature"), profile, [], ctx)).toMatchObject({ type: "human", kind: "signature" });
    expect(
      resolveField(field("I certify that the information provided is true and complete", { kind: "checkbox" }), profile, [], ctx),
    ).toMatchObject({ type: "human", kind: "consent" });
  });

  it("remembers consent once given", () => {
    const bank: AnswerEntry[] = [
      { id: "1", question: "I agree to the privacy policy", answer: "checked", source: "user", updatedAt: 0 },
    ];
    expect(val("I agree to the Privacy Policy *", { kind: "checkbox" }, bank)).toBe("checked");
  });

  it("prefers saved answers over profile rules and tolerates rewording", () => {
    const bank: AnswerEntry[] = [
      { id: "1", question: "Why do you want to work at Acme?", answer: "Because engines.", source: "user", updatedAt: 0 },
      { id: "2", question: "Are you legally authorized to work in the US for any employer?", answer: "Yes", source: "user", updatedAt: 0 },
    ];
    expect(val("Why do you want to work at Acme? *", { kind: "textarea" }, bank)).toBe("Because engines.");
    expect(val("Are you legally authorized to work in the U.S. for any employer?", { kind: "select", options: ["Yes", "No"] }, bank)).toBe("Yes");
  });

  it("fills the cover letter template", () => {
    expect(val("Cover Letter", { kind: "textarea" })).toBe("Dear Acme, I want the Staff Engineer role. — Ada");
  });

  it("uploads the resume to resume file inputs", () => {
    expect(resolveField(field("Resume/CV", { kind: "file" }), profile, [], ctx)).toEqual({ type: "resume" });
    expect(resolveField(field("Cover letter", { kind: "file", required: false }), profile, [], ctx)).toEqual({ type: "unknown" });
  });

  it("leaves open-ended questions unknown", () => {
    expect(val("Tell us about a project you are proud of", { kind: "textarea" })).toBe("unknown");
    expect(val("How many years of Python experience do you have?")).toBe("unknown");
  });
});
