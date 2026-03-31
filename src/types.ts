/**
 * @inosx/agent-memory — Type definitions
 */

/** Default vault categories. Consumers can extend with custom strings. */
export const DEFAULT_CATEGORIES = [
  "decisions",
  "lessons",
  "tasks",
  "projects",
  "handoffs",
] as const;

export type DefaultCategory = (typeof DEFAULT_CATEGORIES)[number];

export interface ConversationMessage {
  role: "user" | "agent";
  text: string;
  internal?: boolean;
  targetAgentIds?: string[];
  diffs?: FileDiffData[];
}

export interface RoomMessage {
  role: "user" | "agent";
  text: string;
  agentId?: string;
  targetAgentIds?: string[];
}

export interface VaultEntry {
  id: string;
  date: string;
  content: string;
  tags: string[];
  agentId: string;
  category: string;
}

export interface Checkpoint {
  agentId: string;
  savedAt: number;
  messages: ConversationMessage[];
  chatId?: string;
  modelId?: string;
}

export interface SearchResult {
  entry: VaultEntry;
  score: number;
  snippet: string;
}

export interface InjectContext {
  projectContext: string;
  handoff?: string;
  decisions: SearchResult[];
  lessons: SearchResult[];
  tasks: string[];
  tokenEstimate: number;
  recovering?: boolean;
  recoverySnapshot?: ConversationMessage[];
}

export interface FileDiffData {
  filePath: string;
  diff: string;
  originalContent: string;
  status: "pending" | "approved" | "denied";
}

export interface CompactionResult {
  timestamp: string;
  checkpointsCleaned: number;
  conversationsTrimmed: number;
  vaultEntriesMerged: number;
  indexRebuilt: boolean;
  legacyFilesCleaned: number;
}

/** Extracts structured insights from conversation messages. */
export interface InsightExtractor {
  (messages: Array<{ role: string; text: string }>): {
    decisions: string[];
    lessons: string[];
  };
}

/** Configuration for createMemory(). */
export interface MemoryConfig {
  /** Absolute or relative path to the memory directory. Resolved to absolute at creation. */
  dir: string;
  /** Vault categories. Defaults to DEFAULT_CATEGORIES. */
  categories?: readonly string[];
  /** Max token budget for context injection. Default: 2000. */
  tokenBudget?: number;
  /** Filename for shared project context inside dir. Default: "_project.md". */
  projectContextFile?: string;
  /** Checkpoint expiry in ms. Default: 7 days. */
  checkpointExpiry?: number;
  /** Custom insight extractor for compaction. Falls back to built-in PT+EN patterns. */
  insightExtractor?: InsightExtractor;
  /** Max conversation messages to keep after trim. Default: 20. */
  maxConversationMessages?: number;
  /** Max vault entries per category before compaction. Default: 30. */
  maxVaultEntriesPerCategory?: number;
  /** Entries to keep after vault compaction. Default: 20. */
  keepVaultEntries?: number;
}

/** Resolved config with all defaults applied. */
export interface ResolvedConfig {
  dir: string;
  categories: readonly string[];
  tokenBudget: number;
  projectContextFile: string;
  checkpointExpiry: number;
  insightExtractor: InsightExtractor;
  maxConversationMessages: number;
  maxVaultEntriesPerCategory: number;
  keepVaultEntries: number;
}
