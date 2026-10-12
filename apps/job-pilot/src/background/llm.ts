import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { DraftRequest, DraftResult } from "../shared/messages";
import type { AnswerEntry, Profile, Settings } from "../shared/types";

const Draft = z.object({
  answer: z.string().describe("The exact text to put in the field. Empty if you cannot answer."),
  needs_human: z.boolean().describe("True if the candidate must answer this themselves."),
  reason: z.string().describe("One short sentence: why a human is needed, or what the answer is based on."),
});

const SYSTEM = `You fill out job applications on behalf of a candidate, one question at a time.

Rules:
- Use only facts from the candidate profile, resume, and saved answers. Never invent employers, dates, degrees, certifications, numbers, links, or personal circumstances.
- If the question asks for a fact you don't have, a legal attestation, a signature, references, or anything the candidate should personally decide, set needs_human to true and leave answer empty.
- For choice questions, answer must be exactly one of the listed options (for multi-select, options separated by "; ").
- For free-text questions, write in the candidate's first-person voice, specific to this company and role, plain and professional with no clichés. Short fields: a phrase or one sentence. Long fields: 80-180 words unless the question asks otherwise.
- Never answer EEO / demographic questions differently from what the profile states.`;

/** Profile fields worth giving the model (drops file data and EEO answers). */
function candidateFacts(p: Profile, answers: AnswerEntry[]): string {
  const { resume: _r, resumeText, coverLetterTemplate: _c, gender: _g, race: _ra, hispanicLatino: _h, veteranStatus: _v, disabilityStatus: _d, ...rest } = p;
  const facts = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== "" && v != null));
  const saved = answers
    .filter((a) => a.source === "user")
    .slice(0, 40)
    .map((a) => `Q: ${a.question}\nA: ${a.answer}`)
    .join("\n\n");
  return [
    `<profile>\n${JSON.stringify(facts, null, 2)}\n</profile>`,
    resumeText ? `<resume>\n${resumeText}\n</resume>` : "<resume>(not provided)</resume>",
    saved ? `<saved_answers>\n${saved}\n</saved_answers>` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1"]);

export async function draftAnswer(req: DraftRequest, profile: Profile, answers: AnswerEntry[], settings: Settings): Promise<DraftResult> {
  if (!settings.anthropicApiKey) return { answer: null, needsHuman: true, reason: "AI drafting needs an API key (Options → AI)" };

  // The key never leaves the background script; content scripts only see results.
  const client = new Anthropic({ apiKey: settings.anthropicApiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });

  const question = [
    `Question: ${req.question}`,
    `Field type: ${req.inputType}${req.required ? " (required)" : ""}`,
    req.options.length ? `Options:\n${req.options.map((o) => `- ${o}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const job = `<job>\nCompany: ${req.meta.company}\nTitle: ${req.meta.title}\nLocation: ${req.meta.location}\n\n${req.meta.description}\n</job>`;

  const useFallback = FALLBACK_MODELS.has(settings.model);
  try {
    const res = await client.beta.messages.parse({
      model: settings.model,
      max_tokens: 8000,
      ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      output_config: { effort: settings.effort, format: betaZodOutputFormat(Draft) },
      system: [
        { type: "text", text: SYSTEM },
        // Stable per candidate: cached across every question and job.
        { type: "text", text: candidateFacts(profile, answers), cache_control: { type: "ephemeral" } },
      ],
      messages: [
        {
          role: "user",
          content: [
            // Stable per job: cached across the questions on one application.
            { type: "text", text: job, cache_control: { type: "ephemeral" } },
            { type: "text", text: question },
          ],
        },
      ],
    });

    if (res.stop_reason === "refusal") return { answer: null, needsHuman: true, reason: "The AI declined this question" };
    if (res.stop_reason === "max_tokens") return { answer: null, needsHuman: true, reason: "AI answer was cut off" };
    const out = res.parsed_output;
    if (!out) return { answer: null, needsHuman: true, reason: "AI returned no usable answer" };
    const answer = out.answer.trim();
    return { answer: answer || null, needsHuman: out.needs_human || !answer, reason: out.reason };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { answer: null, needsHuman: true, reason: "AI: invalid API key" };
    if (e instanceof Anthropic.RateLimitError) return { answer: null, needsHuman: true, reason: "AI: rate limited, try again shortly" };
    if (e instanceof Anthropic.APIError) return { answer: null, needsHuman: true, reason: `AI error ${e.status ?? ""}: ${e.message}`.slice(0, 200) };
    return { answer: null, needsHuman: true, reason: `AI unavailable: ${String(e)}`.slice(0, 200) };
  }
}
