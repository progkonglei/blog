# 工具系统

> 文档目标：详细说明工具系统的设计、如何使用、如何扩展。

---

## 一、核心概念

工具系统是 agent-cli 的核心能力，让 LLM 能够与文件系统、Shell、代码仓库等环境进行交互。整个系统围绕三个核心概念构建：

```
ToolDefinition（工具定义）
    │
    ├── name          — 工具名称（供 LLM 调用）
    ├── description   — 描述（LLM 理解用途）
    ├── inputSchema   — Zod Schema（参数校验）
    ├── isReadOnly    — 是否为只读工具
    ├── checkPermission — 权限钩子
    └── execute       — 执行函数

ToolContext（上下文环境）
    │
    ├── cwd                — 工作目录
    ├── permissionMode     — 权限模式（default/acceptEdits/bypassPermissions）
    ├── askPermission      — 权限提示回调
    ├── signal             — AbortSignal（取消信号）
    └── depth / maxDepth   — 子代理深度

ToolRegistry（工具注册表）
    │
    ├── 管理所有可用工具
    ├── 按只读/非只读分组
    └── 转换为 Anthropic JSON Schema
```

---

## 二、内置工具详解

### 2.1 Bash — Shell 执行

| 属性 | 值 |
|------|-----|
| **name** | `Bash` |
| **description** | 执行 Shell 命令 |
| **readOnly** | 否 |
| **default permission** | `ask`（始终询问） |
| **超时** | 默认 30s，最大 120s（通过 `timeout_ms` 参数） |
| **输出截断** | 80k 字符 |

**参数：**

```typescript
{
  command: string;    // Shell 命令
  timeout_ms?: number; // 超时（毫秒）
}
```

**返回：**

```
Exit code: {code}
Output:
{stdout}
{stderr}
```

**实现细节：**
- 使用 Node.js `child_process.spawn`，`shell: true`
- 支持 `ctx.signal` 取消
- 始终询问权限（即使 `acceptEdits` 模式）
- 适合运行测试、构建、代码检查等

---

### 2.2 Read — 文件读取

| 属性 | 值 |
|------|-----|
| **name** | `Read` |
| **description** | 读取文本文件，支持行范围切片 |
| **readOnly** | 是 |
| **default permission** | `allow`（自动允许） |
| **输出截断** | 100k 字符 |

**参数：**

```typescript
{
  path: string;      // 文件路径
  offset?: number;   // 起始行号（1-based）
  limit?: number;    // 最大行数
}
```

**返回：**

```
path/to/file (共 N 行)
  1│ 第一行内容
  2│ 第二行内容
  ...
```

**实现细节：**
- 使用 `assertInsideCwd` 防止目录遍历
- 文件路径相对于 cwd 解析
- 行号切片是 1-based（offset=1 即从第一行开始）
- 只读工具，始终自动允许

---

### 2.3 Write — 文件写入

| 属性 | 值 |
|------|-----|
| **name** | `Write` |
| **description** | 创建或覆盖文件 |
| **readOnly** | 否 |
| **default permission** | `acceptEdits` 时自动允许，否则 `ask` |

**参数：**

```typescript
{
  path: string;      // 文件路径
  content: string;   // 文件内容
}
```

**返回：**

```
Written {bytes} bytes to {relativePath}
```

**实现细节：**
- 自动创建父目录（`mkdir -p` 语义）
- 使用 `assertInsideCwd` 安全校验
- 写入完成后统计字节数
- 对于大文件或已有文件，推荐使用 `Edit` 进行精准修改

---

### 2.4 Edit — 精准编辑

| 属性 | 值 |
|------|-----|
| **name** | `Edit` |
| **description** | 精准字符串替换（推荐用于已有文件的局部修改） |
| **readOnly** | 否 |
| **default permission** | `acceptEdits` 时自动允许，否则 `ask` |

**参数：**

