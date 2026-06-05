// Provider registry for the agent. Each provider maps onto one of three
// "wire formats" (request/response shapes): Anthropic Messages, OpenAI
// Chat Completions, or Google Gemini generateContent. Most hosted LLM APIs
// are OpenAI-compatible, so a single wire covers many of them.

export type WireFormat = "anthropic" | "openai" | "gemini";

export interface ProviderDef {
  id: string;
  label: string;
  wire: WireFormat;
  /** Default API base URL (no trailing slash). */
  defaultBaseUrl: string;
  /** Suggested model ids (the field is free-text, these are just hints). */
  models: string[];
  defaultModel: string;
  /** Label for the credential field. */
  tokenLabel: string;
  /** Placeholder / format hint for the token. */
  tokenHint?: string;
  /** Whether a token is required to make calls (false for local servers). */
  requiresToken: boolean;
  /** Whether the base URL is meant to be edited by the user. */
  editableBaseUrl: boolean;
  docsUrl?: string;
  notes?: string;
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: "anthropic",
    label: "Anthropic — Claude",
    wire: "anthropic",
    defaultBaseUrl: "https://api.anthropic.com",
    models: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
    defaultModel: "claude-sonnet-4-6",
    tokenLabel: "API Key",
    tokenHint: "sk-ant-…",
    requiresToken: true,
    editableBaseUrl: false,
    docsUrl: "https://docs.anthropic.com",
    notes:
      "Direct browser calls use the anthropic-dangerous-direct-browser-access header.",
  },
  {
    id: "openai",
    label: "OpenAI",
    wire: "openai",
    defaultBaseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o4-mini"],
    defaultModel: "gpt-4o-mini",
    tokenLabel: "API Key",
    tokenHint: "sk-…",
    requiresToken: true,
    editableBaseUrl: false,
    docsUrl: "https://platform.openai.com/docs",
    notes: "Browser CORS is restricted; may require a proxy in production.",
  },
  {
    id: "google",
    label: "Google — Gemini",
    wire: "gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    models: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
    defaultModel: "gemini-2.0-flash",
    tokenLabel: "API Key",
    tokenHint: "AIza…",
    requiresToken: true,
    editableBaseUrl: false,
    docsUrl: "https://ai.google.dev",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    wire: "openai",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    models: [
      "anthropic/claude-3.5-sonnet",
      "openai/gpt-4o-mini",
      "google/gemini-2.0-flash-001",
      "meta-llama/llama-3.3-70b-instruct",
    ],
    defaultModel: "anthropic/claude-3.5-sonnet",
    tokenLabel: "API Key",
    tokenHint: "sk-or-…",
    requiresToken: true,
    editableBaseUrl: false,
    docsUrl: "https://openrouter.ai/docs",
    notes: "Aggregator — one key, hundreds of models. CORS-friendly.",
  },
  {
    id: "groq",
    label: "Groq",
    wire: "openai",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    models: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "mixtral-8x7b-32768",
    ],
    defaultModel: "llama-3.3-70b-versatile",
    tokenLabel: "API Key",
    tokenHint: "gsk_…",
    requiresToken: true,
    editableBaseUrl: false,
    docsUrl: "https://console.groq.com/docs",
  },
  {
    id: "mistral",
    label: "Mistral",
    wire: "openai",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    models: ["mistral-large-latest", "mistral-small-latest", "open-mistral-nemo"],
    defaultModel: "mistral-large-latest",
    tokenLabel: "API Key",
    requiresToken: true,
    editableBaseUrl: false,
    docsUrl: "https://docs.mistral.ai",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    wire: "openai",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
    defaultModel: "deepseek-chat",
    tokenLabel: "API Key",
    requiresToken: true,
    editableBaseUrl: false,
    docsUrl: "https://api-docs.deepseek.com",
  },
  {
    id: "xai",
    label: "xAI — Grok",
    wire: "openai",
    defaultBaseUrl: "https://api.x.ai/v1",
    models: ["grok-2-latest", "grok-2-mini"],
    defaultModel: "grok-2-latest",
    tokenLabel: "API Key",
    tokenHint: "xai-…",
    requiresToken: true,
    editableBaseUrl: false,
    docsUrl: "https://docs.x.ai",
  },
  {
    id: "together",
    label: "Together AI",
    wire: "openai",
    defaultBaseUrl: "https://api.together.xyz/v1",
    models: [
      "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      "Qwen/Qwen2.5-72B-Instruct-Turbo",
    ],
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    tokenLabel: "API Key",
    requiresToken: true,
    editableBaseUrl: false,
    docsUrl: "https://docs.together.ai",
  },
  {
    id: "fireworks",
    label: "Fireworks AI",
    wire: "openai",
    defaultBaseUrl: "https://api.fireworks.ai/inference/v1",
    models: ["accounts/fireworks/models/llama-v3p3-70b-instruct"],
    defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    tokenLabel: "API Key",
    requiresToken: true,
    editableBaseUrl: false,
    docsUrl: "https://docs.fireworks.ai",
  },
  {
    id: "perplexity",
    label: "Perplexity",
    wire: "openai",
    defaultBaseUrl: "https://api.perplexity.ai",
    models: ["sonar", "sonar-pro"],
    defaultModel: "sonar",
    tokenLabel: "API Key",
    tokenHint: "pplx-…",
    requiresToken: true,
    editableBaseUrl: false,
    docsUrl: "https://docs.perplexity.ai",
  },
  {
    id: "azure-openai",
    label: "Azure OpenAI",
    wire: "openai",
    defaultBaseUrl: "https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT",
    models: ["gpt-4o", "gpt-4o-mini"],
    defaultModel: "gpt-4o-mini",
    tokenLabel: "API Key",
    requiresToken: true,
    editableBaseUrl: true,
    notes:
      "Set the base URL to your deployment endpoint. Auth uses the api-key header.",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    wire: "openai",
    defaultBaseUrl: "http://localhost:11434/v1",
    models: ["llama3.2", "qwen2.5", "mistral"],
    defaultModel: "llama3.2",
    tokenLabel: "API Key (optional)",
    requiresToken: false,
    editableBaseUrl: true,
    docsUrl: "https://ollama.com",
    notes: "Runs locally — no token needed. Make sure `ollama serve` is up.",
  },
  {
    id: "lmstudio",
    label: "LM Studio (local)",
    wire: "openai",
    defaultBaseUrl: "http://localhost:1234/v1",
    models: ["local-model"],
    defaultModel: "local-model",
    tokenLabel: "API Key (optional)",
    requiresToken: false,
    editableBaseUrl: true,
    docsUrl: "https://lmstudio.ai",
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    wire: "openai",
    defaultBaseUrl: "https://your-endpoint.example/v1",
    models: ["your-model"],
    defaultModel: "your-model",
    tokenLabel: "API Key",
    requiresToken: false,
    editableBaseUrl: true,
    notes: "Point at any OpenAI-compatible /chat/completions endpoint.",
  },
];

export const PROVIDER_BY_ID: Record<string, ProviderDef> = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, p])
);

export const LOCAL_PROVIDER_ID = "local";
