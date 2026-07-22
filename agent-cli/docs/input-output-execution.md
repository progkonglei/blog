# 输入 → 输出执行逻辑 & 技术稳定

> 文档目标：完整描述 agent-cli 从终端接收到用户输入，到最终输出回复/执行工具的整条链路，并对每个环节做「技术稳定」分析。

---

## 一、整体架构概览

```
用户输入
    │
    ▼
┌──────────────────┐
│   CLI 入口层      │  (commander + env 加载)
│   src/entrypoints │
└────────┬─────────┘
         │ 模式路由
         ▼
┌──────────────────┐
│   REPL / Print   │  (UI 层)
│   src/ui/repl    │
└────────┬─────────┘
         │ submit()
         ▼
┌──────────────────┐
│  QueryEngine     │  门面 / 编排层
│  src/query/      │
│  QueryEngine.ts  │
└────────┬─────────┘
         │ runQueryLoop()
         ▼
┌──────────────────────┐
│  Agent Loop (核心)    │
│  src/query/queryLoop  │
│  ┌────────────────┐  │
│  │ ① maybeCompact │  │  历史压缩
│  │ ② modelCall    │  │  模型 API
│  │ ③ tool_use     │  │  工具选择 & 执行
│  │ ④ 结果回灌      │  │  消息追加
│  └────────────────┘  │
└────────┬─────────────┘
         │ StreamEvent（流式事件）
         ▼
┌──────────────────┐
│  渲染 / 落盘      │
│  REPL 输出 / 日志  │
└──────────────────┘
```

---

## 二、逐层执行链路详解

### 2.1 CLI 入口 (`src/entrypoints/cli.ts`)

| 步骤 | 说明 |
|------|------|
| 1 | 调用 `loadAgentEnv()` 加载 `.env` 文件 |
| 2 | 解析 `commander` 命令行参数 |
| 3 | 根据模式分发：`--print` → `runPrint()`；位置参数 → `runPrint()`；无参数 → `runRepl()` |

**技术稳定分析：**
- `loadAgentEnv()` 在模块顶部同步执行，保证所有后续 `import` 都能读到环境变量。**稳定性**：高，无异步竞态。
- `commander` 的 `.action()` 是异步回调，用 `program.parseAsync()` 兜底异常——任何未捕获的 reject 都会走向 `catch`，设 `exitCode = 1` 而非进程崩溃。**稳定性**：高。
- 多模式路由逻辑清晰，无隐藏分支。**稳定性**：高。

---

### 2.2 REPL / Print 层 (`src/ui/repl.ts`)

| 步骤 | 说明 |
|------|------|
| 1 | 创建 `QueryEngine` 实例 |
| 2 | 调用 `await engine.init()` 异步初始化 |
| 3 | 调用 `engine.submit(userText)` 获取 `AsyncGenerator<StreamEvent>` |
| 4 | `for await` 消费事件：渲染 token / 工具状态 / 最终消息 |
| 5 | `await engine.dispose()` 清理资源 |

**技术稳定分析：**
- `init()` 内部包含：会话创建 + 日志初始化 + 系统提示组装 + MCP 加载。其中 MCP 加载可能超时/失败，但 `loadMcpTools` 内部捕获异常，降级为空工具列表，不会 block 启动。**稳定性**：中高（MCP 失败可降级）。
- `submit()` 返回 `AsyncGenerator`，REPL 用 `for await` 消费——若中途 generator throw，REPL 层会 catch 并打印错误，不会导致整个进程退出。**稳定性**：高。
- `dispose()` 会关闭 MCP 连接和 flush 日志，即使 dispose 失败也不影响已完成的输出。**稳定性**：中高（资源泄漏风险小）。

---

### 2.3 QueryEngine 门面 (`src/query/QueryEngine.ts`)

`QueryEngine` 是编排层，不做 LLM 调用本身，职责清晰：

| 职责 | 说明 |
|------|------|
| `init()` | 装载会话、日志、系统提示、工具、MCP |
| `submit()` | 传入 `userText`，创建 `ToolContext`，委派给 `runQueryLoop()` |
| `dispose()` | 清理资源 |

**技术稳定分析：**
- `submit()` 内部：先 push 用户消息到 `this.messages` → 落盘到 session JSONL → 写入执行日志 → 创建 `ToolContext` → 调用 `runQueryLoop()` → 消费事件时同步写日志。
- 消息持久化（session）在 yield 事件之前完成，即使后续模型调用失败，用户输入也已持久化。**稳定性**：高。
- `modelCall` 被 `llmLogger.wrap()` 包装，每次 API 调用都会落盘请求/响应，无异常逃逸。**稳定性**：高。
- `askPermission` 也被包装，每次权限判定写入执行日志。**稳定性**：高。

