import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { preset } from "../shared/providers";
import type { ProviderId, Settings } from "../shared/types";

// One entry point for every AI task, whatever provider the user connected.
// Claude goes through the Anthropic SDK; every other provider speaks the
// OpenAI-compatible /chat/completions API, so one small fetch client covers
// Gemini, Groq, OpenRouter, GitHub Models, Mistral, Ollama and custom servers.
// Keys only ever live here in the background script.

export class AiError extends Error {}

export interface AiTask<T> {
  schema: z.ZodType<T>;
  system: string;
  /** Large stable context (profile, resume, job post) placed before the prompt. */
  context: string[];
  prompt: string;
  maxTokens?: number;
}

interface Resolved {
  provider: ProviderId;
  key: string;
  model: string;
  baseUrl: string;
}

export function resolveProvider(s: Settings, override?: Partial<Resolved>): Resolved {
  const provider = override?.provider ?? s.aiProvider;
  const p = preset(provider);
  const baseUrl = (override?.baseUrl ?? (provider === "custom" || (provider === "ollama" && s.customBaseUrl) ? s.customBaseUrl : p.baseUrl)).replace(/\/+$/, "");
  return {
    provider,
    key: override?.key ?? s.apiKeys[provider] ?? "",
    model: override?.model ?? s.models[provider] ?? p.defaultModel,
    baseUrl: baseUrl || p.baseUrl,
  };
}

export function aiReady(s: Settings): boolean {
  const r = resolveProvider(s);
  return (!preset(r.provider).needsKey || !!r.key) && !!r.model && (r.provider === "anthropic" || !!r.baseUrl);
}

// ---------------------------------------------------------------------------
// Anthropic

const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1"]);

