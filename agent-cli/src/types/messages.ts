/**
 * 消息与流式事件类型定义
 *
 * 对齐 Claude Code 的小型消息模型：
 * - Message：送给模型的对话历史
 * - StreamEvent：查询循环产出的事件，供 REPL / UI 渲染
 * - TerminalReason：循环结束原因（正常结束 / 超轮次 / 中断 / 错误）
 */

/** 对话角色 */
export type Role = "user" | "assistant" | "system";

/** 普通文本块 */
export type TextBlock = {
  type: "text";
  text: string;
};

/** 模型发起的工具调用 */
export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};

/** 工具执行结果（回传给模型） */
export type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

/** 一条对话消息；content 可以是纯文本，也可以是多块内容 */
export type Message = {
  role: Role;
  content: string | ContentBlock[];
};

/**
 * 查询循环（AsyncGenerator）向外 yield 的事件。
 * UI 层只需要消费这些事件即可实时展示进度。
 */
export type StreamEvent =
  | { type: "text_delta"; text: string } // 模型流式文本增量
  | { type: "tool_start"; id: string; name: string; input: Record<string, unknown> } // 开始执行工具
  | { type: "tool_result"; id: string; name: string; output: string; isError?: boolean } // 工具结果
  | { type: "assistant_message"; message: Message } // 完整助手消息（已写入历史）
  | { type: "status"; message: string } // 状态提示
  | { type: "compact"; before: number; after: number; summary: string } // 上下文压缩完成
  | { type: "error"; error: string }; // 错误

/** 查询循环终止原因（生成器 return 值） */
export type TerminalReason =
  | { kind: "end_turn" } // 模型结束本轮（无更多工具调用）
  | { kind: "max_turns"; turns: number } // 达到最大轮次保护
  | { kind: "aborted" } // 用户中断（Ctrl+C）
  | { kind: "error"; error: string }; // 不可恢复错误

/**
 * 权限模式（简化版 Claude Code 信任梯度）
 * - default：写操作询问用户
 * - acceptEdits：自动批准文件编辑，Bash 仍可能询问
 * - bypassPermissions：全部自动批准
 */
export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions";

/** 单个工具的权限判定结果 */
export type PermissionDecision = "allow" | "deny" | "ask";
