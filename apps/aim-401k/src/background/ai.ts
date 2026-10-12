import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { AiUsage, LocalAiDetection, LocalAiServer } from "../shared/messages";
import { AI_DATA_CONSENT, cleanApiKey, isLocalAi, preset } from "../shared/providers";
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
  /** Extra Firefox data-collection consents this task needs (e.g. email contents). */
  consent?: string[];
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
    // A stored key is only ever paired with that provider's own endpoint: an override
    // pointing somewhere else must bring its own key (never leak a key to another host).
    key: cleanApiKey(override?.key ?? (override?.baseUrl !== undefined ? "" : (s.apiKeys[provider] ?? ""))),
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
  void countRequest(r.provider);
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
    if (e instanceof Anthropic.APIConnectionError) throw new AiError(unreachable(r, e));
    if (e instanceof Anthropic.APIError && typeof e.status === "number") {
      const retry = retryAfterSeconds(e.headers?.get?.("retry-after") ?? null);
      throw new AiError(describeHttpError(e.status, e.message, r, retry));
    }
    throw new AiError(unreachable(r, e));
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
    const raw = (await res.json()) as unknown;
    // Gemini sometimes wraps the error object in an array.
    const b = (Array.isArray(raw) ? raw[0] : raw) as { error?: { message?: string } | string; message?: string } | undefined;
    detail = typeof b?.error === "string" ? b.error : (b?.error?.message ?? b?.message ?? "");
  } catch {
    /* not JSON */
  }
  return new AiError(describeHttpError(res.status, detail, r, retryAfterSeconds(res.headers.get("retry-after"))));
}

// ---------------------------------------------------------------------------
// Friendlier failures: one line a person can act on, per common problem.

type Who = Pick<Resolved, "provider" | "model"> & { baseUrl?: string };

/** "5 s", "3 min", "2 h". */
export function humanWait(seconds: number): string {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} s`;
  if (seconds < 90 * 60) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} h`;
}

/** Seconds from a Retry-After header (delta-seconds or an HTTP date). */
export function retryAfterSeconds(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Number(v);
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.max(0, Math.ceil((t - now) / 1000));
}

/** Map an HTTP failure from any provider to one human line. */
export function describeHttpError(status: number, detail: string, r: Who, retryAfter?: number | null): string {
  const name = preset(r.provider).name;
  const d = detail.replace(/\s+/g, " ").trim().slice(0, 160);
  const tail = d ? ` (${d})` : "";
  if (r.provider === "ollama" && status === 403) {
    return "Ollama is running but refused AIM-401k. Quit Ollama and start it again with OLLAMA_ORIGINS=moz-extension://* set (see Settings → AI).";
  }
  const keyProblem = /api[ _-]?key|unauthori[sz]ed|invalid.{0,20}(key|token)|credential|authenticat/i.test(d);
  if (status === 401 || status === 403 || (status === 400 && keyProblem)) {
    return `${name} rejected the API key. Check it was copied completely, or create a new one.${tail}`;
  }
  if (status === 402) return `${name} says payment is required. Add credits, or switch to a free model or provider.${tail}`;
  if (status === 404) return `${name} doesn't offer the model “${r.model}”. Click “Test & load models” and pick one from the list.`;
  if (status === 408 || status === 504) return `${name} timed out. Try again, or pick a smaller, faster model.`;
  if (status === 413 || (status === 400 && /context|too long|too large|too many tokens|maximum.{0,20}tokens|token limit/i.test(d))) {
    return `That request is too long for “${r.model}”. Pick a model with a bigger context window, or shorten the resume text.`;
  }
  if (status === 429) {
    const quota = /quota|per day|daily|exhausted/i.test(d) ? " You may have used today's free quota; it resets daily." : "";
    const wait = retryAfter ? ` Try again in ${humanWait(retryAfter)}.` : " Wait a minute and try again.";
    return `${name} rate limit reached. Free tiers allow a limited number of requests per minute and per day.${quota}${wait}`;
  }
  if (status >= 500) return `${name} is having trouble right now (error ${status}). Try again in a minute.`;
  return `${name} error ${status}${d ? `: ${d}` : ""}`;
}

