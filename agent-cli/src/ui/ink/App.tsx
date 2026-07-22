/**
 * Claude Code 风格 Ink REPL
 *
 * 关键差异（相对旧版「乱」的原因）：
 * 1. 不用 height=终端行数 的全屏仪表盘布局（边框套边框会乱）
 * 2. 用 <Static> 沉淀已完成消息，像 transcript 往上滚
 * 3. 输入区极简 › ，无双层 round border
 * 4. 工具行对齐 ● / ⎿ ，少状态栏噪音
 */
import React, { useCallback, useState } from "react";
import { Box, Text, Static, useApp, useInput } from "ink";
import { VimMultilineInput } from "./VimMultilineInput.js";
import { MessageRow, type UiMessage } from "./MessageList.js";
import type { QueryEngine } from "../../query/QueryEngine.js";
import type { StreamEvent } from "../../types/messages.js";

type Props = {
  engine: QueryEngine;
  cwd: string;
  mode: string;
};

let msgSeq = 0;
function mid(): string {
  msgSeq += 1;
  return `m${msgSeq}`;
}

export function InkApp({ engine, cwd, mode }: Props) {
  const { exit } = useApp();

  /** 已定稿消息 → Static（不再重绘） */
  const [done, setDone] = useState<UiMessage[]>([]);
  /** 当前回合临时消息（流式 / 运行中工具） */
  const [live, setLive] = useState<UiMessage[]>([]);
  const [busy, setBusy] = useState(false);

  const pushDone = useCallback((items: UiMessage[]) => {
    if (!items.length) return;
    setDone((prev) => [...prev, ...items]);
  }, []);

  useInput((input, key) => {
    if (input === "c" && key.ctrl) {
      // 忙时中断体验：直接退出；后续可接 AbortController
      if (!busy) void engine.dispose().finally(() => exit());
    }
  });

  const onSubmit = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t || busy) return;

      if (t === "/exit" || t === "/quit") {
        await engine.dispose();
        exit();
        return;
      }
      if (t === "/clear") {
        engine.clear();
        setDone([]);
        setLive([]);
        return;
      }
      if (t === "/help") {
        setDone((prev) => [
          ...prev,
          {
            id: mid(),
            kind: "status",
            text: "/help  /clear  /exit · esc=vim · ctrl+j=newline · enter=send",
          },
        ]);
        return;
      }

      const userMsg: UiMessage = { id: mid(), kind: "user", text: t };
      setDone((prev) => [...prev, userMsg]);
      setLive([{ id: mid(), kind: "thinking", text: "Thinking…" }]);
      setBusy(true);

      let assistantId: string | null = null;
      const toolMap = new Map<string, string>();

      const upsertLive = (updater: (prev: UiMessage[]) => UiMessage[]) => {
        setLive((prev) => updater(prev));
      };

      try {
        const gen = engine.submit(t);
        let next = await gen.next();
        while (!next.done) {
          handle(next.value);
          next = await gen.next();
        }
        // 把 live 里非 thinking 的定稿进 Static
        setLive((prev) => {
          const finalized = prev.filter((m) => m.kind !== "thinking");
          if (finalized.length) pushDone(finalized);
          return [];
        });
      } catch (err) {
        pushDone([
          {
            id: mid(),
            kind: "status",
            text: `error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ]);
        setLive([]);
      } finally {
        setBusy(false);
      }

      function handle(ev: StreamEvent) {
        if (ev.type === "text_delta") {
          upsertLive((prev) => {
            // 去掉 thinking
            const withoutThinking = prev.filter((m) => m.kind !== "thinking");
            if (!assistantId) {
              assistantId = mid();
              return [...withoutThinking, { id: assistantId, kind: "assistant", text: ev.text }];
            }
            return withoutThinking.map((m) =>
              m.id === assistantId && m.kind === "assistant"
                ? { ...m, text: m.text + ev.text }
                : m,
            );
          });
          return;
        }

        if (ev.type === "tool_start") {
          assistantId = null;
          const id = mid();
          toolMap.set(ev.id, id);
          const args =
            Object.keys(ev.input).length === 1
              ? String(Object.values(ev.input)[0]).slice(0, 72)
              : JSON.stringify(ev.input).slice(0, 72);

          upsertLive((prev) => {
            const base = prev.filter((m) => m.kind !== "thinking");
            const rows: UiMessage[] = [
              ...base,
              { id, kind: "tool", name: ev.name, args, running: true },
            ];
            if (ev.name === "Orchestrate" && Array.isArray((ev.input as { tasks?: unknown }).tasks)) {
              const tasks = (ev.input as { tasks: Array<{ description: string }> }).tasks;
              rows.push({
                id: mid(),
                kind: "agents",
                items: tasks.map((x) => ({ description: x.description, status: "running" })),
              });
            }
            return rows;
          });
          return;
        }

        if (ev.type === "tool_result") {
          const uiId = toolMap.get(ev.id);
          if (!uiId) return;
          upsertLive((prev) =>
            prev.map((m) =>
              m.id === uiId && m.kind === "tool"
                ? {
                    ...m,
                    running: false,
                    error: ev.isError,
                    result: ev.output.replace(/\s+/g, " ").trim().slice(0, 120),
                  }
                : m,
            ),
          );
          return;
        }

        if (ev.type === "error") {
          upsertLive((prev) => [
            ...prev.filter((m) => m.kind !== "thinking"),
            { id: mid(), kind: "status", text: ev.error },
          ]);
        }
      }
    },
    [busy, engine, exit, pushDone],
  );

  const shortCwd = cwd.length > 42 ? `…${cwd.slice(-41)}` : cwd;

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* 极简欢迎 — 对标 Claude Code 启动信息，无大边框 */}
      <Box marginBottom={1} flexDirection="column">
        <Text>
          <Text color="#D97757" bold>
            ✻ agent-cli
          </Text>
          <Text dimColor> · {mode}</Text>
        </Text>
        <Text dimColor>{shortCwd}</Text>
      </Box>

      <Static items={done}>{(msg) => <MessageRow key={msg.id} msg={msg} />}</Static>

      {live.map((msg) => (
        <MessageRow key={msg.id} msg={msg} />
      ))}

      <VimMultilineInput onSubmit={(v) => void onSubmit(v)} disabled={busy} />
    </Box>
  );
}
