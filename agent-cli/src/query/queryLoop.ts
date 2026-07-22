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
 * UI / REPL / --print / 子代理 都复用这一条循环。
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
  /** 可变的对话历史（循环内会追加 assistant / tool_result） */
  messages: Message[];
  tools: ToolDefinition[];
  toolContext: ToolContext;
  systemPrompt: string;
  /** 模型调用：本身也是 AsyncGenerator，先 yield 流式事件，最后 return ModelResponse */
  modelCall: (req: ModelRequest) => AsyncGenerator<StreamEvent, ModelResponse>;
  maxTurns?: number;
  /** 触发自动压缩的历史字符数阈值 */
  compactThresholdChars?: number;
  signal?: AbortSignal;
};

/**
 * 运行 Agent 循环。
 * @yields StreamEvent 供 UI 渲染
 * @returns TerminalReason 说明为何停止
 */
export async function* runQueryLoop(opts: QueryLoopOptions): AsyncGenerator<StreamEvent, TerminalReason> {
  const maxTurns = opts.maxTurns ?? 40;
  const toolMap = new Map(opts.tools.map((t) => [t.name, t]));
  const { toolsToAnthropic } = await import("../tools/registry.js");
  // 把 Zod schema 转成模型可消费的 JSON Schema 工具列表
  const anthropicTools = toolsToAnthropic(opts.tools);

  let turn = 0;
  while (turn < maxTurns) {
    if (opts.signal?.aborted) return { kind: "aborted" };
    turn += 1;

    // ① 调用模型前：必要时压缩历史，避免撑爆上下文窗口
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

    // ② 调用模型（流式转发事件）
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

    // ③ 把助手消息写入历史
    const assistantMsg: Message = { role: "assistant", content: modelResult.content };
    opts.messages.push(assistantMsg);
    yield { type: "assistant_message", message: assistantMsg };

    // ④ 无工具调用 → 本轮结束
    const toolUses = modelResult.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0 || modelResult.stopReason === "end_turn") {
      return { kind: "end_turn" };
    }

    // ⑤ 逐个执行工具：校验 → 权限 → execute
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

    // ⑥ 工具结果作为 user 消息回灌（Anthropic / 兼容协议惯例）
    opts.messages.push({ role: "user", content: results });
  }

  return { kind: "max_turns", turns: maxTurns };
}
