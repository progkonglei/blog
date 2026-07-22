/**
 * 工具系统核心类型
 *
 * Claude Code 模式：每个工具声明 name / description / Zod schema / 执行函数，
 * 由查询循环统一做：schema 校验 → 权限门控 → execute → 回写 tool_result。
 */
import { z } from "zod";
import type { PermissionDecision, PermissionMode } from "../types/messages.js";

/** 工具执行时的运行时上下文（工作区、权限、取消信号、子代理深度） */
export type ToolContext = {
  /** 工作区根目录；所有相对路径相对此目录解析 */
  cwd: string;
  permissionMode: PermissionMode;
  /** 向用户询问是否允许执行（或由模式自动决定） */
  askPermission: (toolName: string, input: Record<string, unknown>, reason: string) => Promise<boolean>;
  /** 用于中断长时间运行的 Shell 等操作 */
  signal?: AbortSignal;
  /** 子代理嵌套深度：0 = 根 Agent */
  depth: number;
  /** 允许的最大嵌套深度，防止无限委派 */
  maxDepth: number;
};

/** 统一工具定义（注册表与 MCP 包装后都落成此结构） */
export type ToolDefinition = {
  name: string;
  description: string;
  /** Zod 入参 schema，同时用于运行时校验与生成 JSON Schema 给模型 */
  inputSchema: z.ZodTypeAny;
  /** 只读工具权限更轻，也可并发执行（本教学版串行执行） */
  isReadOnly: boolean;
  /** 可选：在询问用户前给出 allow/deny/ask 提示 */
  checkPermission?: (
    input: unknown,
    ctx: ToolContext,
  ) => PermissionDecision | Promise<PermissionDecision>;
  execute: (input: any, ctx: ToolContext) => Promise<string>;
};

/** 定义工具的工厂函数（保留 Zod 泛型推断，对外统一成 ToolDefinition） */
export function defineTool<T extends z.ZodTypeAny>(tool: {
  name: string;
  description: string;
  inputSchema: T;
  isReadOnly: boolean;
  checkPermission?: (
    input: z.infer<T>,
    ctx: ToolContext,
  ) => PermissionDecision | Promise<PermissionDecision>;
  execute: (input: z.infer<T>, ctx: ToolContext) => Promise<string>;
}): ToolDefinition {
  return tool as ToolDefinition;
}