async function anthropicJson<T>(r: Resolved, s: Settings, task: AiTask<T>): Promise<T> {
  const client = new Anthropic({ apiKey: r.key, dangerouslyAllowBrowser: true, maxRetries: 2 });
  try {
    const res = await client.beta.messages.parse({
      model: r.model,
      max_tokens: task.maxTokens ?? 8000,
      ...(FALLBACK_MODELS.has(r.model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      output_config: { effort: s.effort, format: betaZodOutputFormat(task.schema) },
      system: [{ type: "text", text: task.system }],
      messages: [
        {
          role: "user",
          content: [
            // Stable context first, each block cached so repeated questions on
            // the same profile/job only pay for the new question.
            ...task.context.map((text) => ({ type: "text" as const, text, cache_control: { type: "ephemeral" as const } })),
            { type: "text" as const, text: task.prompt },
          ],
        },
      ],
    });
    if (res.stop_reason === "refusal") throw new AiError("The AI declined this request");
    if (res.stop_reason === "max_tokens") throw new AiError("AI answer was cut off");
    if (!res.parsed_output) throw new AiError("AI returned no usable answer");
    return res.parsed_output as T;
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new AiError("Invalid Anthropic API key");
    if (e instanceof Anthropic.RateLimitError) throw new AiError("Rate limited — try again shortly");
    if (e instanceof Anthropic.NotFoundError) throw new AiError(`Model “${r.model}” not found`);
    if (e instanceof Anthropic.APIError) throw new AiError(`Anthropic error ${e.status ?? ""}: ${e.message}`.slice(0, 200));
    throw new AiError(`Couldn't reach Anthropic: ${String(e)}`.slice(0, 200));
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible providers

function headers(r: Resolved): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (r.key) h.authorization = `Bearer ${r.key}`;
  if (r.provider === "openrouter") {
    h["HTTP-Referer"] = "https://github.com/AaronDoubert/SLOP";
    h["X-Title"] = "AIM-401k";
  }
  return h;
}

async function httpError(res: Response, r: Resolved): Promise<AiError> {
  let detail = "";
  try {
    const body = (await res.json()) as { error?: { message?: string } | string; message?: string };
    detail = typeof body.error === "string" ? body.error : (body.error?.message ?? body.message ?? "");
  } catch {
    /* not JSON */
  }
  const name = preset(r.provider).name;
  if (res.status === 401 || res.status === 403) {
    if (r.provider === "ollama") return new AiError("Ollama refused the connection. Start it with OLLAMA_ORIGINS=moz-extension://* (see Settings → AI).");
    return new AiError(`${name} rejected the API key${detail ? `: ${detail}` : ""}`);
  }
  if (res.status === 429) return new AiError(`${name} rate limit reached — free tiers allow a limited number of requests per minute/day`);
  if (res.status === 404) return new AiError(`${name}: model “${r.model}” not found${detail ? ` (${detail})` : ""}`);
  return new AiError(`${name} error ${res.status}${detail ? `: ${detail}` : ""}`.slice(0, 240));
}

/** Pull a JSON object out of a model reply (tolerates ```json fences and chatter). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiError("AI reply wasn't JSON");
  return JSON.parse(body.slice(start, end + 1));
}

async function openAiJson<T>(r: Resolved, task: AiTask<T>): Promise<T> {
  const schema = JSON.stringify(z.toJSONSchema(task.schema));
  const messages = [
    { role: "system", content: `${task.system}\n\nRespond with a single JSON object that matches this JSON Schema, and nothing else:\n${schema}` },
    { role: "user", content: [...task.context, task.prompt].join("\n\n") },
  ];
  const call = (jsonMode: boolean) =>
    fetch(`${r.baseUrl}/chat/completions`, {
      method: "POST",
      headers: headers(r),
      body: JSON.stringify({
        model: r.model,
        messages,
        max_tokens: task.maxTokens ?? 4000,
        temperature: 0.3,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });

  let res: Response;
  try {
    res = await call(true);
    // Some models/providers reject response_format; retry once without it.
    if (res.status === 400) res = await call(false);
  } catch (e) {
    throw new AiError(`Couldn't reach ${preset(r.provider).name} at ${r.baseUrl}: ${String(e)}`.slice(0, 240));
  }
  if (!res.ok) throw await httpError(res, r);
  const data = (await res.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[] };
  const content = data.choices?.[0]?.message?.content ?? "";
  if (!content) throw new AiError("AI returned an empty reply");
  const parsed = task.schema.safeParse(extractJson(content));
  if (!parsed.success) throw new AiError("AI reply didn't match the expected format");
  return parsed.data;
}

// ---------------------------------------------------------------------------

export async function completeJson<T>(s: Settings, task: AiTask<T>, override?: Partial<Resolved>): Promise<T> {
  const r = resolveProvider(s, override);
  if (preset(r.provider).needsKey && !r.key) throw new AiError(`Add a ${preset(r.provider).name} API key in Settings → AI`);
  if (!r.model) throw new AiError("Pick a model in Settings → AI");
  return r.provider === "anthropic" ? anthropicJson(r, s, task) : openAiJson(r, task);
}

/** Model ids the provider offers (filtered to free ones where that matters). */
export async function listModels(s: Settings, override?: Partial<Resolved>): Promise<string[]> {
  const r = resolveProvider(s, override);
  const filter = preset(r.provider).modelFilter;
  if (r.provider === "anthropic") {
    const client = new Anthropic({ apiKey: r.key, dangerouslyAllowBrowser: true });
    const ids: string[] = [];
    for await (const m of client.models.list()) ids.push(m.id);
    return ids;
  }
  const res = await fetch(`${r.baseUrl}/models`, { headers: headers(r) }).catch((e: unknown) => {
    throw new AiError(`Couldn't reach ${preset(r.provider).name}: ${String(e)}`);
  });
  if (!res.ok) throw await httpError(res, r);
  const data = (await res.json()) as { data?: { id: string }[]; models?: { name?: string; id?: string }[] } | { id: string }[];
  const list = Array.isArray(data) ? data : (data.data ?? data.models ?? []);
  const ids = list.map((m) => ("id" in m && m.id ? m.id : ((m as { name?: string }).name ?? "")).replace(/^models\//, "")).filter(Boolean);
  return [...new Set(filter ? ids.filter((id) => filter.test(id)) : ids)].sort();
}

const Ping = z.object({ ok: z.boolean() });

/** Round-trip check used by the "Test" buttons. */
export async function testConnection(s: Settings, override?: Partial<Resolved>): Promise<{ ok: boolean; message: string; models: string[] }> {
  let models: string[] = [];
  try {
    models = await listModels(s, override);
  } catch {
    /* listing is optional; the real test is a completion */
  }
  const r = resolveProvider(s, override);
  const model = r.model || models[0] || "";
  try {
    await completeJson(s, { schema: Ping, system: "You are a connectivity check.", context: [], prompt: 'Reply with {"ok": true}.', maxTokens: 300 }, { ...override, model });
    return { ok: true, message: `Connected to ${preset(r.provider).name} (${model})`, models };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e), models };
  }
}
