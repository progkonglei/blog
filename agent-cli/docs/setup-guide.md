# 安装与配置指南

> 文档目标：帮助新用户从零开始安装和配置 agent-cli。

---

## 一、环境要求

| 依赖 | 最低版本 | 说明 |
|------|----------|------|
| Node.js | 20+ | 需要 ESM 支持 |
| npm | 9+ | 随 Node.js 一起安装 |
| (可选) ripgrep | 最新 | 提供更快的文件内容搜索 |

---

## 二、安装步骤

### 2.1 克隆仓库

```bash
git clone <repo-url> agent-cli
cd agent-cli
```

### 2.2 安装依赖

```bash
npm install
```

### 2.3 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件，配置至少一个 AI 模型提供商：

### 2.4 配置 API Key

#### 方式一：DeepSeek（推荐，性价比高）

```env
AGENT_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

DeepSeek 的 API 价格远低于 OpenAI，且支持较长的上下文窗口，是开发和日常使用的最佳选择。

#### 方式二：Anthropic

```env
AGENT_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

使用 Anthropic Claude 模型，与 agent-cli 的原生设计最匹配。

#### 方式三：OpenAI

```env
AGENT_PROVIDER=openai
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

> **注意**：DeepSeek 和 OpenAI 使用相同的兼容层（`openaiCompatible.ts`），如果你使用其他兼容 OpenAI 接口的提供商（如通义千问、GLM 等），也可以配置 `OPENAI_BASE_URL` 来指定自定义端点。

#### 方式四：离线 Mock（无需 API Key）

```env
MOCK_LLM=1
```

不调用真实 API，适用于测试和离线演示。Mock 模式会模拟一个回合的工具调用（Glob 查询文件，然后结束）。

---

## 三、快速开始

### 3.1 交互式模式

```bash
npm run dev
```

启动后进入 REPL 界面，可以像 Claude Code 一样与 agent 对话。

### 3.2 Headless 模式

单次执行，适合自动化脚本：

```bash
npm run dev -- -p "列出所有 TypeScript 文件，并统计总数"
```

自动接受编辑（无需手动确认）：

```bash
npm run dev -- -p "将 README.md 中的标题改为大写" --permission-mode acceptEdits
```

### 3.3 指定工作目录

```bash
npm run dev -- -d /path/to/project -p "分析项目结构"
```

---

## 四、权限模式

agent-cli 提供三级权限控制：

| 模式 | 说明 | 使用场景 |
|------|------|----------|
| `default` | 每次修改操作询问用户 | 交互式使用，最安全 |
| `acceptEdits` | 自动允许文件编辑（Bash 仍需确认） | 已知信任的 prompt |
| `bypassPermissions` | 自动允许所有操作 | 完全信任的场景 |

```bash
# 默认模式（REPL 中）
npm run dev

# 接受编辑
npm run dev -- -p "..." --permission-mode acceptEdits

# 完全自动
npm run dev -- -p "..." --permission-mode bypassPermissions
```

---

## 五、MCP 工具配置

MCP（Model Context Protocol）允许你扩展 agent 的能力，添加自定义工具。

### 5.1 创建配置文件

在项目的任意父目录或 home 目录下创建 `.agent-cli/mcp.json`：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    },
    "search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"]
    }
  }
}
```

### 5.2 验证 MCP 连接

启动 agent-cli 时，如果 MCP 服务加载成功，banner 中会显示已连接的 MCP 工具数量。

> **注意**：MCP 服务加载失败不会阻止 agent-cli 启动，工具集会降级为空列表。

### 5.3 禁用 MCP

```bash
npm run dev -- --no-mcp
```

---

## 六、Session 管理

每次对话都是一个 session，存储在 `.sessions/` 目录：

### 恢复历史 session

```bash
# 列出所有 session
ls .sessions/*.jsonl

# 恢复指定 session
npm run dev -- --resume <session-id>
```

### Session 目录结构

```
.sessions/
├── <session-id>.jsonl              # 对话数据
├── exec-logs/
│   └── <session-id>/
│       ├── exec.jsonl              # 结构化执行事件
│       └── exec.log                # 人类可读执行日志
└── llm-logs/
    └── <session-id>/
        ├── requests.jsonl          # 请求索引
        ├── 0001-request.json       # 完整请求
        ├── 0001-response.json      # 模型响应
        ├── 0002-request.json
        ├── 0002-response.json
        └── ...
```

---

## 七、环境变量参考

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AGENT_PROVIDER` | auto | 模型提供商：`deepseek` / `anthropic` / `openai` |
| `DEEPSEEK_API_KEY` | - | DeepSeek API Key |
| `ANTHROPIC_API_KEY` | - | Anthropic API Key |
| `OPENAI_API_KEY` | - | OpenAI API Key |
| `OPENAI_BASE_URL` | - | 自定义 API 端点（兼容 OpenAI 接口的网关） |
| `MOCK_LLM` | 0 | 设为 `1` 使用 Mock 模式 |
| `AGENT_LLM_LOG` | 1 | 设为 `0` 关闭 LLM 请求日志 |
| `AGENT_LLM_LOG_DIR` | `.sessions/llm-logs` | LLM 日志目录 |
| `AGENT_EXEC_LOG` | 1 | 设为 `0` 关闭执行日志 |

---

## 八、常见问题

### Q: 启动时提示 API Key 缺失

```
Error: DEEPSEEK_API_KEY is not set
Configure: DEEPSEEK_API_KEY=sk-...
```

确保已复制 `.env.example` 为 `.env` 并填入正确的 API Key。或者设置 `MOCK_LLM=1` 使用离线模式。

### Q: 如何修改模型参数（temperature, max_tokens 等）

当前使用模型默认参数。如需自定义，需要修改 `src/services/api/anthropic.ts` 或 `openaiCompatible.ts` 中的请求参数。

### Q: 输出被截断了

工具输出有字符数限制：
- Bash：80k 字符
- Read：100k 字符
- Glob/Grep：200 条结果

如需查看完整输出，可以分多次读取或直接使用 Bash 工具查看。

### Q: MCP 服务启动失败

agent-cli 会优雅降级，不会影响正常使用。检查 MCP 配置是否正确，以及所需包是否已安装。

### Q: 如何彻底清除所有 session 数据

```bash
rm -rf .sessions/
```
