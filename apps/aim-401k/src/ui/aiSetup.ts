import { api } from "../shared/api";
import type { AiUsage, LocalAiDetection } from "../shared/messages";
import { AI_DATA_CONSENT, PROVIDERS, checkApiKey, isLocalAi, preset } from "../shared/providers";
import type { ProviderId, Settings } from "../shared/types";
import { h, send } from "./common";

// AI provider picker (BYO key / local model), shared by onboarding and settings.
// "We help a bit": local Ollama / LM Studio are detected and offered in one
// click, keys are sanity-checked as they're pasted, and the number of requests
// sent today is shown next to the free-tier limits.

const OLLAMA_BASE = "http://localhost:11434/v1";

/**
 * Ask Firefox (140+) for the optional data-collection permissions an online AI
 * provider needs. Call it synchronously from a click handler. Browsers without
 * built-in consent reject the unknown key, which is fine: the background checks
 * again before anything is sent.
 */
export function requestAiConsent(provider: ProviderId, baseUrl: string, extra: string[] = []): Promise<boolean> {
  if (isLocalAi(provider, baseUrl)) return Promise.resolve(true);
  try {
    const req = { data_collection: [...AI_DATA_CONSENT, ...extra] } as browser.permissions.Permissions;
    return api.permissions.request(req).catch(() => true);
  } catch {
    return Promise.resolve(true);
  }
}

