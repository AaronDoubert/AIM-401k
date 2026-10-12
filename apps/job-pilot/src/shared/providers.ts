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
    notes: "One key, many models. JobPilot lists only the free ones; click “Test & load models” to pick one.",
    modelFilter: /:free$/,
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
