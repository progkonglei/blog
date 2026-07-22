/**
 * 会话执行日志
 *
 * 记录一次会话里「发生了什么」：用户输入、工具调用、工具结果、
 * 文本输出、压缩、权限询问、结束原因等。与 LLM 请求日志互补：
 * - llm-logs：传给模型的完整请求体
 * - exec-logs：运行时执行轨迹（便于回放 / 排障）
 *
 * 目录默认：<cwd>/.sessions/exec-logs/<sessionId>/
 *   ├── exec.jsonl   # 结构化事件（一行一条）
 *   └── exec.log     # 人类可读文本
 */
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { StreamEvent, TerminalReason } from "../../types/messages.js";

export type SessionExecLogOptions = {
  dir: string;
  enabled?: boolean;
};

export class SessionExecLogger {
  readonly dir: string;
  readonly enabled: boolean;
  readonly jsonlPath: string;
  readonly textPath: string;
  /** 聚合 text_delta，避免每个 token 写一行 */
  private textBuf = "";
  private turn = 0;

  constructor(opts: SessionExecLogOptions) {
    this.dir = opts.dir;
    this.enabled = opts.enabled ?? process.env.AGENT_EXEC_LOG !== "0";
    this.jsonlPath = path.join(this.dir, "exec.jsonl");
    this.textPath = path.join(this.dir, "exec.log");
  }

  async init(meta: Record<string, unknown>): Promise<void> {
    if (!this.enabled) return;
    await mkdir(this.dir, { recursive: true });
    await this.write(
      { type: "session_start", ...meta },
      `=== session start ${meta.sessionId ?? ""} ===`,
    );
  }

  async turnStart(userText: string): Promise<void> {
    if (!this.enabled) return;
    await this.flushText();
    this.turn += 1;
    await this.write(
      { type: "user_input", turn: this.turn, text: userText },
      `\n--- turn ${this.turn} ---\nuser> ${userText}`,
    );
  }

  /** 记录查询循环产出的流式事件 */
  async onStreamEvent(ev: StreamEvent): Promise<void> {
    if (!this.enabled) return;

    if (ev.type === "text_delta") {
      this.textBuf += ev.text;
      return;
    }

    await this.flushText();

    switch (ev.type) {
      case "tool_start":
        await this.write(
          { type: "tool_start", id: ev.id, name: ev.name, input: ev.input },
          `⚙ ${ev.name}(${safeJson(ev.input)})`,
        );
        break;
      case "tool_result":
        await this.write(
          {
            type: "tool_result",
            id: ev.id,
            name: ev.name,
            isError: ev.isError ?? false,
            output: truncate(ev.output, 50_000),
          },
          `${ev.isError ? "✗" : "✓"} ${ev.name}: ${truncate(ev.output, 500)}`,
        );
        break;
      case "assistant_message":
        await this.write(
          { type: "assistant_message", message: ev.message },
          `(assistant_message recorded)`,
        );
        break;
      case "compact":
        await this.write(
          { type: "compact", before: ev.before, after: ev.after, summary: ev.summary },
          `♻ compact ${ev.before}→${ev.after}`,
        );
        break;
      case "status":
        await this.write({ type: "status", message: ev.message }, `status: ${ev.message}`);
        break;
      case "error":
        await this.write({ type: "error", error: ev.error }, `ERROR: ${ev.error}`);
        break;
      default:
        break;
    }
  }

  async turnEnd(reason: TerminalReason): Promise<void> {
    if (!this.enabled) return;
    await this.flushText();
    await this.write(
      { type: "turn_end", turn: this.turn, reason },
      `turn_end: ${JSON.stringify(reason)}`,
    );
  }

  async permission(toolName: string, input: Record<string, unknown>, allowed: boolean): Promise<void> {
    if (!this.enabled) return;
    await this.write(
      { type: "permission", toolName, input, allowed },
      `permission ${allowed ? "ALLOW" : "DENY"} ${toolName}(${safeJson(input)})`,
    );
  }

  async sessionEnd(): Promise<void> {
    if (!this.enabled) return;
    await this.flushText();
    await this.write({ type: "session_end" }, `=== session end ===\n`);
  }

  private async flushText(): Promise<void> {
    if (!this.textBuf) return;
    const text = this.textBuf;
    this.textBuf = "";
    await this.write({ type: "assistant_text", text }, `assistant> ${text}`);
  }

  private async write(event: Record<string, unknown>, line: string): Promise<void> {
    const ts = new Date().toISOString();
    const payload = { ts, turn: this.turn || undefined, ...event };
    await appendFile(this.jsonlPath, `${JSON.stringify(payload)}\n`, "utf8");
    await appendFile(this.textPath, `[${ts}] ${line}\n`, "utf8");
  }
}

export function resolveExecLogDir(cwd: string, sessionId: string): string {
  const override = process.env.AGENT_EXEC_LOG_DIR;
  if (override) return path.join(override, sessionId);
  return path.join(cwd, ".sessions", "exec-logs", sessionId);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n...[truncated ${s.length - max} chars]`;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