/** Network-level failure: nothing answered. */
export function unreachable(r: Who, e: unknown): string {
  const why = e instanceof Error ? e.message : String(e);
  if (r.provider === "ollama") return `Couldn't reach Ollama at ${r.baseUrl || "localhost:11434"}. Is Ollama running on this computer?`;
  if (r.provider === "custom") return `Couldn't reach the server at ${r.baseUrl || "(no base URL set)"}. Is it running, and is the base URL right? (${why})`.slice(0, 240);
  return `Couldn't reach ${preset(r.provider).name}. Check your internet connection. (${why})`.slice(0, 240);
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

/** Longest Retry-After we wait out before retrying a 429 once. */
const RETRY_CAP_S = 20;
const DEFAULT_RETRY_S = 2;

async function openAiJson<T>(r: Resolved, task: AiTask<T>): Promise<T> {
  const schema = JSON.stringify(z.toJSONSchema(task.schema));
  const messages = [
    { role: "system", content: `${task.system}\n\nRespond with a single JSON object that matches this JSON Schema, and nothing else:\n${schema}` },
    { role: "user", content: [...task.context, task.prompt].join("\n\n") },
  ];
  let jsonMode = true;
  const call = () => {
    void countRequest(r.provider);
    return fetch(`${r.baseUrl}/chat/completions`, {
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
  };

  let res: Response;
  try {
    res = await call();
    // Some models/providers reject response_format; retry once without it.
    if (res.status === 400) {
      jsonMode = false;
      res = await call();
    }
    // Per-minute limits on free tiers: wait as told (when it's short) and retry once.
    if (res.status === 429) {
      const wait = retryAfterSeconds(res.headers.get("retry-after")) ?? DEFAULT_RETRY_S;
      if (wait <= RETRY_CAP_S) {
        await new Promise((ok) => setTimeout(ok, wait * 1000));
        res = await call();
      }
    }
  } catch (e) {
    throw new AiError(unreachable(r, e));
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
  if (!(await aiConsentGranted(r, task.consent))) {
    throw new AiError(
      `Firefox hasn't been given permission to share your data with ${preset(r.provider).name}. Click “Test & load models” in Settings → AI to allow it, or allow it under about:addons → AIM-401k → Permissions.`,
    );
  }
  return r.provider === "anthropic" ? anthropicJson(r, s, task) : openAiJson(r, task);
}

/**
 * Firefox 140+ built-in data consent: online AI providers need the optional
 * data-collection permissions the user grants from the AI setup screen.
 * Browsers without built-in consent (Chromium, older Firefox) report no
 * `data_collection` and aren't gated; their consent is the explicit AI opt-in.
 */
export async function aiConsentGranted(r: Pick<Resolved, "provider" | "baseUrl">, extra: string[] = []): Promise<boolean> {
  if (isLocalAi(r.provider, r.baseUrl)) return true;
  const g = globalThis as unknown as { browser?: typeof browser; chrome?: typeof browser };
  const perms = (g.browser ?? g.chrome)?.permissions;
  if (!perms?.getAll) return true;
  try {
    const all = await perms.getAll();
    if (!all || !("data_collection" in all)) return true;
    const granted = new Set<string>(all.data_collection ?? []);
    return [...AI_DATA_CONSENT, ...extra].every((c) => granted.has(c));
  } catch {
    return true;
  }
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
    throw new AiError(unreachable(r, e));
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

// ---------------------------------------------------------------------------
// Requests today, per provider, so the setup screen can show "Requests today: N"
// next to the free-tier limits. Kept in memory and in storage.local under one
// key that only ever holds today's counts.

export const AI_USAGE_KEY = "aiUsage";
let usage: AiUsage | null = null;
let usageChain: Promise<unknown> = Promise.resolve();

/** Local calendar day, "YYYY-MM-DD". */
export function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Looked up lazily (not via shared/api) so this module still loads in unit tests.
function usageStore(): browser.storage.StorageArea | undefined {
  const g = globalThis as unknown as { browser?: typeof browser; chrome?: typeof browser };
  return (g.browser ?? g.chrome)?.storage?.local;
}

function withUsage<T>(fn: (u: AiUsage) => T | Promise<T>): Promise<T> {
  const run = async () => {
    const day = localDay();
    if (usage?.day !== day) {
      let stored: AiUsage | undefined;
      try {
        stored = ((await usageStore()?.get(AI_USAGE_KEY)) as Record<string, AiUsage | undefined> | undefined)?.[AI_USAGE_KEY];
      } catch {
        /* storage unavailable: memory only */
      }
      usage = { day, counts: stored?.day === day ? { ...stored.counts } : {} };
    }
    return fn(usage);
  };
  const p = usageChain.then(run, run);
  usageChain = p.catch(() => undefined);
  return p;
}

/** Count one request sent to a provider today. */
export function countRequest(provider: ProviderId): Promise<void> {
  return withUsage(async (u) => {
    u.counts[provider] = (u.counts[provider] ?? 0) + 1;
    try {
      await usageStore()?.set({ [AI_USAGE_KEY]: u });
    } catch {
      /* memory only */
    }
  });
}

export function getAiUsage(): Promise<AiUsage> {
  return withUsage((u) => ({ day: u.day, counts: { ...u.counts } }));
}

/** Drop the in-memory counts (after a wipe removed the stored ones). */
export function resetAiUsage(): void {
  usage = null;
}

// ---------------------------------------------------------------------------
// Local model servers: offer them when they're already running.

export const OLLAMA_TAGS_URL = "http://localhost:11434/api/tags";
export const LMSTUDIO_MODELS_URL = "http://localhost:1234/v1/models";

async function probe(url: string, baseUrl: string, pick: (body: unknown) => string[], timeoutMs: number): Promise<LocalAiServer> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const none: LocalAiServer = { reachable: false, forbidden: false, baseUrl, models: [] };
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (res.status === 403) return { ...none, forbidden: true };
    if (!res.ok) return none;
    const body: unknown = await res.json().catch(() => ({}));
    return { reachable: true, forbidden: false, baseUrl, models: [...new Set(pick(body))] };
  } catch {
    return none;
  } finally {
    clearTimeout(timer);
  }
}

/** Is Ollama (port 11434) or LM Studio (port 1234) running on this computer? Probed in parallel. */
export async function detectLocalAi(timeoutMs = 1500): Promise<LocalAiDetection> {
  const [ollama, lmstudio] = await Promise.all([
    probe(
      OLLAMA_TAGS_URL,
      "http://localhost:11434/v1",
      (b) => ((b as { models?: { name?: string; model?: string }[] }).models ?? []).map((m) => (m.name ?? m.model ?? "").replace(/:latest$/, "")).filter(Boolean),
      timeoutMs,
    ),
    probe(
      LMSTUDIO_MODELS_URL,
      "http://localhost:1234/v1",
      (b) => ((b as { data?: { id?: string }[] }).data ?? []).map((m) => m.id ?? "").filter((id) => id && !/embed/i.test(id)),
      timeoutMs,
    ),
  ]);
  return { ollama, lmstudio };
}
