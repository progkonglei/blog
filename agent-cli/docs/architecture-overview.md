# 架构总览

> 文档目标：从宏观视角描述 agent-cli 的整体架构、模块职责、依赖关系和数据流。

---

## 一、整体架构分层

```
┌─────────────────────────────────────────────┐
│                  CLI 入口                      │  src/entrypoints/cli.ts
│     Commander 解析 · 环境加载 · 模式路由        │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│                 UI 层                         │  src/ui/
│    REPL 交互 / headless 输出 · 主题渲染       │
└──────────────────┬──────────────────────────┘
                   │ submit(userText)
                   ▼
┌─────────────────────────────────────────────┐
│              QueryEngine 门面                 │  src/query/QueryEngine.ts
│    session 管理 · 日志初始化 · 工具加载 · MCP   │
└──────────────────┬──────────────────────────┘
                   │ runQueryLoop()
                   ▼
┌─────────────────────────────────────────────┐
│              Agent Loop 核心                  │  src/query/queryLoop.ts
│  ① compact ② modelCall ③ tool_use ④ 回灌   │
└──┬───────────┬───────────┬──────────────────┘
   │           │           │
   ▼           ▼           ▼
┌──────┐  ┌────────┐  ┌──────────┐
│ 工具  │  │ 模型 API│  │ 上下文组装 │
│ 系统  │  │ 提供商  │  │ 系统提示  │
└──────┘  └────────┘  └──────────┘
```

## 二、模块职责

### 2.1 入口层 — `src/entrypoints/cli.ts`

| 职责 | 说明 |
|------|------|
| 环境加载 | 调用 `loadAgentEnv()` 加载 `.env` 文件，确保所有后续 import 都能读到环境变量 |
| 参数解析 | 使用 Commander 解析命令行参数 |
| 模式路由 | 根据参数分发到 `runRepl()`（交互式）或 `runPrint()`（headless） |

**支持的 CLI 参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `-d, --cwd` | string | 工作目录（默认当前目录） |
| `-m, --permission-mode` | string | 权限模式：`default` / `acceptEdits` / `bypassPermissions` |
| `-p, --print` | string | 单次 prompt（headless 模式） |
| `--resume` | string | 恢复 session ID |
| `--no-mcp` | boolean | 禁用 MCP 工具 |
| `[prompt...]` | string[] | 位置参数，等同于 `--print` |

### 2.2 UI 层 — `src/ui/`

| 文件 | 职责 |
|------|------|
| `repl.ts` | 交互式 REPL（`runRepl`）和 headless 输出（`runPrint`） |
| `theme.ts` | 终端主题、颜色方案、布局工具函数 |

**`runRepl(opts)`** — 多轮交互循环：
- 创建 `QueryEngine` 实例 → `init()` → `submit()` → `for await` 消费事件
- 处理 SIGINT（`Ctrl+C` → 中断当前，再按 → 退出）
- 权限提示（`allow` / `deny` / `?` 帮助）
- 输入 `help` 显示帮助面板

**`runPrint(opts)`** — 单次执行：
- 与 REPL 共享相同的 `QueryEngine` 和渲染逻辑
- 权限回调默认返回 `true`（自动允许，若模式为 `acceptEdits`）
- 输出完成后自动退出

### 2.3 查询引擎 — `src/query/QueryEngine.ts`

`QueryEngine` 是门面（Facade）类，协调整个 session 生命周期：

```
QueryEngine
  │
  ├── init()
  │   ├── SessionStore.create() / open()     ← 会话创建/恢复
  │   ├── SessionExecLogger.init()           ← 执行日志
  │   ├── LlmRequestLogger.wrap(modelCall)   ← LLM 日志包装
  │   ├── assembleSystemPrompt()             ← 系统提示组装
  │   ├── createBuiltinTools()               ← 内置工具
  │   └── loadMcpTools()                     ← MCP 工具（可降级）
  │
  ├── submit(userText, signal?)
  │   ├── 追加用户消息到 messages
  │   ├── 持久化到 session JSONL
  │   ├── 写入执行日志
  │   ├── 创建 ToolContext
  │   └── 委派 runQueryLoop()
  │
  └── dispose()
      ├── 关闭 MCP 连接
      └── flush 执行日志
```

**关键设计：**
- `submit()` 返回 `AsyncGenerator<StreamEvent, void>`，REPL 用 `for await` 消费
- 消息在 `yield` 之前先持久化，保证不丢数据
- `dispose()` 是安全的，可多次调用

### 2.4 Agent Loop — `src/query/queryLoop.ts`

Agent Loop 是项目的核心，实现了经典的 ReAct 模式：

