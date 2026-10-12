// Inbox reader for Gmail / Outlook web tabs (no OAuth): reads the visible
// message list and sends RawMail items to the background as `intelIngest`.
// Read-only: it never clicks, opens or changes anything, and nothing leaves
// the browser (the background classifies locally).
// OWNER: Intel agent.
import { api } from "../shared/api";
import type { ToBackground } from "../shared/messages";
import type { IntelSource } from "../shared/types";
import { gmailSelf, isReadableView, parseGmail, parseOutlook, providerFor, recentMails } from "./mailParse";

/** At most one scan per 20 s, however busy the page's DOM is. */
const MIN_GAP = 20_000;
const FIRST_SCAN = 1500;
/** While turned off in settings, check back every few minutes. */
const RECHECK = 5 * 60_000;

declare global {
  interface Window {
    __aim401kMail?: boolean;
  }
}

type IngestReply = { enabled?: boolean } | undefined;

function main(): void {
  const provider = providerFor(location.hostname);
  if (!provider || window !== window.top || window.__aim401kMail) return;
  window.__aim401kMail = true;
  const source: IntelSource = provider === "gmail" ? "gmail-tab" : "outlook-tab";
  const sent = new Set<string>();
  let enabled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastScan = 0;
  let observer: MutationObserver | null = null;

  const send = (msg: ToBackground) => api.runtime.sendMessage(msg) as Promise<IngestReply>;

  const scan = async () => {
    timer = null;
    lastScan = Date.now();
    if (!enabled || !isReadableView(provider, location)) return;
    const now = Date.now();
    const all = provider === "gmail" ? parseGmail(document, now, gmailSelf(document.title)) : parseOutlook(document, now);
    const fresh = recentMails(all, now).filter((m) => !sent.has(m.messageId));
    if (!fresh.length) return;
    try {
      const reply = await send({ type: "intelIngest", source, mails: fresh });
      if (reply?.enabled === false) return stop();
      for (const m of fresh) sent.add(m.messageId);
    } catch {
      schedule(MIN_GAP); // background restarting: try again even if the page stays still
    }
  };

  const schedule = (delay = FIRST_SCAN) => {
    if (timer || !enabled) return;
    timer = setTimeout(() => void scan(), Math.max(delay, lastScan + MIN_GAP - Date.now()));
  };

  const start = () => {
    if (enabled) return;
    enabled = true;
    observer = new MutationObserver(() => schedule());
    observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
    schedule(FIRST_SCAN);
  };

  function stop(): void {
    enabled = false;
    observer?.disconnect();
    observer = null;
    if (timer) clearTimeout(timer);
    timer = null;
  }

  // Ask the background whether this reader is on (settings.intel.gmailTab / outlookTab).
  let failures = 0;
  const probe = async () => {
    try {
      const reply = await send({ type: "intelIngest", source, mails: [] });
      failures = 0;
      if (reply?.enabled) start();
      else stop();
    } catch {
      // Background not reachable yet (startup / extension update): retry soon, backing off.
      if (++failures <= 5) setTimeout(() => void probe(), 2000 * failures);
    }
  };
  window.addEventListener("hashchange", () => schedule()); // Gmail switches folders by hash
  void probe();
  setInterval(() => void probe(), RECHECK);
}

main();
