/**
 * Ink REPL 主界面
 * - 上方：可滚动消息（PgUp/PgDn）
 * - 下方：Vim 多行输入
 * - 运行中禁用输入，流式追加消息
 */
import React, { useCallback, useMemo, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { VimMultilineInput } from "./VimMultilineInput.js";
import { MessageList, type UiMessage } from "./MessageList.js";
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
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;

  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("ready");

  const maxVisible = Math.max(6, rows - 10);

  const append = useCallback((m: UiMessage) => {
    setMessages((prev) => [...prev, m]);
    setScrollOffset(0);
  }, []);

  useInput((input, key) => {
    if (key.pageUp) {
      setScrollOffset((o) => Math.min(messages.length, o + Math.max(1, Math.floor(maxVisible / 2))));
      return;
    }
    if (key.pageDown) {
      setScrollOffset((o) => Math.max(0, o - Math.max(1, Math.floor(maxVisible / 2))));
      return;
    }
    if (busy) return;
    if (input === "q" && key.ctrl) {
      void engine.dispose().finally(() => exit());
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
        setMessages([]);
        setStatus("cleared");
        return;
      }
      if (t === "/help") {
        append({
          id: mid(),
          kind: "status",
          text: "/help /clear /exit · Esc=vim · Ctrl+J=newline · Enter=send · PgUp/PgDn · Orchestrate=parallel agents",
        });
        return;
      }

      append({ id: mid(), kind: "user", text: t });
      setBusy(true);
      setStatus("running…");

      const ac = new AbortController();
      let assistantId: string | null = null;
      const toolMap = new Map<string, string>();

      try {
        const gen = engine.submit(t, ac.signal);
        let next = await gen.next();
        while (!next.done) {
          handleStream(next.value);
          next = await gen.next();
        }
        setStatus(next.value.kind === "end_turn" ? "ready" : next.value.kind);
      } catch (err) {
        append({
          id: mid(),
          kind: "status",
          text: `error: ${err instanceof Error ? err.message : String(err)}`,
        });
        setStatus("error");
      } finally {
        setBusy(false);
      }

      function handleStream(ev: StreamEvent) {
        if (ev.type === "text_delta") {
          if (!assistantId) {
            assistantId = mid();
            append({ id: assistantId, kind: "assistant", text: ev.text });
          } else {
            const aid = assistantId;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aid && m.kind === "assistant" ? { ...m, text: m.text + ev.text } : m,
              ),
            );
          }
          return;
        }
        if (ev.type === "tool_start") {
          assistantId = null;
          const id = mid();
          toolMap.set(ev.id, id);
          const args =
            Object.keys(ev.input).length === 1
              ? String(Object.values(ev.input)[0]).slice(0, 64)
              : JSON.stringify(ev.input).slice(0, 64);
          append({
            id,
            kind: "tool",
            name: ev.name,
            args,
            running: true,
          });
          if (ev.name === "Orchestrate" && Array.isArray((ev.input as { tasks?: unknown }).tasks)) {
            const tasks = (ev.input as { tasks: Array<{ description: string }> }).tasks;
            append({
              id: mid(),
              kind: "agents",
              items: tasks.map((x) => ({ description: x.description, status: "running" })),
            });
          }
          return;
        }
        if (ev.type === "tool_result") {
          const uiId = toolMap.get(ev.id);
          if (uiId) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === uiId && m.kind === "tool"
                  ? {
                      ...m,
                      running: false,
                      error: ev.isError,
                      result: ev.output.replace(/\s+/g, " ").trim().slice(0, 100),
                    }
                  : m,
              ),
            );
          }
          return;
        }
        if (ev.type === "phase" && ev.phase === "model_call_start") {
          setStatus(`model step ${ev.step}…`);
        }
        if (ev.type === "error") {
          append({ id: mid(), kind: "status", text: ev.error });
        }
      }
    },
    [append, busy, engine, exit],
  );

  const header = useMemo(
    () =>
      `agent-cli · ${mode} · ${cwd.slice(-48)} · session ${(engine.sessionId ?? "").slice(0, 8)}…`,
    [cwd, engine.sessionId, mode],
  );

  return (
    <Box flexDirection="column" height={rows} width="100%">
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="#D97757" bold>
          ✻{" "}
        </Text>
        <Text dimColor>{header}</Text>
        <Text> </Text>
        <Text color={busy ? "yellow" : "green"}>{busy ? "● busy" : "● idle"}</Text>
      </Box>

      <Box flexGrow={1} flexDirection="column" paddingX={1}>
        <MessageList messages={messages} scrollOffset={scrollOffset} maxVisible={maxVisible} />
      </Box>

      <Box paddingX={1}>
        <Text dimColor>
          {status}
          {engine.docsPath ? ` · docs ${engine.docsPath}` : ""}
        </Text>
      </Box>

      <VimMultilineInput onSubmit={(v) => void onSubmit(v)} disabled={busy} />
    </Box>
  );
}
