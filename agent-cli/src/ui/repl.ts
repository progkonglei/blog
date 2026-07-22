/**
 * 终端 UI：交互 REPL 与 --print 无头模式
 *
 * 职责仅是渲染 StreamEvent + 处理权限询问 / 斜杠命令，
 * 业务逻辑全部在 QueryEngine。
 */
import chalk from "chalk";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { StreamEvent, TerminalReason } from "../types/messages.js";
import { QueryEngine } from "../query/QueryEngine.js";
import type { PermissionMode } from "../types/messages.js";

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
    const preview = JSON.stringify(toolInput, null, 0).slice(0, 200);
    const answer = await rl.question(
      chalk.yellow(`\nAllow ${toolName} (${reason})?\n  ${preview}\n  [y/N] `),
    );
    return /^y(es)?$/i.test(answer.trim());
  };

  const engine = new QueryEngine({
    cwd: opts.cwd,
    permissionMode: opts.permissionMode,
    askPermission,
    enableMcp: opts.enableMcp,
  });
  await engine.init(opts.resume);

  console.log(chalk.cyan(`agent-cli  session=${engine.sessionId}`));
  console.log(chalk.dim(`cwd=${opts.cwd}  mode=${opts.permissionMode}`));
  console.log(chalk.dim("Commands: /help /clear /exit  |  Ctrl+C to abort turn\n"));

  try {
    while (true) {
      const line = (await rl.question(chalk.green("› "))).trim();
      if (!line) continue;
      if (line === "/exit" || line === "/quit") break;
      if (line === "/help") {
        printHelp();
        continue;
      }
      if (line === "/clear") {
        engine.clear();
        console.log(chalk.dim("context cleared (session file kept)"));
        continue;
      }

      const ac = new AbortController();
      const onSig = () => ac.abort();
      process.once("SIGINT", onSig);

      try {
        process.stdout.write(chalk.blue("assistant: "));
        const gen = engine.submit(line, ac.signal);
        let next = await gen.next();
        while (!next.done) {
          renderEvent(next.value);
          next = await gen.next();
        }
        renderTerminal(next.value);
        process.stdout.write("\n");
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
  const askPermission = async () => opts.permissionMode !== "default";
  // In print mode, default asks → auto-deny unless acceptEdits/bypass; use accept via mode
  const engine = new QueryEngine({
    cwd: opts.cwd,
    permissionMode: opts.permissionMode === "default" ? "acceptEdits" : opts.permissionMode,
    askPermission: async () => true,
    enableMcp: opts.enableMcp,
  });
  await engine.init();

  try {
    const gen = engine.submit(opts.prompt);
    let next = await gen.next();
    while (!next.done) {
      renderEvent(next.value);
      next = await gen.next();
    }
    renderTerminal(next.value);
    process.stdout.write("\n");
    return next.value.kind === "error" ? 1 : 0;
  } finally {
    await engine.dispose();
    void askPermission;
  }
}

/** 把查询循环事件打印到终端 */
function renderEvent(ev: StreamEvent): void {
  switch (ev.type) {
    case "text_delta":
      process.stdout.write(ev.text);
      break;
    case "tool_start":
      console.log(chalk.magenta(`\n⚙ ${ev.name}(${JSON.stringify(ev.input).slice(0, 120)})`));
      break;
    case "tool_result":
      console.log(
        chalk.dim(
          ev.isError ? `✗ ${ev.name}: ${ev.output.slice(0, 300)}` : `✓ ${ev.name}: ${ev.output.slice(0, 300)}`,
        ),
      );
      process.stdout.write(chalk.blue("assistant: "));
      break;
    case "compact":
      console.log(chalk.yellow(`\n♻ compact ${ev.before}→${ev.after} chars`));
      break;
    case "status":
      console.log(chalk.dim(ev.message));
      break;
    case "error":
      console.log(chalk.red(`\nerror: ${ev.error}`));
      break;
    default:
      break;
  }
}

function renderTerminal(t: TerminalReason): void {
  if (t.kind === "max_turns") console.log(chalk.yellow(`\n(stopped: max turns ${t.turns})`));
  if (t.kind === "aborted") console.log(chalk.yellow("\n(aborted)"));
  if (t.kind === "error") console.log(chalk.red(`\n(error: ${t.error})`));
}

function printHelp(): void {
  console.log(`
${chalk.bold("agent-cli")} — Claude Code–inspired coding agent

  /help     show this help
  /clear    clear in-memory conversation
  /exit     quit

Permission modes: default | acceptEdits | bypassPermissions
MCP: place servers in .agent-cli/mcp.json (or .cursor/mcp.json)
`);
}
