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

# Interactive REPL
npm run dev

# Headless (auto-accepts edits)
npm run dev -- -p "List TypeScript files and summarize package.json" --permission-mode acceptEdits

# Offline smoke (no API key)
MOCK_LLM=1 npm run dev -- -p "hello"
```

Supported providers via `AGENT_PROVIDER`: `deepseek` | `openai` | `anthropic` (auto-detects from env keys).

## LLM 请求日志

默认开启：每次调用大模型都会把 `system` / `messages` / `tools` 写到本地：

```text
.sessions/llm-logs/<sessionId>/
  requests.jsonl       # 索引
  0001-request.json    # 完整请求
  0001-response.json   # 模型返回
```

关闭：`AGENT_LLM_LOG=0`。自定义目录：`AGENT_LLM_LOG_DIR=...`。

## 会话执行日志

默认开启：记录用户输入、工具调用/结果、助手输出、权限决定、结束原因：

```text
.sessions/exec-logs/<sessionId>/
  exec.jsonl   # 结构化事件
  exec.log     # 人类可读
```

关闭：`AGENT_EXEC_LOG=0`。

## Built-in tools

`Bash` · `Read` · `Write` · `Edit` · `Glob` · `Grep` · `Agent` (+ MCP tools if configured)

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
  tools/                 # Builtin tools + Agent subagent
  permissions/           # Path safety + permission gate
  context/               # System prompt / CLAUDE.md
  session/               # JSONL persistence
  services/
    api/                 # 模型提供商（DeepSeek/Anthropic/OpenAI）
    debug/               # LLM 请求落盘
    compact/             # Auto-compact
    mcp/                 # MCP client
  ui/repl.ts             # Terminal REPL / print renderer
```

## Disclaimer

This is a **teaching harness**. Claude Code itself is proprietary; community write-ups of its architecture informed the design. Do not expect feature parity (Ink UI, 40+ tools, 7 safety layers, hooks, etc.).
