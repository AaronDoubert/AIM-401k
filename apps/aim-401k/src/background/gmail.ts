// Gmail API with the user's own OAuth client (BYO, optional). Read-only scope.
// The access token lives in memory and browser.storage.session (cleared when
// the browser closes) — never in storage.local, never in exports.
// OWNER: Intel agent.
import { api } from "../shared/api";
import type { RawMail } from "../shared/types";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_QUERY = "newer_than:30d (application OR applying OR interview OR candidate OR position OR offer OR assessment)";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GmailError extends Error {}
/** The token was rejected (expired or revoked): the user has to sign in again. */
export class GmailAuthError extends GmailError {}

export interface GmailToken {
  token: string;
  expiresAt: number;
}

/** What the settings page shows; kept in storage.session next to the token. */
export interface GmailStatus {
  connected: boolean;
  expiresAt: number;
  lastSync: number;
  error: string;
  /** We already told the user the link was lost (don't repeat every 30 min). */
  lostNotified: boolean;
}

export const TOKEN_KEY = "gmailToken";
export const STATUS_KEY = "gmailStatus";
const EMPTY_STATUS: GmailStatus = { connected: false, expiresAt: 0, lastSync: 0, error: "", lostNotified: false };

// ---------------------------------------------------------------------------
// pure helpers (unit-tested)

export function buildAuthUrl(o: { clientId: string; redirectUri: string; state: string; silent?: boolean }): string {
  const u = new URL(AUTH_URL);
  u.searchParams.set("client_id", o.clientId.trim());
  u.searchParams.set("response_type", "token");
  u.searchParams.set("redirect_uri", o.redirectUri);
  u.searchParams.set("scope", GMAIL_SCOPE);
  u.searchParams.set("state", o.state);
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("prompt", o.silent ? "none" : "consent");
  return u.toString();
}

const OAUTH_ERRORS: Record<string, string> = {
  access_denied: "Access was denied in the Google window.",
  interaction_required: "Google needs you to sign in again.",
  login_required: "Google needs you to sign in again.",
  consent_required: "Google needs you to approve access again.",
  invalid_client: "Google doesn't recognise that client ID. Check it was copied completely.",
  unauthorized_client: "This client ID isn't allowed to use this sign-in flow. Make sure its type is “Web application”.",
  invalid_scope: "The Gmail read-only scope was refused.",
};

/** Read access_token / expires_in (or an error) from the OAuth redirect URL. */
export function parseAuthRedirect(url: string, expectedState: string, now = Date.now()): GmailToken {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new GmailError("Google sent back an unreadable sign-in result.");
  }
  const frag = new URLSearchParams(u.hash.replace(/^#/, ""));
  const params = ["access_token", "error", "state"].some((k) => frag.has(k)) ? frag : u.searchParams;
  const error = params.get("error");
  if (error) throw new GmailError(OAUTH_ERRORS[error] ?? `Google sign-in failed: ${error}${params.get("error_description") ? ` (${params.get("error_description")})` : ""}`);
  if (expectedState && params.get("state") !== expectedState) throw new GmailError("Sign-in response didn't match this request. Try again.");
  const token = params.get("access_token");
  if (!token) throw new GmailError("Google didn't return an access token.");
  const ttl = Number(params.get("expires_in"));
  const seconds = Number.isFinite(ttl) && ttl > 0 ? ttl : 3600;
  return { token, expiresAt: now + Math.max(60, seconds - 60) * 1000 };
}

export function listUrl(query = GMAIL_QUERY, max = 50): string {
  const u = new URL(`${API}/messages`);
  u.searchParams.set("q", query);
  u.searchParams.set("maxResults", String(max));
  return u.toString();
}

export function messageUrl(id: string): string {
  const u = new URL(`${API}/messages/${encodeURIComponent(id)}`);
  u.searchParams.set("format", "metadata");
  for (const h of ["From", "Subject", "Date"]) u.searchParams.append("metadataHeaders", h);
  return u.toString();
}

/** `"Acme Robotics" <jobs@acme.com>` → name + address. */
export function parseFrom(value: string): { name: string; email: string } {
  const v = value.trim();
  const m = v.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1]!.replace(/\\"/g, '"').trim() || m[2]!.trim(), email: m[2]!.trim().toLowerCase() };
  return { name: v.includes("@") ? "" : v, email: v.includes("@") ? v.toLowerCase() : "" };
}

/** Gmail snippets are HTML-escaped ("We&#39;d love to…"). */
export function decodeEntities(s: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return named[e.toLowerCase()] ?? m;
  });
}

export interface GmailMessage {
  id: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: { name: string; value: string }[] };
}

