/**
 * @inosx/agent-memory
 *
 * File-based memory system for AI agents.
 * Vault (markdown persistence), full-text search (BM25),
 * context injection, session checkpoints, and compaction.
 *
 * Usage:
 *   import { createMemory } from "@inosx/agent-memory";
 *   const mem = createMemory({ dir: ".memory" });
 *
 *   await mem.vault.append("agent-1", "decisions", "Use PostgreSQL for persistence");
 *   const results = await mem.search("database", { agentId: "agent-1" });
 *   const ctx = await mem.inject.buildContext("agent-1", "fix the migration bug");
 */

import path from "path";
import type {
  MemoryConfig,
  ResolvedConfig,
  InsightExtractor,
} from "./types.js";
import { DEFAULT_CATEGORIES } from "./types.js";
import { createVault, type VaultApi } from "./vault.js";
import { createSearch, type SearchApi, type SearchOptions } from "./search.js";
import { createSession, type SessionApi } from "./session.js";
import { createInject, type InjectApi } from "./inject.js";
import { createCompact, defaultInsightExtractor, type CompactApi } from "./compact.js";
import { createMigrate, type MigrateApi } from "./migrate.js";

const SEVEN_DAYS_MS = 7 * 24 * 3_600_000;

function resolveConfig(config: MemoryConfig): ResolvedConfig {
  return {
    dir: path.resolve(config.dir),
    categories: config.categories ?? DEFAULT_CATEGORIES,
    tokenBudget: config.tokenBudget ?? 2000,
    projectContextFile: config.projectContextFile ?? "_project.md",
    checkpointExpiry: config.checkpointExpiry ?? SEVEN_DAYS_MS,
    insightExtractor: config.insightExtractor ?? defaultInsightExtractor,
    maxConversationMessages: config.maxConversationMessages ?? 20,
    maxVaultEntriesPerCategory: config.maxVaultEntriesPerCategory ?? 30,
    keepVaultEntries: config.keepVaultEntries ?? 20,
  };
}

export interface AgentMemory {
  readonly config: ResolvedConfig;
  readonly vault: VaultApi;
  readonly search: SearchApi;
  readonly session: SessionApi;
  readonly inject: InjectApi;
  readonly compact: CompactApi;
  readonly migrate: MigrateApi;
}

export function createMemory(config: MemoryConfig): AgentMemory {
  const resolved = resolveConfig(config);
  const vault = createVault(resolved);
  const search = createSearch(resolved, vault);
  const session = createSession(resolved, vault);
  const inject = createInject(resolved, vault, search, session);
  const compact = createCompact(resolved, vault, search);
  const migrate = createMigrate(resolved, vault);

  return { config: resolved, vault, search, session, inject, compact, migrate };
}

// Re-export all types for consumers
export type {
  MemoryConfig,
  ResolvedConfig,
  InsightExtractor,
  VaultApi,
  SearchApi,
  SearchOptions,
  SessionApi,
  InjectApi,
  CompactApi,
  MigrateApi,
};

export type {
  VaultEntry,
  Checkpoint,
  SearchResult,
  InjectContext,
  ConversationMessage,
  RoomMessage,
  FileDiffData,
  CompactionResult,
  DefaultCategory,
} from "./types.js";

export { DEFAULT_CATEGORIES } from "./types.js";
export { defaultInsightExtractor } from "./compact.js";
