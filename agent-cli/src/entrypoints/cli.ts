#!/usr/bin/env node
/**
 * CLI 入口（Commander）
 *
 * 关键点：先 loadAgentEnv()，再动态 import 业务模块，
 * 保证创建 OpenAI/Anthropic 客户端前已读到 .env。
 *
 * 模式：
 * - 无参数 → REPL
 * - -p/--print 或直接跟 prompt → 无头单次执行
 */
import { loadAgentEnv } from "../config/env.js";

const loaded = loadAgentEnv();

const { Command } = await import("commander");
const path = await import("node:path");
type PermissionMode = import("../types/messages.js").PermissionMode;

function parseMode(raw?: string): PermissionMode {
  const v = (raw ?? process.env.AGENT_PERMISSION_MODE ?? "default") as PermissionMode;
  if (v === "default" || v === "acceptEdits" || v === "bypassPermissions") return v;
  throw new Error(`Invalid permission mode: ${raw}`);
}

const program = new Command();

program
  .name("agent-cli")
  .description("Claude Code–inspired TypeScript coding agent CLI (educational)")
  .version("0.1.0")
  .option("-d, --cwd <path>", "Working directory", process.cwd())
  .option(
    "-m, --permission-mode <mode>",
    "default | acceptEdits | bypassPermissions",
    process.env.AGENT_PERMISSION_MODE ?? "default",
  )
  .option("-p, --print [prompt]", "Headless single-shot mode (Claude Code --print)")
  .option("--resume <sessionId>", "Resume a JSONL session id from .sessions/")
  .option("--no-mcp", "Disable MCP tool loading")
  .option("--legacy-ui", "Use classic readline UI instead of Ink TUI")
  .argument("[prompt...]", "Optional initial prompt (REPL still starts unless --print)")
  .action(async (promptParts: string[], opts) => {
    const hasKey = Boolean(
      process.env.DEEPSEEK_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY,
    );
    if (!hasKey && process.env.MOCK_LLM !== "1") {
      console.error(
        "No API key found. Create agent-cli/.env with:\n  AGENT_PROVIDER=deepseek\n  DEEPSEEK_API_KEY=sk-...\n(see agent-cli/.env.example)",
      );
    } else if (opts.print !== undefined || promptParts.join(" ").trim() || opts.legacyUi || process.env.AGENT_VERBOSE === "1") {
      const provider =
        process.env.AGENT_PROVIDER ||
        (process.env.DEEPSEEK_API_KEY ? "deepseek" : process.env.ANTHROPIC_API_KEY ? "anthropic" : "openai");
      console.error(`[agent-cli] provider=${provider}${loaded[0] ? ` env=${loaded[0]}` : ""}`);
    }

    const cwd = path.resolve(opts.cwd as string);
    const permissionMode = parseMode(opts.permissionMode as string);
    const enableMcp = opts.mcp !== false;
    const joined = promptParts.join(" ").trim();

    // --print：无头单次
    if (opts.print !== undefined) {
      const { runPrint } = await import("../ui/repl.js");
      const prompt =
        typeof opts.print === "string" && opts.print.length > 0
          ? opts.print
          : joined || "Summarize this repository in 3 bullets.";
      const code = await runPrint({ cwd, permissionMode, prompt, enableMcp });
      process.exitCode = code;
      return;
    }

    // 位置参数当 prompt：也走无头模式，方便脚本调用
    if (joined) {
      const { runPrint } = await import("../ui/repl.js");
      const code = await runPrint({ cwd, permissionMode, prompt: joined, enableMcp });
      process.exitCode = code;
      return;
    }

    if (opts.legacyUi) {
      const { runRepl } = await import("../ui/repl.js");
      await runRepl({
        cwd,
        permissionMode,
        resume: opts.resume as string | undefined,
        enableMcp,
      });
      return;
    }

    // 进入 Ink 前少打日志，避免和 TUI 抢屏（详细路径写在 docs/runs）
    if (process.env.AGENT_VERBOSE === "1") {
      console.error(`[agent-cli] ink tui · ${permissionMode}`);
    }

    const { runInkRepl } = await import("../ui/ink/runInkRepl.js");
    await runInkRepl({
      cwd,
      permissionMode,
      resume: opts.resume as string | undefined,
      enableMcp,
    });
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
