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
      // jsonSchema7 avoids OpenAPI boolean exclusiveMinimum (DeepSeek/OpenAI reject those)
      target: "jsonSchema7",
      $refStrategy: "none",
    }) as Record<string, unknown>;
    delete json.$schema;
    // Ensure top-level object schema
    if (!json.type) json.type = "object";
    return {
      name: t.name,
      description: t.description,
      input_schema: sanitizeForFunctionCalling(json),
    };
  });
}

/** Strip fields some OpenAI-compatible providers reject. */
function sanitizeForFunctionCalling(schema: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(schema)) as unknown;
  walk(clone);
  return clone as Record<string, unknown>;

  function walk(node: unknown): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const obj = node as Record<string, unknown>;
    for (const key of ["exclusiveMinimum", "exclusiveMaximum"]) {
      if (typeof obj[key] === "boolean") delete obj[key];
    }
    // DeepSeek is picky about unsupported keywords
    delete obj.$schema;
    for (const v of Object.values(obj)) walk(v);
  }
}
