/**
 * 启动 Ink TUI — Claude Code 风格 transcript UI
 */
import React from "react";
import { render } from "ink";
import { QueryEngine } from "../../query/QueryEngine.js";
import type { PermissionMode } from "../../types/messages.js";
import { InkApp } from "./App.js";

export async function runInkRepl(opts: {
  cwd: string;
  permissionMode: PermissionMode;
  resume?: string;
  enableMcp: boolean;
}): Promise<void> {
  const mode: PermissionMode =
    opts.permissionMode === "default" ? "acceptEdits" : opts.permissionMode;

  const engine = new QueryEngine({
    cwd: opts.cwd,
    permissionMode: mode,
    askPermission: async () => true,
    enableMcp: opts.enableMcp,
  });

  await engine.init(opts.resume);

  // 清掉入口里 console.error 造成的「脏屏」感：换行后进入干净 transcript
  process.stdout.write("\n");

  const instance = render(<InkApp engine={engine} cwd={opts.cwd} mode={mode} />, {
    exitOnCtrlC: true,
  });

  await instance.waitUntilExit();
  await engine.dispose();
}
