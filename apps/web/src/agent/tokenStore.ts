import { LOCAL_PROVIDER_ID, PROVIDER_BY_ID } from "./providers";

export interface ProviderCreds {
  token: string;
  baseUrl?: string;
  model?: string;
}

export interface AgentSettings {
  activeProviderId: string; // "local" or a ProviderDef id
  creds: Record<string, ProviderCreds>;
}

const STORAGE_KEY = "condenser.agent.settings.v1";

function defaults(): AgentSettings {
  return { activeProviderId: LOCAL_PROVIDER_ID, creds: {} };
}

function load(): AgentSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw) as Partial<AgentSettings>;
    return {
      activeProviderId: parsed.activeProviderId ?? LOCAL_PROVIDER_ID,
      creds: parsed.creds ?? {},
    };
  } catch {
    return defaults();
  }
}

/**
 * Tiny observable settings store backed by localStorage. Tokens never leave
 * the browser unless an LLM request is made to the provider the user selected.
 */
class TokenStore {
  private settings: AgentSettings = load();
  private listeners = new Set<() => void>();

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  getSnapshot = (): AgentSettings => this.settings;

  private persist(next: AgentSettings): void {
    this.settings = next;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage may be unavailable (private mode) — keep in-memory */
    }
    for (const l of this.listeners) l();
  }

  setActiveProvider(id: string): void {
    this.persist({ ...this.settings, activeProviderId: id });
  }

  getCreds(providerId: string): ProviderCreds {
    return this.settings.creds[providerId] ?? { token: "" };
  }

  setCreds(providerId: string, creds: Partial<ProviderCreds>): void {
    const existing = this.settings.creds[providerId] ?? { token: "" };
    const merged: ProviderCreds = { ...existing, ...creds };
    this.persist({
      ...this.settings,
      creds: { ...this.settings.creds, [providerId]: merged },
    });
  }

  clearCreds(providerId: string): void {
    const nextCreds = { ...this.settings.creds };
    delete nextCreds[providerId];
    this.persist({ ...this.settings, creds: nextCreds });
  }

  /** Resolve the effective model for a provider (override → provider default). */
  resolvedModel(providerId: string): string {
    const def = PROVIDER_BY_ID[providerId];
    const creds = this.getCreds(providerId);
    return creds.model || def?.defaultModel || "";
  }

  /** Resolve the effective base URL for a provider (override → provider default). */
  resolvedBaseUrl(providerId: string): string {
    const def = PROVIDER_BY_ID[providerId];
    const creds = this.getCreds(providerId);
    return (creds.baseUrl || def?.defaultBaseUrl || "").replace(/\/$/, "");
  }
}

export const tokenStore = new TokenStore();

/** Mask a secret for display: keep a short prefix/suffix. */
export function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 8) return "•".repeat(token.length);
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}
