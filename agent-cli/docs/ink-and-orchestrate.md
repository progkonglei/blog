# Ink TUI & 多 Agent 编排

## Ink / React TUI

默认 `npm run dev` 进入 Ink 界面（`--legacy-ui` 回退旧版）。

| 操作 | 说明 |
|------|------|
| Enter | 发送 |
| Ctrl+J | 多行换行 |
| Esc | Vim NORMAL |
| i / a / A / o | 进入 INSERT |
| hjkl / 方向键 | NORMAL 移动 |
| dd | 清空输入 |
| PgUp / PgDn | 滚动会话 |
| /help /clear /exit | 斜杠命令 |

## Orchestrate（并行多 Agent）

模型可调用 `Orchestrate`，一次传入最多 8 个独立任务，内部 `Promise.all` 并行跑隔离子代理，只把摘要汇总回父 Agent。

冒烟：

```bash
npm run smoke:orchestrate
```
