/**
 * 并行编排冒烟（不启动 Ink）
 * MOCK_LLM=1 npx tsx src/orchestrator/smoke.ts
 */
import { createModelCall } from "../services/api/provider.js";
import { createBuiltinTools } from "../tools/registry.js";
import { runParallelAgents, formatParallelResults } from "./parallelAgents.js";
import type { ToolContext } from "../tools/Tool.js";

async function main() {
  process.env.MOCK_LLM = process.env.MOCK_LLM ?? "1";
  const modelCall = createModelCall();
  const tools = createBuiltinTools({ modelCall });
  // worker tools = without Orchestrate
  const workerTools = tools.filter((t) => t.name !== "Orchestrate");

  const ctx: ToolContext = {
    cwd: process.cwd(),
    permissionMode: "bypassPermissions",
    askPermission: async () => true,
    depth: 0,
    maxDepth: 2,
  };

  const results = await runParallelAgents({
    tasks: [
      { description: "find package", prompt: "Use Glob to find package.json", readonly: true },
      { description: "list src", prompt: "Use Glob to list src/**/*.ts files", readonly: true },
    ],
    parentCtx: ctx,
    getTools: (readonly) =>
      readonly ? workerTools.filter((t) => t.isReadOnly) : workerTools,
    modelCall,
    onTaskStatus: (i, d, s) => console.error(`[agent ${i}] ${d}: ${s}`),
  });

  console.log(formatParallelResults(results));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
