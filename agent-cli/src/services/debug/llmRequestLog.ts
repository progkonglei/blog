/**
 * 大模型请求落盘
 *
 * 每次调用模型前，把 system / messages / tools 写成本地文件，
 * 并通过 StreamEvent.llm_call 通知执行日志，把「第几次 LLM」串到流水线上。
 *
 * 目录默认：<cwd>/.sessions/llm-logs/<sessionId>/
 *   ├── requests.jsonl
 *   ├── 0001-request.json
 *   ├── 0001-response.json
 *   └── 0001-summary.md      # 单次调用摘要
 */
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ModelRequest, ModelResponse } from "../../query/queryLoop.js";
import type { StreamEvent } from "../../types/messages.js";
import type { ModelCaller } from "../api/provider.js";

export type LlmLogOptions = {
  dir: string;
  enabled?: boolean;
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

  /** 包装 modelCall：写文件 + 向下游 yield llm_call 事件 */
  wrap(inner: ModelCaller): ModelCaller {
    if (!this.enabled) return inner;

    const self = this;
    return async function* loggedCall(req: ModelRequest) {
      const meta = await self.writeRequest(req);
      if (meta) {
        yield {
          type: "llm_call",
          id: meta.id,
          kind: "request",
          approxChars: meta.approxChars,
        } satisfies StreamEvent;
      }

      const gen = inner(req);
      let next = await gen.next();
      while (!next.done) {
        yield next.value as StreamEvent;
        next = await gen.next();
      }
      const response = next.value as ModelResponse;

      if (meta && self.logResponse) {
        await self.writeResponse(meta.id, response, req);
        yield {
          type: "llm_call",
          id: meta.id,
          kind: "response",
          stopReason: response.stopReason,
        } satisfies StreamEvent;
      }
      return response;
    };
  }

  async writeRequest(req: ModelRequest): Promise<{ id: string; approxChars: number } | null> {
    if (!this.enabled) return null;
    await mkdir(this.dir, { recursive: true });
    this.seq += 1;
    const id = String(this.seq).padStart(4, "0");
    const ts = new Date().toISOString();
    const approxChars = estimateChars(req);

    const record = {
      id,
      ts,
      system: req.system,
      messages: req.messages,
      tools: req.tools.map((t) => t.name),
      tool_schemas: req.tools,
      message_count: req.messages.length,
      approx_chars: approxChars,
    };

    await writeFile(path.join(this.dir, `${id}-request.json`), JSON.stringify(record, null, 2), "utf8");

    await appendFile(
      path.join(this.dir, "requests.jsonl"),
      `${JSON.stringify({
        id,
        ts,
        file: `${id}-request.json`,
        tools: record.tools,
        message_count: record.message_count,
        approx_chars: approxChars,
        last_role: lastRole(req),
      })}\n`,
      "utf8",
    );

    return { id, approxChars };
  }

  async writeResponse(id: string, response: ModelResponse, req: ModelRequest): Promise<void> {
    if (!this.enabled) return;
    await writeFile(
      path.join(this.dir, `${id}-response.json`),
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

    // 单次调用摘要，方便快速扫
    const toolUses = response.content.filter((b) => b.type === "tool_use");
    const texts = response.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const md = [
      `# LLM 调用 #${id} 摘要`,
      "",
      `| 项 | 值 |`,
      `|---|---|`,
      `| stopReason | ${response.stopReason} |`,
      `| 入参 messages | ${req.messages.length} |`,
      `| 可用 tools | ${req.tools.map((t) => t.name).join(", ") || "(无)"} |`,
      `| 本次 tool_use | ${toolUses.length ? toolUses.map((t) => (t.type === "tool_use" ? t.name : "")).join(", ") : "(无)"} |`,
      "",
      "## 模型文本",
      "",
      texts.trim() || "_(空)_",
      "",
      "## 文件",
      "",
      `- \`${id}-request.json\``,
      `- \`${id}-response.json\``,
      "",
    ].join("\n");
    await writeFile(path.join(this.dir, `${id}-summary.md`), md, "utf8");
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

export function resolveLlmLogDir(cwd: string, sessionId?: string): string {
  const override = process.env.AGENT_LLM_LOG_DIR;
  if (override) {
    return sessionId ? path.join(override, sessionId) : override;
  }
  const base = path.join(cwd, ".sessions", "llm-logs");
  return sessionId ? path.join(base, sessionId) : base;
}
