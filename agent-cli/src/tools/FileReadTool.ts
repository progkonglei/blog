/** Read：读取工作区内文本文件（可按行切片），只读自动放行 */
import { z } from "zod";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { defineTool } from "./Tool.js";
import { assertInsideCwd } from "../permissions/pathSafety.js";

const inputSchema = z.object({
  path: z.string().describe("File path relative to cwd or absolute within cwd"),
  offset: z.number().int().min(1).optional().describe("1-based start line"),
  limit: z.number().int().positive().optional().describe("Max lines to return"),
});

export const FileReadTool = defineTool({
  name: "Read",
  description: "Read a text file from the workspace. Optionally slice by line offset/limit.",
  inputSchema,
  isReadOnly: true,
  checkPermission: async () => "allow" as const,
  async execute({ path: filePath, offset, limit }, ctx) {
    const abs = assertInsideCwd(ctx.cwd, filePath);
    const raw = await readFile(abs, "utf8");
    const lines = raw.split("\n");
    const start = (offset ?? 1) - 1;
    const end = limit ? start + limit : lines.length;
    const slice = lines.slice(start, end);
    const numbered = slice.map((line, i) => `${String(start + i + 1).padStart(6)}|${line}`).join("\n");
    const header = `file: ${path.relative(ctx.cwd, abs)} (${lines.length} lines)`;
    return truncate(`${header}\n${numbered}`, 100_000);
  },
});

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n\n...[truncated]`;
}
