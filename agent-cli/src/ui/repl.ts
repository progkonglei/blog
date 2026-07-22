/**
 * 终端 UI —— 对齐 Claude Code CLI 的观感
 *
 * - 输入：边框 prompt 框
 * - 工具：● Tool(args) + ⎿ 结果，执行中 spinner
 * - 助手正文：干净流式输出，少边框噪音
 * - 阶段事件：默认不刷屏（细节在 exec-logs）
 */
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { StreamEvent, TerminalReason } from "../types/messages.js";
import { QueryEngine } from "../query/QueryEngine.js";
import type { PermissionMode } from "../types/messages.js";
import { banner, helpPanel, theme } from "./theme.js";
import { permissionBox, promptBox } from "./prompt.js";
import {
  ensureTextClosed,
  finishTool,
  freshToolUi,
  startToolSpinner,
  stopAllSpinners,
  writeAssistantDelta,
  writeThinking,
  type ToolUiState,
} from "./tools.js";

/** 交互式多轮对话 */
export async function runRepl(opts: {
  cwd: string;
  permissionMode: PermissionMode;
  resume?: string;
  enableMcp: boolean;
}): Promise<void> {
  const rl = readline.createInterface({ input, output, terminal: true });

  const askPermission = async (
    toolName: string,
    toolInput: Record<string, unknown>,
    reason: string,
  ): Promise<boolean> => permissionBox(rl, toolName, toolInput, reason);

  const engine = new QueryEngine({
    cwd: opts.cwd,
    permissionMode: opts.permissionMode,
    askPermission,
    enableMcp: opts.enableMcp,
  });
  await engine.init(opts.resume);

  banner({
    sessionId: engine.sessionId,
    cwd: opts.cwd,
    mode: opts.permissionMode,
    llmLogDir: engine.llmLogDir,
    execLogDir: engine.execLogDir,
    docsPath: engine.docsPath,
  });

  try {
    while (true) {
      const line = await promptBox(rl);
      if (!line) continue;
      if (line === "/exit" || line === "/quit") {
        console.log(theme.muted("\nbye\n"));
        break;
      }
      if (line === "/help") {
        helpPanel();
        continue;
      }
      if (line === "/clear") {
        engine.clear();
        console.log(theme.muted("context cleared\n"));
        continue;
      }

      const ac = new AbortController();
      const onSig = () => ac.abort();
      process.once("SIGINT", onSig);

      const state = freshToolUi();
      try {
        console.log();
        const gen = engine.submit(line, ac.signal);
        let next = await gen.next();
        while (!next.done) {
          renderEvent(next.value, state);
          next = await gen.next();
        }
        ensureTextClosed(state);
        renderTerminal(next.value);
        console.log();
      } finally {
        stopAllSpinners(state);
        process.removeListener("SIGINT", onSig);
      }
    }
  } finally {
    await engine.dispose();
    rl.close();
  }
}

/** 单次任务无头模式 */
export async function runPrint(opts: {
  cwd: string;
  permissionMode: PermissionMode;
  prompt: string;
  enableMcp: boolean;
}): Promise<number> {
  const engine = new QueryEngine({
    cwd: opts.cwd,
    permissionMode: opts.permissionMode === "default" ? "acceptEdits" : opts.permissionMode,
    askPermission: async () => true,
    enableMcp: opts.enableMcp,
  });
  await engine.init();

  if (engine.llmLogDir) console.error(theme.muted(`llm-log  ${engine.llmLogDir}`));
  if (engine.execLogDir) console.error(theme.muted(`exec-log ${engine.execLogDir}`));
  if (engine.docsPath) console.error(theme.muted(`docs     ${engine.docsPath}`));
  console.log();

  const state = freshToolUi();
  try {
    const gen = engine.submit(opts.prompt);
    let next = await gen.next();
    while (!next.done) {
      renderEvent(next.value, state);
      next = await gen.next();
    }
    ensureTextClosed(state);
    renderTerminal(next.value);
    console.log();
    return next.value.kind === "error" ? 1 : 0;
  } finally {
    stopAllSpinners(state);
    await engine.dispose();
  }
}

/** 把查询循环事件画到终端 */
function renderEvent(ev: StreamEvent, state: ToolUiState): void {
  switch (ev.type) {
    case "text_delta":
      writeAssistantDelta(state, ev.text);
      break;

    case "tool_start":
      startToolSpinner(state, ev.id, ev.name, ev.input);
      break;

    case "tool_result":
      finishTool(state, ev.id, ev.output, ev.isError);
      break;

    case "phase":
      // 仅在开始调模型时给一个轻量 thinking，其余阶段留给日志
      if (ev.phase === "model_call_start" && state.toolCount === 0 && !state.inText) {
        writeThinking(state, "thinking…");
      }
      break;

    case "compact":
      ensureTextClosed(state);
      console.log(`${theme.warn("●")} ${theme.muted(`compact ${ev.before} → ${ev.after}`)}`);
      break;

    case "error":
      ensureTextClosed(state);
      stopAllSpinners(state);
      console.log(`${theme.err("●")} ${theme.err(ev.error)}`);
      break;

    case "status":
    case "llm_call":
    case "assistant_message":
    default:
      break;
  }
}

function renderTerminal(t: TerminalReason): void {
  if (t.kind === "end_turn") return;
  if (t.kind === "max_turns") {
    console.log(`${theme.warn("●")} ${theme.muted(`stopped · max turns ${t.turns}`)}`);
  } else if (t.kind === "aborted") {
    console.log(`${theme.warn("●")} ${theme.muted("aborted")}`);
  } else if (t.kind === "error") {
    console.log(`${theme.err("●")} ${theme.err(t.error)}`);
  }
}
