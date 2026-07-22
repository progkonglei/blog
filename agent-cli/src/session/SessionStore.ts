import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Message } from "../types/messages.js";

/** Append-only JSONL session store — Claude Code persistence pattern. */
export class SessionStore {
  readonly sessionId: string;
  readonly filePath: string;

  private constructor(sessionId: string, filePath: string) {
    this.sessionId = sessionId;
    this.filePath = filePath;
  }

  static async create(dir: string, sessionId = randomUUID()): Promise<SessionStore> {
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${sessionId}.jsonl`);
    const store = new SessionStore(sessionId, filePath);
    await store.append({ type: "session_start", sessionId, ts: Date.now() });
    return store;
  }

  static async open(filePath: string): Promise<{ store: SessionStore; messages: Message[] }> {
    const sessionId = path.basename(filePath, ".jsonl");
    const store = new SessionStore(sessionId, filePath);
    const messages = await store.loadMessages();
    return { store, messages };
  }

  static async list(dir: string): Promise<string[]> {
    try {
      const files = await readdir(dir);
      return files.filter((f) => f.endsWith(".jsonl")).sort().reverse();
    } catch {
      return [];
    }
  }

  async append(event: Record<string, unknown>): Promise<void> {
    await appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
  }

  async recordMessage(message: Message): Promise<void> {
    await this.append({ type: "message", ts: Date.now(), message });
  }

  async loadMessages(): Promise<Message[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const messages: Message[] = [];
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        const ev = JSON.parse(line) as { type: string; message?: Message };
        if (ev.type === "message" && ev.message) messages.push(ev.message);
      }
      return messages;
    } catch {
      return [];
    }
  }
}
