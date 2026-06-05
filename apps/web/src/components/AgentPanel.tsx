import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useController } from "../state/engineContext";
import { runAgentTurn, type AgentEvent } from "../agent/runtime";
import type { ChatTurn } from "../agent/client";
import { tokenStore } from "../agent/tokenStore";
import { LOCAL_PROVIDER_ID, PROVIDER_BY_ID } from "../agent/providers";
import { TokenSettings } from "./TokenSettings";

type DisplayItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; id: string; name: string; args: Record<string, unknown>; ok?: boolean; result?: unknown; error?: string }
  | { kind: "error"; text: string };

const SUGGESTIONS = [
  "Low-pass filter at 1 kHz",
  "Voltage divider",
  "Add a 10k resistor",
  "Clear the canvas",
];

function useAgentSettings() {
  return useSyncExternalStore(tokenStore.subscribe, tokenStore.getSnapshot);
}

function ToolChip({ item }: { item: Extract<DisplayItem, { kind: "tool" }> }) {
  const status = item.ok === undefined ? "running" : item.ok ? "ok" : "fail";
  return (
    <details className={`tool-chip ${status}`}>
      <summary>
        <span className="tool-dot" />
        <span className="tool-name mono">{item.name}</span>
        <span className="tool-status">{status === "running" ? "…" : status === "ok" ? "✓" : "✕"}</span>
      </summary>
      <pre className="tool-json">{JSON.stringify(item.args, null, 2)}</pre>
      {item.error && <pre className="tool-json err">{item.error}</pre>}
      {item.result !== undefined && item.ok && (
        <pre className="tool-json">{JSON.stringify(item.result, null, 2)}</pre>
      )}
    </details>
  );
}

export function AgentPanel() {
  const ctrl = useController();
  const settings = useAgentSettings();
  const [tab, setTab] = useState<"chat" | "tokens">("chat");
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeId = settings.activeProviderId;
  const isLocal = activeId === LOCAL_PROVIDER_ID;
  const provider = PROVIDER_BY_ID[activeId];
  const activeLabel = isLocal ? "Offline agent" : (provider?.label ?? "Offline agent");

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [items]);

  const send = async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || busy) return;
    setInput("");
    setItems((prev) => [...prev, { kind: "user", text }]);
    setBusy(true);

    const onEvent = (e: AgentEvent) => {
      setItems((prev) => {
        if (e.type === "assistant_text") return [...prev, { kind: "assistant", text: e.text }];
        if (e.type === "error") return [...prev, { kind: "error", text: e.message }];
        if (e.type === "tool_call")
          return [...prev, { kind: "tool", id: e.id, name: e.name, args: e.args }];
        if (e.type === "tool_result")
          return prev.map((it) =>
            it.kind === "tool" && it.id === e.id
              ? { ...it, ok: e.ok, result: e.data, error: e.error }
              : it
          );
        return prev;
      });
    };

    // Resolve provider configuration.
    let mode: "local" | "llm" = "local";
    let token = "";
    if (!isLocal && provider) {
      token = tokenStore.getCreds(activeId).token;
      if (provider.requiresToken && !token) {
        onEvent({ type: "error", message: `No API key set for ${provider.label}. Add one under the Tokens tab, or switch to the offline agent.` });
        setBusy(false);
        return;
      }
      mode = "llm";
    }

    try {
      const result = await runAgentTurn(text, {
        ctrl,
        mode,
        ...(provider ? { provider } : {}),
        baseUrl: tokenStore.resolvedBaseUrl(activeId),
        token,
        model: tokenStore.resolvedModel(activeId),
        history,
        onEvent,
      });
      setHistory((h) => [...h, ...result.turns]);
    } catch (err) {
      onEvent({ type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel agent-panel">
      <div className="panel-head agent-head">
        <div className="agent-tabs">
          <button className={tab === "chat" ? "on" : ""} onClick={() => setTab("chat")}>
            Agent
          </button>
          <button className={tab === "tokens" ? "on" : ""} onClick={() => setTab("tokens")}>
            Tokens
          </button>
        </div>
        <button className="provider-pill" onClick={() => setTab("tokens")} title="Change provider">
          {activeLabel} ▾
        </button>
      </div>

      {tab === "tokens" ? (
        <TokenSettings />
      ) : (
        <div className="agent-chat">
          <div className="chat-scroll" ref={scrollRef}>
            {items.length === 0 && (
              <div className="chat-intro">
                <p>
                  I design circuits by calling deterministic procedures and issuing validated
                  commands — I never do the arithmetic myself.
                </p>
                <p className="muted">
                  Active: <strong>{activeLabel}</strong>. Try one of these:
                </p>
                <div className="suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => send(s)} disabled={busy}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {items.map((it, i) => {
              if (it.kind === "tool") return <ToolChip key={i} item={it} />;
              return (
                <div key={i} className={`bubble ${it.kind}`}>
                  {it.text}
                </div>
              );
            })}
            {busy && <div className="bubble assistant pending">working…</div>}
          </div>

          <div className="chat-input">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={`Ask ${activeLabel} to design something…`}
              rows={2}
            />
            <button className="primary" disabled={busy || !input.trim()} onClick={() => void send()}>
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
