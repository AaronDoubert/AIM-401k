import type { EngineController } from "../state/EngineController";
import type { ProviderDef } from "./providers";
import { callProvider, type ChatTurn } from "./client";
import { TOOL_DEFS, executeTool } from "./tools";
import { planLocalTurn } from "./localAgent";

export type AgentEvent =
  | { type: "assistant_text"; text: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; ok: boolean; data?: unknown; error?: string }
  | { type: "error"; message: string };

export interface RunContext {
  ctrl: EngineController;
  mode: "local" | "llm";
  provider?: ProviderDef;
  baseUrl?: string;
  token?: string;
  model?: string;
  history: ChatTurn[];
  onEvent?: (e: AgentEvent) => void;
  signal?: AbortSignal;
}

export interface TurnResult {
  events: AgentEvent[];
  turns: ChatTurn[]; // new turns to append to history
}

const MAX_ITERATIONS = 8;

function systemPrompt(ctrl: EngineController): string {
  const s = ctrl.getState();
  const summary = `Current circuit: ${s.components.length} component(s), ${s.nets.length} net(s).`;
  return [
    "You are the design copilot inside Condenser, a browser-based AI-assisted schematic/PCB tool.",
    "Hard rules (the tools enforce them):",
    "1. NEVER do component-value arithmetic yourself. To size R/C/L or design a filter/divider, call run_procedure or insert_module.",
    "2. NEVER mutate the model directly — only through the provided tools (add_component, connect, set_params, insert_module, …).",
    "3. Components live on a fidelity ladder L0→L3 and only upgrade. attach_interface→L1, set_params→L2, bind_real_part→L3.",
    "Call get_circuit before editing so you reference real component/net ids. Keep replies short; end with a one-line summary of what you changed.",
    summary,
  ].join("\n");
}

async function runLocal(userText: string, ctx: RunContext): Promise<TurnResult> {
  const events: AgentEvent[] = [];
  const emit = (e: AgentEvent) => {
    events.push(e);
    ctx.onEvent?.(e);
  };
  const { plan, finalText } = planLocalTurn(userText);
  for (let i = 0; i < plan.length; i++) {
    const call = plan[i]!;
    const id = `local_${i}`;
    emit({ type: "tool_call", id, name: call.name, args: call.args });
    const result = executeTool(ctx.ctrl, call.name, call.args);
    emit({ type: "tool_result", id, name: call.name, ok: result.ok, data: result.data, error: result.error });
  }
  emit({ type: "assistant_text", text: finalText });
  return {
    events,
    turns: [
      { role: "user", text: userText },
      { role: "assistant", text: finalText },
    ],
  };
}

async function runLLM(userText: string, ctx: RunContext): Promise<TurnResult> {
  const events: AgentEvent[] = [];
  const emit = (e: AgentEvent) => {
    events.push(e);
    ctx.onEvent?.(e);
  };
  if (!ctx.provider) {
    emit({ type: "error", message: "No provider selected." });
    return { events, turns: [] };
  }

  const newTurns: ChatTurn[] = [{ role: "user", text: userText }];
  const working: ChatTurn[] = [...ctx.history, ...newTurns];

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let resp;
    try {
      resp = await callProvider({
        provider: ctx.provider,
        baseUrl: ctx.baseUrl ?? ctx.provider.defaultBaseUrl,
        token: ctx.token ?? "",
        model: ctx.model ?? ctx.provider.defaultModel,
        system: systemPrompt(ctx.ctrl),
        turns: working,
        tools: TOOL_DEFS,
        signal: ctx.signal,
      });
    } catch (err) {
      emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
      return { events, turns: newTurns };
    }

    const assistantTurn: ChatTurn = {
      role: "assistant",
      ...(resp.text ? { text: resp.text } : {}),
      ...(resp.toolCalls.length ? { toolCalls: resp.toolCalls } : {}),
    };
    working.push(assistantTurn);
    newTurns.push(assistantTurn);
    if (resp.text) emit({ type: "assistant_text", text: resp.text });

    if (resp.toolCalls.length === 0) {
      return { events, turns: newTurns };
    }

    for (const call of resp.toolCalls) {
      emit({ type: "tool_call", id: call.id, name: call.name, args: call.args });
      const result = executeTool(ctx.ctrl, call.name, call.args);
      emit({ type: "tool_result", id: call.id, name: call.name, ok: result.ok, data: result.data, error: result.error });
      const toolTurn: ChatTurn = {
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: JSON.stringify(result.ok ? result.data ?? { ok: true } : { error: result.error }),
      };
      working.push(toolTurn);
      newTurns.push(toolTurn);
    }
  }

  emit({ type: "error", message: `Stopped after ${MAX_ITERATIONS} tool iterations.` });
  return { events, turns: newTurns };
}

export function runAgentTurn(userText: string, ctx: RunContext): Promise<TurnResult> {
  return ctx.mode === "local" ? runLocal(userText, ctx) : runLLM(userText, ctx);
}
