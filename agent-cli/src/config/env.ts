/**
 * 环境变量加载与 API Key 校验
 *
 * 必须在创建 OpenAI/Anthropic 客户端之前调用 loadAgentEnv()，
 * 否则会出现 SDK 报 Missing OPENAI_API_KEY 的误导性错误。
 */
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 从多个候选路径加载 .env（先到先生效，不覆盖已有 process.env）
 * @returns 实际加载成功的文件路径列表
 */
export function loadAgentEnv(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../.env"), // 包根目录 agent-cli/.env
    path.resolve(process.cwd(), ".env"), // 当前工作目录
    path.resolve(process.cwd(), "agent-cli/.env"), // 从仓库根目录启动时
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

/**
 * 从候选 Key 中取第一个非空值；全部缺失则抛出带配置示例的明确错误。
 */
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
