/**
 * 查询循环（Agent Loop）—— Claude Code 的心脏
 *
 * 实现为 AsyncGenerator：
 *   while (未结束) {
 *     压缩上下文（可选）
 *     调用模型（流式 yield 事件）
 *     若有 tool_use → 权限检查 → 执行 → 把结果写入历史 → 继续
 *     否则 end_turn
 *   }
 *
 * 通过 yield phase 事件，让执行日志能画出清晰的流水线。
 */
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

/** 发给模型层的请求 */
export type ModelRequest = {
  system: string;
  messages: Message[];
  tools: ReturnType<typeof import("../tools/registry.js").toolsToAnthropic>;
  signal?: AbortSignal;
};

/** 模型一次调用的结构化结果 */
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

export async function* runQueryLoop(opts: QueryLoopOptions): AsyncGenerator<StreamEvent, TerminalReason> {
  const maxTurns = opts.maxTurns ?? 40;
  const toolMap = new Map(opts.tools.map((t) => [t.name, t]));
  const { toolsToAnthropic } = await import("../tools/registry.js");
  const anthropicTools = toolsToAnthropic(opts.tools);

  let step = 0;
  while (step < maxTurns) {
    if (opts.signal?.aborted) return { kind: "aborted" };
    step += 1;

    yield {
      type: "phase",
      step,
      phase: "loop_step",
      detail: `Agent 循环第 ${step} 步（模型推理 → 可选工具 → 回灌）`,
    };

    // ① 压缩检查
    yield { type: "phase", step, phase: "compact_check", detail: "检查上下文是否需要压缩" };
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
        type: "phase",
        step,
        phase: "compact_done",
        detail: `${compacted.beforeChars} → ${compacted.afterChars} chars`,
      };
      yield {
        type: "compact",
        before: compacted.beforeChars,
        after: compacted.afterChars,
        summary: compacted.summary,
      };
    }

    // ② 调用模型
    yield {
      type: "phase",
      step,
      phase: "model_call_start",
      detail: `messages=${opts.messages.length} tools=${anthropicTools.length}`,
    };
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

    const toolUses = modelResult.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
    const textPreview = modelResult.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("")
      .slice(0, 120);
    yield {
      type: "phase",
      step,
      phase: "model_call_end",
      detail: `stop=${modelResult.stopReason} tools=${toolUses.length}${textPreview ? ` text="${textPreview.replace(/\n/g, " ")}…"` : ""}`,
    };

    // ③ 写入历史
    const assistantMsg: Message = { role: "assistant", content: modelResult.content };
    opts.messages.push(assistantMsg);
    yield { type: "assistant_message", message: assistantMsg };

    // ④ 无工具 → 结束
    if (toolUses.length === 0 || modelResult.stopReason === "end_turn") {
      yield { type: "phase", step, phase: "end_turn", detail: "模型未再请求工具，本轮结束" };
      return { kind: "end_turn" };
    }

    // ⑤ 执行工具
    yield {
      type: "phase",
      step,
      phase: "tool_dispatch",
      detail: toolUses.map((t) => t.name).join(", "),
    };
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

    // ⑥ 回灌历史，进入下一步模型调用
    opts.messages.push({ role: "user", content: results });
    yield {
      type: "phase",
      step,
      phase: "tool_results_to_history",
      detail: `回写 ${results.length} 条 tool_result，进入下一步模型推理`,
    };
  }

  return { kind: "max_turns", turns: maxTurns };
}
