import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { defineTool, type ToolDefinition } from "../../tools/Tool.js";

export type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type McpConfigFile = {
  mcpServers?: Record<string, McpServerConfig>;
};

/**
 * Minimal MCP client — load mcp.json, connect via stdio, wrap tools
 * as first-class ToolDefinitions (Claude Code / Cursor pattern).
 */
export async function loadMcpTools(cwd: string): Promise<{
  tools: ToolDefinition[];
  clients: Client[];
  close: () => Promise<void>;
}> {
  const config = await readMcpConfig(cwd);
  const servers = config.mcpServers ?? {};
  const tools: ToolDefinition[] = [];
  const clients: Client[] = [];

  for (const [name, cfg] of Object.entries(servers)) {
    try {
      const transport = new StdioClientTransport({
        command: cfg.command,
        args: cfg.args ?? [],
        env: { ...process.env, ...cfg.env } as Record<string, string>,
      });
      const client = new Client({ name: `agent-cli-${name}`, version: "0.1.0" });
      await client.connect(transport);
      clients.push(client);

      const listed = await client.listTools();
      for (const t of listed.tools) {
        tools.push(wrapMcpTool(client, name, t));
      }
    } catch (err) {
      console.error(`[mcp] failed to connect ${name}:`, err instanceof Error ? err.message : err);
    }
  }

  return {
    tools,
    clients,
    close: async () => {
      await Promise.allSettled(clients.map((c) => c.close()));
    },
  };
}

async function readMcpConfig(cwd: string): Promise<McpConfigFile> {
  const candidates = [
    path.join(cwd, ".agent-cli", "mcp.json"),
    path.join(cwd, ".cursor", "mcp.json"),
    path.join(cwd, "mcp.json"),
  ];
  for (const p of candidates) {
    try {
      const raw = await readFile(p, "utf8");
      return JSON.parse(raw) as McpConfigFile;
    } catch {
      // try next
    }
  }
  return {};
}

function wrapMcpTool(
  client: Client,
  serverName: string,
  t: { name: string; description?: string; inputSchema?: Record<string, unknown> },
): ToolDefinition {
  const toolName = `mcp__${serverName}__${t.name}`;
  // MCP schemas vary; accept object passthrough
  const inputSchema = z.object({}).passthrough();

  return defineTool({
    name: toolName,
    description: `[MCP:${serverName}] ${t.description ?? t.name}`,
    inputSchema,
    isReadOnly: false,
    checkPermission: async () => "ask" as const,
    async execute(input) {
      const result = await client.callTool({ name: t.name, arguments: input });
      const content = Array.isArray(result.content)
        ? result.content
            .map((c) => {
              if (c && typeof c === "object" && "text" in c) return String((c as { text: string }).text);
              return JSON.stringify(c);
            })
            .join("\n")
        : JSON.stringify(result.content);
      if (result.isError) throw new Error(content);
      return content || "(empty MCP result)";
    },
  });
}
