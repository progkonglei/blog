import { zodToJsonSchema } from "zod-to-json-schema";
import type { ToolDefinition } from "./Tool.js";
import { BashTool } from "./BashTool.js";
import { FileReadTool } from "./FileReadTool.js";
import { FileWriteTool } from "./FileWriteTool.js";
import { FileEditTool } from "./FileEditTool.js";
import { GlobTool } from "./GlobTool.js";
import { GrepTool } from "./GrepTool.js";
import { createAgentTool } from "./AgentTool.js";
import type { runQueryLoop } from "../query/queryLoop.js";

export type ModelCall = Parameters<typeof runQueryLoop>[0]["modelCall"];

export function createBuiltinTools(opts: {
  modelCall: ModelCall;
  includeAgent?: boolean;
}): ToolDefinition[] {
  const base: ToolDefinition[] = [
    BashTool,
    FileReadTool,
    FileWriteTool,
    FileEditTool,
    GlobTool,
    GrepTool,
  ];

  const getTools = (readonly: boolean): ToolDefinition[] => {
    const filtered = readonly ? base.filter((t) => t.isReadOnly) : [...base];
    if (opts.includeAgent !== false) {
      filtered.push(
        createAgentTool({
          getTools,
          modelCall: opts.modelCall,
        }),
      );
    }
    return filtered;
  };

  return getTools(false);
}

export function toolsToAnthropic(tools: ToolDefinition[]) {
  return tools.map((t) => {
    const json = zodToJsonSchema(t.inputSchema, {
      target: "openApi3",
      $refStrategy: "none",
    }) as Record<string, unknown>;
    delete json.$schema;
    return {
      name: t.name,
      description: t.description,
      input_schema: json,
    };
  });
}
