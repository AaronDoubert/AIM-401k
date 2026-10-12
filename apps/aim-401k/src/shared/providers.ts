import type { ProviderId } from "./types";

export interface ProviderPreset {
  id: ProviderId;
  name: string;
  /** OpenAI-compatible base URL (unused for anthropic). */
  baseUrl: string;
  defaultModel: string;
  /** Where to get a key. */
  keyUrl: string;
  signIn: string;
  cost: string;
  needsKey: boolean;
  /** Shown before connecting. */
  notes: string;
  /** Only list models whose id matches (e.g. OpenRouter's free ones). */
  modelFilter?: RegExp;
  /** "Recommended path" badge shown on the provider card. */
  badge?: string;
  /** What this provider's keys look like (used to warn, never to block). */
  keyShape?: { test: RegExp; hint: string };
}

// Free-tier details change often; the UI links to each provider's own page.
export const PROVIDERS: ProviderPreset[] = [
  {
    id: "gemini",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-flash-latest",
    keyUrl: "https://aistudio.google.com/apikey",
    signIn: "Your Google account",
    cost: "Free tier (rate-limited, no card)",
    needsKey: true,
    notes: "Easiest start: sign in with Google, click “Create API key”. On the free tier Google may use prompts to improve its products.",
    badge: "Easiest free start",
    keyShape: { test: /^AIza[0-9A-Za-z_-]{30,}$/, hint: "Gemini keys start with “AIza” and are 39 characters long" },
  },
  {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    keyUrl: "https://console.groq.com/keys",
    signIn: "Google, GitHub or email",
    cost: "Free tier (rate-limited, no card)",
    needsKey: true,
    notes: "Very fast open models. Free limits are per model and per minute.",
    keyShape: { test: /^gsk_[0-9A-Za-z]{20,}$/, hint: "Groq keys start with “gsk_”" },
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "",
    keyUrl: "https://openrouter.ai/keys",
    signIn: "Google, GitHub or email",
    cost: "Free “:free” models (20/min, 50/day; 1,000/day after a one-time $10 top-up)",
    needsKey: true,
    notes: "One key, many models. AIM-401k lists only the free ones; click “Test & load models” to pick one.",
    modelFilter: /:free$/,
    keyShape: { test: /^sk-or-[0-9A-Za-z-]{20,}$/, hint: "OpenRouter keys start with “sk-or-”" },
  },
  {
    id: "github",
    name: "GitHub Models",
    baseUrl: "https://models.github.ai/inference",
    defaultModel: "openai/gpt-4.1-mini",
    keyUrl: "https://github.com/settings/personal-access-tokens/new",
    signIn: "Your GitHub account",
    cost: "Free for prototyping (low daily limits)",
    needsKey: true,
    notes: "Create a fine-grained token with the “Models: read” permission and paste it as the key.",
    keyShape: { test: /^(github_pat_[0-9A-Za-z_]{20,}|ghp_[0-9A-Za-z]{30,})$/, hint: "GitHub tokens start with “github_pat_” (fine-grained) or “ghp_” (classic)" },
  },
  {
    id: "mistral",
    name: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-small-latest",
    keyUrl: "https://console.mistral.ai/api-keys",
    signIn: "Email or Google + phone verification",
    cost: "Free “Experiment” plan (no card)",
    needsKey: true,
    notes: "Free-plan requests may be used to train Mistral's models.",
    keyShape: { test: /^[0-9A-Za-z]{32}$/, hint: "Mistral keys are 32 letters and digits" },
  },
  {
    id: "ollama",
    name: "Ollama (on this computer)",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3.2",
    keyUrl: "https://ollama.com/download",
    signIn: "No account at all",
    cost: "Free, private, runs locally",
    needsKey: false,
    notes: "Install Ollama, run `ollama pull llama3.2`, and start it with OLLAMA_ORIGINS=moz-extension://* so the extension may connect.",
    badge: "Most private",
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    baseUrl: "",
    defaultModel: "claude-opus-5-5",
    keyUrl: "https://console.anthropic.com/settings/keys",
    signIn: "Email or Google",
    cost: "Paid (pay as you go)",
    needsKey: true,
    notes: "Highest quality drafting. Requires adding credits.",
    badge: "Best quality (paid)",
    keyShape: { test: /^sk-ant-[0-9A-Za-z_-]{20,}$/, hint: "Anthropic keys start with “sk-ant-”" },
  },
  {
    id: "custom",
    name: "Other (OpenAI-compatible)",
    baseUrl: "",
    defaultModel: "",
    keyUrl: "",
    signIn: "—",
    cost: "—",
    needsKey: false,
    notes: "Any server that speaks the OpenAI /chat/completions API (LM Studio, vLLM, Together, DeepSeek…).",
  },
];

export function preset(id: ProviderId): ProviderPreset {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]!;
}

// ---------------------------------------------------------------------------
// Key sanity checks: warn (never block) when a pasted key looks wrong.

export interface KeyCheck {
  /** The key with pasted whitespace, quotes and a "Bearer " prefix removed. */
  key: string;
  /** True when `key` differs from what was pasted. */
  cleaned: boolean;
  /** One line for the user, or null when the key looks fine. */
  warning: string | null;
}

/** Strip what usually sneaks in when copying a key: spaces, line breaks, quotes, `NAME_API_KEY=`, `Bearer `. */
export function cleanApiKey(raw: string): string {
  return raw
    .trim()
    .replace(/^["'`“”‘’]+/, "")
    .replace(/^(?:export\s+)?[A-Za-z_]*(?:KEY|TOKEN)\s*[:=]\s*/i, "")
    .replace(/^(?:Authorization:\s*)?Bearer\s+/i, "")
    .replace(/[\s\u200b-\u200d\ufeff]+/g, "")
    .replace(/^["'`“”‘’<]+|["'`“”‘’>,;]+$/g, "");
}

/** Check a key against the selected provider's shape (and spot keys for a different provider). */
export function checkApiKey(provider: ProviderId, raw: string): KeyCheck {
  const key = cleanApiKey(raw);
  const cleaned = key !== raw;
  const p = preset(provider);
  if (!key) return { key, cleaned, warning: null };
  if (!p.keyShape || p.keyShape.test.test(key)) {
    return { key, cleaned, warning: cleaned ? "Removed spaces or quotes that came along with the paste." : null };
  }
  const other = PROVIDERS.find((o) => o.id !== provider && o.keyShape && o.id !== "mistral" && o.keyShape.test.test(key));
  const warning = other
    ? `This looks like a ${other.name} key, but ${p.name} is selected.`
    : `This doesn't look like a ${p.name} key (${p.keyShape.hint}). Double-check it was copied completely.`;
  return { key, cleaned, warning };
}

// ---------------------------------------------------------------------------
// Firefox built-in data consent (Firefox 140+). Sending profile facts and job
// descriptions to an online AI provider is optional data transmission: it is
// declared as optional in the manifest and asked for before first use.
// Local servers (Ollama, LM Studio on localhost) transmit nothing.

/** Consent categories an AI request to an online provider involves. */
export const AI_DATA_CONSENT = ["personallyIdentifyingInfo", "websiteContent"] as const;

const LOCALHOST = /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?(\/|$)/i;

/** True when AI requests stay on this computer. */
export function isLocalAi(provider: ProviderId, baseUrl: string): boolean {
  if (provider === "ollama") return !baseUrl || LOCALHOST.test(baseUrl);
  return provider === "custom" && LOCALHOST.test(baseUrl);
}
