/**
 * 会话执行日志（增强版）
 *
 * 目标：让「Agent 怎么跑的」一眼能看懂，并且每轮有独立总结。
 *
 * 目录：.sessions/exec-logs/<sessionId>/
 *   ├── flow.log                 # 带阶段的人类可读流水线
 *   ├── exec.jsonl               # 全量结构化事件
 *   ├── turns/
 *   │   ├── turn-01-summary.md   # 本轮中文总结（流程 + 工具 + 结论）
 *   │   └── turn-01-summary.json
 *   └── session-summary.md       # 整场会话总览
 */
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StreamEvent, TerminalReason } from "../../types/messages.js";

export type SessionExecLogOptions = {
  dir: string;
  enabled?: boolean;
};

type ToolCallRec = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  isError?: boolean;
  startedAt: string;
  endedAt?: string;
};

type LlmCallRec = {
  id: string;
  kind: "request" | "response";
  stopReason?: string;
  approxChars?: number;
  at: string;
};

type PhaseRec = {
  step: number;
  phase: string;
  detail?: string;
  at: string;
};

type TurnState = {
  turn: number;
  startedAt: string;
  userText: string;
  phases: PhaseRec[];
  tools: ToolCallRec[];
  llmCalls: LlmCallRec[];
  assistantTexts: string[];
  errors: string[];
  permissions: Array<{ toolName: string; allowed: boolean; at: string }>;
  reason?: TerminalReason;
  endedAt?: string;
};

export class SessionExecLogger {
  readonly dir: string;
  readonly enabled: boolean;
  readonly jsonlPath: string;
  readonly flowPath: string;
  readonly turnsDir: string;
  readonly sessionSummaryPath: string;

  private textBuf = "";
  private turn = 0;
  private current: TurnState | null = null;
  private turns: TurnState[] = [];
  private sessionMeta: Record<string, unknown> = {};
  private pendingTools = new Map<string, ToolCallRec>();

  constructor(opts: SessionExecLogOptions) {
    this.dir = opts.dir;
    this.enabled = opts.enabled ?? process.env.AGENT_EXEC_LOG !== "0";
    this.jsonlPath = path.join(this.dir, "exec.jsonl");
    this.flowPath = path.join(this.dir, "flow.log");
    this.turnsDir = path.join(this.dir, "turns");
    this.sessionSummaryPath = path.join(this.dir, "session-summary.md");
  }

  async init(meta: Record<string, unknown>): Promise<void> {
    if (!this.enabled) return;
    this.sessionMeta = meta;
    await mkdir(this.turnsDir, { recursive: true });
    await this.writeEvent({ type: "session_start", ...meta });
    await this.flow([
      "╔══════════════════════════════════════════════════════╗",
      "║              agent-cli 会话执行流水线                  ║",
      "╚══════════════════════════════════════════════════════╝",
      `session : ${meta.sessionId}`,
      `cwd     : ${meta.cwd}`,
      `mode    : ${meta.permissionMode}`,
      `resumed : ${meta.resumed}`,
      "",
      "图例: [STEP] 循环步  |  [LLM] 模型调用  |  [TOOL] 工具  |  [PHASE] 阶段",
      "",
    ].join("\n"));
  }

  async turnStart(userText: string): Promise<void> {
    if (!this.enabled) return;
    await this.flushText();
    this.turn += 1;
    this.current = {
      turn: this.turn,
      startedAt: new Date().toISOString(),
      userText,
      phases: [],
      tools: [],
      llmCalls: [],
      assistantTexts: [],
      errors: [],
      permissions: [],
    };
    this.pendingTools.clear();
    await this.writeEvent({ type: "user_input", turn: this.turn, text: userText });
    await this.flow([
      "",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      `▶ TURN ${String(this.turn).padStart(2, "0")}  用户输入`,
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      `  ${userText}`,
      "",
      "  流程预览:",
      "    用户输入",
      "      ↓",
      "    [循环] 压缩检查 → 调用模型 → (有工具?) → 执行工具 → 回灌历史 → …",
      "      ↓",
      "    结束本轮 / 给出最终回复",
      "",
    ].join("\n"));
  }

