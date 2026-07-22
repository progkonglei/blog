/**
 * QueryEngine —— 会话引擎门面
 *
 * Claude Code 模式：REPL、-p/--print、子代理都走同一套引擎。
 * 负责：装载系统提示 / 工具 / MCP / 会话持久化，然后把用户输入交给 queryLoop。
 */
import type { Message, PermissionMode, StreamEvent, TerminalReason } from "../types/messages.js";
import type { ToolDefinition, ToolContext } from "../tools/Tool.js";
import { runQueryLoop } from "./queryLoop.js";
import { createModelCall, type ModelCaller } from "../services/api/provider.js";
import { createBuiltinTools } from "../tools/registry.js";
import { assembleSystemPrompt } from "../context/assemble.js";
import { loadMcpTools } from "../services/mcp/client.js";
import { SessionStore } from "../session/SessionStore.js";
import { LlmRequestLogger, resolveLlmLogDir } from "../services/debug/llmRequestLog.js";
import path from "node:path";

export type QueryEngineOptions = {
  cwd: string;
  permissionMode: PermissionMode;
  askPermission: ToolContext["askPermission"];
  sessionDir?: string;
  resumeSessionId?: string;
  maxTurns?: number;
  enableMcp?: boolean;
};

export class QueryEngine {
  readonly cwd: string;
  readonly permissionMode: PermissionMode;
  private askPermission: ToolContext["askPermission"];
  /** 当前会话的完整消息历史（内存中） */
  private messages: Message[] = [];
  private tools: ToolDefinition[] = [];
  private systemPrompt = "";
  private session: SessionStore | null = null;
  private closeMcp: (() => Promise<void>) | null = null;
  private modelCall: ModelCaller = createModelCall();
  private llmLogger: LlmRequestLogger | null = null;
  private maxTurns: number;
  private enableMcp: boolean;
  private sessionDir: string;

  constructor(opts: QueryEngineOptions) {
    this.cwd = opts.cwd;
    this.permissionMode = opts.permissionMode;
    this.askPermission = opts.askPermission;
    this.maxTurns = opts.maxTurns ?? 40;
    this.enableMcp = opts.enableMcp ?? true;
    this.sessionDir = opts.sessionDir ?? path.join(opts.cwd, ".sessions");
  }

  /** 初始化：会话 → 请求日志包装 → 系统提示 / 工具 / MCP */
  async init(resumeSessionId?: string): Promise<void> {
    // 先建会话，拿到 sessionId，再挂 LLM 请求日志目录
    if (resumeSessionId) {
      const file = path.join(this.sessionDir, `${resumeSessionId}.jsonl`);
      const opened = await SessionStore.open(file);
      this.session = opened.store;
      this.messages = opened.messages;
    } else {
      this.session = await SessionStore.create(this.sessionDir);
    }

    // 每次传给大模型的 messages 落盘（含子代理 / compact 调用）
    const logDir = resolveLlmLogDir(this.cwd, this.session.sessionId);
    this.llmLogger = new LlmRequestLogger({ dir: logDir });
    this.modelCall = this.llmLogger.wrap(createModelCall());

    this.systemPrompt = await assembleSystemPrompt(this.cwd);
    // 工具（含 Agent）必须用包装后的 modelCall，子代理请求才会被记录
    this.tools = createBuiltinTools({ modelCall: this.modelCall });

    if (this.enableMcp) {
      const mcp = await loadMcpTools(this.cwd);
      this.tools = [...this.tools, ...mcp.tools];
      this.closeMcp = mcp.close;
    }
  }

  get sessionId(): string | undefined {
    return this.session?.sessionId;
  }

  /** LLM 请求日志目录（未启用时为 undefined） */
  get llmLogDir(): string | undefined {
    return this.llmLogger?.enabled ? this.llmLogger.dir : undefined;
  }

  get history(): Message[] {
    return this.messages;
  }

  /** 清空内存中的对话（磁盘会话文件仍保留） */
  clear(): void {
    this.messages = [];
  }

  /**
   * 提交一轮用户输入，驱动查询循环。
   * 调用方 for-await 消费 StreamEvent 即可。
   */
  async *submit(userText: string, signal?: AbortSignal): AsyncGenerator<StreamEvent, TerminalReason> {
    const userMsg: Message = { role: "user", content: userText };
    this.messages.push(userMsg);
    await this.session?.recordMessage(userMsg);

    const toolContext: ToolContext = {
      cwd: this.cwd,
      permissionMode: this.permissionMode,
      askPermission: this.askPermission,
      signal,
      depth: 0,
      maxDepth: 2, // 根 Agent 最多再嵌套 2 层子代理
    };

    const gen = runQueryLoop({
      messages: this.messages,
      tools: this.tools,
      toolContext,
      systemPrompt: this.systemPrompt,
      modelCall: this.modelCall,
      maxTurns: this.maxTurns,
      signal,
    });

    let next = await gen.next();
    while (!next.done) {
      const ev = next.value;
      if (ev.type === "assistant_message") {
        await this.session?.recordMessage(ev.message);
      }
      yield ev;
      next = await gen.next();
    }
    return next.value;
  }

  /** 释放 MCP 等外部连接 */
  async dispose(): Promise<void> {
    await this.closeMcp?.();
  }
}
