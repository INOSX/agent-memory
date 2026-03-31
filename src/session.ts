import fs from "fs";
import path from "path";
import type { ConversationMessage, Checkpoint, ResolvedConfig } from "./types.js";
import type { VaultApi } from "./vault.js";

function checkpointPath(config: ResolvedConfig, agentId: string): string {
  return path.join(config.dir, ".vault", "checkpoints", `${agentId}.json`);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export interface SessionApi {
  checkpoint(agentId: string, messages: ConversationMessage[], chatId?: string, modelId?: string): Promise<void>;
  recover(agentId: string): Promise<Checkpoint | null>;
  sleep(agentId: string, messages: ConversationMessage[], summary: string): Promise<void>;
}

export function createSession(config: ResolvedConfig, vault: VaultApi): SessionApi {
  return {
    async checkpoint(agentId, messages, chatId?, modelId?) {
      const cp: Checkpoint = {
        agentId,
        savedAt: Date.now(),
        messages: messages.slice(-50),
        chatId,
        ...(modelId ? { modelId } : {}),
      };
      const filePath = checkpointPath(config, agentId);
      ensureDir(path.dirname(filePath));
      fs.writeFileSync(filePath, JSON.stringify(cp, null, 2), "utf-8");
    },

    async recover(agentId) {
      const filePath = checkpointPath(config, agentId);
      if (!fs.existsSync(filePath)) return null;

      try {
        const cp: Checkpoint = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        if (Date.now() - cp.savedAt < config.checkpointExpiry) {
          return cp;
        }
        return null;
      } catch {
        return null;
      }
    },

    async sleep(agentId, messages, summary) {
      await vault.append(agentId, "handoffs", summary);
      await this.checkpoint(agentId, messages);
    },
  };
}
