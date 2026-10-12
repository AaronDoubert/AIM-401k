// Settings → Inbox intel (Gmail/Outlook tab readers, BYO Gmail API client).
// OWNER: Intel agent. Rendered into #intel-settings on the options page.
import type { GmailStatus } from "../background/gmail";
import type { SyncResult } from "../background/intel";
import { api } from "../shared/api";
import { normalizeSettings, STORAGE_KEYS } from "../shared/defaults";
import type { IntelSettings, Settings } from "../shared/types";
import { h, send, toast } from "./common";

type Ctx = { box: HTMLElement; settings: Settings; onChange: () => void };
let ctx: Ctx | null = null;
let status: Partial<GmailStatus> = {};
let message: { text: string; bad: boolean } | null = null;
let busy = false;
let wired = false;

const session = () => (api.storage as unknown as { session?: browser.storage.StorageArea }).session;
const time = (t: number) => (t ? new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");
const CLIENT_ID_RE = /^[\w-]+\.apps\.googleusercontent\.com$/;

function redirectUrl(): string {
  try {
    return api.identity?.getRedirectURL?.() ?? "";
  } catch {
    return "";
  }
}

/** Write intel fields straight to storage (so the background sees the client id without a full Save). */
async function persist(patch: Partial<IntelSettings>): Promise<void> {
  const raw = (await api.storage.local.get(STORAGE_KEYS.settings)) as { settings?: unknown };
  const stored = normalizeSettings(raw.settings);
  stored.intel = { ...stored.intel, ...patch };
  await api.storage.local.set({ [STORAGE_KEYS.settings]: stored });
}

async function loadStatus(): Promise<void> {
  try {
    const got = (await session()?.get("gmailStatus")) as { gmailStatus?: GmailStatus } | undefined;
    status = got?.gmailStatus ?? {};
  } catch {
    status = {};
  }
  draw();
}

function toggle(label: string, key: "gmailTab" | "outlookTab" | "autoStatus" | "useAi" | "gmailApi", hint = ""): HTMLElement {
  const c = ctx!;
  const input = h("input", { type: "checkbox", checked: !!c.settings.intel[key] });
  input.dataset.intel = key;
  input.addEventListener("change", () => {
    c.settings.intel[key] = input.checked;
    c.onChange();
  });
  return h("label", { className: "f check wide" }, input, h("span", {}, label, hint ? h("span", { className: "muted", textContent: ` ${hint}` }) : ""));
}

const link = (href: string, text: string) => h("a", { href, target: "_blank", rel: "noopener", textContent: text });
const step = (...kids: (Node | string)[]) => h("li", { style: "margin:4px 0" }, ...kids);
const code = (text: string) => h("code", { textContent: text });

async function run(label: string, fn: () => Promise<SyncResult | boolean>): Promise<void> {
  if (busy) return;
  busy = true;
  message = { text: label, bad: false };
  draw();
  try {
    const r = await fn();
    const c = ctx!;
    if (typeof r === "boolean") message = { text: "Disconnected. The token was forgotten and revoked.", bad: false };
    else if (r.ok) {
      c.settings.intel.lastSync = r.lastSync;
      message = { text: `Synced. ${r.added} new job email${r.added === 1 ? "" : "s"}.`, bad: false };
    } else message = { text: r.error ?? "Something went wrong.", bad: true };
  } catch (e) {
    message = { text: e instanceof Error ? e.message : String(e), bad: true };
  }
  busy = false;
  await loadStatus();
}

function gmailApiSection(): HTMLElement {
  const c = ctx!;
  const redirect = redirectUrl();
  const copyBtn = h("button", { type: "button", textContent: "Copy" });
  copyBtn.addEventListener("click", () => {
    void navigator.clipboard.writeText(redirect).then(
      () => toast("Redirect URI copied"),
      () => toast("Couldn't copy: select it and copy by hand"),
    );
  });

  const idInput = h("input", { value: c.settings.intel.gmailClientId, placeholder: "1234567890-abc123.apps.googleusercontent.com", autocomplete: "off", spellcheck: false });
  idInput.id = "intel-client-id";
  idInput.addEventListener("input", () => {
    c.settings.intel.gmailClientId = idInput.value.trim();
    c.onChange();
  });

  const connected = !!status.connected;
  const connectBtn = h("button", { type: "button", className: "primary", textContent: connected ? "Reconnect" : "Connect Gmail", disabled: busy });
  connectBtn.id = "intel-connect";
  connectBtn.addEventListener("click", () => {
    const id = idInput.value.trim();
    if (!CLIENT_ID_RE.test(id)) {
      message = { text: "That doesn't look like an OAuth client ID. It ends in .apps.googleusercontent.com (step 6).", bad: true };
      draw();
      return;
    }
    c.settings.intel.gmailClientId = id;
    void run("Opening Google sign-in…", async () => {
      await persist({ gmailClientId: id });
      const r = await send<SyncResult>({ type: "gmailConnect" });
      if (r?.connected) c.settings.intel.gmailApi = true; // the background turned sync on
      return r;
    });
  });
  const syncBtn = h("button", { type: "button", textContent: "Sync now", disabled: busy || !connected });
  syncBtn.addEventListener("click", () => void run("Syncing…", () => send<SyncResult>({ type: "intelSync" })));
  const disconnectBtn = h("button", { type: "button", className: "danger", textContent: "Disconnect", disabled: busy || (!connected && !c.settings.intel.gmailApi) });
  disconnectBtn.addEventListener("click", () =>
    void run("Disconnecting…", async () => {
      const r = await send<boolean>({ type: "gmailDisconnect" });
      c.settings.intel.gmailApi = false;
      return r;
    }),
  );

  const state = connected
    ? `Connected · last sync ${time(status.lastSync || c.settings.intel.lastSync)}${status.expiresAt ? ` · sign-in valid until ${time(status.expiresAt)}` : ""}`
    : c.settings.intel.gmailApi
      ? "Not connected right now (sign-in expired or the browser restarted)."
      : "Not connected.";
  const statusLine = h("div", { className: "muted", textContent: state });
  statusLine.id = "intel-gmail-state";
  const err = message ?? (status.error ? { text: status.error, bad: true } : null);
  const msgLine = err ? h("div", { className: `status ${err.bad ? "bad" : "ok"}`, textContent: err.text, style: "margin-top:6px" }) : "";

  const details = h(
    "details",
    { className: "card", style: "margin-top:12px", open: connected || !!c.settings.intel.gmailClientId },
    h("summary", { style: "cursor:pointer" }, h("b", { textContent: "Connect Gmail API (advanced, BYO)" }), h("span", { className: "muted", textContent: " · works even when Gmail isn't open" })),
    h(
      "p",
      {},
      "The tab reader only sees your inbox while Gmail is open. With the Gmail API, AIM-401k checks every 30 minutes on its own. It uses ",
      h("b", { textContent: "your own" }),
      " Google OAuth client, so no one else (not us, not a third-party service) is involved. Setup takes about 5 minutes:",
    ),
    h(
      "ol",
      { style: "padding-left:20px;margin:6px 0" },
      step("Open the ", link("https://console.cloud.google.com/projectcreate", "Google Cloud console"), " and create a new project (any name, e.g. “AIM-401k”)."),
      step("Enable the ", link("https://console.cloud.google.com/apis/library/gmail.googleapis.com", "Gmail API"), " for that project."),
      step(
        "Set up the ",
        link("https://console.cloud.google.com/apis/credentials/consent", "OAuth consent screen"),
        ": user type ",
        h("b", { textContent: "External" }),
        ", any app name, your email as support contact. Under ",
        h("b", { textContent: "Test users" }),
        ", add your own Gmail address. Leave the app in Testing.",
      ),
      step("Go to ", link("https://console.cloud.google.com/apis/credentials", "Credentials"), " → Create credentials → OAuth client ID → Application type ", h("b", { textContent: "Web application" }), "."),
      step(
        "Under ",
        h("b", { textContent: "Authorized redirect URIs" }),
        ", add exactly this URI:",
        h("div", { className: "row", style: "margin:6px 0" }, h("code", { textContent: redirect || "(not available in this browser)", style: "user-select:all;word-break:break-all" }), redirect ? copyBtn : ""),
      ),
      step("Click Create, copy the ", h("b", { textContent: "Client ID" }), " (it ends in ", code(".apps.googleusercontent.com"), ") and paste it below. You don't need the client secret."),
      step("Click ", h("b", { textContent: "Connect Gmail" }), ". Google warns that it hasn't verified the app. That's expected for your own test app: choose Continue and allow read-only access."),
    ),
    h("label", { className: "f", style: "margin-top:8px" }, "OAuth client ID", idInput),
    toggle("Sync every 30 minutes while connected", "gmailApi"),
    h("div", { className: "row", style: "margin-top:8px" }, connectBtn, syncBtn, disconnectBtn),
    statusLine,
    msgLine,
    h(
      "p",
      { className: "muted", style: "margin-top:10px" },
      "Privacy: read-only access (",
      code("gmail.readonly"),
      "). Only messages from the last 30 days that mention applications, interviews, offers and similar are fetched, and only their sender, subject, date and preview. They're sorted in this browser. The sign-in token is kept in memory for the session only. It's never saved to disk or included in exports, and Disconnect revokes it. Google sign-ins last about an hour; after that AIM-401k renews quietly while you're signed in to Google, or asks you to reconnect.",
    ),
  );
  return details;
}

function draw(): void {
  if (!ctx) return;
  const { box } = ctx;
  const readers = h(
    "div",
    { className: "card" },
    h(
      "p",
      { style: "margin-top:0" },
      "AIM-401k can keep your tracker up to date from your inbox: confirmations, interview requests, assessments, offers and rejections. Emails are read and sorted in this browser. Nothing is uploaded anywhere.",
    ),
    h(
      "div",
      { className: "grid" },
      toggle("Read Gmail while it's open in a tab", "gmailTab", "(mail.google.com)"),
      toggle("Read Outlook while it's open in a tab", "outlookTab", "(outlook.live.com, outlook.office.com)"),
      toggle("Update application statuses from matched emails", "autoStatus", "(Applied → Interviewing → Offer / Rejected; never backwards)"),
      toggle("Let my AI provider sort emails the rules aren't sure about", "useAi", "(optional, uses the provider set up under AI)"),
    ),
    h(
      "p",
      { className: "muted", style: "margin-bottom:0" },
      "The tab readers look only at the message list (sender, subject, preview and date) for the last 60 days. They never open, click or change an email. Matched emails show up in the tracker, and you can assign the rest to a job there. AI sorting sends the sender, subject and preview of unclear job-related emails (at most 3 per scan) to your AI provider.",
    ),
  );
  box.replaceChildren(readers, gmailApiSection());
}

export function renderIntelSettings(box: HTMLElement, settings: Settings, onChange: () => void): void {
  ctx = { box, settings, onChange };
  if (!wired) {
    wired = true;
    api.storage.onChanged.addListener((changes, area) => {
      if (area === "session" && changes.gmailStatus) {
        status = (changes.gmailStatus.newValue as GmailStatus | undefined) ?? {};
        if (!busy) draw();
      }
      // The background stamps lastSync and flips gmailApi on connect/disconnect; keep the
      // page's copy current so a later Save doesn't roll those back.
      const change = changes[STORAGE_KEYS.settings];
      if (area === "local" && change?.newValue && ctx) {
        const next = normalizeSettings(change.newValue).intel;
        const prev = normalizeSettings(change.oldValue).intel;
        ctx.settings.intel.lastSync = next.lastSync;
        if (next.gmailApi !== prev.gmailApi) {
          ctx.settings.intel.gmailApi = next.gmailApi;
          if (!busy) draw();
        }
      }
    });
  }
  draw();
  void loadStatus();
}
