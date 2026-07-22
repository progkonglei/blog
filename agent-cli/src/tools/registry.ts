/**
 * 内置工具注册表
 *
 * - createBuiltinTools：组装 Bash/Read/Write/Edit/Glob/Grep/Agent
 * - toolsToAnthropic：Zod → JSON Schema，供模型 function calling
 *
 * 注意：DeepSeek/OpenAI 对 JSON Schema 较严，需 sanitize 掉布尔 exclusiveMinimum 等字段。
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
import type { runQueryLoop } from "../query/queryLoop.js";

export type ModelCall = Parameters<typeof runQueryLoop>[0]["modelCall"];

/** 创建内置工具列表；Agent 工具通过闭包拿到 getTools，以便子代理裁剪工具集 */
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
    // readonly=true 时子代理只能用只读工具（探索代码库场景）
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

/** 转换为模型侧 tool schema（字段名沿用 Anthropic 的 input_schema） */
export function toolsToAnthropic(tools: ToolDefinition[]) {
  return tools.map((t) => {
    const json = zodToJsonSchema(t.inputSchema, {
      // 使用 jsonSchema7：避免 OpenAPI 的 boolean exclusiveMinimum（DeepSeek 会 400）
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

/** 清理部分 OpenAI 兼容网关不接受的 schema 关键字 */
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
