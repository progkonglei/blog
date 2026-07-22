# agent-cli 目录结构分析

> 本文说明仓库内 `agent-cli/` 的目录分层、各模块职责，以及一次请求如何在目录间流转。

---

## 一、顶层一览

```text
agent-cli/
├── src/                 # 全部 TypeScript 源码（核心）
├── docs/                # 人读文档 + 每次运行自动沉淀
├── dist/                # tsc 编译产物（gitignore 可忽略本地）
├── node_modules/        # 依赖
├── package.json         # 脚本 / 依赖 / bin 入口
├── tsconfig.json        # TS + JSX（Ink）
├── CLAUDE.md            # 项目指令（会被装进 system prompt）
├── .env.example         # 环境变量模板
├── .env                 # 本地密钥（gitignore，勿提交）
└── README.md
```

| 路径 | 是否应提交 | 说明 |
|------|------------|------|
| `src/` | ✅ | 源码 |
| `docs/`（含 `runs/`） | ✅ | 文档与会话沉淀 |
| `.env` / `.sessions/` | ❌ | 密钥与本地日志 |
| `dist/` / `node_modules/` | ❌ | 构建与依赖 |

---

## 二、`src/` 分层（按调用链）

整体是「入口 → UI → 引擎 → 循环 → 工具/模型/服务」：

```text
entrypoints/cli.ts
        │
        ├─ -p/--print ──────────► ui/repl.ts (runPrint)
        ├─ --legacy-ui ─────────► ui/repl.ts (runRepl)
        └─ 默认 REPL ───────────► ui/ink/runInkRepl.tsx
                                        │
                                        ▼
                               query/QueryEngine.ts
                                        │
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
            query/queryLoop.ts   tools/* + registry   services/api/*
                    │                   │                   │
                    │                   ├─ Agent / Orchestrate
                    │                   │         │
                    │                   │         ▼
                    │                   │  orchestrator/parallelAgents.ts
                    │                   │
                    └───────────────────┴──► permissions / compact / mcp / debug
```

### 2.1 入口层 `src/entrypoints/`

| 文件 | 职责 |
|------|------|
| `cli.ts` | Commander 解析；先 `loadAgentEnv()`；路由到 Ink / legacy / print |

**设计点：** 动态 `import` UI，保证 `.env` 在创建 OpenAI/Anthropic 客户端前已加载。

### 2.2 类型层 `src/types/`

| 文件 | 职责 |
|------|------|
| `messages.ts` | `Message` / `StreamEvent` / `TerminalReason` / 权限模式 |

所有 UI、循环、日志都消费同一套事件类型，避免各层私自约定协议。

### 2.3 查询引擎 `src/query/`

| 文件 | 职责 |
|------|------|
| `QueryEngine.ts` | 会话门面：装工具/MCP/日志/文档沉淀，对外 `submit()` |
| `queryLoop.ts` | **Agent 心脏**：AsyncGenerator 循环（压缩→模型→工具→回灌） |

**设计点：** REPL、print、子代理共用 `runQueryLoop`，与 Claude Code「单一 query 引擎」一致。

### 2.4 工具层 `src/tools/`

```text
tools/
├── Tool.ts              # ToolDefinition / ToolContext / defineTool
├── registry.ts          # 注册表 + Zod→JSON Schema
├── BashTool.ts
├── FileReadTool.ts / FileWriteTool.ts / FileEditTool.ts
├── GlobTool.ts / GrepTool.ts
├── AgentTool.ts         # 单个隔离子代理
└── OrchestrateTool.ts   # 多任务并行编排
```

| 角色 | 工具集 |
|------|--------|
| 根 Agent | 全部内置 + `Agent` + `Orchestrate` |
| Orchestrate 工人 | 内置 + `Agent`，**不含** `Orchestrate`（防扇出爆炸） |
| readonly 子代理 | 仅 `isReadOnly` 工具 |

### 2.5 编排层 `src/orchestrator/`

| 文件 | 职责 |
|------|------|
| `parallelAgents.ts` | `runSubAgent` / `runParallelAgents` / 结果格式化 |
| `smoke.ts` | `MOCK_LLM=1` 并行冒烟 |

### 2.6 UI 层 `src/ui/`

```text
ui/
├── ink/                      # 默认 TUI（Ink + React）
│   ├── runInkRepl.tsx        # render() 入口
│   ├── App.tsx               # 布局：消息区 + 状态 + 输入
│   ├── MessageList.tsx       # 可滚动会话（PgUp/PgDn）
│   └── VimMultilineInput.tsx # 多行 + Vim INSERT/NORMAL
├── repl.ts                   # legacy readline + --print 渲染
├── prompt.ts                 # 边框输入 / 权限框（legacy）
├── tools.ts                  # ● / ⎿ / spinner（legacy print）
└── theme.ts                  # 颜色与 banner
```