export function toRawMail(m: GmailMessage): RawMail {
  const header = (n: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? "";
  const { name, email } = parseFrom(header("From"));
  const internal = Number(m.internalDate);
  const dated = Date.parse(header("Date"));
  return {
    messageId: m.id,
    from: name,
    fromEmail: email,
    subject: header("Subject").trim(),
    snippet: decodeEntities(m.snippet ?? "").replace(/\s+/g, " ").trim(),
    receivedAt: Number.isFinite(internal) && internal > 0 ? internal : Number.isFinite(dated) ? dated : Date.now(),
  };
}

// ---------------------------------------------------------------------------
// token + status (memory, mirrored to storage.session when the browser has it)

let memToken: GmailToken | null = null;
let memStatus: GmailStatus = { ...EMPTY_STATUS };
const session = () => (api.storage as { session?: browser.storage.StorageArea }).session;

export async function getToken(): Promise<GmailToken | null> {
  if (!memToken) {
    try {
      memToken = ((await session()?.get(TOKEN_KEY)) as Record<string, GmailToken | undefined> | undefined)?.[TOKEN_KEY] ?? null;
    } catch {
      /* no session storage */
    }
  }
  return memToken && memToken.expiresAt > Date.now() ? memToken : null;
}

async function saveToken(t: GmailToken | null): Promise<void> {
  memToken = t;
  try {
    if (t) await session()?.set({ [TOKEN_KEY]: t });
    else await session()?.remove(TOKEN_KEY);
  } catch {
    /* memory only */
  }
}

export async function getStatus(): Promise<GmailStatus> {
  try {
    const s = ((await session()?.get(STATUS_KEY)) as Record<string, GmailStatus | undefined> | undefined)?.[STATUS_KEY];
    if (s) memStatus = { ...EMPTY_STATUS, ...s };
  } catch {
    /* memory only */
  }
  return memStatus;
}

export async function setStatus(patch: Partial<GmailStatus>): Promise<GmailStatus> {
  memStatus = { ...(await getStatus()), ...patch };
  try {
    await session()?.set({ [STATUS_KEY]: memStatus });
  } catch {
    /* memory only */
  }
  return memStatus;
}

function randomState(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function redirectUri(): string {
  return api.identity?.getRedirectURL?.() ?? "";
}

/**
 * Sign in through Google's implicit flow in a browser-managed window.
 * `interactive: false` tries a silent refresh (works while the Google session
 * is alive and consent was given before).
 */
export async function signIn(clientId: string, interactive: boolean): Promise<GmailToken> {
  if (!clientId.trim()) throw new GmailError("Paste your OAuth client ID first.");
  if (!api.identity?.launchWebAuthFlow) throw new GmailError("This browser doesn't support extension sign-in (identity API missing).");
  const state = randomState();
  const url = buildAuthUrl({ clientId, redirectUri: redirectUri(), state, silent: !interactive });
  let redirect: string;
  try {
    redirect = await api.identity.launchWebAuthFlow({ url, interactive });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new GmailError(
      interactive
        ? `Sign-in didn't finish (${msg}). If Google showed “redirect_uri_mismatch”, the redirect URI in your OAuth client must be exactly ${redirectUri()}`
        : "Silent sign-in failed",
    );
  }
  const tok = parseAuthRedirect(redirect, state);
  await saveToken(tok);
  await setStatus({ connected: true, expiresAt: tok.expiresAt, error: "", lostNotified: false });
  return tok;
}

/** Forget the token (and revoke it at Google, best effort). */
export async function signOut(revoke = true): Promise<void> {
  const t = memToken ?? (await getToken());
  await saveToken(null);
  await setStatus({ connected: false, expiresAt: 0 });
  if (revoke && t) {
    void fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t.token)}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    }).catch(() => undefined);
  }
}

/** A usable token: the stored one, else a silent refresh, else null. */
export async function validToken(clientId: string): Promise<GmailToken | null> {
  const t = await getToken();
  if (t) return t;
  if (!clientId.trim()) return null;
  try {
    return await signIn(clientId, false);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// API calls

async function gget<T>(url: string, token: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  } catch (e) {
    throw new GmailError(`Couldn't reach Gmail: ${String(e)}`.slice(0, 200));
  }
  if (res.status === 401) throw new GmailAuthError("Gmail sign-in expired or was revoked.");
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? "";
    } catch {
      /* not JSON */
    }
    if (res.status === 403) throw new GmailError(`Gmail refused the request${detail ? `: ${detail}` : ""}. Check the Gmail API is enabled in your Google Cloud project.`.slice(0, 300));
    if (res.status === 429) throw new GmailError("Gmail rate limit reached; it will retry on the next sync.");
    throw new GmailError(`Gmail error ${res.status}${detail ? `: ${detail}` : ""}`.slice(0, 240));
  }
  return (await res.json()) as T;
}

/** Recent job-ish messages not in `known`, as RawMail (metadata + snippet only). */
export async function fetchRecent(token: string, known: Set<string>, max = 50): Promise<RawMail[]> {
  const list = await gget<{ messages?: { id: string }[] }>(listUrl(GMAIL_QUERY, max), token);
  const ids = (list.messages ?? []).map((m) => m.id).filter((id) => id && !known.has(id));
  const out: RawMail[] = [];
  for (let i = 0; i < ids.length; i += 5) {
    const batch = await Promise.all(
      ids.slice(i, i + 5).map((id) =>
        gget<GmailMessage>(messageUrl(id), token).then(toRawMail, (e: unknown) => {
          if (e instanceof GmailAuthError) throw e;
          return null; // one bad message shouldn't sink the sync
        }),
      ),
    );
    for (const m of batch) if (m) out.push(m);
  }
  return out;
}
