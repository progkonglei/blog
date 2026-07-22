# agent-cli 文档

| 文档 | 说明 |
|------|------|
| [input-output-execution.md](./input-output-execution.md) | 输入→输出链路与稳定性分析 |
| [runs/](./runs/) | **每次运行自动沉淀**的会话文档 |

## 自动沉淀（Doc Deposit）

每次 `npm run dev` / `--print` 结束后会写入：

```text
docs/runs/
  INDEX.md                 # 全部会话索引（最新在上）
  LATEST.md                # 最近一次完整快照
  HISTORY.jsonl            # 机器可读流水
  YYYY-MM-DD_xxxxxxxx.md   # 单次会话总览
  YYYY-MM-DD_xxxxxxxx/
    turn-01.md             # 每轮详细总结
```

关闭：`AGENT_DOC_DEPOSIT=0`  
自定义目录：`AGENT_DOC_DIR=/path/to/runs`