| 模式 | 入口 | 适用 |
|------|------|------|
| 默认 | `ui/ink/*` | 交互开发 |
| `--legacy-ui` | `ui/repl.ts` | 简单终端 |
| `-p/--print` | `ui/repl.ts` → `runPrint` | CI / 脚本 |

### 2.7 服务层 `src/services/`

```text
services/
├── api/
│   ├── provider.ts           # 按环境选择 DeepSeek / Anthropic / OpenAI
│   ├── openaiCompatible.ts   # DeepSeek 等 OpenAI 兼容协议
│   └── anthropic.ts          # Anthropic + MOCK_LLM
├── compact/compact.ts        # 上下文超限时摘要压缩
├── mcp/client.ts             # MCP stdio 客户端 → ToolDefinition
└── debug/
    ├── llmRequestLog.ts      # 每次 LLM 请求/响应落盘
    ├── sessionExecLog.ts     # 执行流水线 flow.log + 每轮总结
    └── docDeposit.ts         # 沉淀到 docs/runs/（可进 Git）
```

### 2.8 其它支撑

| 目录 | 职责 |
|------|------|
| `config/env.ts` | 多路径加载 `.env`、校验 API Key |
| `context/assemble.ts` | 系统提示 + 向上查找 `CLAUDE.md` / `AGENTS.md` |
| `permissions/` | 路径沙箱 + allow/ask/deny 门控 |
| `session/SessionStore.ts` | 会话消息 append-only JSONL |

---

## 三、运行时生成目录（不在 `src/`）

### 3.1 `.sessions/`（本地，gitignore）

```text
.sessions/
├── <sessionId>.jsonl              # 消息 transcript
├── llm-logs/<sessionId>/
│   ├── 0001-request.json
│   ├── 0001-response.json
│   ├── 0001-summary.md
│   └── requests.jsonl
└── exec-logs/<sessionId>/
    ├── flow.log                   # 带 [STEP]/[LLM]/[TOOL] 的流水线
    ├── exec.jsonl
    ├── session-summary.md
    └── turns/turn-01-summary.md
```

### 3.2 `docs/runs/`（沉淀，建议提交）

```text
docs/runs/
├── INDEX.md / LATEST.md / HISTORY.jsonl
├── YYYY-MM-DD_xxxxxxxx.md
└── YYYY-MM-DD_xxxxxxxx/turn-01.md
```

与 `.sessions` 的关系：**日志留本机排障，文档进仓库复盘。**

---

## 四、`docs/` 文档地图

| 文件 | 内容 |
|------|------|
| `README.md` | 文档索引 |
| `directory-structure.md` | **本文：目录结构分析** |
| `input-output-execution.md` | 输入→输出链路与稳定性 |
| `ink-and-orchestrate.md` | Ink TUI 与并行编排 |
| `runs/` | 每次运行自动生成的会话沉淀 |

---

## 五、一次用户输入的目录穿越

```text
1. entrypoints/cli.ts          解析参数、加载 .env
2. ui/ink/App.tsx              收集输入，调用 engine.submit
3. query/QueryEngine.ts        记会话、挂日志与 DocDeposit
4. query/queryLoop.ts          phase 事件 → modelCall / tools
5. services/api/*              真实 HTTP；debug/llmRequestLog 写 llm-logs
6. tools/* 或 orchestrator/*   执行；权限走 permissions/*
7. StreamEvent 回 UI           ink MessageList 渲染 ●/正文
8. sessionEnd                  exec-logs 定稿 + docs/runs 沉淀
```

---

## 六、模块依赖原则（维护时注意）

1. **`types/` 不依赖业务模块** — 只被引用。
2. **`queryLoop` 不依赖 UI** — 只 yield 事件；Ink / legacy / print 都是消费者。
3. **`tools/registry` 可依赖 `orchestrator`**，工人工具集故意去掉 `Orchestrate`。
4. **`services/debug` 可写盘，不可反向依赖 UI**。
5. **密钥只出现在 `.env`**，文档与 `docs/runs` 不得写入 Key。

---

## 七、扩展时该改哪

| 想加的能力 | 优先改动的目录 |
|------------|----------------|
| 新工具 | `src/tools/` + `registry.ts` |
| 新模型厂商 | `src/services/api/` |
| TUI 交互 | `src/ui/ink/` |
| 并行/调度策略 | `src/orchestrator/` |
| 权限/沙箱 | `src/permissions/` |
| 日志与沉淀格式 | `src/services/debug/` |
| 斜杠命令 | `ui/ink/App.tsx` 与/或 `ui/repl.ts` |

---

_生成说明：与当前 `src/` 树保持同步；结构变更时请更新本文。_
