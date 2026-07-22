import type { ToolContext, ToolDefinition } from "../tools/Tool.js";
import type { PermissionDecision } from "../types/messages.js";

/**
 * Deny-first / graduated trust — simplified Claude Code permission gate.
 * Modes: default (ask for writes), acceptEdits (auto file edits), bypassPermissions (all auto).
 */
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

  // acceptEdits: auto-approve non-bash edits
  if (ctx.permissionMode === "acceptEdits" && tool.name !== "Bash") {
    return true;
  }

  return ctx.askPermission(tool.name, input, tool.isReadOnly ? "read" : "write");
}
