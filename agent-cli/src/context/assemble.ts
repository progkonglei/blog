import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Assemble system prompt from identity + CLAUDE.md / AGENTS.md hierarchy
 * (Claude Code loads CLAUDE.md from cwd upward).
 */
export async function assembleSystemPrompt(cwd: string): Promise<string> {
  const identity = [
    "You are agent-cli, a Claude Code–inspired coding agent running in the terminal.",
    "Use tools to inspect and modify the workspace. Prefer Edit over Write for existing files.",
    "Be concise. After finishing, briefly summarize what changed.",
    `Workspace cwd: ${cwd}`,
  ].join("\n");

  const memoryFiles = await loadInstructionFiles(cwd);
  if (!memoryFiles) return identity;
  return `${identity}\n\n# Project instructions\n${memoryFiles}`;
}

async function loadInstructionFiles(cwd: string): Promise<string | null> {
  const names = ["CLAUDE.md", "AGENTS.md", ".agent-cli.md"];
  const chunks: string[] = [];
  let dir = path.resolve(cwd);
  const root = path.parse(dir).root;

  // Walk up a few levels (project → parents), Claude Code style
  for (let i = 0; i < 4; i++) {
    for (const name of names) {
      try {
        const p = path.join(dir, name);
        const text = await readFile(p, "utf8");
        chunks.push(`## ${path.relative(cwd, p) || name}\n${text.trim()}`);
      } catch {
        // missing ok
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir || dir === root) break;
    dir = parent;
  }

  return chunks.length ? chunks.join("\n\n") : null;
}
