import { describe, expect, it } from "vitest";
import { chooseOption, isPlaceholderOption } from "../src/core/choose";
import { findAnswer, upsertAnswer } from "../src/core/answerBank";

describe("chooseOption", () => {
  it("matches exactly, ignoring case and punctuation", () => {
    expect(chooseOption("united states", ["Canada", "United States"])).toBe(1);
  });
  it("does not confuse male with female", () => {
    expect(chooseOption("Male", ["Female", "Male"])).toBe(1);
    expect(chooseOption("Female", ["Male", "Female"])).toBe(1);
  });
  it("maps yes/no", () => {
    expect(chooseOption("Yes", ["No, I do not", "Yes, I do"])).toBe(1);
    expect(chooseOption("no", ["Yes", "Not sure", "No"])).toBe(2);
  });
  it("matches by containment and overlap", () => {
    expect(chooseOption("Bachelor's", ["High school", "Bachelor's Degree", "Master's Degree"])).toBe(1);
    expect(chooseOption("Something unrelated", ["Yes", "No"])).toBe(-1);
  });
  it("detects placeholders", () => {
    expect(isPlaceholderOption("Select...")).toBe(true);
    expect(isPlaceholderOption("--")).toBe(true);
    expect(isPlaceholderOption("Please select")).toBe(true);
    expect(isPlaceholderOption("Yes")).toBe(false);
  });
});

describe("answer bank", () => {
  it("upserts by normalized question", () => {
    let bank = upsertAnswer([], { id: "a", question: "Why us?", answer: "1", source: "user", updatedAt: 0 });
    bank = upsertAnswer(bank, { id: "b", question: "why US *", answer: "2", source: "user", updatedAt: 1 });
    expect(bank).toHaveLength(1);
    expect(findAnswer("Why us", bank)?.answer).toBe("2");
  });
  it("does not fuzzy-match short or different questions", () => {
    const bank = [{ id: "a", question: "Do you have a driver's license?", answer: "Yes", source: "user" as const, updatedAt: 0 }];
    expect(findAnswer("Do you have a security clearance?", bank)).toBeNull();
  });
});
