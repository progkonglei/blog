/**
 * 内置工具注册表
 *
 * - createBuiltinTools：Bash/Read/Write/Edit/Glob/Grep/Agent/Orchestrate
 * - toolsToAnthropic：Zod → JSON Schema
 */
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ToolDefinition } from "./Tool.js";
import { BashTool } from "./BashTool.js";
import { FileReadTool } from "./FileReadTool.js";
import { FileWriteTool } from "./FileWriteTool.js";
import { FileEditTool } from "./FileEditTool.js";
import { GlobTool } from "./GlobTool.js";
import { GrepTool } from "./GrepTool.js";
import { createAgentTool } from "./AgentTool.js";
import { createOrchestrateTool } from "./OrchestrateTool.js";
import type { runQueryLoop } from "../query/queryLoop.js";

export type ModelCall = Parameters<typeof runQueryLoop>[0]["modelCall"];

/** 创建内置工具列表 */
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

  /** 工人工具：可含 Agent，但不含 Orchestrate（防止并行扇出） */
  const getWorkerTools = (readonly: boolean): ToolDefinition[] => {
    const filtered = readonly ? base.filter((t) => t.isReadOnly) : [...base];
    if (opts.includeAgent !== false) {
      filtered.push(
        createAgentTool({
          getTools: getWorkerTools,
          modelCall: opts.modelCall,
        }),
      );
    }
    return filtered;
  };

  /** 根工具：工人工具 + Orchestrate */
  const getRootTools = (readonly: boolean): ToolDefinition[] => {
    const tools = getWorkerTools(readonly);
    if (opts.includeAgent !== false) {
      tools.push(
        createOrchestrateTool({
          getTools: getRootTools,
          getWorkerTools,
          modelCall: opts.modelCall,
        }),
      );
    }
    return tools;
  };

  return getRootTools(false);
}

export function toolsToAnthropic(tools: ToolDefinition[]) {
  return tools.map((t) => {
    const json = zodToJsonSchema(t.inputSchema, {
      target: "jsonSchema7",
      $refStrategy: "none",
    }) as Record<string, unknown>;
    delete json.$schema;
    if (!json.type) json.type = "object";
    return {
      name: t.name,
      description: t.description,
      input_schema: sanitizeForFunctionCalling(json),
    };
  });
}

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
    delete obj.$schema;
    for (const v of Object.values(obj)) walk(v);
  }
}
