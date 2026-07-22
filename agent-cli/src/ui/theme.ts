/**
 * 终端主题与排版工具
 *
 * 目标：少噪音、强层级 —— 品牌/标题醒目，元数据变淡，
 * 工具调用用卡片块，正文保持干净可读。
 */
import chalk from "chalk";

export const theme = {
  brand: chalk.hex("#E8A87C").bold,
  accent: chalk.hex("#85CDCA"),
  muted: chalk.hex("#6B7280"),
  soft: chalk.hex("#9CA3AF"),
  ok: chalk.hex("#34D399"),
  warn: chalk.hex("#FBBF24"),
  err: chalk.hex("#F87171"),
  tool: chalk.hex("#A78BFA"),
  user: chalk.hex("#60A5FA"),
  assistant: chalk.hex("#E5E7EB"),
  border: chalk.hex("#374151"),
};

const COLS = Math.max(48, Math.min(process.stdout.columns || 80, 100));

export function rule(char = "─"): string {
  return theme.border(char.repeat(COLS));
}

export function pad(label: string, value: string): string {
  return `${theme.muted(label.padEnd(10))} ${theme.soft(value)}`;
}

/** 截断单行预览 */
export function preview(text: string, max = 72): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max - 1)}…`;
}

/** 缩进多行块 */
export function indent(text: string, prefix = "  "): string {
  return text
    .split("\n")
    .map((l) => `${prefix}${l}`)
    .join("\n");
}

export function banner(opts: {
  sessionId?: string;
  cwd: string;
  mode: string;
  llmLogDir?: string;
  execLogDir?: string;
}): void {
  const title = `${theme.brand("agent-cli")}  ${theme.muted("coding agent")}`;
  console.log();
  console.log(title);
  console.log(rule("━"));
  if (opts.sessionId) console.log(pad("session", opts.sessionId));
  console.log(pad("cwd", opts.cwd));
  console.log(pad("mode", opts.mode));
  if (opts.llmLogDir) console.log(pad("llm-log", opts.llmLogDir));
  if (opts.execLogDir) console.log(pad("exec-log", opts.execLogDir));
  console.log(rule("━"));
  console.log(theme.muted("  /help  /clear  /exit    Ctrl+C abort turn"));
  console.log();
}

export function helpPanel(): void {
  console.log();
  console.log(theme.brand("  Commands"));
  console.log(theme.muted("  ────────"));
  console.log(`  ${theme.accent("/help")}     show this help`);
  console.log(`  ${theme.accent("/clear")}    clear in-memory conversation`);
  console.log(`  ${theme.accent("/exit")}     quit`);
  console.log();
  console.log(theme.brand("  Modes"));
  console.log(theme.muted("  ─────"));
  console.log(`  ${theme.soft("default")} | ${theme.soft("acceptEdits")} | ${theme.soft("bypassPermissions")}`);
  console.log();
  console.log(theme.brand("  MCP"));
  console.log(theme.muted("  ───"));
  console.log(`  ${theme.soft(".agent-cli/mcp.json  or  .cursor/mcp.json")}`);
  console.log();
}
