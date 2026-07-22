/**
 * 大模型请求落盘
 *
 * 每次调用模型前，把 system / messages / tools 摘要写成本地文件，
 * 便于排查「到底给模型看了什么」。
 *
 * 目录默认：<cwd>/.sessions/llm-logs/<sessionId>/
 *   ├── requests.jsonl          # 追加索引（一行一次请求）
 *   ├── 0001-request.json       # 完整请求体
 *   └── 0001-response.json      # 模型返回（可选，便于对照）
 */
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ModelRequest, ModelResponse } from "../../query/queryLoop.js";
import type { StreamEvent } from "../../types/messages.js";
import type { ModelCaller } from "../api/provider.js";

export type LlmLogOptions = {
  /** 日志根目录 */
  dir: string;
  /** 是否启用（可用 AGENT_LLM_LOG=0 关闭） */
  enabled?: boolean;
  /** 是否同时记录模型响应 */
  logResponse?: boolean;
};

export class LlmRequestLogger {
  readonly dir: string;
  readonly enabled: boolean;
  readonly logResponse: boolean;
  private seq = 0;

  constructor(opts: LlmLogOptions) {
    this.dir = opts.dir;
    this.enabled = opts.enabled ?? process.env.AGENT_LLM_LOG !== "0";
    this.logResponse = opts.logResponse ?? process.env.AGENT_LLM_LOG_RESPONSE !== "0";
  }

  /** 包装 modelCall：请求前写文件，返回后再写响应 */
  wrap(inner: ModelCaller): ModelCaller {
    if (!this.enabled) return inner;

    const self = this;
    return async function* loggedCall(req: ModelRequest) {
      const id = await self.writeRequest(req);
      const gen = inner(req);
      let next = await gen.next();
      while (!next.done) {
        yield next.value as StreamEvent;
        next = await gen.next();
      }
      const response = next.value as ModelResponse;
      if (id != null && self.logResponse) {
        await self.writeResponse(id, response);
      }
      return response;
    };
  }

  /** 写入一次请求；返回序号（如 0001） */
  async writeRequest(req: ModelRequest): Promise<string | null> {
    if (!this.enabled) return null;
    await mkdir(this.dir, { recursive: true });
    this.seq += 1;
    const id = String(this.seq).padStart(4, "0");
    const ts = new Date().toISOString();

    const record = {
      id,
      ts,
      system: req.system,
      messages: req.messages,
      // tools 完整 schema 很大；默认只记名字，完整 schema 另存
      tools: req.tools.map((t) => t.name),
      tool_schemas: req.tools,
      message_count: req.messages.length,
      approx_chars: estimateChars(req),
    };

    const file = path.join(this.dir, `${id}-request.json`);
    await writeFile(file, JSON.stringify(record, null, 2), "utf8");

    // 索引行：方便用 jq / rg 快速扫
    await appendFile(
      path.join(this.dir, "requests.jsonl"),
      `${JSON.stringify({
        id,
        ts,
        file: `${id}-request.json`,
        tools: record.tools,
        message_count: record.message_count,
        approx_chars: record.approx_chars,
        last_role: lastRole(req),
      })}\n`,
      "utf8",
    );

    return id;
  }

  async writeResponse(id: string, response: ModelResponse): Promise<void> {
    if (!this.enabled) return;
    const file = path.join(this.dir, `${id}-response.json`);
    await writeFile(
      file,
      JSON.stringify(
        {
          id,
          ts: new Date().toISOString(),
          stopReason: response.stopReason,
          content: response.content,
        },
        null,
        2,
      ),
      "utf8",
    );
  }
}

function estimateChars(req: ModelRequest): number {
  try {
    return JSON.stringify({ system: req.system, messages: req.messages }).length;
  } catch {
    return -1;
  }
}

function lastRole(req: ModelRequest): string {
  const last = req.messages[req.messages.length - 1];
  return last?.role ?? "(empty)";
}

/** 根据 cwd / sessionId 解析日志目录 */
export function resolveLlmLogDir(cwd: string, sessionId?: string): string {
  const override = process.env.AGENT_LLM_LOG_DIR;
  if (override) {
    return sessionId ? path.join(override, sessionId) : override;
  }
  const base = path.join(cwd, ".sessions", "llm-logs");
  return sessionId ? path.join(base, sessionId) : base;
}
