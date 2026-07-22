/**
 * Agent 工具（单个 SubAgent）
 */
import { z } from "zod";
import { defineTool, type ToolDefinition } from "./Tool.js";
import { runSubAgent } from "../orchestrator/parallelAgents.js";
import type { ModelCall } from "./registry.js";

const inputSchema = z.object({
  description: z.string().describe("Short 3-5 word title for the subagent task"),
  prompt: z.string().describe("Full task for the subagent"),
  readonly: z.boolean().optional().describe("If true, only read-only tools"),
});

export function createAgentTool(deps: {
  getTools: (readonly: boolean) => ToolDefinition[];
  modelCall: ModelCall;
}): ToolDefinition {
  return defineTool({
    name: "Agent",
    description:
      "Delegate one focused subtask to an isolated subagent. For multiple independent tasks in parallel, prefer Orchestrate.",
    inputSchema,
    isReadOnly: true,
    checkPermission: async () => "allow" as const,
    async execute({ description, prompt, readonly }, ctx) {
      const result = await runSubAgent({
        task: { description, prompt, readonly },
        parentCtx: ctx,
        getTools: deps.getTools,
        modelCall: deps.modelCall,
      });
      const header = `[subagent:${description} depth=${ctx.depth + 1} stop=${result.stopKind} ${result.durationMs}ms]`;
      return `${header}\n\n${result.summary}`;
    },
  });
}