```typescript
{
  path: string;           // 文件路径
  old_string: string;     // 被替换的原始文本（必须精确匹配）
  new_string: string;     // 替换后的新文本
  replace_all?: boolean;  // 是否替换所有匹配（默认为 false）
}
```

**返回：**

```
Applied edit to {path} (changed {N} occurrence(s))
```

**实现细节：**
- 默认要求 `old_string` 在文件中**唯一匹配**（防止意外替换）
- `replace_all: true` 可替换所有匹配
- 零匹配或非唯一匹配时抛出错误，不修改文件
- 比 Write 更安全、更精准，是修改已有文件的推荐方式

---

### 2.5 Glob — 文件搜索

| 属性 | 值 |
|------|-----|
| **name** | `Glob` |
| **description** | 按 glob 模式搜索文件 |
| **readOnly** | 是 |
| **default permission** | `allow` |
| **最大结果数** | 200 |

**参数：**

```typescript
{
  pattern: string;   // Glob 模式，如 "**/*.ts", "src/**/*.css"
  cwd?: string;      // 搜索目录（默认当前工作目录）
}
```

**返回：**

```
Found N files matching pattern:
- src/foo.ts
- src/bar.ts
...
```

**实现细节：**
- 自动忽略 `node_modules`、`.git`、`dist` 目录
- 使用 `glob` 库
- 路径相对于 cwd 解析
- 只读工具，始终自动允许

---

### 2.6 Grep — 内容搜索

| 属性 | 值 |
|------|-----|
| **name** | `Grep` |
| **description** | 在文件中搜索正则表达式匹配 |
| **readOnly** | 是 |
| **default permission** | `allow` |
| **最大结果数** | 200 |

**参数：**

```typescript
{
  pattern: string;       // 正则表达式
  path?: string;         // 搜索路径（文件或目录）
  glob?: string;         // Glob 过滤器，如 "*.ts"
  case_insensitive?: boolean; // 是否忽略大小写
  head_limit?: number;   // 最大结果行数
}
```

**返回：**

```
path/to/file.ts:
   12│ matched content
   34│ another match
```

**实现细节：**
- **双后端策略**：
  1. 优先尝试 ripgrep（`rg`），速度快，输出带行号
  2. 若 ripgrep 不可用，降级为纯 Node.js 实现（用 glob 枚举文件，逐行正则匹配）
- 自动忽略 `node_modules`、`.git`、`dist`
- 使用 `assertInsideCwd` 安全校验
- 只读工具，始终自动允许

---

### 2.7 Agent — 子代理

| 属性 | 值 |
|------|-----|
| **name** | `Agent` |
| **description** | 将子任务委派给隔离的子代理 |
| **readOnly** | 否（取决于子代理调用的工具） |
| **default permission** | 同父级上下文 |
| **最大深度** | 2（通过 `maxDepth` 配置） |
| **最大轮次** | 12 |

**参数：**

```typescript
{
  description: string;  // 子任务描述（3-5 词）
  prompt: string;       // 任务指令
  readonly?: boolean;   // 子代理是否只能使用只读工具
}
```

**返回：**

```
[subagent:<description> depth=<n> stop=<reason>]
<子代理最终回复>
```

**实现细节：**
- 创建**完全隔离的** `runQueryLoop`，使用独立的消息历史
- 子代理继承父级工具的**子集**（只读或全部）
- `maxDepth` 限制递归深度，防止无限嵌套
- 子代理运行最多 12 轮，防止无限循环
- 子代理的最终文本回复作为工具结果返回给父代理
- 设计目标：防止上下文爆炸（context explosion）

---

## 三、工具注册与转换

### 注册流程

```typescript
// src/tools/registry.ts

function createBuiltinTools(
  modelCall: ModelCaller,
  getTools: GetToolsFn
): ToolDefinition[] {
  return [
    BashTool.create(),
    FileReadTool.create(),
    FileWriteTool.create(),
    FileEditTool.create(),
    GlobTool.create(),
    GrepTool.create(),
    createAgentTool({ getTools, modelCall }),
  ];
}
```

