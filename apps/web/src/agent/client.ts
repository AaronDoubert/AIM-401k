import type { ProviderDef } from "./providers";
import type { ToolDef } from "./tools";

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type ChatTurn =
  | { role: "user"; text: string }
  | { role: "assistant"; text?: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface ProviderResponse {
  text: string;
  toolCalls: ToolCall[];
}

export interface CallOptions {
  provider: ProviderDef;
  baseUrl: string;
  token: string;
  model: string;
  system: string;
  turns: ChatTurn[];
  tools: ToolDef[];
  signal?: AbortSignal;
  maxTokens?: number;
}

function safeJsonParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function readError(res: Response): Promise<string> {
  let body = "";
  try {
    body = await res.text();
  } catch {
    /* ignore */
  }
  const snippet = body.length > 400 ? `${body.slice(0, 400)}…` : body;
  return `HTTP ${res.status} ${res.statusText}${snippet ? ` — ${snippet}` : ""}`;
}

// ── Anthropic Messages API ────────────────────────────────────────────────────

async function callAnthropic(opts: CallOptions): Promise<ProviderResponse> {
  const url = `${opts.baseUrl}/v1/messages`;
  const messages: unknown[] = [];
  let pendingToolResults: unknown[] = [];

  const flushTools = () => {
    if (pendingToolResults.length) {
      messages.push({ role: "user", content: pendingToolResults });
      pendingToolResults = [];
    }
  };

  for (const turn of opts.turns) {
    if (turn.role === "tool") {
      pendingToolResults.push({
        type: "tool_result",
        tool_use_id: turn.toolCallId,
        content: turn.content,
      });
      continue;
    }
    flushTools();
    if (turn.role === "user") {
      messages.push({ role: "user", content: turn.text });
    } else {
      const content: unknown[] = [];
      if (turn.text) content.push({ type: "text", text: turn.text });
      for (const tc of turn.toolCalls ?? []) {
        content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args });
      }
      messages.push({ role: "assistant", content });
    }
  }
  flushTools();

  const res = await fetch(url, {
    method: "POST",
    signal: opts.signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": opts.token,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.system,
      messages,
      tools: opts.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      })),
    }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
  };
  let text = "";
  const toolCalls: ToolCall[] = [];
  for (const block of data.content ?? []) {
    if (block.type === "text" && block.text) text += block.text;
    if (block.type === "tool_use" && block.name && block.id) {
      toolCalls.push({ id: block.id, name: block.name, args: block.input ?? {} });
    }
  }
  return { text, toolCalls };
}

// ── OpenAI Chat Completions API (+ compatibles) ───────────────────────────────

async function callOpenAI(opts: CallOptions): Promise<ProviderResponse> {
  const isAzure = opts.provider.id === "azure-openai";
  const url = isAzure
    ? `${opts.baseUrl}/chat/completions?api-version=2024-10-21`
    : `${opts.baseUrl}/chat/completions`;

  const messages: unknown[] = [{ role: "system", content: opts.system }];
  for (const turn of opts.turns) {
    if (turn.role === "user") {
      messages.push({ role: "user", content: turn.text });
    } else if (turn.role === "assistant") {
      const msg: Record<string, unknown> = {
        role: "assistant",
        content: turn.text ?? null,
      };
      if (turn.toolCalls?.length) {
        msg.tool_calls = turn.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        }));
      }
      messages.push(msg);
    } else {
      messages.push({
        role: "tool",
        tool_call_id: turn.toolCallId,
        content: turn.content,
      });
    }
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (isAzure) headers["api-key"] = opts.token;
  else if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
  if (opts.provider.id === "openrouter") {
    headers["http-referer"] = "https://condenser.local";
    headers["x-title"] = "Condenser";
  }

  const res = await fetch(url, {
    method: "POST",
    signal: opts.signal,
    headers,
    body: JSON.stringify({
      model: opts.model,
      messages,
      tools: opts.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      tool_choice: "auto",
      max_tokens: opts.maxTokens ?? 1024,
    }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
      };
    }>;
  };
  const message = data.choices?.[0]?.message;
  const toolCalls: ToolCall[] = (message?.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    args: safeJsonParse(tc.function.arguments),
  }));
  return { text: message?.content ?? "", toolCalls };
}

// ── Google Gemini generateContent API ─────────────────────────────────────────

function sanitizeGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeGeminiSchema);
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
      if (k === "additionalProperties") continue; // unsupported by Gemini
      out[k] = sanitizeGeminiSchema(v);
    }
    return out;
  }
  return schema;
}

async function callGemini(opts: CallOptions): Promise<ProviderResponse> {
  const url = `${opts.baseUrl}/v1beta/models/${opts.model}:generateContent?key=${encodeURIComponent(opts.token)}`;

  const contents: unknown[] = [];
  for (const turn of opts.turns) {
    if (turn.role === "user") {
      contents.push({ role: "user", parts: [{ text: turn.text }] });
    } else if (turn.role === "assistant") {
      const parts: unknown[] = [];
      if (turn.text) parts.push({ text: turn.text });
      for (const tc of turn.toolCalls ?? []) {
        parts.push({ functionCall: { name: tc.name, args: tc.args } });
      }
      contents.push({ role: "model", parts });
    } else {
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: turn.name,
              response: { result: turn.content },
            },
          },
        ],
      });
    }
  }

  const res = await fetch(url, {
    method: "POST",
    signal: opts.signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: opts.system }] },
      contents,
      tools: [
        {
          function_declarations: opts.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: sanitizeGeminiSchema(t.parameters),
          })),
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }> };
    }>;
  };
  let text = "";
  const toolCalls: ToolCall[] = [];
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  parts.forEach((part, i) => {
    if (part.text) text += part.text;
    if (part.functionCall) {
      toolCalls.push({
        id: `gem_${i}_${part.functionCall.name}`,
        name: part.functionCall.name,
        args: part.functionCall.args ?? {},
      });
    }
  });
  return { text, toolCalls };
}

export async function callProvider(opts: CallOptions): Promise<ProviderResponse> {
  switch (opts.provider.wire) {
    case "anthropic":
      return callAnthropic(opts);
    case "gemini":
      return callGemini(opts);
    case "openai":
    default:
      return callOpenAI(opts);
  }
}

export async function testConnection(
  provider: ProviderDef,
  baseUrl: string,
  token: string,
  model: string
): Promise<{ ok: boolean; message: string }> {
  try {
    const resp = await callProvider({
      provider,
      baseUrl,
      token,
      model,
      system: "You are a connectivity probe. Reply with the single word: ok.",
      turns: [{ role: "user", text: "ping" }],
      tools: [],
      maxTokens: 16,
    });
    const reply = resp.text.trim() || "(no text — tool-call only)";
    return { ok: true, message: `Connected. Model replied: "${reply.slice(0, 60)}"` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
