#!/usr/bin/env node
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load .env from package root and cwd (never commit secrets)
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, "../../.env"), quiet: true });
loadEnv({ path: path.resolve(process.cwd(), ".env"), quiet: true });

import { Command } from "commander";
import { runPrint, runRepl } from "../ui/repl.js";
import type { PermissionMode } from "../types/messages.js";

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
  .argument("[prompt...]", "Optional initial prompt (REPL still starts unless --print)")
  .action(async (promptParts: string[], opts) => {
    const cwd = path.resolve(opts.cwd as string);
    const permissionMode = parseMode(opts.permissionMode as string);
    const enableMcp = opts.mcp !== false;
    const joined = promptParts.join(" ").trim();

    // --print with optional prompt from flag or args
    if (opts.print !== undefined) {
      const prompt =
        typeof opts.print === "string" && opts.print.length > 0
          ? opts.print
          : joined || "Summarize this repository in 3 bullets.";
      const code = await runPrint({ cwd, permissionMode, prompt, enableMcp });
      process.exitCode = code;
      return;
    }

    if (joined) {
      // One-shot then exit (convenience)
      const code = await runPrint({ cwd, permissionMode, prompt: joined, enableMcp });
      process.exitCode = code;
      return;
    }

    await runRepl({
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
