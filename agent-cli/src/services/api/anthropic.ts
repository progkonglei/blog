/**
 * Anthropic Messages API 客户端 + MOCK_LLM 假模型
 *
 * 流式解析 text / tool_use，转换成内部 StreamEvent / ModelResponse。
 * MOCK_LLM=1 时不发真实请求，便于离线冒烟。
 */
import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlock, Message, StreamEvent, ToolUseBlock } from "../../types/messages.js";
import type { ModelRequest, ModelResponse } from "../../query/queryLoop.js";

/** 内部消息 → Anthropic MessageParam */
function toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      if (typeof m.content === "string") {
        return { role: m.role as "user" | "assistant", content: m.content };
      }
      const blocks: Anthropic.ContentBlockParam[] = m.content.map((b) => {
        if (b.type === "text") return { type: "text", text: b.text };
        if (b.type === "tool_use") {
          return {
            type: "tool_use",
            id: b.id,
            name: b.name,
            input: b.input,
          };
        }
        return {
          type: "tool_result",
          tool_use_id: b.tool_use_id,
          content: b.content,
          is_error: b.is_error,
        };
      });
      return { role: m.role as "user" | "assistant", content: blocks };
    });
}

export function createAnthropicModelCall(opts?: {
  apiKey?: string;
  model?: string;
  baseURL?: string;
}): (req: ModelRequest) => AsyncGenerator<StreamEvent, ModelResponse> {
  const client = new Anthropic({
    apiKey: opts?.apiKey ?? process.env.ANTHROPIC_API_KEY,
    baseURL: opts?.baseURL ?? process.env.ANTHROPIC_BASE_URL,
  });
  const model = opts?.model ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";

  return async function* modelCall(req: ModelRequest): AsyncGenerator<StreamEvent, ModelResponse> {
    if (process.env.MOCK_LLM === "1") {
      return yield* mockModelCall(req);
    }

    const stream = client.messages.stream({
      model,
      max_tokens: 8192,
      system: req.system,
      messages: toAnthropicMessages(req.messages),
      tools: req.tools.length
        ? (req.tools as Anthropic.Tool[])
        : undefined,
    });

    const content: ContentBlock[] = [];
    let currentTool: ToolUseBlock | null = null;
    let stopReason: ModelResponse["stopReason"] = "end_turn";

    for await (const event of stream) {
      if (req.signal?.aborted) {
        stream.abort();
        break;
      }

      if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block.type === "text") {
          content.push({ type: "text", text: "" });
        } else if (block.type === "tool_use") {
          currentTool = { type: "tool_use", id: block.id, name: block.name, input: {} };
          content.push(currentTool);
        }
      } else if (event.type === "content_block_delta") {
        const delta = event.delta;
        if (delta.type === "text_delta") {
          const last = content[content.length - 1];
          if (last?.type === "text") last.text += delta.text;
          yield { type: "text_delta", text: delta.text };
        } else if (delta.type === "input_json_delta" && currentTool) {
          // Accumulate raw JSON; parse at block stop
          (currentTool as ToolUseBlock & { _raw?: string })._raw =
            ((currentTool as ToolUseBlock & { _raw?: string })._raw ?? "") + delta.partial_json;
        }
      } else if (event.type === "content_block_stop") {
        if (currentTool) {
          const raw = (currentTool as ToolUseBlock & { _raw?: string })._raw ?? "{}";
          try {
            currentTool.input = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            currentTool.input = {};
          }
          delete (currentTool as ToolUseBlock & { _raw?: string })._raw;
          currentTool = null;
        }
      } else if (event.type === "message_delta") {
        const sr = event.delta.stop_reason;
        if (sr === "tool_use") stopReason = "tool_use";
        else if (sr === "max_tokens") stopReason = "max_tokens";
        else if (sr === "end_turn") stopReason = "end_turn";
        else stopReason = "other";
      }
    }

    // Finalize from final message if stream helper provides it
    try {
      const final = await stream.finalMessage();
      if (final.stop_reason === "tool_use") stopReason = "tool_use";
      else if (final.stop_reason === "max_tokens") stopReason = "max_tokens";
      else if (final.stop_reason === "end_turn") stopReason = "end_turn";

      // Prefer final message content for accuracy
      const rebuilt: ContentBlock[] = [];
      for (const b of final.content) {
        if (b.type === "text") rebuilt.push({ type: "text", text: b.text });
        if (b.type === "tool_use") {
          rebuilt.push({
            type: "tool_use",
            id: b.id,
            name: b.name,
            input: b.input as Record<string, unknown>,
          });
        }
      }
      if (rebuilt.length) {
        content.length = 0;
        content.push(...rebuilt);
      }
    } catch {
      // streaming already populated content
    }

    return { content, stopReason };
  };
}

/** 离线确定性假模型：第一次调 Glob，收到 tool_result 后结束 */
async function* mockModelCall(req: ModelRequest): AsyncGenerator<StreamEvent, ModelResponse> {
  const last = req.messages[req.messages.length - 1];
  const text =
    typeof last?.content === "string"
      ? last.content
      : JSON.stringify(last?.content ?? "");

  // If last message has tool results, end turn
  if (
    last?.role === "user" &&
    Array.isArray(last.content) &&
    last.content.some((b) => b.type === "tool_result")
  ) {
    const reply = "Mock: tools finished. Done.";
    yield { type: "text_delta", text: reply };
    return {
      content: [{ type: "text", text: reply }],
      stopReason: "end_turn",
    };
  }

  // First turn with tools available: call Glob once then stop next turn
  if (req.tools.some((t) => t.name === "Glob") && !text.includes("[context compact")) {
    const toolUse: ToolUseBlock = {
      type: "tool_use",
      id: "toolu_mock_1",
      name: "Glob",
      input: { pattern: "package.json" },
    };
    yield { type: "text_delta", text: "Mock: listing package.json via Glob.\n" };
    return {
      content: [
        { type: "text", text: "Mock: listing package.json via Glob." },
        toolUse,
      ],
      stopReason: "tool_use",
    };
  }

  const reply = "Mock LLM reply (set ANTHROPIC_API_KEY and unset MOCK_LLM for real calls).";
  yield { type: "text_delta", text: reply };
  return { content: [{ type: "text", text: reply }], stopReason: "end_turn" };
}
