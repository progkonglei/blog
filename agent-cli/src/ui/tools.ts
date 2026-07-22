/**
 * Claude Code 风格工具渲染
 *
 * ● Read(path/to/file.ts)
 *   ⎿  Read 42 lines
 *
 * 执行中用同一行 spinner 更新，完成后清掉换成 ● / ⎿
 */
import { preview, theme } from "./theme.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export type ToolUiState = {
  inText: boolean;
  spinners: Map<string, NodeJS.Timeout>;
  spinning: boolean;
  toolCount: number;
  pendingInputs: Map<string, { name: string; input: Record<string, unknown> }>;
};

export function freshToolUi(): ToolUiState {
  return {
    inText: false,
    spinners: new Map(),
    spinning: false,
    toolCount: 0,
    pendingInputs: new Map(),
  };
}

/** 格式化工具参数为 Claude Code 常见的 Tool(arg) 形态 */
export function formatToolCall(name: string, input: Record<string, unknown>): string {
  const keys = Object.keys(input);
  if (keys.length === 0) return `${name}()`;
  if (keys.length === 1) {
    const v = input[keys[0]!];
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return `${name}(${preview(s, 64)})`;
  }
  const preferred = ["command", "path", "pattern", "file_path", "query"];
  for (const k of preferred) {
    if (k in input) {
      const s = typeof input[k] === "string" ? String(input[k]) : JSON.stringify(input[k]);
      return `${name}(${preview(s, 64)})`;
    }
  }
  return `${name}(${preview(JSON.stringify(input), 56)})`;
}

export function startToolSpinner(state: ToolUiState, id: string, name: string, input: Record<string, unknown>): void {
  stopAllSpinners(state);
  ensureTextClosed(state);
  state.pendingInputs.set(id, { name, input });

  const label = formatToolCall(name, input);
  let i = 0;
  state.spinning = true;
  process.stdout.write(`\r${theme.thinking(FRAMES[0]!)} ${theme.toolDim(label)}`);

  const timer = setInterval(() => {
    i = (i + 1) % FRAMES.length;
    const cols = process.stdout.columns || 80;
    process.stdout.write(`\r${" ".repeat(cols)}\r`);
    process.stdout.write(`${theme.thinking(FRAMES[i]!)} ${theme.toolDim(label)}`);
  }, 80);
  state.spinners.set(id, timer);
}

export function finishTool(
  state: ToolUiState,
  id: string,
  output: string,
  isError?: boolean,
): void {
  const timer = state.spinners.get(id);
  if (timer) {
    clearInterval(timer);
    state.spinners.delete(id);
  }
  if (state.spinning) {
    const cols = process.stdout.columns || 80;
    process.stdout.write(`\r${" ".repeat(cols)}\r`);
    state.spinning = false;
  }

  const meta = state.pendingInputs.get(id) ?? { name: "Tool", input: {} };
  state.pendingInputs.delete(id);
  state.toolCount += 1;

  const call = formatToolCall(meta.name, meta.input);
  const dot = isError ? theme.err("●") : theme.accent("●");
  console.log(`${dot} ${theme.tool(call)}`);

  for (const line of formatResultLines(output, isError)) {
    console.log(`  ${theme.muted("⎿")}  ${line}`);
  }
}

function formatResultLines(output: string, isError?: boolean): string[] {
  const raw = output.trimEnd();
  if (!raw) return [theme.muted("(empty)")];

  const maxLines = 6;
  const maxWidth = Math.max(40, Math.min((process.stdout.columns || 80) - 6, 90));
  const parts = raw.split("\n");
  const shown = parts.slice(0, maxLines);
  const lines = shown.map((l) => {
    const clipped = l.length > maxWidth ? `${l.slice(0, maxWidth - 1)}…` : l;
    return isError ? theme.err(clipped) : theme.soft(clipped);
  });
  if (parts.length > maxLines) {
    lines.push(theme.muted(`… +${parts.length - maxLines} lines`));
  }
  return lines;
}

export function ensureTextClosed(state: ToolUiState): void {
  if (state.inText) {
    process.stdout.write("\n");
    state.inText = false;
  }
}

export function stopAllSpinners(state: ToolUiState): void {
  for (const [, timer] of state.spinners) clearInterval(timer);
  state.spinners.clear();
  if (state.spinning) {
    const cols = process.stdout.columns || 80;
    process.stdout.write(`\r${" ".repeat(cols)}\r`);
    state.spinning = false;
  }
}

export function writeAssistantDelta(state: ToolUiState, text: string): void {
  if (!text) return;
  stopAllSpinners(state);
  if (!state.inText && text === "\n") return;
  state.inText = true;
  process.stdout.write(theme.assistant(text));
}

export function writeThinking(state: ToolUiState, label: string): void {
  ensureTextClosed(state);
  console.log(`${theme.thinking("✽")} ${theme.muted(label)}`);
}
