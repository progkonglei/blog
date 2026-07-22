/**
 * Claude Code 风格输入行（极简）
 *
 * › your text█
 *   insert · ctrl+j newline · esc vim
 *
 * 去掉双层边框 / 多余 │，避免「乱」
 */
import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";

export type VimMode = "insert" | "normal";

type Props = {
  onSubmit: (value: string) => void;
  disabled?: boolean;
};

export function VimMultilineInput({ onSubmit, disabled }: Props) {
  const [mode, setMode] = useState<VimMode>("insert");
  const [lines, setLines] = useState<string[]>([""]);
  const [row, setRow] = useState(0);
  const [col, setCol] = useState(0);

  const current = lines[row] ?? "";

  const setLine = useCallback((r: number, text: string) => {
    setLines((prev) => {
      const next = [...prev];
      next[r] = text;
      return next;
    });
  }, []);

  const reset = () => {
    setLines([""]);
    setRow(0);
    setCol(0);
    setMode("insert");
  };

  useInput(
    (input, key) => {
      if (disabled) return;

      if (key.ctrl && input === "j") {
        const left = current.slice(0, col);
        const right = current.slice(col);
        setLines((prev) => {
          const next = [...prev];
          next[row] = left;
          next.splice(row + 1, 0, right);
          return next;
        });
        setRow((r) => r + 1);
        setCol(0);
        return;
      }

      if (mode === "insert") {
        if (key.escape) {
          setMode("normal");
          setCol((c) => Math.max(0, Math.min(c, current.length) - (c > 0 ? 1 : 0)));
          return;
        }
        if (key.return) {
          const value = lines.join("\n").trimEnd();
          if (!value) return;
          onSubmit(value);
          reset();
          return;
        }
        if (key.backspace || key.delete) {
          if (col > 0) {
            setLine(row, current.slice(0, col - 1) + current.slice(col));
            setCol((c) => c - 1);
          } else if (row > 0) {
            const prevLine = lines[row - 1] ?? "";
            setLines((prev) => {
              const next = [...prev];
              next[row - 1] = prevLine + current;
              next.splice(row, 1);
              return next;
            });
            setRow((r) => r - 1);
            setCol(prevLine.length);
          }
          return;
        }
        if (key.leftArrow) {
          setCol((c) => Math.max(0, c - 1));
          return;
        }
        if (key.rightArrow) {
          setCol((c) => Math.min(current.length, c + 1));
          return;
        }
        if (key.upArrow && row > 0) {
          const target = row - 1;
          setRow(target);
          setCol((c) => Math.min(c, (lines[target] ?? "").length));
          return;
        }
        if (key.downArrow && row < lines.length - 1) {
          const target = row + 1;
          setRow(target);
          setCol((c) => Math.min(c, (lines[target] ?? "").length));
          return;
        }
        if (input && !key.ctrl && !key.meta) {
          setLine(row, current.slice(0, col) + input + current.slice(col));
          setCol((c) => c + [...input].length);
        }
        return;
      }

      // normal
      if (input === "i") {
        setMode("insert");
        return;
      }
      if (input === "a") {
        setMode("insert");
        setCol((c) => Math.min(current.length, c + 1));
        return;
      }
      if (input === "A") {
        setMode("insert");
        setCol(current.length);
        return;
      }
      if (input === "o") {
        setLines((prev) => {
          const next = [...prev];
          next.splice(row + 1, 0, "");
          return next;
        });
        setRow((r) => r + 1);
        setCol(0);
        setMode("insert");
        return;
      }
      if (input === "h" || key.leftArrow) {
        setCol((c) => Math.max(0, c - 1));
        return;
      }
      if (input === "l" || key.rightArrow) {
        setCol((c) => Math.min(Math.max(0, current.length - 1), c + 1));
        return;
      }
      if ((input === "k" || key.upArrow) && row > 0) {
        const target = row - 1;
        setRow(target);
        setCol((c) => Math.min(c, Math.max(0, (lines[target] ?? "").length - 1)));
        return;
      }
      if ((input === "j" || key.downArrow) && row < lines.length - 1) {
        const target = row + 1;
        setRow(target);
        setCol((c) => Math.min(c, Math.max(0, (lines[target] ?? "").length - 1)));
        return;
      }
      if (input === "0") {
        setCol(0);
        return;
      }
      if (input === "$") {
        setCol(Math.max(0, current.length - 1));
        return;
      }
      if (input === "d") {
        reset();
        return;
      }
      if (key.return) {
        const value = lines.join("\n").trimEnd();
        if (!value) return;
        onSubmit(value);
        reset();
      }
    },
    { isActive: !disabled },
  );

  const empty = lines.length === 1 && lines[0] === "";

  return (
    <Box flexDirection="column" marginTop={1}>
      {lines.map((line, i) => {
        const prefix = i === 0 ? (
          <Text color="#D97757" bold>
            ›{" "}
          </Text>
        ) : (
          <Text>{"  "}</Text>
        );

        if (i !== row) {
          return (
            <Box key={i}>
              {prefix}
              <Text>{line || " "}</Text>
            </Box>
          );
        }

        const before = line.slice(0, col);
        const cursorChar = line[col] ?? " ";
        const after = line.slice(col + 1);
        return (
          <Box key={i}>
            {prefix}
            {empty && mode === "insert" ? (
              <>
                <Text inverse> </Text>
                <Text dimColor> type a message</Text>
              </>
            ) : (
              <Text>
                <Text>{before}</Text>
                <Text inverse>{cursorChar}</Text>
                <Text>{after}</Text>
              </Text>
            )}
          </Box>
        );
      })}
      {!disabled && mode === "normal" ? (
        <Box marginLeft={2}>
          <Text dimColor>-- NORMAL --</Text>
        </Box>
      ) : null}
      {disabled ? (
        <Box marginLeft={2}>
          <Text dimColor>…</Text>
        </Box>
      ) : null}
    </Box>
  );
}