### 转换为 Anthropic JSON Schema

LLM API 需要 JSON Schema 格式的工具定义：

```typescript
function toolsToAnthropic(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: sanitizeForFunctionCalling(
      zodToJsonSchema(t.inputSchema)
    ),
  }));
}
```

`sanitizeForFunctionCalling` 会移除 OpenAI/DeepSeek 网关不兼容的字段（如 `exclusiveMinimum`、`exclusiveMaximum`、`$schema`）。

### 只读过滤

```typescript
function getTools(readonly?: boolean): ToolDefinition[] {
  if (readonly) {
    return allTools.filter(t => t.isReadOnly);
  }
  return allTools;
}
```

子代理（`AgentTool`）通过此机制限制其只能调用只读工具。

---

## 四、工具的两种使用方式

### 方式一：通过 MCP 注册（外部工具）

在 `.agent-cli/mcp.json` 中配置 MCP 服务器，这些工具在 `QueryEngine.init()` 阶段通过 MCP 客户端加载，与内置工具合并使用。

### 方式二：通过代码扩展（自定义工具）

```typescript
import { defineTool } from './Tool.js';

const MyCustomTool = defineTool({
  name: 'MyTool',
  description: '我的自定义工具',
  inputSchema: z.object({
    param1: z.string().describe('参数1'),
    param2: z.number().optional().describe('参数2'),
  }),
  isReadOnly: true,
  checkPermission: (_ctx, _input) => 'allow',
  execute: async (ctx, input) => {
    // 实现你的工具逻辑
    return `处理结果: ${input.param1}`;
  },
});
```

然后在 `createBuiltinTools()` 中注册即可。

---

## 五、权限模型

每个工具可以通过 `checkPermission` 钩子控制访问：

| 返回值 | 行为 |
|--------|------|
| `'allow'` | 自动允许执行（只读工具通常如此） |
| `'deny'` | 拒绝执行，返回权限错误给 LLM |
| `'ask'` | 根据 `permissionMode` 决定：`acceptEdits` 模式且非 Bash → 允许；否则提示用户 |

`gateToolPermission()` 完整逻辑：

```
1. bypassPermissions 模式 → 直接 allow
2. tool.checkPermission() 返回:
   - "allow" → allow
   - "deny"  → deny
   - "ask"   →
     a. acceptEdits 模式 且 不是 Bash 工具 → allow
     b. 否则 → ctx.askPermission() 询问用户
```

---

## 六、工具执行流程（工具循环）

```typescript
for (const use of toolUses) {
  // 1. 广播 tool_start 事件
  yield { type: "tool_start", name: use.name, input: use.input };

  // 2. 查找工具
  const tool = toolMap.get(use.name);
  if (!tool) {
    result = { type: "tool_result", content: "Unknown tool", is_error: true };
    continue;
  }

  // 3. 参数校验
  const parsed = tool.inputSchema.safeParse(use.input);
  if (!parsed.success) {
    result = { type: "tool_result", content: parsed.error.message, is_error: true };
    continue;
  }

  // 4. 权限检查
  const decision = await gateToolPermission(tool, ctx, parsed.data);
  if (decision === "deny") {
    result = { type: "tool_result", content: "Permission denied", is_error: true };
    continue;
  }

  // 5. 执行
  try {
    const output = await tool.execute(ctx, parsed.data);
    result = { type: "tool_result", content: output };
  } catch (err) {
    result = { type: "tool_result", content: String(err), is_error: true };
  }

  // 6. 广播 tool_result 事件
  yield { type: "tool_result", name: use.name, result: result.content };
}
```

**关键设计：**
- 每个工具调用独立 try-catch，一个失败不影响其他
- 校验、权限、执行三段分离，各司其职
- 所有结果（成功/失败/拒绝）回灌给 LLM
