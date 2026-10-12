import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  aiConsentGranted,
  completeJson,
  countRequest,
  describeHttpError,
  detectLocalAi,
  getAiUsage,
  humanWait,
  localDay,
  resetAiUsage,
  resolveProvider,
  retryAfterSeconds,
  testConnection,
  unreachable,
} from "../src/background/ai";
import { normalizeSettings } from "../src/shared/defaults";
import { checkApiKey, cleanApiKey, isLocalAi, PROVIDERS } from "../src/shared/providers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetAiUsage();
});

describe("API key sanity checks", () => {
  const good = {
    gemini: "AIzaSyD-1234567890abcdefghijklmnopqrstu",
    groq: "gsk_abcdefghijklmnopqrstuvwxyz0123456789",
    openrouter: "sk-or-v1-0123456789abcdef0123456789abcdef",
    anthropic: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
    github: "github_pat_11ABCDEFG0123456789_abcdefghijklmnop",
    mistral: "abcdefghijklmnopqrstuvwxyz012345",
  } as const;

  it("accepts well-shaped keys silently", () => {
    for (const [provider, key] of Object.entries(good)) expect(checkApiKey(provider as keyof typeof good, key), provider).toEqual({ key, cleaned: false, warning: null });
    expect(checkApiKey("github", "ghp_abcdefghijklmnopqrstuvwxyz0123456789").warning).toBeNull();
  });

  it("strips pasted whitespace, quotes and prefixes", () => {
    expect(cleanApiKey(`  "${good.groq}"\n`)).toBe(good.groq);
    expect(cleanApiKey(`'${good.gemini}'`)).toBe(good.gemini);
    expect(cleanApiKey(`GEMINI_API_KEY=${good.gemini}`)).toBe(good.gemini);
    expect(cleanApiKey(`export GROQ_API_KEY="${good.groq}"`)).toBe(good.groq);
    expect(cleanApiKey(`Bearer ${good.openrouter}`)).toBe(good.openrouter);
    expect(cleanApiKey(`gsk_abc​def`)).toBe("gsk_abcdef");
    const c = checkApiKey("groq", ` ${good.groq} `);
    expect(c).toMatchObject({ key: good.groq, cleaned: true });
    expect(c.warning).toMatch(/Removed spaces or quotes/);
  });

  it("warns (doesn't block) on the wrong shape, and spots another provider's key", () => {
    expect(checkApiKey("gemini", "hello").warning).toMatch(/doesn't look like a Google Gemini key.*AIza/);
    expect(checkApiKey("gemini", good.groq).warning).toBe("This looks like a Groq key, but Google Gemini is selected.");
    expect(checkApiKey("anthropic", good.openrouter).warning).toMatch(/OpenRouter key/);
    expect(checkApiKey("mistral", "short").warning).toMatch(/32 letters/);
    expect(checkApiKey("ollama", "anything").warning).toBeNull();
    expect(checkApiKey("custom", "anything").warning).toBeNull();
    expect(checkApiKey("gemini", "").warning).toBeNull();
  });

  it("marks the recommended paths", () => {
    const badge = Object.fromEntries(PROVIDERS.filter((p) => p.badge).map((p) => [p.id, p.badge]));
    expect(badge).toEqual({ gemini: "Easiest free start", ollama: "Most private", anthropic: "Best quality (paid)" });
  });

  it("cleans stored keys before use", () => {
    const s = normalizeSettings({ aiProvider: "groq", apiKeys: { groq: ` "${good.groq}" ` } });
    expect(resolveProvider(s).key).toBe(good.groq);
  });
});

describe("friendly error messages", () => {
  const groq = { provider: "groq" as const, model: "llama-3.3-70b-versatile" };
  it("maps common HTTP failures to one human line", () => {
    expect(describeHttpError(401, "Invalid API Key", groq)).toBe("Groq rejected the API key. Check it was copied completely, or create a new one. (Invalid API Key)");
    expect(describeHttpError(400, "API key not valid. Please pass a valid API key.", { provider: "gemini", model: "x" })).toMatch(/^Google Gemini rejected the API key/);
    expect(describeHttpError(402, "", groq)).toMatch(/payment is required/);
    expect(describeHttpError(404, "", groq)).toBe("Groq doesn't offer the model “llama-3.3-70b-versatile”. Click “Test & load models” and pick one from the list.");
    expect(describeHttpError(413, "", groq)).toMatch(/too long for “llama-3.3-70b-versatile”/);
    expect(describeHttpError(400, "This model's maximum context length is 8192 tokens", groq)).toMatch(/too long/);
    expect(describeHttpError(503, "overloaded", groq)).toBe("Groq is having trouble right now (error 503). Try again in a minute.");
    expect(describeHttpError(418, "teapot", groq)).toBe("Groq error 418: teapot");
  });
  it("explains rate limits, quotas and when to retry", () => {
    expect(describeHttpError(429, "", groq, 30)).toBe("Groq rate limit reached. Free tiers allow a limited number of requests per minute and per day. Try again in 30 s.");
    expect(describeHttpError(429, "You exceeded your current quota", { provider: "gemini", model: "x" }, 7200)).toMatch(/used today's free quota.*Try again in 2 h\.$/);
    expect(describeHttpError(429, "", groq)).toMatch(/Wait a minute and try again\.$/);
  });
  it("explains Ollama's origin check and unreachable servers", () => {
    expect(describeHttpError(403, "", { provider: "ollama", model: "llama3.2" })).toMatch(/OLLAMA_ORIGINS=moz-extension:\/\/\*/);
    expect(unreachable({ provider: "ollama", model: "x", baseUrl: "http://localhost:11434/v1" }, new TypeError("NetworkError"))).toMatch(/Is Ollama running/);
    expect(unreachable({ provider: "custom", model: "x", baseUrl: "http://localhost:1234/v1" }, new TypeError("NetworkError"))).toMatch(/server at http:\/\/localhost:1234\/v1/);
    expect(unreachable({ provider: "groq", model: "x" }, new TypeError("NetworkError"))).toMatch(/Check your internet connection/);
  });
  it("parses Retry-After and formats waits", () => {
    expect(retryAfterSeconds("12")).toBe(12);
    expect(retryAfterSeconds("0.5")).toBe(0.5);
    expect(retryAfterSeconds(null)).toBeNull();
    expect(retryAfterSeconds("soon")).toBeNull();
    const now = Date.parse("2026-10-12T10:00:00Z");
    expect(retryAfterSeconds("Mon, 12 Oct 2026 10:01:00 GMT", now)).toBe(60);
    expect([humanWait(0.2), humanWait(45), humanWait(600), humanWait(5400)]).toEqual(["1 s", "45 s", "10 min", "2 h"]);
  });
});

// ---------------------------------------------------------------------------

const Ping = z.object({ ok: z.boolean() });
const settings = normalizeSettings({ aiProvider: "groq", apiKeys: { groq: "gsk_test" }, llmMode: "draft" });
const okReply = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok": true}' } }] }), { status: 200 });
const limited = (retryAfter: string | null, message = "Rate limit reached") =>
  new Response(JSON.stringify({ error: { message } }), { status: 429, headers: retryAfter == null ? {} : { "retry-after": retryAfter } });
const task = { schema: Ping, system: "s", context: [], prompt: "p" };

describe("OpenAI-compatible calls", () => {
  it("retries a 429 once after a short Retry-After", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(limited("0")).mockResolvedValueOnce(okReply());
    vi.stubGlobal("fetch", fetch);
    await expect(completeJson(settings, task)).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("doesn't wait out a long Retry-After, and says when to come back", async () => {
    const fetch = vi.fn().mockResolvedValue(limited("3600", "Requests per day exhausted"));
    vi.stubGlobal("fetch", fetch);
    await expect(completeJson(settings, task)).rejects.toThrow(/Groq rate limit reached.*free quota.*Try again in 60 min/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("gives up after one retry", async () => {
    const fetch = vi.fn().mockResolvedValue(limited("0"));
    vi.stubGlobal("fetch", fetch);
    await expect(completeJson(settings, task)).rejects.toThrow(/rate limit/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("turns network failures into a readable line", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("NetworkError when attempting to fetch resource.")));
    await expect(completeJson(settings, task)).rejects.toThrow(/Couldn't reach Groq\. Check your internet connection/);
  });

  it("keeps testConnection's shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (String(url).endsWith("/models") ? new Response(JSON.stringify({ data: [{ id: "m1" }] })) : okReply())),
    );
    await expect(testConnection(settings)).resolves.toEqual({ ok: true, message: "Connected to Groq (llama-3.3-70b-versatile)", models: ["m1"] });
  });
});

describe("requests today", () => {
  it("counts each request per provider for the local day", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(limited("0")).mockResolvedValueOnce(okReply()));
    await completeJson(settings, task);
    await countRequest("gemini");
    const u = await getAiUsage();
    expect(u).toEqual({ day: localDay(), counts: { groq: 2, gemini: 1 } });
  });

  it("persists to storage and starts over on a new day", async () => {
    const mem: Record<string, unknown> = { aiUsage: { day: "1999-01-01", counts: { groq: 40 } } };
    const local = {
      get: vi.fn(async (k: string) => ({ [k]: mem[k] })),
      set: vi.fn(async (o: Record<string, unknown>) => void Object.assign(mem, JSON.parse(JSON.stringify(o)))),
    };
    vi.stubGlobal("browser", { storage: { local } });
    await countRequest("groq");
    expect(mem.aiUsage).toEqual({ day: localDay(), counts: { groq: 1 } });
    // A fresh background (cache dropped) picks today's count back up from storage.
    resetAiUsage();
    await countRequest("groq");
    expect((await getAiUsage()).counts).toEqual({ groq: 2 });
  });

  it("formats the local day", () => {
    expect(localDay(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("Firefox built-in data consent", () => {
  const withGrant = (all: object) => vi.stubGlobal("browser", { permissions: { getAll: async () => all } });

  it("knows which providers stay on this computer", () => {
    expect(isLocalAi("ollama", "http://localhost:11434/v1")).toBe(true);
    expect(isLocalAi("ollama", "https://ollama.example.com/v1")).toBe(false);
    expect(isLocalAi("custom", "http://127.0.0.1:1234/v1")).toBe(true);
    expect(isLocalAi("custom", "https://api.together.xyz/v1")).toBe(false);
    expect(isLocalAi("groq", "http://localhost:1/v1")).toBe(false);
  });

  it("gates online providers on the optional data permissions (Firefox 140+)", async () => {
    const groq = { provider: "groq" as const, baseUrl: "https://api.groq.com/openai/v1" };
    withGrant({ permissions: [], origins: [], data_collection: [] });
    expect(await aiConsentGranted(groq)).toBe(false);
    expect(await aiConsentGranted({ provider: "ollama", baseUrl: "http://localhost:11434/v1" })).toBe(true);
    withGrant({ data_collection: ["personallyIdentifyingInfo", "websiteContent"] });
    expect(await aiConsentGranted(groq)).toBe(true);
    withGrant({ permissions: [], origins: [] }); // no built-in consent (Chromium, older Firefox)
    expect(await aiConsentGranted(groq)).toBe(true);
  });

  it("explains how to allow it instead of sending", async () => {
    withGrant({ data_collection: [] });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(completeJson(settings, task)).rejects.toThrow(/permission to share your data with Groq.*Test & load models/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("local model detection", () => {
  it("finds Ollama models and an LM Studio server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("11434")
          ? new Response(JSON.stringify({ models: [{ name: "llama3.2:latest" }, { name: "qwen2.5:7b" }] }))
          : new Response(JSON.stringify({ data: [{ id: "qwen2.5-7b-instruct" }, { id: "text-embedding-nomic-embed-text-v1.5" }] })),
      ),
    );
    expect(await detectLocalAi()).toEqual({
      ollama: { reachable: true, forbidden: false, baseUrl: "http://localhost:11434/v1", models: ["llama3.2", "qwen2.5:7b"] },
      lmstudio: { reachable: true, forbidden: false, baseUrl: "http://localhost:1234/v1", models: ["qwen2.5-7b-instruct"] },
    });
  });

  it("reports Ollama's 403 (OLLAMA_ORIGINS) and nothing listening", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("11434")) return new Response("", { status: 403 });
        throw new TypeError("NetworkError");
      }),
    );
    const d = await detectLocalAi();
    expect(d.ollama).toMatchObject({ reachable: false, forbidden: true, models: [] });
    expect(d.lmstudio).toMatchObject({ reachable: false, forbidden: false });
  });

  it("gives up after the timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_ok, fail) => init.signal?.addEventListener("abort", () => fail(new DOMException("aborted", "AbortError")))),
      ),
    );
    const t0 = Date.now();
    const d = await detectLocalAi(50);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(d.ollama.reachable).toBe(false);
    expect(d.lmstudio.reachable).toBe(false);
  });
});
