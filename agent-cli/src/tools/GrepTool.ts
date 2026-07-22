import { z } from "zod";
import { spawn } from "node:child_process";
import { defineTool } from "./Tool.js";
import { assertInsideCwd } from "../permissions/pathSafety.js";

const inputSchema = z.object({
  pattern: z.string().describe("Regex pattern to search"),
  path: z.string().optional().describe("File or directory to search (default: cwd)"),
  glob: z.string().optional().describe("Optional glob filter e.g. *.ts"),
  case_insensitive: z.boolean().optional(),
  head_limit: z.number().int().positive().max(200).optional(),
});

export const GrepTool = defineTool({
  name: "Grep",
  description: "Search file contents with ripgrep (rg) if available, else a Node fallback.",
  inputSchema,
  isReadOnly: true,
  checkPermission: async () => "allow" as const,
  async execute(input, ctx) {
    const target = input.path ? assertInsideCwd(ctx.cwd, input.path) : ctx.cwd;
    const limit = input.head_limit ?? 50;
    try {
      return await runRg(input.pattern, target, ctx.cwd, {
        glob: input.glob,
        caseInsensitive: input.case_insensitive,
        limit,
        signal: ctx.signal,
      });
    } catch {
      return await nodeGrep(input.pattern, target, {
        caseInsensitive: input.case_insensitive,
        limit,
        glob: input.glob,
      });
    }
  },
});

async function runRg(
  pattern: string,
  target: string,
  cwd: string,
  opts: { glob?: string; caseInsensitive?: boolean; limit: number; signal?: AbortSignal },
): Promise<string> {
  const args = ["--line-number", "--no-heading", "--color", "never", "-m", String(opts.limit)];
  if (opts.caseInsensitive) args.push("-i");
  if (opts.glob) args.push("--glob", opts.glob);
  args.push(pattern, target);

  return await new Promise((resolve, reject) => {
    const child = spawn("rg", args, { cwd, signal: opts.signal });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || code === 1) resolve(out.trim() || "(no matches)");
      else reject(new Error(err || `rg exited ${code}`));
    });
  });
}

async function nodeGrep(
  pattern: string,
  target: string,
  opts: { caseInsensitive?: boolean; limit: number; glob?: string },
): Promise<string> {
  const { readFile, stat } = await import("node:fs/promises");
  const path = await import("node:path");
  const { glob } = await import("glob");
  const flags = opts.caseInsensitive ? "i" : "";
  const re = new RegExp(pattern, flags);
  const files = (await stat(target)).isDirectory()
    ? (
        await glob(opts.glob ?? "**/*", {
          cwd: target,
          nodir: true,
          absolute: true,
          ignore: ["**/node_modules/**", "**/.git/**"],
        })
      ).slice(0, 400)
    : [target];

  const hits: string[] = [];
  for (const file of files) {
    if (hits.length >= opts.limit) break;
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i]!)) {
        hits.push(`${path.relative(process.cwd(), file)}:${i + 1}:${lines[i]}`);
        if (hits.length >= opts.limit) break;
      }
    }
  }
  return hits.join("\n") || "(no matches)";
}
