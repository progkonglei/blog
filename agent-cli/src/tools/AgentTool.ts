/**
 * Agent 工具（SubAgent）
 *
 * Claude Code 模式：
 * 1. 父 Agent 通过 Agent 工具委派子任务
 * 2. 子会话拥有独立 messages（不继承父聊天史）
 * 3. 子会话跑完自己的 queryLoop
 * 4. 只把摘要文本返回父会话 —— 避免上下文爆炸
 */
import { z } from "zod";
import { defineTool, type ToolContext, type ToolDefinition } from "./Tool.js";
import type { Message, StreamEvent } from "../types/messages.js";
import { runQueryLoop } from "../query/queryLoop.js";

const inputSchema = z.object({
  description: z.string().describe("Short 3-5 word title for the subagent task"),
  prompt: z.string().describe("Full task for the subagent"),
  readonly: z.boolean().optional().describe("If true, only read-only tools"),
});

export function createAgentTool(deps: {
  /** 按是否只读裁剪工具集；子代理也可再次拿到 Agent（受 maxDepth 限制） */
  getTools: (readonly: boolean) => ToolDefinition[];
  modelCall: Parameters<typeof runQueryLoop>[0]["modelCall"];
}): ToolDefinition {
  return defineTool({
    name: "Agent",
    description:
      "Delegate a focused subtask to a subagent with an isolated context window. Use for exploration or parallel research. Returns a summary only.",
    inputSchema,
    isReadOnly: true,
    checkPermission: async () => "allow" as const,
    async execute({ description, prompt, readonly }, ctx) {
      if (ctx.depth >= ctx.maxDepth) {
        throw new Error(`Max subagent depth (${ctx.maxDepth}) reached`);
      }

      const tools = deps.getTools(Boolean(readonly));
      const childCtx: ToolContext = {
        ...ctx,
        depth: ctx.depth + 1,
        // 只读子代理：跳过写权限询问，加快探索
        permissionMode: readonly ? "bypassPermissions" : ctx.permissionMode,
      };

      // 独立历史：不带父会话上下文
      const messages: Message[] = [
        {
          role: "user",
          content: `Subagent task (${description}):\n\n${prompt}\n\nWhen finished, reply with a concise summary of findings. Do not ask the user questions.`,
        },
      ];

      let summary = "";
      const gen = runQueryLoop({
        messages,
        tools,
        toolContext: childCtx,
        modelCall: deps.modelCall,
        systemPrompt:
          "You are a focused subagent. Complete the task with tools, then return a clear summary. Prefer Read/Grep/Glob; avoid unnecessary writes.",
        maxTurns: 12,
        compactThresholdChars: 120_000,
      });

      // 消费子循环事件，只保留最终文本摘要返回父 Agent
      let terminal = await gen.next();
      while (!terminal.done) {
        const ev = terminal.value as StreamEvent;
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
      const header = `[subagent:${description} depth=${childCtx.depth} stop=${reason.kind}]`;
      return `${header}\n\n${summary.trim() || "(no text summary)"}`;
    },
  });
}
