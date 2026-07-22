/**
 * 终端 UI：交互 REPL 与 --print 无头模式
 *
 * 渲染原则：
 * 1. 回合之间用分隔线，避免糊成一片
 * 2. 工具调用用「卡片」块（开始 / 结果），正文单独成流
 * 3. 元数据变淡，成功/失败用色区分
 */
import chalk from "chalk";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { StreamEvent, TerminalReason } from "../types/messages.js";
import { QueryEngine } from "../query/QueryEngine.js";
import type { PermissionMode } from "../types/messages.js";
import { banner, helpPanel, preview, theme } from "./theme.js";

type RenderState = {
  /** 当前是否在输出助手正文（用于工具卡片前后换行） */
  inText: boolean;
  toolCount: number;
};

function freshState(): RenderState {
  return { inText: false, toolCount: 0 };
}

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
  ): Promise<boolean> => {
    console.log();
    console.log(theme.warn("╭─ permission ─────────────────────────────"));
    console.log(theme.warn(`│ allow ${chalk.bold(toolName)}?`) + theme.muted(`  (${reason})`));
    console.log(theme.warn("│") + theme.soft(` ${preview(JSON.stringify(toolInput), 64)}`));
    console.log(theme.warn("╰───────────────────────────────────────────"));
    const answer = await rl.question(theme.warn("  [y/N] "));
    return /^y(es)?$/i.test(answer.trim());
  };

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
  });

  try {
    while (true) {
      const line = (await rl.question(theme.user("› "))).trim();
      if (!line) continue;
      if (line === "/exit" || line === "/quit") {
        console.log(theme.muted("\nbye.\n"));
        break;
      }
      if (line === "/help") {
        helpPanel();
        continue;
      }
      if (line === "/clear") {
        engine.clear();
        console.log(theme.muted("  context cleared (session file kept)\n"));
        continue;
      }

      const ac = new AbortController();
      const onSig = () => ac.abort();
      process.once("SIGINT", onSig);

      const state = freshState();
      try {
        console.log();
        console.log(theme.muted("╭─ assistant"));
        const gen = engine.submit(line, ac.signal);
        let next = await gen.next();
        while (!next.done) {
          renderEvent(next.value, state);
          next = await gen.next();
        }
        ensureNewline(state);
        renderTerminal(next.value);
        console.log(theme.muted("╰─"));
        console.log();
      } finally {
        process.removeListener("SIGINT", onSig);
      }
    }
  } finally {
    await engine.dispose();
    rl.close();
  }
}

/** 单次任务无头模式（类似 Claude Code -p/--print） */
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

  if (engine.llmLogDir) console.error(theme.muted(`[llm-log] ${engine.llmLogDir}`));
  if (engine.execLogDir) console.error(theme.muted(`[exec-log] ${engine.execLogDir}`));

  const state = freshState();
  try {
    console.log(theme.muted("╭─ assistant"));
    const gen = engine.submit(opts.prompt);
    let next = await gen.next();
    while (!next.done) {
      renderEvent(next.value, state);
      next = await gen.next();
    }
    ensureNewline(state);
    renderTerminal(next.value);
    console.log(theme.muted("╰─"));
    console.log();
    return next.value.kind === "error" ? 1 : 0;
  } finally {
    await engine.dispose();
  }
}

function ensureNewline(state: RenderState): void {
  if (state.inText) {
    process.stdout.write("\n");
    state.inText = false;
  }
}

/** 把查询循环事件打印到终端 */
function renderEvent(ev: StreamEvent, state: RenderState): void {
  switch (ev.type) {
    case "text_delta": {
      const text = ev.text;
      if (!text) break;
      if (!state.inText) {
        // 跳过纯开头换行，避免空 │ 行
        if (text === "\n") break;
        process.stdout.write(theme.muted("│ "));
        state.inText = true;
      }
      const parts = text.split("\n");
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) {
          // 末尾单独换行：先结束本段，下一 delta 再开 │
          if (i === parts.length - 1 && parts[i] === "") {
            process.stdout.write("\n");
            state.inText = false;
            break;
          }
          process.stdout.write("\n" + theme.muted("│ "));
          state.inText = true;
        }
        process.stdout.write(theme.assistant(parts[i] ?? ""));
      }
      break;
    }
    case "tool_start": {
      ensureNewline(state);
      state.toolCount += 1;
      const n = String(state.toolCount).padStart(2, "0");
      console.log(
        theme.muted("│ ") +
          theme.tool(`▸ #${n} ${chalk.bold(ev.name)}`) +
          theme.soft(`  ${preview(JSON.stringify(ev.input), 56)}`),
      );
      break;
    }
    case "tool_result": {
      ensureNewline(state);
      const mark = ev.isError ? theme.err("✗") : theme.ok("✓");
      const body = preview(ev.output.replace(/\n/g, " · "), 78);
      console.log(
        theme.muted("│   ") +
          mark +
          " " +
          theme.soft(ev.name) +
          (body ? theme.muted(`  ${body}`) : ""),
      );
      break;
    }
    case "compact": {
      ensureNewline(state);
      console.log(
        theme.muted("│ ") + theme.warn(`↻ compact  ${ev.before} → ${ev.after} chars`),
      );
      break;
    }
    case "status": {
      ensureNewline(state);
      console.log(theme.muted("│ ") + theme.soft(ev.message));
      break;
    }
    case "error": {
      ensureNewline(state);
      console.log(theme.muted("│ ") + theme.err(`error: ${ev.error}`));
      break;
    }
    default:
      break;
  }
}

function renderTerminal(t: TerminalReason): void {
  if (t.kind === "end_turn") return;
  if (t.kind === "max_turns") {
    console.log(theme.muted("│ ") + theme.warn(`stopped · max turns ${t.turns}`));
  } else if (t.kind === "aborted") {
    console.log(theme.muted("│ ") + theme.warn("aborted"));
  } else if (t.kind === "error") {
    console.log(theme.muted("│ ") + theme.err(`error · ${t.error}`));
  }
}
