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
    api/                 # Anthropic streaming client (+ MOCK_LLM)
    compact/             # Auto-compact
    mcp/                 # MCP client
  ui/repl.ts             # Terminal REPL / print renderer
```

## Disclaimer

This is a **teaching harness**. Claude Code itself is proprietary; community write-ups of its architecture informed the design. Do not expect feature parity (Ink UI, 40+ tools, 7 safety layers, hooks, etc.).