---

### 2.4 Agent Loop 核心 (`src/query/queryLoop.ts`)

这是最关键的循环，以下逐行分析其执行路径：

#### 伪代码逻辑

```
turn = 0
while turn < maxTurns:
    ① maybeCompact(messages)         // 压缩历史（如超过阈值）
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

#### 详细步骤

##### ① 历史压缩 (`maybeCompact`)

- 触发条件：`messages` 序列化的字符数 > `compactThresholdChars`（默认 180k）
- 压缩方式：将历史（不含 system）发送给 LLM，请求生成摘要 + 保留最新 N 轮
- 成功后：清空 `opts.messages`，替换为压缩后的消息列表
- yield `{ type: "compact", before, after, summary }`

**技术稳定分析：**
- `maybeCompact` 是异步函数，内部有 try-catch，压缩失败时**静默跳过**，不影响继续循环。**稳定性**：高（优雅降级）。
- 压缩后 `opts.messages.length = 0; opts.messages.push(...compacted.messages)` —— 直接修改传入的引用，不重建数组，保证 `QueryEngine` 中的引用一致。**稳定性**：高。
- 阈值 180k 远低于常见模型上下文窗口（200k+），有足够余量。**稳定性**：高。

##### ② 模型调用 (`modelCall`)

- 调用格式：`modelCall({ system, messages, tools, signal })`
- 返回 `AsyncGenerator<StreamEvent, ModelResponse>`
- 流式事件包括：`text_delta`, `tool_use_start`, `tool_use_delta`, `input_json_delta`, `content_block_stop` 等
- 最终 `ModelResponse` 包含完整 `content` 和 `stopReason`

**技术稳定分析：**
- 流式 API 在 Node 环境通过 HTTP SSE 实现，若网络中断：
  - `modelCall` 内部应该 throw → 外层 catch → yield `{ type: "error" }` → return `{ kind: "error" }`。**稳定性**：中高（依赖 provider 实现的健壮性）。
  - 若信号量 `AbortSignal` 触发 → 循环顶部检测 `opts.signal?.aborted` 立即返回 `{ kind: "aborted" }`。**稳定性**：高。
- 超时处理：当前没有显式超时（除了 AbortSignal），但外层 `maxTurns` 保证循环不会无限持续。**稳定性**：中（建议：HTTP 请求侧设置超时）。

##### ③ 助手消息落盘

```typescript
const assistantMsg: Message = { role: "assistant", content: modelResult.content };
opts.messages.push(assistantMsg);
yield { type: "assistant_message", message: assistantMsg };
```

**技术稳定分析：**
- 先 push 到 messages，再 yield 事件——保证消息已入历史，即使 UI 消费时出错也不丢状态。**稳定性**：高。
- 注意：`modelResult.content` 是 `ContentBlock[]`，其中 `tool_use` block 包含完整的 JSON input。**稳定性**：高。

##### ④ 终止条件判定

```typescript
const toolUses = modelResult.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
if (toolUses.length === 0 || modelResult.stopReason === "end_turn") {
  return { kind: "end_turn" };
}
```

**技术稳定分析：**
- `stopReason === "end_turn"` 是 Anthropic API 的惯例，但兼容 OpenAI 格式时可能是 `"stop"`。若 `stopReason` 为 `"stop"` 但仍有 tool_use，会出现**不一致状态**。**稳定性**：中（兼容性风险）。
- 双重条件（toolUses.length === 0 **或** stopReason === "end_turn"）提供了安全边界：即使 stopReason 非预期，只要没工具调用也会结束。**稳定性**：中高。

##### ⑤ 工具执行循环

```typescript
for (const use of toolUses) {
  // a) yield tool_start
  // b) 查找 toolMap -> 不存在则返回错误
  // c) inputSchema.parse() -> 校验失败则返回错误
  // d) gateToolPermission() -> 被拒则返回错误
  // e) tool.execute() -> 失败则返回错误
  // 以上全部 push tool_result 到 results[]
}
// ⑥ 回灌
opts.messages.push({ role: "user", content: results });
```

**技术稳定分析：**
- 每个工具调用独立 try-catch，一个工具失败不影响其他工具的执行。**稳定性**：高。
- `gateToolPermission` 允许用户选择 allow/reject，拒绝时返回 `"Permission denied"` 给模型，模型可以据此修正请求。**稳定性**：高。
- `inputSchema.parse()` 使用 Zod，校验失败抛异常 → 捕获后生成 `is_error: true` 结果。**稳定性**：高。
- 所有工具结果（成功/失败/拒绝）统一作为 `user` 角色的 `tool_result` 块回灌给模型，符合 Anthropic Messages API 协议。**稳定性**：高。

##### ⑥ 结果回灌 & 循环

- 所有 `tool_result` 合并为一条 `{ role: "user", content: results }` 消息
- 模型在下一轮看到这些结果后，可能：
  - 继续调用工具
  - 生成最终文本回复（`end_turn`）
- 回到步骤 ①，直至 `maxTurns` 或 `end_turn` 或 `abort`

**技术稳定分析：**
- `maxTurns` 默认 40，防止无限循环。到达后返回 `{ kind: "max_turns" }`。**稳定性**：高。
- 但若工具链特别长（如逐个文件读取），40 轮可能不够。理论上模型可以分多轮，每轮读几个文件。**稳定性**：中高（需引导模型分批）。

---

## 三、错误边界总结

| 环节 | 异常情况 | 处理方式 | 稳定等级 |
|------|----------|----------|----------|
| CLI 启动 | API Key 缺失 | 打印警告，不退出（支持 MOCK） | 🟢 高 |
| CLI 解析 | 无效参数 | Commander 自动报错，exit 1 | 🟢 高 |
| MCP 加载 | 服务不可达 | 降级为空工具列表 | 🟢 高 |
| 会话创建 | 磁盘写入失败 | 默认日志目录，无 session 文件也可运行 | 🟢 高 |
| 历史压缩 | LLM 调用失败 | 静默跳过，保持原历史 | 🟢 高 |
| 模型调用 | 网络异常 / API 错误 | catch → yield error 事件 → 终止循环 | 🟡 中高 |
| 模型调用 | 超时 | 依赖 AbortSignal（需调用方传入） | 🟡 中 |
| 工具校验 | Zod 校验失败 | catch → is_error 回灌 | 🟢 高 |
| 工具执行 | 运行时报错 | catch → is_error 回灌 | 🟢 高 |
| REPL 渲染 | 渲染异常 | 局部 try-catch，打印错误 | 🟢 高 |
| 资源清理 | dispose 失败 | 不阻塞主流程，仅为 log | 🟡 中高 |

---

## 四、数据流一致性保障

```
用户输入
  │
  ├── 写入 session JSONL  ←── 先持久化，再提交给 LLM
  ├── 写入 exec log       ←── 同步记录
  │
  ▼
