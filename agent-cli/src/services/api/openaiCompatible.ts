import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type { ContentBlock, Message, StreamEvent, ToolUseBlock } from "../../types/messages.js";
import type { ModelRequest, ModelResponse } from "../../query/queryLoop.js";

/**
 * OpenAI-compatible provider (DeepSeek, OpenAI, local gateways).
 * DeepSeek: baseURL https://api.deepseek.com , model deepseek-chat
 */
export function createOpenAICompatibleModelCall(opts?: {
  apiKey?: string;
  model?: string;
  baseURL?: string;
}): (req: ModelRequest) => AsyncGenerator<StreamEvent, ModelResponse> {
  const apiKey =
    opts?.apiKey ??
    process.env.DEEPSEEK_API_KEY ??
    process.env.OPENAI_API_KEY ??
    process.env.API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing API key. Set DEEPSEEK_API_KEY (or OPENAI_API_KEY) in agent-cli/.env — see .env.example",
    );
  }
  const baseURL =
    opts?.baseURL ??
    process.env.OPENAI_BASE_URL ??
    process.env.DEEPSEEK_BASE_URL ??
    "https://api.deepseek.com";
  const model =
    opts?.model ?? process.env.OPENAI_MODEL ?? process.env.DEEPSEEK_MODEL ?? "deepseek-chat";

  // Pass apiKey explicitly so the SDK does not look for OPENAI_API_KEY only.
  const client = new OpenAI({ apiKey, baseURL });

  return async function* modelCall(req: ModelRequest): AsyncGenerator<StreamEvent, ModelResponse> {
    const tools: ChatCompletionTool[] | undefined = req.tools.length
      ? req.tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema as Record<string, unknown>,
          },
        }))
      : undefined;

    const messages = toOpenAIMessages(req.system, req.messages);

    const stream = await client.chat.completions.create(
      {
        model,
        messages,
        tools,
        stream: true,
      },
      { signal: req.signal },
    );

    let text = "";
    const toolAcc = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();
    let finish: string | null = null;

    for await (const chunk of stream) {
      if (req.signal?.aborted) break;
      const choice = chunk.choices[0];
      if (!choice) continue;
      if (choice.finish_reason) finish = choice.finish_reason;

      const delta = choice.delta;
      if (delta?.content) {
        text += delta.content;
        yield { type: "text_delta", text: delta.content };
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const cur = toolAcc.get(idx) ?? { id: "", name: "", arguments: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (tc.function?.arguments) cur.arguments += tc.function.arguments;
          toolAcc.set(idx, cur);
        }
      }
    }

    const content: ContentBlock[] = [];
    if (text) content.push({ type: "text", text });

    const toolUses: ToolUseBlock[] = [];
    for (const [, t] of [...toolAcc.entries()].sort((a, b) => a[0] - b[0])) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(t.arguments || "{}") as Record<string, unknown>;
      } catch {
        input = {};
      }
      toolUses.push({
        type: "tool_use",
        id: t.id || `tool_${t.name}_${toolUses.length}`,
        name: t.name,
        input,
      });
    }
    content.push(...toolUses);

    let stopReason: ModelResponse["stopReason"] = "end_turn";
    if (finish === "tool_calls" || toolUses.length > 0) stopReason = "tool_use";
    else if (finish === "length") stopReason = "max_tokens";
    else if (finish === "stop") stopReason = "end_turn";
    else if (finish) stopReason = "other";

    return { content, stopReason };
  };
}

function toOpenAIMessages(system: string, messages: Message[]): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = [{ role: "system", content: system }];

  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role as "user" | "assistant", content: m.content });
      continue;
    }

    if (m.role === "assistant") {
      const textParts = m.content.filter((b): b is { type: "text"; text: string } => b.type === "text");
      const toolUses = m.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
      const text = textParts.map((b) => b.text).join("\n");
      if (toolUses.length) {
        out.push({
          role: "assistant",
          content: text || null,
          tool_calls: toolUses.map((t) => ({
            id: t.id,
            type: "function" as const,
            function: {
              name: t.name,
              arguments: JSON.stringify(t.input ?? {}),
            },
          })),
        });
      } else {
        out.push({ role: "assistant", content: text });
      }
      continue;
    }

    // user message: may be plain text or tool_result blocks
    const toolResults = m.content.filter((b) => b.type === "tool_result");
    if (toolResults.length) {
      for (const tr of toolResults) {
        if (tr.type !== "tool_result") continue;
        out.push({
          role: "tool",
          tool_call_id: tr.tool_use_id,
          content: tr.content,
        });
      }
      continue;
    }

    const text = m.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    out.push({ role: "user", content: text });
  }

  return out;
}
