/**
 * Claude Code 风格输入框 / 权限框
 *
 * ╭──────────────────────────────────────╮
 * │ > your prompt                        │
 * ╰──────────────────────────────────────╯
 */
import type readline from "node:readline/promises";
import { preview, theme, termWidth } from "./theme.js";

export async function promptBox(rl: readline.Interface): Promise<string> {
  const inner = termWidth() - 2;
  console.log(theme.border(`╭${"─".repeat(inner)}╮`));
  const answer = await rl.question(`${theme.border("│")} ${theme.user(">")} `);
  console.log(theme.border(`╰${"─".repeat(inner)}╯`));
  return answer.trim();
}

/** 权限确认 —— Claude Code permission dialog 简化 */
export async function permissionBox(
  rl: readline.Interface,
  toolName: string,
  toolInput: Record<string, unknown>,
  reason: string,
): Promise<boolean> {
  const inner = termWidth() - 2;
  console.log();
  console.log(theme.warn(`╭${"─".repeat(inner)}╮`));
  console.log(
    `${theme.warn("│")} ${theme.warn("⚠")}  ${theme.tool(`Allow ${toolName}?`)} ${theme.muted(`· ${reason}`)}`,
  );
  console.log(`${theme.warn("│")}    ${theme.soft(preview(JSON.stringify(toolInput), inner - 6))}`);
  console.log(theme.warn(`╰${"─".repeat(inner)}╯`));
  const answer = await rl.question(`  ${theme.warn("❯")} ${theme.muted("[y/N]")} `);
  return /^y(es)?$/i.test(answer.trim());
}
