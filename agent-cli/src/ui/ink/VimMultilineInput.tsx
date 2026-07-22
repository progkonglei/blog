/**
 * Vim 多行输入（Ink）
 *
 * - insert（默认）：正常输入；Esc → normal；Ctrl+J / Shift+Enter → 换行；Enter → 提交
 * - normal：h/l 左右，j/k 上下行，0/$ 行首尾，i/a/A/o 进入插入，dd 清空，Enter 提交
 */
import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";

export type VimMode = "insert" | "normal";

type Props = {
  onSubmit: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
};

export function VimMultilineInput({ onSubmit, disabled, placeholder }: Props) {
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

  useInput(
    (input, key) => {
      if (disabled) return;

      // 全局：Ctrl+C 由外层处理；Ctrl+J 换行
      if (key.ctrl && input === "j") {
        // 在光标处拆行
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
          setCol((c) => Math.max(0, c - 1));
          return;
        }
        if (key.return) {
          const value = lines.join("\n").trimEnd();
          if (!value) return;
          onSubmit(value);
          setLines([""]);
          setRow(0);
          setCol(0);
          setMode("insert");
          return;
        }
        if (key.backspace || key.delete) {
          if (col > 0) {
            setLine(row, current.slice(0, col - 1) + current.slice(col));
            setCol((c) => c - 1);
          } else if (row > 0) {
            const prevLine = lines[row - 1] ?? "";
            const merged = prevLine + current;
            setLines((prev) => {
              const next = [...prev];
              next[row - 1] = merged;
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
          setRow((r) => r - 1);
          setCol((c) => Math.min(c, (lines[row - 1] ?? "").length));
          return;
        }
        if (key.downArrow && row < lines.length - 1) {
          setRow((r) => r + 1);
          setCol((c) => Math.min(c, (lines[row + 1] ?? "").length));
          return;
        }
        if (input && !key.ctrl && !key.meta) {
          setLine(row, current.slice(0, col) + input + current.slice(col));
          setCol((c) => c + input.length);
        }
        return;
      }

      // ——— normal mode ———
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
      if (input === "k" || key.upArrow) {
        if (row > 0) {
          setRow((r) => r - 1);
          setCol((c) => Math.min(c, Math.max(0, (lines[row - 1] ?? "").length - 1)));
        }
        return;
      }
      if (input === "j" || key.downArrow) {
        if (row < lines.length - 1) {
          setRow((r) => r + 1);
          setCol((c) => Math.min(c, Math.max(0, (lines[row + 1] ?? "").length - 1)));
        }
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
        // 简化：dd 清空全部
        setLines([""]);
        setRow(0);
        setCol(0);
        return;
      }
      if (key.return) {
        const value = lines.join("\n").trimEnd();
        if (!value) return;
        onSubmit(value);
        setLines([""]);
        setRow(0);
        setCol(0);
        setMode("insert");
      }
    },
    { isActive: !disabled },
  );

  const modeLabel = mode === "insert" ? "INSERT" : "NORMAL";
  const modeColor = mode === "insert" ? "yellow" : "cyan";

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Box>
        <Text color="gray">│ </Text>
        <Text color="#D97757" bold>
          {">"}{" "}
        </Text>
        <Box flexDirection="column">
          {lines.map((line, i) => {
            if (i !== row) {
              return (
                <Text key={i} color="white">
                  {line || " "}
                </Text>
              );
            }
            const before = line.slice(0, col);
            const cursor = line[col] ?? " ";
            const after = line.slice(col + 1);
            return (
              <Text key={i}>
                <Text color="white">{before}</Text>
                <Text inverse color="white">
                  {cursor}
                </Text>
                <Text color="white">{after}</Text>
                {!line && col === 0 ? (
                  <Text color="gray">{placeholder ?? "message · Esc vim · Ctrl+J newline · Enter send"}</Text>
                ) : null}
              </Text>
            );
          })}
        </Box>
      </Box>
      <Box>
        <Text dimColor>
          -- <Text color={modeColor}>{modeLabel}</Text> -- · lines {lines.length} · scroll PgUp/PgDn
        </Text>
      </Box>
    </Box>
  );
}
