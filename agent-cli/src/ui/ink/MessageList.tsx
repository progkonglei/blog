/**
 * 可滚动会话消息列表
 */
import React from "react";
import { Box, Text } from "ink";

export type UiMessage =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "tool"; name: string; args: string; result?: string; error?: boolean; running?: boolean }
  | { id: string; kind: "status"; text: string }
  | { id: string; kind: "agents"; items: Array<{ description: string; status: string }> };

type Props = {
  messages: UiMessage[];
  scrollOffset: number;
  maxVisible: number;
};

export function MessageList({ messages, scrollOffset, maxVisible }: Props) {
  const start = Math.max(0, messages.length - maxVisible - scrollOffset);
  const end = Math.max(0, messages.length - scrollOffset);
  const visible = messages.slice(start, end);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {visible.length === 0 ? (
        <Text dimColor>conversation empty · type below</Text>
      ) : (
        visible.map((m) => <MessageRow key={m.id} msg={m} />)
      )}
      {scrollOffset > 0 ? (
        <Text dimColor>
          ↑ {scrollOffset} more below · PgDn
        </Text>
      ) : null}
    </Box>
  );
}

function MessageRow({ msg }: { msg: UiMessage }) {
  switch (msg.kind) {
    case "user":
      return (
        <Box marginY={0}>
          <Text color="#D97757" bold>
            ❯{" "}
          </Text>
          <Text>{msg.text}</Text>
        </Box>
      );
    case "assistant":
      return (
        <Box marginY={0}>
          <Text>{msg.text || " "}</Text>
        </Box>
      );
    case "tool":
      return (
        <Box flexDirection="column" marginY={0}>
          <Text>
            <Text color={msg.running ? "magenta" : msg.error ? "red" : "#D97757"}>●</Text>{" "}
            <Text>
              {msg.name}({msg.args})
            </Text>
            {msg.running ? <Text color="magenta"> …</Text> : null}
          </Text>
          {msg.result != null && !msg.running ? (
            <Text dimColor>
              {"  "}⎿ {msg.result}
            </Text>
          ) : null}
        </Box>
      );
    case "agents":
      return (
        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginY={0}>
          <Text color="cyan" bold>
            orchestrate · {msg.items.length} agents
          </Text>
          {msg.items.map((a, i) => (
            <Text key={i} dimColor>
              [{i + 1}] {a.description} · {a.status}
            </Text>
          ))}
        </Box>
      );
    case "status":
      return (
        <Text dimColor>
          ✽ {msg.text}
        </Text>
      );
    default:
      return null;
  }
}
