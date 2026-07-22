import type { Message, PermissionMode, StreamEvent, TerminalReason } from "../types/messages.js";
import type { ToolDefinition, ToolContext } from "../tools/Tool.js";
import { runQueryLoop } from "./queryLoop.js";
import { createAnthropicModelCall } from "../services/api/anthropic.js";
import { createBuiltinTools } from "../tools/registry.js";
import { assembleSystemPrompt } from "../context/assemble.js";
import { loadMcpTools } from "../services/mcp/client.js";
import { SessionStore } from "../session/SessionStore.js";
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

/**
 * QueryEngine — single entry used by REPL and --print (Claude Code pattern:
 * one loop for all interfaces).
 */
export class QueryEngine {
  readonly cwd: string;
  readonly permissionMode: PermissionMode;
  private askPermission: ToolContext["askPermission"];
  private messages: Message[] = [];
  private tools: ToolDefinition[] = [];
  private systemPrompt = "";
  private session: SessionStore | null = null;
  private closeMcp: (() => Promise<void>) | null = null;
  private modelCall = createAnthropicModelCall();
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

  async init(resumeSessionId?: string): Promise<void> {
    this.systemPrompt = await assembleSystemPrompt(this.cwd);
    this.tools = createBuiltinTools({ modelCall: this.modelCall });

    if (this.enableMcp) {
      const mcp = await loadMcpTools(this.cwd);
      this.tools = [...this.tools, ...mcp.tools];
      this.closeMcp = mcp.close;
    }

    if (resumeSessionId) {
      const file = path.join(this.sessionDir, `${resumeSessionId}.jsonl`);
      const opened = await SessionStore.open(file);
      this.session = opened.store;
      this.messages = opened.messages;
    } else {
      this.session = await SessionStore.create(this.sessionDir);
    }
  }

  get sessionId(): string | undefined {
    return this.session?.sessionId;
  }

  get history(): Message[] {
    return this.messages;
  }

  clear(): void {
    this.messages = [];
  }

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
      if (ev.type === "assistant_message") {
        await this.session?.recordMessage(ev.message);
      }
      yield ev;
      next = await gen.next();
    }
    return next.value;
  }

  async dispose(): Promise<void> {
    await this.closeMcp?.();
  }
}
