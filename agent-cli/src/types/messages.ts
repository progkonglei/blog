/** Shared message & stream event types — mirrors Claude Code's message model at a small scale. */

export type Role = "user" | "assistant" | "system";

export type TextBlock = {
  type: "text";
  text: string;
};

export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export type Message = {
  role: Role;
  content: string | ContentBlock[];
};

/** Events yielded by the AsyncGenerator query loop (UI / REPL consume these). */
export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; output: string; isError?: boolean }
  | { type: "assistant_message"; message: Message }
  | { type: "status"; message: string }
  | { type: "compact"; before: number; after: number; summary: string }
  | { type: "error"; error: string };

export type TerminalReason =
  | { kind: "end_turn" }
  | { kind: "max_turns"; turns: number }
  | { kind: "aborted" }
  | { kind: "error"; error: string };

export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions";

export type PermissionDecision = "allow" | "deny" | "ask";
