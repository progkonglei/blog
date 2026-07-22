import type {
  ContentBlock,
  Message,
  StreamEvent,
  TerminalReason,
  ToolResultBlock,
  ToolUseBlock,
} from "../types/messages.js";
import type { ToolContext, ToolDefinition } from "../tools/Tool.js";
import { maybeCompact } from "../services/compact/compact.js";
import { gateToolPermission } from "../permissions/PermissionManager.js";

export type ModelRequest = {
  system: string;
  messages: Message[];
  tools: ReturnType<typeof import("../tools/registry.js").toolsToAnthropic>;
  signal?: AbortSignal;
};

export type ModelResponse = {
  content: ContentBlock[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "other";
};

export type QueryLoopOptions = {
  messages: Message[];
  tools: ToolDefinition[];
  toolContext: ToolContext;
  systemPrompt: string;
  modelCall: (req: ModelRequest) => AsyncGenerator<StreamEvent, ModelResponse>;
  maxTurns?: number;
  compactThresholdChars?: number;
  signal?: AbortSignal;
};

/**
 * Claude Code–style agent loop as an AsyncGenerator.
 * Yields StreamEvents for the UI; returns a typed TerminalReason.
 */
export async function* runQueryLoop(opts: QueryLoopOptions): AsyncGenerator<StreamEvent, TerminalReason> {
  const maxTurns = opts.maxTurns ?? 40;
  const toolMap = new Map(opts.tools.map((t) => [t.name, t]));
  const { toolsToAnthropic } = await import("../tools/registry.js");
  const anthropicTools = toolsToAnthropic(opts.tools);

  let turn = 0;
  while (turn < maxTurns) {
    if (opts.signal?.aborted) return { kind: "aborted" };
    turn += 1;

    const compacted = await maybeCompact(opts.messages, {
      thresholdChars: opts.compactThresholdChars ?? 180_000,
      modelCall: opts.modelCall,
      systemPrompt: opts.systemPrompt,
      tools: anthropicTools,
      signal: opts.signal,
    });
    if (compacted) {
      opts.messages.length = 0;
      opts.messages.push(...compacted.messages);
      yield {
        type: "compact",
        before: compacted.beforeChars,
        after: compacted.afterChars,
        summary: compacted.summary,
      };
    }

    let modelResult: ModelResponse;
    try {
      const gen = opts.modelCall({
        system: opts.systemPrompt,
        messages: opts.messages,
        tools: anthropicTools,
        signal: opts.signal,
      });
      let next = await gen.next();
      while (!next.done) {
        yield next.value;
        next = await gen.next();
      }
      modelResult = next.value;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      yield { type: "error", error: msg };
      return { kind: "error", error: msg };
    }

    const assistantMsg: Message = { role: "assistant", content: modelResult.content };
    opts.messages.push(assistantMsg);
    yield { type: "assistant_message", message: assistantMsg };

    const toolUses = modelResult.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0 || modelResult.stopReason === "end_turn") {
      return { kind: "end_turn" };
    }

    const results: ToolResultBlock[] = [];
    for (const use of toolUses) {
      yield { type: "tool_start", id: use.id, name: use.name, input: use.input };
      const tool = toolMap.get(use.name);
      if (!tool) {
        const output = `Unknown tool: ${use.name}`;
        results.push({ type: "tool_result", tool_use_id: use.id, content: output, is_error: true });
        yield { type: "tool_result", id: use.id, name: use.name, output, isError: true };
        continue;
      }

      let parsed: unknown;
      try {
        parsed = tool.inputSchema.parse(use.input);
      } catch (err) {
        const output = `Invalid tool input: ${err instanceof Error ? err.message : String(err)}`;
        results.push({ type: "tool_result", tool_use_id: use.id, content: output, is_error: true });
        yield { type: "tool_result", id: use.id, name: use.name, output, isError: true };
        continue;
      }

      const allowed = await gateToolPermission(tool, parsed as Record<string, unknown>, opts.toolContext);
      if (!allowed) {
        const output = "Permission denied by user / policy";
        results.push({ type: "tool_result", tool_use_id: use.id, content: output, is_error: true });
        yield { type: "tool_result", id: use.id, name: use.name, output, isError: true };
        continue;
      }

      try {
        const output = await tool.execute(parsed, opts.toolContext);
        results.push({ type: "tool_result", tool_use_id: use.id, content: output });
        yield { type: "tool_result", id: use.id, name: use.name, output };
      } catch (err) {
        const output = err instanceof Error ? err.message : String(err);
        results.push({ type: "tool_result", tool_use_id: use.id, content: output, is_error: true });
        yield { type: "tool_result", id: use.id, name: use.name, output, isError: true };
      }
    }

    // Anthropic: tool results are a user message with tool_result blocks
    opts.messages.push({ role: "user", content: results });
  }

  return { kind: "max_turns", turns: maxTurns };
}
