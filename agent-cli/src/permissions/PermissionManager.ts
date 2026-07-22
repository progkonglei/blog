/**
 * 权限门控
 *
 * 简化版 Claude Code「拒绝优先 + 渐进信任」：
 * bypassPermissions → 全放行
 * 工具自身 checkPermission → allow/deny/ask
 * acceptEdits → 自动批准非 Bash 的写操作
 * 否则 → 询问用户
 */
import type { ToolContext, ToolDefinition } from "../tools/Tool.js";
import type { PermissionDecision } from "../types/messages.js";

export async function gateToolPermission(
  tool: ToolDefinition,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<boolean> {
  if (ctx.permissionMode === "bypassPermissions") return true;

  let decision: PermissionDecision = "ask";
  if (tool.checkPermission) {
    decision = await tool.checkPermission(input, ctx);
  } else {
    decision = tool.isReadOnly ? "allow" : "ask";
  }

  if (decision === "allow") return true;
  if (decision === "deny") return false;

  // acceptEdits：文件编辑自动过，Shell 仍走询问（副作用更大）
  if (ctx.permissionMode === "acceptEdits" && tool.name !== "Bash") {
    return true;
  }

  return ctx.askPermission(tool.name, input, tool.isReadOnly ? "read" : "write");
}
