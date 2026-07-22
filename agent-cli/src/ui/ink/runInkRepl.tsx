/**
 * 启动 Ink TUI REPL
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
  // Ink 暂无模态权限框：default → 按 acceptEdits 跑，避免卡死
  const mode: PermissionMode =
    opts.permissionMode === "default" ? "acceptEdits" : opts.permissionMode;

  const engine = new QueryEngine({
    cwd: opts.cwd,
    permissionMode: mode,
    askPermission: async () => true,
    enableMcp: opts.enableMcp,
  });

  await engine.init(opts.resume);

  const instance = render(
    <InkApp engine={engine} cwd={opts.cwd} mode={mode} />,
  );

  await instance.waitUntilExit();
  await engine.dispose();
}