  async onStreamEvent(ev: StreamEvent): Promise<void> {
    if (!this.enabled) return;

    if (ev.type === "text_delta") {
      this.textBuf += ev.text;
      return;
    }

    await this.flushText();

    switch (ev.type) {
      case "phase": {
        this.current?.phases.push({
          step: ev.step,
          phase: ev.phase,
          detail: ev.detail,
          at: new Date().toISOString(),
        });
        await this.writeEvent({
          type: "phase",
          step: ev.step,
          phase: ev.phase,
          detail: ev.detail,
        });
        await this.flow(formatPhase(ev.step, ev.phase, ev.detail));
        break;
      }
      case "llm_call": {
        this.current?.llmCalls.push({
          id: ev.id,
          kind: ev.kind,
          stopReason: ev.stopReason,
          approxChars: ev.approxChars,
          at: new Date().toISOString(),
        });
        await this.writeEvent({
          type: "llm_call",
          id: ev.id,
          kind: ev.kind,
          stopReason: ev.stopReason,
          approxChars: ev.approxChars,
        });
        if (ev.kind === "request") {
          await this.flow(
            `  [LLM] → 请求 #${ev.id}` +
              (ev.approxChars != null ? ` (~${ev.approxChars} chars)` : "") +
              `  文件: llm-logs/.../${ev.id}-request.json`,
          );
        } else {
          await this.flow(
            `  [LLM] ← 响应 #${ev.id}` +
              (ev.stopReason ? ` stop=${ev.stopReason}` : "") +
              `  文件: llm-logs/.../${ev.id}-response.json`,
          );
        }
        break;
      }
      case "tool_start": {
        const rec: ToolCallRec = {
          id: ev.id,
          name: ev.name,
          input: ev.input,
          startedAt: new Date().toISOString(),
        };
        this.pendingTools.set(ev.id, rec);
        this.current?.tools.push(rec);
        await this.writeEvent({ type: "tool_start", id: ev.id, name: ev.name, input: ev.input });
        await this.flow(`  [TOOL] ▸ ${ev.name}(${preview(safeJson(ev.input), 100)})`);
        break;
      }
      case "tool_result": {
        const pending = this.pendingTools.get(ev.id);
        if (pending) {
          pending.output = ev.output;
          pending.isError = ev.isError;
          pending.endedAt = new Date().toISOString();
        }
        await this.writeEvent({
          type: "tool_result",
          id: ev.id,
          name: ev.name,
          isError: ev.isError ?? false,
          output: truncate(ev.output, 50_000),
        });
        await this.flow(
          `  [TOOL] ${ev.isError ? "✗" : "✓"} ${ev.name} → ${preview(ev.output.replace(/\n/g, " "), 120)}`,
        );
        break;
      }
      case "assistant_message":
        await this.writeEvent({ type: "assistant_message", message: ev.message });
        break;
      case "compact":
        this.current?.phases.push({
          step: -1,
          phase: "compact",
          detail: `${ev.before}→${ev.after}`,
          at: new Date().toISOString(),
        });
        await this.writeEvent({
          type: "compact",
          before: ev.before,
          after: ev.after,
          summary: ev.summary,
        });
        await this.flow(`  [PHASE] compact ${ev.before} → ${ev.after} chars`);
        break;
      case "status":
        await this.writeEvent({ type: "status", message: ev.message });
        await this.flow(`  · ${ev.message}`);
        break;
      case "error":
        this.current?.errors.push(ev.error);
        await this.writeEvent({ type: "error", error: ev.error });
        await this.flow(`  [ERROR] ${ev.error}`);
        break;
      default:
        break;
    }
  }

  async turnEnd(reason: TerminalReason): Promise<void> {
    if (!this.enabled || !this.current) return;
    await this.flushText();
    this.current.reason = reason;
    this.current.endedAt = new Date().toISOString();
    const done = this.current;
    this.turns.push(done);
    this.current = null;

    await this.writeEvent({ type: "turn_end", turn: done.turn, reason });
    await this.flow(`\n◀ TURN ${String(done.turn).padStart(2, "0")} 结束 · ${describeReason(reason)}\n`);

    // 每轮独立总结文件
    const id = String(done.turn).padStart(2, "0");
    const summaryJson = buildTurnSummary(done);
    const summaryMd = renderTurnSummaryMd(done, summaryJson);
    await writeFile(path.join(this.turnsDir, `turn-${id}-summary.json`), JSON.stringify(summaryJson, null, 2), "utf8");
    await writeFile(path.join(this.turnsDir, `turn-${id}-summary.md`), summaryMd, "utf8");
    await this.flow(`  ✎ 本轮总结已写入 turns/turn-${id}-summary.md\n`);

    // 更新会话总览
    await this.writeSessionSummary();
  }

  async permission(toolName: string, input: Record<string, unknown>, allowed: boolean): Promise<void> {
    if (!this.enabled) return;
    this.current?.permissions.push({
      toolName,
      allowed,
      at: new Date().toISOString(),
    });
    await this.writeEvent({ type: "permission", toolName, input, allowed });
    await this.flow(`  [PERM] ${allowed ? "ALLOW" : "DENY"} ${toolName}`);
  }

