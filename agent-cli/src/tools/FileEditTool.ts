import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defineTool } from "./Tool.js";
import { assertInsideCwd } from "../permissions/pathSafety.js";

const inputSchema = z.object({
  path: z.string().describe("File to edit"),
  old_string: z.string().describe("Exact text to find"),
  new_string: z.string().describe("Replacement text"),
  replace_all: z.boolean().optional().describe("Replace all occurrences (default false)"),
});

export const FileEditTool = defineTool({
  name: "Edit",
  description:
    "Exact string replacement in a file. old_string must uniquely match unless replace_all is true.",
  inputSchema,
  isReadOnly: false,
  checkPermission: async (_input, ctx) => {
    if (ctx.permissionMode === "acceptEdits" || ctx.permissionMode === "bypassPermissions") {
      return "allow";
    }
    return "ask";
  },
  async execute({ path: filePath, old_string, new_string, replace_all }, ctx) {
    const abs = assertInsideCwd(ctx.cwd, filePath);
    const before = await readFile(abs, "utf8");
    const count = before.split(old_string).length - 1;
    if (count === 0) {
      throw new Error(`old_string not found in ${filePath}`);
    }
    if (!replace_all && count > 1) {
      throw new Error(`old_string matched ${count} times; set replace_all or make it unique`);
    }
    const after = replace_all
      ? before.split(old_string).join(new_string)
      : before.replace(old_string, new_string);
    await writeFile(abs, after, "utf8");
    return `Edited ${path.relative(ctx.cwd, abs)} (${count} replacement${count === 1 ? "" : "s"})`;
  },
});
