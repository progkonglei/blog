/** Bash：在工作区内执行 Shell 命令（默认需用户确认） */
import { z } from "zod";
import { spawn } from "node:child_process";
import { defineTool } from "./Tool.js";

const inputSchema = z.object({
  command: z.string().describe("Shell command to run"),
  timeout_ms: z.number().int().positive().max(120_000).optional().describe("Timeout in ms (default 30000)"),
});

export const BashTool = defineTool({
  name: "Bash",
  description:
    "Execute a shell command in the project working directory. Prefer targeted commands over broad ones. Output is truncated if very long.",
  inputSchema,
  isReadOnly: false,
  // Shell 副作用大，默认一律询问
  checkPermission: async () => "ask" as const,
  async execute({ command, timeout_ms }, ctx) {
    const timeout = timeout_ms ?? 30_000;
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(command, {
        cwd: ctx.cwd,
        shell: true,
        env: process.env,
        signal: ctx.signal,
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);

      child.stdout.on("data", (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr.on("data", (d: Buffer) => {
        stderr += d.toString();
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        const out = [
          stdout.trimEnd(),
          stderr.trimEnd() ? `stderr:\n${stderr.trimEnd()}` : "",
          `exit_code: ${code ?? "null"}`,
        ]
          .filter(Boolean)
          .join("\n\n");
        resolve(truncate(out, 80_000));
      });
    });
  },
});

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n\n...[truncated ${s.length - max} chars]`;
}