```
turn = 0
while turn < maxTurns:
    ① maybeCompact(messages)          // 历史压缩（>180k chars 时触发）
    ② modelCall(system, messages)     // 调用 LLM API
    ③ push assistant message 到历史
    ④ 没有 tool_use → return end_turn
    ⑤ for each tool_use:
          gateToolPermission()         // 权限检查
          tool.execute()               // 执行工具
          push tool_result 到历史
    ⑥ 回到 ①
return max_turns
```

**终止条件：**

| 条件 | 返回 | 说明 |
|------|------|------|
| 模型无 tool_use 或 stopReason 为 `end_turn` | `end_turn` | 正常结束 |
| 循环次数达到 `maxTurns`（默认 40） | `max_turns` | 防止无限循环 |
| `opts.signal?.aborted` 为 true | `aborted` | 用户中断 |
| 模型调用异常 | `error` | 网络/API 错误 |

### 2.5 工具系统 — `src/tools/`

**核心类型** (`Tool.ts`)：

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodObject<any>;
  isReadOnly?: boolean;
  checkPermission?: (ctx: ToolContext, input: any) => PermissionDecision;
  execute: (ctx: ToolContext, input: any) => Promise<string>;
}
```

**内置工具一览：**

| 工具 | 文件 | 说明 | 只读 | 权限 |
|------|------|------|------|------|
| `Bash` | `BashTool.ts` | 执行 Shell 命令，默认超时 30s，最大 120s，输出截断 80k chars | ❌ | 始终 `ask` |
| `Read` | `FileReadTool.ts` | 读取文件，支持行范围切片（1-based），截断 100k chars | ✅ | `allow` |
| `Write` | `FileWriteTool.ts` | 创建/覆盖文件，自动创建目录 | ❌ | `acceptEdits` 时自动允许 |
| `Edit` | `FileEditTool.ts` | 精准字符串替换，支持单次（强制唯一匹配）或 `replace_all` | ❌ | `acceptEdits` 时自动允许 |
| `Glob` | `GlobTool.ts` | 按 glob 模式搜索文件，忽略 node_modules/.git/dist | ✅ | `allow` |
| `Grep` | `GrepTool.ts` | 内容搜索，优先 ripgrep，降级 Node 实现 | ✅ | `allow` |
| `Agent` | `AgentTool.ts` | 子代理，隔离执行，限制深度和工具集 | ❌ | 同父级 |

**注册表** (`registry.ts`)：
- `createBuiltinTools()` 创建所有内置工具
- `getTools(readonly?)` 闭包，过滤只读工具给子代理
- `toolsToAnthropic()` 将 Zod schema 转换为 Anthropic JSON Schema（兼容 OpenAI/DeepSeek）

### 2.6 模型 API — `src/services/api/`

| 文件 | 职责 |
|------|------|
| `provider.ts` | 工厂函数 `createModelCall()`，按环境变量选择提供商 |
| `anthropic.ts` | Anthropic Messages API 客户端 + Mock 实现 |
| `openaiCompatible.ts` | OpenAI 兼容 API 客户端（DeepSeek / OpenAI / 网关） |

**提供商选择逻辑：**

```
AGENT_PROVIDER 设置? → 使用指定提供商
否则检测环境变量:
  DEEPSEEK_API_KEY → deepseek (默认)
  ANTHROPIC_API_KEY → anthropic
  OPENAI_API_KEY → openai
MOCK_LLM=1 → 使用 mock 实现
```

**`ModelCaller` 签名：**

```typescript
type ModelCaller = (
  req: ModelRequest
) => AsyncGenerator<StreamEvent, ModelResponse>;
```

### 2.7 上下文组装 — `src/context/assemble.ts`

`assembleSystemPrompt(cwd)` 构建系统提示，包含：
1. **身份指令** — 描述 agent-cli 的角色和能力
2. **CLAUDE.md** — 从当前目录向上查找最多 4 层
3. **AGENTS.md** — 同上
4. **.agent-cli.md** — 同上

### 2.8 Session 管理 — `src/session/SessionStore.ts`

`SessionStore` 提供 append-only JSONL 持久化：

| 方法 | 说明 |
|------|------|
| `create(dir, sessionId?)` | 创建新 session，写入 `session_start` 事件 |
| `open(filePath)` | 从已有文件恢复 session 和 messages |
| `list(dir)` | 列出所有 `.jsonl` 文件（按时间倒序） |
| `append(data)` | 追加任意 JSON 行 |
| `recordMessage(msg)` | 记录消息到 session |
| `loadMessages()` | 从文件恢复所有消息 |

### 2.9 权限管理 — `src/permissions/`

**`PermissionManager.ts`** — `gateToolPermission()` 逻辑：

```
bypassPermissions? → 直接允许
tool.checkPermission === "allow"? → 允许
tool.checkPermission === "deny"? → 拒绝
tool.checkPermission === "ask"? →
  permissionMode === "acceptEdits" 且非 Bash? → 允许
  否则 → 提示用户