modelCall(request)
  │
  ├── llmLogger 记录完整 request/response ←── 先记录，再 yield
  │
  ▼
assistant_message
  │
  ├── push 到 messages[] ←── 先入历史，再 yield
  ├── session JSONL 追加 ←── 异步不阻塞
  │
  ▼
tool_result
  │
  ├── push 到 results[]
  ├── yield 事件
  │
  ▼
回灌 user role → 循环
```

**关键保障原则：**
1. **先落地，后投递**：用户输入先写入 session 文件，再提交给模型
2. **先入历史，后 yield**：消息先 push 到数组中，再通知 UI 层
3. **引用统一**：`opts.messages` 是外部传入的引用，`QueryEngine.submit()` 和 `runQueryLoop()` 操作同一个数组
4. **写日志不阻塞主流程**：日志写入使用 `await` 但无 `try-catch` 包围主逻辑

---

## 五、可观测性

| 维度 | 实现 |
|------|------|
| LLM 请求/响应 | `LlmRequestLogger` → `llm-logs/{sessionId}/` |
| 执行轨迹 | `SessionExecLogger` → `exec-logs/{sessionId}/` |
| 会话持久化 | `SessionStore` → `.sessions/{sessionId}.jsonl` |
| 权限操作记录 | 嵌入 exec log，含 allow/deny 及工具输入 |

三者相互独立，任一日志写入失败不影响其他日志和主流程。

---

## 六、稳定性结论

**整体稳定性：🟢 高**

agent-cli 的输入→输出执行链在设计上遵循了典型的 Agent Loop 模式，并具备以下稳定性特征：

1. **分段保护**：每个环节（模型调用、工具校验、工具执行）都有独立的 try-catch
2. **优雅降级**：MCP 失败、历史压缩失败、日志写入失败都不会 block 主流程
3. **数据一致**：先持久化后投递，先入历史后 yield
4. **有限循环**：`maxTurns` 硬性上限，防止无限 tool_use 循环
5. **可取消**：支持 `AbortSignal`，调用方随时终止

**可改进的中等级别风险：**
- 模型 API 调用没有独立超时（需通过 AbortSignal 实现）
- 若 provider 返回非预期 `stopReason` 但携带 tool_use，可能导致模型误判

---

*最后更新：2025-07*  
*对应代码：`src/entrypoints/cli.ts`, `src/ui/repl.ts`, `src/query/QueryEngine.ts`, `src/query/queryLoop.ts`*
