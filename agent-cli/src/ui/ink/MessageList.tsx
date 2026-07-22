import React from "react";
import { Box, Text } from "ink";

/** Claude Code–style transcript message shapes */
export type UiMessage =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string }
  | {
      id: string;
      kind: "tool";
      name: string;
      args?: string;
      result?: string;
      running?: boolean;
      error?: boolean;
    }
  | { id: string; kind: "thinking"; text: string }
  | { id: string; kind: "status"; text: string }
  | {
      id: string;
      kind: "agents";
      items: Array<{ description: string; status: string }>;
    };

/**
 * Single transcript row — no nested bordered cards.
 * Aligns with Claude Code: › user, plain assistant, ● tool / ⎿ result
 */
export function MessageRow({ msg }: { msg: UiMessage }): React.ReactElement {
  switch (msg.kind) {
    case "user":
      return (
        <Box marginBottom={1} flexDirection="column">
          <Text>
            <Text color="#D97757" bold>
              ›{" "}
            </Text>
            <Text>{msg.text}</Text>
          </Text>
        </Box>
      );

    case "assistant":
      return (
        <Box marginBottom={1} flexDirection="column">
          <Text>{msg.text}</Text>
        </Box>
      );

    case "thinking":
      return (
        <Box marginBottom={0}>
          <Text dimColor>✽ {msg.text}</Text>
        </Box>
      );

    case "tool":
      return (
        <Box flexDirection="column" marginBottom={0}>
          <Text>
            <Text color={msg.error ? "red" : "magenta"}>●</Text>{" "}
            <Text bold>{msg.name}</Text>
            {msg.args ? <Text dimColor>({msg.args})</Text> : null}
            {msg.running ? <Text dimColor> …</Text> : null}
          </Text>
          {msg.result ? (
            <Text color={msg.error ? "red" : undefined} dimColor={!msg.error}>
              {"  "}⎿  {msg.result}
            </Text>
          ) : null}
        </Box>
      );

    case "agents":
      return (
        <Box flexDirection="column" marginLeft={2} marginBottom={0}>
          {msg.items.map((a, i) => (
            <Text key={i} dimColor>
              ⎿  {a.status === "running" ? "…" : "✓"} {a.description.slice(0, 80)}
            </Text>
          ))}
        </Box>
      );

    case "status":
      return (
        <Box marginBottom={1}>
          <Text dimColor>{msg.text}</Text>
        </Box>
      );

    default:
      return <Text />;
  }
}
