/**
 * 模型提供商选择器
 *
 * 根据 AGENT_PROVIDER 或环境变量中的 Key 自动选择：
 * DeepSeek（默认优先）/ Anthropic / OpenAI 兼容网关。
 * MOCK_LLM=1 时走本地假模型，便于无 Key 冒烟测试。
 */
import { createAnthropicModelCall } from "./anthropic.js";
import { createOpenAICompatibleModelCall } from "./openaiCompatible.js";
import type { ModelRequest, ModelResponse } from "../../query/queryLoop.js";
import type { StreamEvent } from "../../types/messages.js";
import { requireApiKey } from "../../config/env.js";

export type ModelCaller = (req: ModelRequest) => AsyncGenerator<StreamEvent, ModelResponse>;

/**
 * 创建绑定到具体提供商的 modelCall。
 * QueryEngine 在构造时调用一次即可。
 */
export function createModelCall(): ModelCaller {
  if (process.env.MOCK_LLM === "1") {
    // mock 实现挂在 anthropic 模块内，避免额外文件
    return createAnthropicModelCall();
  }

  const explicit = (process.env.AGENT_PROVIDER ?? "").toLowerCase();
  // 未显式指定时：有哪个 Key 就用哪个；都没有则默认 deepseek（随后 requireApiKey 会给出清晰报错）
  const provider =
    explicit ||
    (process.env.DEEPSEEK_API_KEY
      ? "deepseek"
      : process.env.ANTHROPIC_API_KEY
        ? "anthropic"
        : process.env.OPENAI_API_KEY
          ? "openai"
          : "deepseek");

  if (provider === "anthropic") {
    const apiKey = requireApiKey(
      "anthropic",
      [process.env.ANTHROPIC_API_KEY],
      "Set ANTHROPIC_API_KEY in agent-cli/.env",
    );
    return createAnthropicModelCall({ apiKey });
  }

  if (provider === "deepseek") {
    const apiKey = requireApiKey(
      "deepseek",
      [process.env.DEEPSEEK_API_KEY, process.env.OPENAI_API_KEY],
      "Set DEEPSEEK_API_KEY in agent-cli/.env",
    );
    return createOpenAICompatibleModelCall({
      apiKey,
      baseURL: process.env.DEEPSEEK_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://api.deepseek.com",
      model: process.env.DEEPSEEK_MODEL ?? process.env.OPENAI_MODEL ?? "deepseek-chat",
    });
  }

  // OpenAI 或任意 OpenAI 兼容网关
  const apiKey = requireApiKey(
    "openai",
    [process.env.OPENAI_API_KEY, process.env.DEEPSEEK_API_KEY],
    "Set OPENAI_API_KEY in agent-cli/.env",
  );
  return createOpenAICompatibleModelCall({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  });
}
