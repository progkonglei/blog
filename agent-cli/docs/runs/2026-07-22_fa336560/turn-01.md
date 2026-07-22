# Turn 01 调用总结

> Turn 1: 用户「hello」→ LLM×2 → 工具[Glob] → Mock: listing package.json via Glob. Mock: tools finished. Done.

## 基本信息

| 项 | 值 |
|---|---|
| 开始 | 2026-07-22T15:04:53.682Z |
| 结束 | 2026-07-22T15:04:53.695Z |
| 耗时 | 13 ms |
| 结束原因 | 正常结束 (end_turn) |
| 循环步数 | 2 |
| LLM 调用 | 2 |
| 工具调用 | 1（失败 0） |

## 用户输入

```
hello
```

## 执行流程

```
用户输入
  └─ 循环步 #1
       ├─ 调用大模型
       │    └─ 返回 (stop=tool_use tools=1 text="Mock: listing package.json via Glob.…")
       ├─ 执行工具: Glob
       └─ 结果回灌历史 → 继续
  └─ 循环步 #2
       ├─ 调用大模型
       │    └─ 返回 (stop=end_turn tools=0 text="Mock: tools finished. Done.…")
  └─ 结束本轮
```

## 关联 LLM 请求

- `0001-request.json` / `0001-response.json`（见 `llm-logs/<sessionId>/`）
- `0002-request.json` / `0002-response.json`（见 `llm-logs/<sessionId>/`）

## 工具调用

### ✓ `Glob`

输入:
```json
{
  "pattern": "package.json"
}
```
输出预览:
```
package.json
```

## 最终助手回复

Mock: listing package.json via Glob.
Mock: tools finished. Done.
