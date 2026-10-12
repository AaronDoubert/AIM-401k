import { PROVIDERS, preset } from "../shared/providers";
import type { ProviderId, Settings } from "../shared/types";
import { h, send } from "./common";

// AI provider picker (BYO key / local model), shared by onboarding and settings.

export function renderAiSetup(box: Element, settings: Settings, onChange: () => void, onConnected?: () => void): void {
  const draw = () => {
    const p = preset(settings.aiProvider);
    const cards = h("div", { className: "providers" });
    for (const pr of PROVIDERS) {
      const card = h(
        "button",
        { type: "button", className: `provider ${pr.id === settings.aiProvider ? "on" : ""}` },
        h("b", { textContent: pr.name }),
        h("span", { className: "muted", textContent: pr.cost }),
        h("span", { className: "muted", textContent: `Sign in: ${pr.signIn}` }),
      );
      card.addEventListener("click", () => {
        settings.aiProvider = pr.id as ProviderId;
        onChange();
        draw();
      });
      cards.append(card);
    }

    const keyInput = h("input", { type: "password", value: settings.apiKeys[p.id] ?? "", placeholder: p.needsKey ? "Paste your API key" : "Not needed", autocomplete: "off" });
    keyInput.addEventListener("input", () => {
      settings.apiKeys[p.id] = keyInput.value.trim();
      onChange();
    });
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
    test.addEventListener("click", async () => {
      test.disabled = true;
      status.textContent = "Testing…";
      status.className = "muted status";
      const override = {
        provider: p.id,
        key: keyInput.value.trim(),
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
      if (res.ok) {
        if (settings.llmMode === "off") settings.llmMode = "draft";
        onChange();
        onConnected?.();
      }
    });

    const detail = h(
      "div",
      { className: "card" },
      h("p", { textContent: p.notes }),
      p.keyUrl ? h("p", {}, h("a", { href: p.keyUrl, target: "_blank", rel: "noopener", textContent: p.needsKey ? `Get a ${p.name} key →` : `Set up ${p.name} →` })) : "",
      h("div", { className: "grid" }, ...(p.needsKey || p.id === "custom" ? [h("label", { className: "f" }, "API key", keyInput)] : []), h("label", { className: "f" }, "Model", modelInput, modelList), ...(p.id === "custom" || p.id === "ollama" ? [h("label", { className: "f" }, "Base URL", baseInput)] : [])),
      h("div", { className: "row", style: "margin-top:10px" }, test, status),
    );
    box.replaceChildren(cards, detail);
  };
  draw();
}
