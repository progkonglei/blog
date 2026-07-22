/**
 * Orchestrate —— 多 Agent 并行编排工具
 *
 * 一次传入多个独立任务，Promise.all 并行跑隔离子代理，
 * 只把各任务摘要汇总回父 Agent（Claude Code coordinator 精简版）。
 */
import { z } from "zod";
import { defineTool, type ToolDefinition } from "./Tool.js";
import { formatParallelResults, runParallelAgents } from "../orchestrator/parallelAgents.js";
import type { ModelCall } from "./registry.js";

const inputSchema = z.object({
  tasks: z
    .array(
      z.object({
        description: z.string().describe("Short title"),
        prompt: z.string().describe("Full task prompt"),
        readonly: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(8)
    .describe("Independent tasks to run in parallel (max 8)"),
});

export function createOrchestrateTool(deps: {
  getTools: (readonly: boolean) => ToolDefinition[];
  /** 子代理工具集：应排除 Orchestrate，防止递归扇出 */
  getWorkerTools: (readonly: boolean) => ToolDefinition[];
  modelCall: ModelCall;
}): ToolDefinition {
  return defineTool({
    name: "Orchestrate",
    description:
      "Run multiple independent subagents in parallel and return combined summaries. Use when tasks do not depend on each other (e.g. explore different dirs). Max 8 tasks.",
    inputSchema,
    isReadOnly: true,
    checkPermission: async () => "allow" as const,
    async execute({ tasks }, ctx) {
      if (ctx.depth >= ctx.maxDepth) {
        throw new Error(`Max agent depth (${ctx.maxDepth}) reached; cannot orchestrate`);
      }

      const results = await runParallelAgents({
        tasks,
        parentCtx: ctx,
        // worker 不用 Orchestrate，避免并行里再并行爆炸
        getTools: deps.getWorkerTools,
        modelCall: deps.modelCall,
      });

      return formatParallelResults(results);
    },
  });
}