  async sessionEnd(): Promise<void> {
    if (!this.enabled) return;
    await this.flushText();
    await this.writeEvent({ type: "session_end" });
    await this.writeSessionSummary();
    await this.flow("\n═══ session end ═══\n");
  }

  private async writeSessionSummary(): Promise<void> {
    const md = renderSessionSummaryMd(this.sessionMeta, this.turns);
    await writeFile(this.sessionSummaryPath, md, "utf8");
  }

  private async flushText(): Promise<void> {
    if (!this.textBuf) return;
    const text = this.textBuf;
    this.textBuf = "";
    this.current?.assistantTexts.push(text);
    await this.writeEvent({ type: "assistant_text", text });
    await this.flow(`  [TEXT] ${preview(text.replace(/\n/g, " "), 160)}`);
  }

  private async writeEvent(event: Record<string, unknown>): Promise<void> {
    const ts = new Date().toISOString();
    const payload = { ts, turn: this.turn || undefined, ...event };
    await appendFile(this.jsonlPath, `${JSON.stringify(payload)}\n`, "utf8");
  }

  private async flow(line: string): Promise<void> {
    const ts = new Date().toISOString().slice(11, 23); // HH:mm:ss.sss
    const stamped = line
      .split("\n")
      .map((l) => (l.length ? `[${ts}] ${l}` : ""))
      .join("\n");
    await appendFile(this.flowPath, `${stamped}\n`, "utf8");
  }
}

export function resolveExecLogDir(cwd: string, sessionId: string): string {
  const override = process.env.AGENT_EXEC_LOG_DIR;
  if (override) return path.join(override, sessionId);
  return path.join(cwd, ".sessions", "exec-logs", sessionId);
}

function formatPhase(step: number, phase: string, detail?: string): string {
  const labels: Record<string, string> = {
    loop_step: "① 进入循环步",
    compact_check: "② 压缩检查",
    compact_done: "②′ 已压缩",
    model_call_start: "③ 调用大模型",
    model_call_end: "③′ 模型返回",
    tool_dispatch: "④ 分发工具",
    tool_results_to_history: "⑤ 工具结果回灌",
    end_turn: "⑥ 结束本轮",
  };
  const title = labels[phase] ?? phase;
  return `  [STEP ${step}] ${title}${detail ? ` — ${detail}` : ""}`;
}

function buildTurnSummary(t: TurnState) {
  const durationMs =
    t.endedAt && t.startedAt ? Date.parse(t.endedAt) - Date.parse(t.startedAt) : undefined;
  const llmRequestIds = [...new Set(t.llmCalls.filter((c) => c.kind === "request").map((c) => c.id))];
  const toolNames = t.tools.map((x) => x.name);
  const finalText = t.assistantTexts.join("").trim();

  // 从 phases 重建可读流程图
  const flow = t.phases.map((p) => ({
    step: p.step,
    phase: p.phase,
    detail: p.detail,
  }));

  return {
    turn: t.turn,
    startedAt: t.startedAt,
    endedAt: t.endedAt,
    durationMs,
    user: t.userText,
    stopReason: t.reason,
    stats: {
      loopSteps: new Set(t.phases.map((p) => p.step).filter((s) => s > 0)).size,
      llmCalls: llmRequestIds.length,
      toolCalls: t.tools.length,
      toolErrors: t.tools.filter((x) => x.isError).length,
      permissionsAsked: t.permissions.length,
    },
    flow,
    llmRequestIds,
    tools: t.tools.map((x) => ({
      name: x.name,
      id: x.id,
      ok: !x.isError,
      input: x.input,
      outputPreview: x.output ? preview(x.output, 300) : undefined,
    })),
    finalAssistantText: finalText ? truncate(finalText, 4000) : "",
    errors: t.errors,
    oneLineSummary: oneLine(t, finalText, toolNames, llmRequestIds.length),
  };
}

function oneLine(
  t: TurnState,
  finalText: string,
  toolNames: string[],
  llmCalls: number,
): string {
  const tools = toolNames.length ? `工具[${toolNames.join(", ")}]` : "无工具";
  const snippet = finalText ? preview(finalText.replace(/\n/g, " "), 80) : "(无文本回复)";
  return `Turn ${t.turn}: 用户「${preview(t.userText, 40)}」→ LLM×${llmCalls} → ${tools} → ${snippet}`;
}

