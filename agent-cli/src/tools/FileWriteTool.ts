import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { defineTool } from "./Tool.js";
import { assertInsideCwd } from "../permissions/pathSafety.js";

const inputSchema = z.object({
  path: z.string().describe("File path to write"),
  content: z.string().describe("Full file contents"),
});

export const FileWriteTool = defineTool({
  name: "Write",
  description: "Write (create or overwrite) a file with the given content.",
  inputSchema,
  isReadOnly: false,
  checkPermission: async (_input, ctx) => {
    if (ctx.permissionMode === "acceptEdits" || ctx.permissionMode === "bypassPermissions") {
      return "allow";
    }
    return "ask";
  },
  async execute({ path: filePath, content }, ctx) {
    const abs = assertInsideCwd(ctx.cwd, filePath);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    return `Wrote ${path.relative(ctx.cwd, abs)} (${content.length} bytes)`;
  },
});
