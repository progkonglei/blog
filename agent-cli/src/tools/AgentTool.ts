import { z } from "zod";
import { defineTool, type ToolContext, type ToolDefinition } from "./Tool.js";
import type { Message, StreamEvent } from "../types/messages.js";
import { runQueryLoop } from "../query/queryLoop.js";

const inputSchema = z.object({
  description: z.string().describe("Short 3-5 word title for the subagent task"),
  prompt: z.string().describe("Full task for the subagent"),
  readonly: z.boolean().optional().describe("If true, only read-only tools"),
});

/**
 * AgentTool — Claude Code pattern: spawn an isolated query() with its own
 * message history; return only a summary to the parent (context isolation).
 */
export function createAgentTool(deps: {
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
        permissionMode: readonly ? "bypassPermissions" : ctx.permissionMode,
      };

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

      let terminal = await gen.next();
      while (!terminal.done) {
        const ev = terminal.value as StreamEvent;
        if (ev.type === "text_delta") summary += ev.text;
        if (ev.type === "assistant_message" && typeof ev.message.content === "string") {
          summary = ev.message.content;
        }
        if (
          ev.type === "assistant_message" &&
          Array.isArray(ev.message.content)
        ) {
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
