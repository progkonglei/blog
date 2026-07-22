import { z } from "zod";
import type { PermissionDecision, PermissionMode } from "../types/messages.js";

export type ToolContext = {
  cwd: string;
  permissionMode: PermissionMode;
  /** Ask the user (or auto-resolve based on mode). */
  askPermission: (toolName: string, input: Record<string, unknown>, reason: string) => Promise<boolean>;
  signal?: AbortSignal;
  /** Nested depth for subagents (0 = root). */
  depth: number;
  maxDepth: number;
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  /** Read-only tools can run concurrently / with lighter permission. */
  isReadOnly: boolean;
  /** Optional static permission hint before ask. */
  checkPermission?: (
    input: unknown,
    ctx: ToolContext,
  ) => PermissionDecision | Promise<PermissionDecision>;
  execute: (input: any, ctx: ToolContext) => Promise<string>;
};

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
