/**
 * 终端主题 —— 贴近 Claude Code CLI 的暖色 / 低对比层级
 */
import chalk from "chalk";

export const theme = {
  /** Claude 式橙暖品牌色 */
  brand: chalk.hex("#D97757").bold,
  accent: chalk.hex("#D97757"),
  muted: chalk.hex("#6B7280"),
  soft: chalk.hex("#9CA3AF"),
  ok: chalk.hex("#4ADE80"),
  warn: chalk.hex("#FBBF24"),
  err: chalk.hex("#F87171"),
  tool: chalk.hex("#E5E7EB"),
  toolDim: chalk.hex("#9CA3AF"),
  user: chalk.hex("#D97757"),
  assistant: chalk.hex("#E5E7EB"),
  border: chalk.hex("#4B5563"),
  thinking: chalk.hex("#A78BFA"),
};

export function termWidth(): number {
  return Math.max(40, Math.min(process.stdout.columns || 80, 96));
}

export function rule(char = "─"): string {
  return theme.border(char.repeat(termWidth()));
}

export function preview(text: string, max = 72): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max - 1)}…`;
}

export function banner(opts: {
  sessionId?: string;
  cwd: string;
  mode: string;
  llmLogDir?: string;
  execLogDir?: string;
  docsPath?: string;
}): void {
  console.log();
  console.log(`${theme.brand("✻")} ${theme.brand("agent-cli")} ${theme.muted("· Claude Code–style coding agent")}`);
  console.log(theme.muted(`  ${opts.cwd}`));
  if (opts.sessionId) console.log(theme.muted(`  session ${opts.sessionId.slice(0, 8)}…`));
  console.log(theme.muted(`  ${opts.mode}`) + (opts.execLogDir ? theme.muted("  · logs on") : ""));
  if (opts.docsPath) console.log(theme.muted(`  docs ${opts.docsPath}`));
  console.log();
}

export function helpPanel(): void {
  console.log();
  console.log(theme.brand("  Commands"));
  console.log(theme.muted("  /help   /clear   /exit"));
  console.log(theme.muted("  Ctrl+C  abort current turn"));
  console.log();
}
