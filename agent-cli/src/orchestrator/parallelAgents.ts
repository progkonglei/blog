/**
 * 子代理执行内核 —— Agent / Orchestrate 共用
 * 隔离上下文，只返回摘要文本。
 */
import type { Message, StreamEvent } from "../types/messages.js";
import type { ToolContext, ToolDefinition } from "../tools/Tool.js";
import { runQueryLoop } from "../query/queryLoop.js";
import type { ModelCall } from "../tools/registry.js";

export type SubAgentTask = {
  description: string;
  prompt: string;
  readonly?: boolean;
};

export type SubAgentResult = {
  description: string;
  ok: boolean;
  summary: string;
  stopKind: string;
  durationMs: number;
};

export async function runSubAgent(opts: {
  task: SubAgentTask;
  parentCtx: ToolContext;
  getTools: (readonly: boolean) => ToolDefinition[];
  modelCall: ModelCall;
  /** 进度回调（供 UI / 编排器展示） */
  onEvent?: (ev: StreamEvent) => void;
}): Promise<SubAgentResult> {
  const started = Date.now();
  const { task, parentCtx } = opts;

  if (parentCtx.depth >= parentCtx.maxDepth) {
    return {
      description: task.description,
      ok: false,
      summary: `Max subagent depth (${parentCtx.maxDepth}) reached`,
      stopKind: "error",
      durationMs: 0,
    };
  }

  const tools = opts.getTools(Boolean(task.readonly));
  // 并行子代理不再嵌套 Orchestrate/Agent，避免扇出爆炸：由 getTools(readonly) 控制
  const childCtx: ToolContext = {
    ...parentCtx,
    depth: parentCtx.depth + 1,
    permissionMode: task.readonly ? "bypassPermissions" : parentCtx.permissionMode,
  };

  const messages: Message[] = [
    {
      role: "user",
      content: `Subagent task (${task.description}):\n\n${task.prompt}\n\nWhen finished, reply with a concise summary of findings. Do not ask the user questions.`,
    },
  ];

  let summary = "";
  try {
    const gen = runQueryLoop({
      messages,
      tools,
      toolContext: childCtx,
      modelCall: opts.modelCall,
      systemPrompt:
        "You are a focused subagent. Complete the task with tools, then return a clear summary. Prefer Read/Grep/Glob; avoid unnecessary writes.",
      maxTurns: 12,
      compactThresholdChars: 120_000,
      signal: parentCtx.signal,
    });

    let terminal = await gen.next();
    while (!terminal.done) {
      const ev = terminal.value as StreamEvent;
      opts.onEvent?.(ev);
      if (ev.type === "text_delta") summary += ev.text;
      if (ev.type === "assistant_message" && typeof ev.message.content === "string") {
        summary = ev.message.content;
      }
      if (ev.type === "assistant_message" && Array.isArray(ev.message.content)) {
        const texts = ev.message.content
          .filter((b): b is { type: "text"; text: string } => b.type === "text")
          .map((b) => b.text);
        if (texts.length) summary = texts.join("\n");
      }
      terminal = await gen.next();
    }

    const reason = terminal.value;
    return {
      description: task.description,
      ok: reason.kind !== "error",
      summary: summary.trim() || "(no text summary)",
      stopKind: reason.kind,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return {
      description: task.description,
      ok: false,
      summary: err instanceof Error ? err.message : String(err),
      stopKind: "error",
      durationMs: Date.now() - started,
    };
  }
}

/**
 * 并行编排：同时跑多个隔离子代理，汇总结果。
 * Claude Code coordinator / agent swarm 的精简版。
 */
export async function runParallelAgents(opts: {
  tasks: SubAgentTask[];
  parentCtx: ToolContext;
  getTools: (readonly: boolean) => ToolDefinition[];
  modelCall: ModelCall;
  onTaskEvent?: (index: number, description: string, ev: StreamEvent) => void;
  onTaskStatus?: (index: number, description: string, status: "running" | "done" | "error") => void;
}): Promise<SubAgentResult[]> {
  const { tasks } = opts;
  if (!tasks.length) return [];

  opts.onTaskStatus &&
    tasks.forEach((t, i) => opts.onTaskStatus?.(i, t.description, "running"));

  const promises = tasks.map(async (task, index) => {
    const result = await runSubAgent({
      task,
      parentCtx: opts.parentCtx,
      getTools: opts.getTools,
      modelCall: opts.modelCall,
      onEvent: (ev) => opts.onTaskEvent?.(index, task.description, ev),
    });
    opts.onTaskStatus?.(index, task.description, result.ok ? "done" : "error");
    return result;
  });

  return Promise.all(promises);
}

/** 格式化并行结果给父模型 */
export function formatParallelResults(results: SubAgentResult[]): string {
  const lines = [
    `[orchestrate] ${results.length} subagents finished`,
    "",
    ...results.map((r, i) => {
      const mark = r.ok ? "✓" : "✗";
      return [
        `### ${mark} [${i + 1}] ${r.description} (${r.durationMs}ms, stop=${r.stopKind})`,
        r.summary,
        "",
      ].join("\n");
    }),
  ];
  return lines.join("\n");
}
