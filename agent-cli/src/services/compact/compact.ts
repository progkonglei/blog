import type { Message, StreamEvent } from "../../types/messages.js";
import type { ModelRequest, ModelResponse } from "../../query/queryLoop.js";

export type CompactResult = {
  messages: Message[];
  beforeChars: number;
  afterChars: number;
  summary: string;
};

function estimateChars(messages: Message[]): number {
  return JSON.stringify(messages).length;
}

/**
 * Simplified compaction pipeline (Claude Code has 5 layers).
 * Here: budget check → single auto-compact summary when over threshold.
 */
export async function maybeCompact(
  messages: Message[],
  opts: {
    thresholdChars: number;
    modelCall: (req: ModelRequest) => AsyncGenerator<StreamEvent, ModelResponse>;
    systemPrompt: string;
    tools: ModelRequest["tools"];
    signal?: AbortSignal;
  },
): Promise<CompactResult | null> {
  const before = estimateChars(messages);
  if (before < opts.thresholdChars) return null;
  if (messages.length < 6) return null;

  // Keep first user message + summarize the middle + keep last 2 turns
  const head = messages.slice(0, 1);
  const tail = messages.slice(-4);
  const middle = messages.slice(1, -4);

  const transcript = middle
    .map((m) => {
      const body =
        typeof m.content === "string"
          ? m.content
          : m.content
              .map((b) => {
                if (b.type === "text") return b.text;
                if (b.type === "tool_use") return `tool_use ${b.name}(${JSON.stringify(b.input).slice(0, 200)})`;
                return `tool_result ${b.tool_use_id}: ${b.content.slice(0, 200)}`;
              })
              .join("\n");
      return `${m.role}: ${body}`;
    })
    .join("\n\n")
    .slice(0, 60_000);

  let summary = "";
  try {
    const gen = opts.modelCall({
      system:
        "Summarize this agent transcript for future context. Preserve goals, key decisions, file paths touched, and unfinished work. Be concise.",
      messages: [{ role: "user", content: transcript }],
      tools: [],
      signal: opts.signal,
    });
    let next = await gen.next();
    while (!next.done) {
      if (next.value.type === "text_delta") summary += next.value.text;
      next = await gen.next();
    }
    const final = next.value;
    if (!summary) {
      summary = final.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    }
  } catch {
    summary = `[compact fallback] ${middle.length} messages omitted`;
  }

  const compacted: Message[] = [
    ...head,
    {
      role: "user",
      content: `[context compact summary]\n${summary}`,
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "Understood. I will continue with the compact summary in mind." }],
    },
    ...tail,
  ];

  return {
    messages: compacted,
    beforeChars: before,
    afterChars: estimateChars(compacted),
    summary: summary.slice(0, 500),
  };
}
