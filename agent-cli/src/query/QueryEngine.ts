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
import { SessionExecLogger, resolveExecLogDir } from "../services/debug/sessionExecLog.js";
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
  private execLogger: SessionExecLogger | null = null;
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

  /** 初始化：会话 → 执行/LLM 日志 → 系统提示 / 工具 / MCP */
  async init(resumeSessionId?: string): Promise<void> {
    if (resumeSessionId) {
      const file = path.join(this.sessionDir, `${resumeSessionId}.jsonl`);
      const opened = await SessionStore.open(file);
      this.session = opened.store;
      this.messages = opened.messages;
    } else {
      this.session = await SessionStore.create(this.sessionDir);
    }

    const sessionId = this.session.sessionId;

    // 会话执行轨迹（用户输入 / 工具 / 输出）
    this.execLogger = new SessionExecLogger({ dir: resolveExecLogDir(this.cwd, sessionId) });
    await this.execLogger.init({
      sessionId,
      cwd: this.cwd,
      permissionMode: this.permissionMode,
      resumed: Boolean(resumeSessionId),
    });

    // 包装权限回调，把 allow/deny 也写入执行日志
    const rawAsk = this.askPermission;
    this.askPermission = async (toolName, input, reason) => {
      const allowed = await rawAsk(toolName, input, reason);
      await this.execLogger?.permission(toolName, input, allowed);
      return allowed;
    };

    // 每次传给大模型的 messages 落盘（含子代理 / compact 调用）
    const logDir = resolveLlmLogDir(this.cwd, sessionId);
    this.llmLogger = new LlmRequestLogger({ dir: logDir });
    this.modelCall = this.llmLogger.wrap(createModelCall());

    this.systemPrompt = await assembleSystemPrompt(this.cwd);
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

  /** 会话执行日志目录 */
  get execLogDir(): string | undefined {
    return this.execLogger?.enabled ? this.execLogger.dir : undefined;
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
    await this.execLogger?.turnStart(userText);

    const toolContext: ToolContext = {
      cwd: this.cwd,
      permissionMode: this.permissionMode,
      askPermission: this.askPermission,
      signal,
      depth: 0,
      maxDepth: 2,
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
      await this.execLogger?.onStreamEvent(ev);
      if (ev.type === "assistant_message") {
        await this.session?.recordMessage(ev.message);
      }
      yield ev;
      next = await gen.next();
    }

    await this.execLogger?.turnEnd(next.value);
    return next.value;
  }

  /** 释放 MCP 等外部连接，并关闭执行日志 */
  async dispose(): Promise<void> {
    await this.execLogger?.sessionEnd();
    await this.closeMcp?.();
  }
}