```

**`pathSafety.ts`** — `assertInsideCwd(cwd, filePath)`：
- 解析文件路径，检查是否从 cwd 逃逸（防止目录遍历攻击）
- 所有文件工具（Read/Write/Edit）在 execute 前调用

### 2.10 类型系统 — `src/types/messages.ts`

定义了全项目共享的消息模型：

```
Message = { role: "user"|"assistant", content: ContentBlock[] }
ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock
StreamEvent = text_delta | tool_start | tool_result | assistant_message | status | compact | error
TerminalReason = end_turn | max_turns | aborted | error
```

### 2.11 配置 — `src/config/env.ts`

| 导出 | 说明 |
|------|------|
| `loadAgentEnv()` | 从多个候选路径加载 `.env`，不覆盖已有环境变量 |
| `requireApiKey()` | 检查 API Key 存在，不存在则抛错（含配置示例） |

### 2.12 MCP — `src/services/mcp/`

从 `.agent-cli/mcp.json` 加载 MCP 工具，通过 stdio 通信。失败时降级为空列表，不阻塞启动。

---

## 三、依赖关系图

```
cli.ts
  └── repl.ts / ui/
        └── QueryEngine
              ├── SessionStore
              ├── SessionExecLogger
              ├── LlmRequestLogger
              ├── assembleSystemPrompt
              │     └── 文件系统（CLAUDE.md 等）
              ├── createBuiltinTools
              │     ├── Tool.ts (类型)
              │     ├── registry.ts
              │     ├── BashTool.ts
              │     ├── FileReadTool.ts
              │     ├── FileWriteTool.ts
              │     ├── FileEditTool.ts
              │     ├── GlobTool.ts
              │     ├── GrepTool.ts
              │     └── AgentTool.ts
              ├── loadMcpTools
              │     └── MCP client
              ├── createModelCall
              │     ├── anthropic.ts
              │     └── openaiCompatible.ts
              └── runQueryLoop
                    ├── maybeCompact
                    ├── modelCall
                    ├── gateToolPermission
                    └── tool.execute

跨层共享:
  messages.ts (类型定义)
  env.ts (环境配置)
```

---

## 四、数据流

```
用户输入 (REPL)
    │
    ▼
QueryEngine.submit(text)
    │
    ├── ① 持久化: session JSONL + exec log
    │
    ▼
runQueryLoop({ messages, system, tools, ... })
    │
    ├── ② [循环] maybeCompact → modelCall → 流式事件
    │
    ├── ③ assistant_message → yield 事件 + 持久化
    │
    ├── ④ tool_use → gatePermission → tool.execute → tool_result
    │
    └── ⑤ 回灌到 messages → 回到 ②
    │
    ▼
StreamEvent (for await)
    │
    ├── 渲染到终端 (REPL/Print)
    ├── 写入 exec log
    └── 写入 session JSONL
```

**关键保障原则：**
1. **先落地，后投递** — 用户输入先写入 session，再提交给模型
2. **先入历史，后 yield** — 消息先 push 到数组，再通知 UI
3. **引用统一** — `QueryEngine.messages` 和 `runQueryLoop` 操作同一个数组引用
4. **写日志不阻塞** — 日志异步写入，失败不影响主流程

---

## 五、可观测性

| 维度 | 存储位置 | 格式 |
|------|----------|------|
| LLM 请求/响应 | `.sessions/llm-logs/{sessionId}/` | JSON（独立文件 + jsonl 索引） |
| 执行轨迹 | `.sessions/exec-logs/{sessionId}/` | JSONL + 可读 LOG |
| 会话数据 | `.sessions/{sessionId}.jsonl` | Append-only JSONL |
| 权限操作 | 嵌入 exec log | 含 allow/deny 及工具输入 |

三种日志相互独立，任一日志写入失败不影响其他日志和主流程。

---

## 六、技术栈

| 维度 | 选型 |
|------|------|
| 语言 | TypeScript 5.x (ESM) |
| CLI 框架 | Commander |
| Schema 校验 | Zod |
| 终端样式 | Chalk |
| AI SDK | @anthropic-ai/sdk, openai |
| 文件搜索 | glob, ripgrep (优先) |
| 运行时 | Node.js 20+ |
| 包管理 | npm |
