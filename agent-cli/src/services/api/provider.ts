import { createAnthropicModelCall } from "./anthropic.js";
import { createOpenAICompatibleModelCall } from "./openaiCompatible.js";
import type { ModelRequest, ModelResponse } from "../../query/queryLoop.js";
import type { StreamEvent } from "../../types/messages.js";
import { requireApiKey } from "../../config/env.js";

export type ModelCaller = (req: ModelRequest) => AsyncGenerator<StreamEvent, ModelResponse>;

/**
 * Resolve provider from env:
 * - AGENT_PROVIDER=deepseek|openai|anthropic|mock
 * - or auto: DEEPSEEK_API_KEY → deepseek, ANTHROPIC_API_KEY → anthropic, OPENAI_API_KEY → openai
 */
export function createModelCall(): ModelCaller {
  if (process.env.MOCK_LLM === "1") {
    return createAnthropicModelCall(); // mock path lives there
  }

  const explicit = (process.env.AGENT_PROVIDER ?? "").toLowerCase();
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
