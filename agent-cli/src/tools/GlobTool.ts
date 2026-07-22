/** Glob：按通配符查找文件路径（只读） */
import { z } from "zod";
import { glob } from "glob";
import { defineTool } from "./Tool.js";
import { assertInsideCwd } from "../permissions/pathSafety.js";
import path from "node:path";

const inputSchema = z.object({
  pattern: z.string().describe("Glob pattern, e.g. **/*.ts"),
  cwd: z.string().optional().describe("Subdirectory relative to workspace"),
});

export const GlobTool = defineTool({
  name: "Glob",
  description: "Find files by glob pattern within the workspace.",
  inputSchema,
  isReadOnly: true,
  checkPermission: async () => "allow" as const,
  async execute({ pattern, cwd: sub }, ctx) {
    const searchRoot = sub ? assertInsideCwd(ctx.cwd, sub) : ctx.cwd;
    const matches = await glob(pattern, {
      cwd: searchRoot,
      nodir: true,
      absolute: false,
      ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
    });
    const listed = matches
      .slice(0, 200)
      .map((m) => path.relative(ctx.cwd, path.join(searchRoot, m)))
      .join("\n");
    return listed || "(no matches)";
  },
});