function renderTurnSummaryMd(t: TurnState, summary: ReturnType<typeof buildTurnSummary>): string {
  const lines: string[] = [
    `# Turn ${String(t.turn).padStart(2, "0")} 调用总结`,
    "",
    `> ${summary.oneLineSummary}`,
    "",
    "## 基本信息",
    "",
    `| 项 | 值 |`,
    `|---|---|`,
    `| 开始 | ${t.startedAt} |`,
    `| 结束 | ${t.endedAt ?? "-"} |`,
    `| 耗时 | ${summary.durationMs != null ? `${summary.durationMs} ms` : "-"} |`,
    `| 结束原因 | ${describeReason(t.reason ?? { kind: "end_turn" })} |`,
    `| 循环步数 | ${summary.stats.loopSteps} |`,
    `| LLM 调用 | ${summary.stats.llmCalls} |`,
    `| 工具调用 | ${summary.stats.toolCalls}（失败 ${summary.stats.toolErrors}） |`,
    "",
    "## 用户输入",
    "",
    "```",
    t.userText,
    "```",
    "",
    "## 执行流程",
    "",
    "```",
    "用户输入",
  ];

  let lastStep = 0;
  for (const p of t.phases) {
    if (p.step > 0 && p.step !== lastStep && p.phase === "loop_step") {
      lines.push(`  └─ 循环步 #${p.step}`);
      lastStep = p.step;
    }
    if (p.phase === "model_call_start") lines.push(`       ├─ 调用大模型`);
    if (p.phase === "model_call_end") lines.push(`       │    └─ 返回 (${p.detail ?? ""})`);
    if (p.phase === "tool_dispatch") lines.push(`       ├─ 执行工具: ${p.detail ?? ""}`);
    if (p.phase === "tool_results_to_history") lines.push(`       └─ 结果回灌历史 → 继续`);
    if (p.phase === "end_turn") lines.push(`  └─ 结束本轮`);
    if (p.phase === "compact_done") lines.push(`       ├─ 上下文压缩 ${p.detail ?? ""}`);
  }
  lines.push("```", "");

  if (summary.llmRequestIds.length) {
    lines.push("## 关联 LLM 请求", "");
    for (const id of summary.llmRequestIds) {
      lines.push(`- \`${id}-request.json\` / \`${id}-response.json\`（见 \`llm-logs/<sessionId>/\`）`);
    }
    lines.push("");
  }

  if (summary.tools.length) {
    lines.push("## 工具调用", "");
    for (const tool of summary.tools) {
      lines.push(`### ${tool.ok ? "✓" : "✗"} \`${tool.name}\``);
      lines.push("");
      lines.push("输入:");
      lines.push("```json");
      lines.push(JSON.stringify(tool.input, null, 2));
      lines.push("```");
      if (tool.outputPreview) {
        lines.push("输出预览:");
        lines.push("```");
        lines.push(tool.outputPreview);
        lines.push("```");
      }
      lines.push("");
    }
  }

  lines.push("## 最终助手回复", "");
  lines.push(summary.finalAssistantText || "_(空)_");
  lines.push("");
  return lines.join("\n");
}

function renderSessionSummaryMd(meta: Record<string, unknown>, turns: TurnState[]): string {
  const lines: string[] = [
    `# 会话总结`,
    "",
    `| 项 | 值 |`,
    `|---|---|`,
    `| sessionId | ${meta.sessionId ?? ""} |`,
    `| cwd | ${meta.cwd ?? ""} |`,
    `| permissionMode | ${meta.permissionMode ?? ""} |`,
    `| turns | ${turns.length} |`,
    "",
    "## 各轮一句话",
    "",
  ];
  for (const t of turns) {
    const s = buildTurnSummary(t);
    lines.push(`- **Turn ${t.turn}**: ${s.oneLineSummary}`);
  }
  lines.push("", "## 文件导航", "");
  lines.push("- `flow.log` — 带时间戳的完整流水线（推荐先看）");
  lines.push("- `exec.jsonl` — 全量事件");
  lines.push("- `turns/turn-XX-summary.md` — 每轮详细总结");
  lines.push("- 对应 `../llm-logs/<sessionId>/` — 每次真实请求/响应");
  lines.push("");
  return lines.join("\n");
}

function describeReason(r: TerminalReason): string {
  if (r.kind === "end_turn") return "正常结束 (end_turn)";
  if (r.kind === "max_turns") return `达到最大循环步 ${r.turns}`;
  if (r.kind === "aborted") return "用户中断";
  return `错误: ${r.error}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n...[truncated ${s.length - max} chars]`;
}

function preview(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
