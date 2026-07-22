# agent-cli

Educational **TypeScript coding-agent CLI** inspired by [Claude Code](https://docs.anthropic.com/en/docs/claude-code) architecture patterns (not a fork; original code).

## What it mirrors from Claude Code

| Pattern | Implementation |
|--------|----------------|
| Single query engine for REPL + headless | `src/query/QueryEngine.ts` |
| `AsyncGenerator` agent loop | `src/query/queryLoop.ts` |
| Tool interface + registry | `src/tools/*` |
| Deny-first / graduated permissions | `src/permissions/*` |
| Isolated subagent (`Agent` tool) | `src/tools/AgentTool.ts` |
| Context compact (simplified) | `src/services/compact/compact.ts` |
| CLAUDE.md / AGENTS.md assembly | `src/context/assemble.ts` |
| Append-only JSONL sessions | `src/session/SessionStore.ts` |
| MCP stdio tools | `src/services/mcp/client.ts` |
| LLM request local logs | `src/services/debug/llmRequestLog.ts` |
| Session execution logs | `src/services/debug/sessionExecLog.ts` |
| `--print` headless mode | CLI `-p` |

## Quick start

```bash
cd agent-cli
npm install
cp .env.example .env
# DeepSeek（推荐）:
#   AGENT_PROVIDER=deepseek
#   DEEPSEEK_API_KEY=sk-...
# Anthropic:
#   AGENT_PROVIDER=anthropic
#   ANTHROPIC_API_KEY=sk-ant-...

# Interactive Ink TUI (default)
npm run dev

# Classic readline UI
npm run dev -- --legacy-ui

# Headless (auto-accepts edits)
npm run dev -- -p "List TypeScript files and summarize package.json" --permission-mode acceptEdits

# Offline smoke (no API key)
MOCK_LLM=1 npm run dev -- -p "hello"
```

Supported providers via `AGENT_PROVIDER`: `deepseek` | `openai` | `anthropic` (auto-detects from env keys).

## 会话执行日志

默认开启，目录：

```text
.sessions/exec-logs/<sessionId>/
  flow.log                 # 带阶段的流水线（推荐先看）
  exec.jsonl               # 全量事件
  session-summary.md       # 整场总览
  turns/
    turn-01-summary.md     # 每轮调用总结（流程 + 工具 + 结论）
    turn-01-summary.json
```

关闭：`AGENT_EXEC_LOG=0`。

## 文档沉淀（可进 Git）

每次运行自动写入 `docs/runs/`（与 `.sessions` 不同，**默认适合提交**）：

```text
docs/runs/
  INDEX.md / LATEST.md / HISTORY.jsonl
  YYYY-MM-DD_xxxxxxxx.md
  YYYY-MM-DD_xxxxxxxx/turn-01.md
```

关闭：`AGENT_DOC_DEPOSIT=0`。

## LLM 请求日志

```text
.sessions/llm-logs/<sessionId>/
  0001-request.json / 0001-response.json / 0001-summary.md
  requests.jsonl
```

关闭：`AGENT_LLM_LOG=0`。

## Built-in tools

`Bash` · `Read` · `Write` · `Edit` · `Glob` · `Grep` · `Agent` · `Orchestrate`（并行多 Agent）(+ MCP)

## Ink TUI

默认交互界面为 Ink/React：

- 可滚动会话（PgUp / PgDn）
- 多行输入（Ctrl+J 换行，Enter 发送）
- Vim：Esc → NORMAL（hjkl / i / a / dd），Enter 发送
- `--legacy-ui` 回退旧版 readline UI

## MCP

Create `.agent-cli/mcp.json`:

```json
{
  "mcpServers": {
    "example": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    }
  }
}
```

## Layout

```
src/
  entrypoints/cli.ts     # Commander entry
  query/                 # QueryEngine + AsyncGenerator loop
  tools/                 # Builtin tools + Agent + Orchestrate
  orchestrator/          # 并行多 Agent
  permissions/           # Path safety + permission gate
  context/               # System prompt / CLAUDE.md
  session/               # JSONL persistence
  services/
    api/                 # 模型提供商（DeepSeek/Anthropic/OpenAI）
    debug/               # LLM 请求落盘 + 执行日志 + 文档沉淀
    compact/             # Auto-compact
    mcp/                 # MCP client
  ui/
    ink/                 # Ink/React TUI（默认 REPL）
    repl.ts              # legacy readline / --print
```

## Disclaimer

This is a **teaching harness**. Claude Code itself is proprietary; community write-ups of its architecture informed the design. Do not expect feature parity (Ink UI, 40+ tools, 7 safety layers, hooks, etc.).