export function renderAiSetup(box: Element, settings: Settings, onChange: () => void, onConnected?: () => void): void {
  const banner = h("div", { id: "ai-local", style: "margin-bottom:12px" });
  let detected: LocalAiDetection | null = null;
  let usage: AiUsage | null = null;
  let runTest: (() => Promise<void>) | null = null;
  let usageLine: HTMLElement | null = null;

  const requestsToday = () => {
    if (!usageLine) return;
    const n = usage?.counts[settings.aiProvider] ?? 0;
    usageLine.textContent = `Requests today: ${n}`;
  };
  const refreshUsage = async () => {
    try {
      usage = await send<AiUsage>({ type: "getAiUsage" });
    } catch {
      usage = null;
    }
    requestsToday();
  };

  /** Switch to a provider and run the connection test straight away. */
  const useLocal = async (provider: ProviderId, baseUrl: string, model: string) => {
    settings.aiProvider = provider;
    settings.customBaseUrl = baseUrl;
    if (model) settings.models[provider] = model;
    onChange();
    draw();
    await runTest?.();
  };

  const drawBanner = () => {
    const parts: HTMLElement[] = [];
    const o = detected?.ollama;
    const l = detected?.lmstudio;
    if (o?.reachable && o.models.length) {
      const inUse = settings.aiProvider === "ollama";
      const pick = h("select", { style: "width:auto" }, ...o.models.map((m) => h("option", { value: m, textContent: m })));
      const current = settings.models.ollama;
      if (current && o.models.includes(current)) pick.value = current;
      const use = h("button", { type: "button", className: inUse ? "" : "primary", id: "ai-use-ollama", textContent: inUse ? "Switch model" : "Use it" });
      use.addEventListener("click", () => void useLocal("ollama", OLLAMA_BASE, pick.value));
      parts.push(
        h(
          "div",
          { className: "card", style: "border-color:var(--ok)" },
          h("b", { textContent: "Ollama detected on this computer" }),
          h("span", { className: "muted", textContent: ` with ${o.models.length} model${o.models.length > 1 ? "s" : ""}: ${o.models.slice(0, 6).join(", ")}${o.models.length > 6 ? "…" : ""}` }),
          h("div", { className: "row", style: "margin-top:8px" }, h("span", { textContent: inUse ? "In use (private, free)." : "Use it (private, free):" }), pick, use),
        ),
      );
    } else if (o?.reachable) {
      parts.push(
        h(
          "div",
          { className: "card" },
          h("b", { textContent: "Ollama is running on this computer, but has no models yet. " }),
          "Run ",
          h("code", { textContent: "ollama pull llama3.2" }),
          " in a terminal, then reopen this page.",
        ),
      );
    } else if (o?.forbidden) {
      parts.push(
        h(
          "div",
          { className: "card", style: "border-color:var(--warn)" },
          h("b", { textContent: "Ollama is running on this computer but refused AIM-401k." }),
          h("p", {
            style: "margin:6px 0",
            textContent: "Ollama only answers web pages and extensions it was told to trust. Quit Ollama, set OLLAMA_ORIGINS=moz-extension://* and start it again:",
          }),
          h(
            "ul",
            { style: "margin:0;padding-left:20px" },
            h("li", {}, "macOS: ", h("code", { textContent: 'launchctl setenv OLLAMA_ORIGINS "moz-extension://*"' }), ", then reopen the Ollama app"),
            h("li", {}, "Linux: ", h("code", { textContent: "sudo systemctl edit ollama" }), ", add ", h("code", { textContent: 'Environment="OLLAMA_ORIGINS=moz-extension://*"' }), " under [Service], then ", h("code", { textContent: "sudo systemctl restart ollama" })),
            h("li", {}, "Windows: add a user environment variable OLLAMA_ORIGINS = moz-extension://* and restart Ollama"),
            h("li", {}, "Or in a terminal: ", h("code", { textContent: "OLLAMA_ORIGINS='moz-extension://*' ollama serve" })),
          ),
        ),
      );
    }
    if (l?.reachable && l.models.length) {
      const inUse = settings.aiProvider === "custom" && settings.customBaseUrl === l.baseUrl;
      const use = h("button", { type: "button", id: "ai-use-lmstudio", textContent: inUse ? "Use again" : "Use it" });
      use.addEventListener("click", () => void useLocal("custom", l.baseUrl, settings.models.custom && l.models.includes(settings.models.custom) ? settings.models.custom : l.models[0]!));
      parts.push(
        h(
          "div",
          { className: "card", style: "margin-top:8px;border-color:var(--ok)" },
          h("b", { textContent: "LM Studio server detected on this computer" }),
          h("span", { className: "muted", textContent: ` with: ${l.models.slice(0, 4).join(", ")}${l.models.length > 4 ? "…" : ""}` }),
          h("div", { className: "row", style: "margin-top:8px" }, h("span", { textContent: `Set up “Other (OpenAI-compatible)” at ${l.baseUrl} (private, free):` }), use),
        ),
      );
    }
    banner.replaceChildren(...parts);
  };

  const draw = () => {
    const p = preset(settings.aiProvider);
    const cards = h("div", { className: "providers" });
    for (const pr of PROVIDERS) {
      const card = h(
        "button",
        { type: "button", className: `provider ${pr.id === settings.aiProvider ? "on" : ""}` },
        h("b", { textContent: pr.name }),
        ...(pr.badge ? [h("span", { className: "pill", textContent: pr.badge })] : []),
        h("span", { className: "muted", textContent: pr.cost }),
        h("span", { className: "muted", textContent: `Sign in: ${pr.signIn}` }),
      );
      card.dataset.provider = pr.id;
      card.addEventListener("click", () => {
        settings.aiProvider = pr.id as ProviderId;
        onChange();
        draw();
      });
      cards.append(card);
    }

    const keyInput = h("input", { type: "password", value: settings.apiKeys[p.id] ?? "", placeholder: p.needsKey ? "Paste your API key" : "Not needed", autocomplete: "off" });
    keyInput.spellcheck = false;
    const keyHint = h("span", { className: "muted", id: "ai-key-hint" });
    const checkKey = (fix: boolean) => {
      const c = checkApiKey(p.id, keyInput.value);
      if (fix && c.cleaned) keyInput.value = c.key;
      keyHint.textContent = c.warning ?? "";
      // Shape mismatches are a warning; "removed spaces/quotes" is just a note.
      keyHint.style.color = c.warning && !p.keyShape?.test.test(c.key) ? "var(--warn)" : "";
      return c.key;
    };
    keyInput.addEventListener("input", () => {
      settings.apiKeys[p.id] = checkKey(true);
      onChange();
    });
    checkKey(false);
    const modelInput = h("input", { value: settings.models[p.id] ?? p.defaultModel, placeholder: "model id" });
    modelInput.setAttribute("list", "jp-models");
    const modelList = h("datalist", { id: "jp-models" });
    modelInput.addEventListener("input", () => {
      settings.models[p.id] = modelInput.value.trim();
      onChange();
    });
    const baseInput = h("input", { value: settings.customBaseUrl || (p.id === "ollama" ? p.baseUrl : ""), placeholder: "https://host/v1" });
    baseInput.addEventListener("input", () => {
      settings.customBaseUrl = baseInput.value.trim();
      onChange();
    });
    const status = h("div", { className: "muted status" });
    const test = h("button", { type: "button", className: "primary", textContent: "Test & load models" });
    runTest = async () => {
      // First thing, while the click's user activation is still valid.
      // If AI email sorting is on, this provider will also see email subjects/previews.
      const extra = settings.intel?.useAi ? ["personalCommunications"] : [];
      const consent = requestAiConsent(p.id, p.id === "custom" || p.id === "ollama" ? baseInput.value.trim() || p.baseUrl : p.baseUrl, extra);
      test.disabled = true;
      status.textContent = "Testing…";
      status.className = "muted status";
      await consent;
      const override = {
        provider: p.id,
        key: checkKey(true),
        model: modelInput.value.trim(),
        ...(p.id === "custom" || p.id === "ollama" ? { baseUrl: baseInput.value.trim() || p.baseUrl } : {}),
      };
      const res = await send<{ ok: boolean; message: string; models: string[] }>({ type: "testAi", override });
      modelList.replaceChildren(...res.models.map((m) => h("option", { value: m })));
      if (!modelInput.value && res.models[0]) {
        modelInput.value = res.models[0];
        settings.models[p.id] = res.models[0];
        onChange();
      }
      status.textContent = res.ok ? `✓ ${res.message}${res.models.length ? ` · ${res.models.length} models available` : ""}` : `✗ ${res.message}`;
      status.className = `status ${res.ok ? "ok" : "bad"}`;
      test.disabled = false;
      void refreshUsage();
      if (res.ok) {
        if (settings.llmMode === "off") settings.llmMode = "draft";
        onChange();
        onConnected?.();
      }
    };
    test.addEventListener("click", () => void runTest?.());

    // Privacy guard (also mirrored in Settings → Privacy & data).
    const redact = h("input", { type: "checkbox", id: "ai-redact", checked: settings.aiRedact });
    redact.addEventListener("change", () => {
      settings.aiRedact = redact.checked;
      onChange();
      document.dispatchEvent(new CustomEvent("aim401k:ai-redact", { detail: redact.checked }));
    });

    usageLine = h("span", { className: "muted", id: "ai-usage" });
    const detail = h(
      "div",
      { className: "card" },
      h("p", { textContent: p.notes }),
      h("p", { className: "muted" }, `${p.cost} · `, usageLine),
      p.keyUrl ? h("p", {}, h("a", { href: p.keyUrl, target: "_blank", rel: "noopener", textContent: p.needsKey ? `Get a ${p.name} key →` : `Set up ${p.name} →` })) : "",
      h(
        "div",
        { className: "grid" },
        ...(p.needsKey || p.id === "custom" ? [h("label", { className: "f" }, "API key", keyInput, keyHint)] : []),
        h("label", { className: "f" }, "Model", modelInput, modelList),
        ...(p.id === "custom" || p.id === "ollama" ? [h("label", { className: "f" }, "Base URL", baseInput)] : []),
      ),
      h("div", { className: "row", style: "margin-top:10px" }, test, status),
      h(
        "div",
        { style: "margin-top:12px" },
        h("label", { className: "f check" }, redact, "Redact contact details before sending to AI (recommended)"),
        h("div", {
          className: "muted",
          textContent: "Leaves out your email, phone, street address and postal code, and turns email addresses and phone numbers in your resume text into [email] / [phone]. Forms still get them from your profile.",
        }),
      ),
    );
    requestsToday();
    drawBanner();
    box.replaceChildren(banner, cards, detail);
  };

  draw();
  void refreshUsage();
  void send<LocalAiDetection>({ type: "detectLocalAi" })
    .then((d) => {
      detected = d;
      drawBanner();
    })
    .catch(() => undefined);
}
