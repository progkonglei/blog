import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load .env before creating any LLM client.
 * Searches package root, cwd, and cwd/agent-cli (when launched from repo root).
 */
export function loadAgentEnv(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../.env"), // agent-cli/.env from src/config or dist/config
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "agent-cli/.env"),
  ];

  const loaded: string[] = [];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const result = loadEnv({ path: p, quiet: true, override: false });
    if (result.parsed && Object.keys(result.parsed).length > 0) {
      loaded.push(p);
    }
  }
  return loaded;
}

export function requireApiKey(provider: string, keys: Array<string | undefined>, hint: string): string {
  for (const k of keys) {
    if (k && k.trim()) return k.trim();
  }
  throw new Error(
    [
      `Missing API key for provider "${provider}".`,
      hint,
      "Example agent-cli/.env:",
      "  AGENT_PROVIDER=deepseek",
      "  DEEPSEEK_API_KEY=sk-...",
      "  DEEPSEEK_MODEL=deepseek-chat",
    ].join("\n"),
  );
}
