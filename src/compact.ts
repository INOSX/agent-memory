import fs from "fs";
import path from "path";
import type { Checkpoint, CompactionResult, InsightExtractor, ResolvedConfig } from "./types.js";
import type { VaultApi } from "./vault.js";
import type { SearchApi } from "./search.js";

// ── Built-in insight patterns (PT + EN) ─────────────────────────────

const DECISION_PATTERNS = [
  /\bdecidimos\b/i, /\bdecidi\b/i, /\bdecisão\s+(foi|tomada|de)\b/i,
  /\bchose\s+to\b/i, /\bwill\s+use\b/i, /\bgoing\s+with\b/i,
  /\boptamos\s+por\b/i, /\badotamos\b/i, /\bvamos\s+usar\b/i,
  /\bwent\s+with\b/i, /\bsettled\s+on\b/i, /\bwe\s+decided\b/i,
  /\bwe\s+chose\b/i, /\bconclusion:/i, /\bconclusão:/i,
  /\brecomenda[çc]ão\b/i, /\brecommend(ed|ation)\b/i,
  /\bpropon(ho|emos)\b/i, /\bpropose\s+(to|that|we)\b/i,
];

const LESSON_PATTERNS = [
  /\bwe\s+learned\b/i, /\blesson:/i,
  /\baprendemos\b/i, /\blição:/i, /\binsight:/i,
  /\bdescoberta:/i, /\bobservação:/i, /\bobservacao:/i,
  /\bimportante:/i, /\bimportant:/i, /\btakeaway/i,
  /\bnote:\s+\S/i,
  /\bponto\s+(forte|fraco)/i,
  /\bcuidado\s+com\b/i, /\bo\s+problema\s+era\b/i,
  /\bworkaround/i, /\blimitação\b/i, /\blimitation\b/i,
];

const EXCLUDED_LINE_PATTERNS = [
  /^\|/,                          // markdown table rows
  /^#{1,6}\s/,                    // headings
  /^[`~]{3}/,                     // code fences
  /^<!--/,                        // HTML comments
  /^>/,                           // blockquotes
  /^[-*]\s*$/,                    // bare list markers
  /^(\d+)\.\s*$/,                 // bare ordered list markers
  /^\*\*/,                        // bold-only lines (usually labels)
];

const AGENT_REASONING_PATTERNS = [
  /^(Let me|I'm thinking|I need to|I should|I'll|I'm also)\b/i,
  /^(The user seems|The user wants|The user is)\b/i,
  /^(Actually,|Hmm|Wait,|OK so|Alright)\b/i,
  /^(Looking at|Checking|Reading|Searching)\b/i,
  /^(Now I|First I|Next I)\b/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function isNoisyLine(trimmed: string): boolean {
  if (matchesAny(trimmed, EXCLUDED_LINE_PATTERNS)) return true;
  if (matchesAny(trimmed, AGENT_REASONING_PATTERNS)) return true;
  return false;
}

/** Built-in insight extractor using PT + EN heuristic patterns. */
export const defaultInsightExtractor: InsightExtractor = (messages) => {
  const decisions: string[] = [];
  const lessons: string[] = [];

  for (const msg of messages) {
    if (msg.role !== "agent") continue;
    const lines = msg.text.split("\n").filter((l) => l.trim().length > 30);
    for (const line of lines) {
      const trimmed = line.trim();
      if (isNoisyLine(trimmed)) continue;
      if (matchesAny(trimmed, DECISION_PATTERNS) && decisions.length < 10) {
        decisions.push(trimmed.slice(0, 300));
      } else if (matchesAny(trimmed, LESSON_PATTERNS) && lessons.length < 10) {
        lessons.push(trimmed.slice(0, 300));
      }
    }
  }

  return { decisions, lessons };
};

export interface CompactApi {
  run(): Promise<CompactionResult>;
  getLastResult(): CompactionResult | null;
  /** Exposed for testing/direct use. */
  extractInsights(messages: Array<{ role: string; text: string }>): { decisions: string[]; lessons: string[] };
}

export function createCompact(config: ResolvedConfig, vault: VaultApi, search: SearchApi): CompactApi {
  function compactLogPath(): string {
    return path.join(config.dir, ".vault", "compact-log.json");
  }

  function processedMarkPath(): string {
    return path.join(config.dir, ".vault", "processed-conversations.json");
  }

  function loadProcessedSet(): Set<string> {
    const p = processedMarkPath();
    if (!fs.existsSync(p)) return new Set();
    try {
      const data = JSON.parse(fs.readFileSync(p, "utf-8"));
      return new Set(Array.isArray(data) ? data : []);
    } catch {
      return new Set();
    }
  }

  function saveProcessedSet(s: Set<string>): void {
    const p = processedMarkPath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify([...s]), "utf-8");
  }

  // Step A: Stale checkpoint cleanup
  function cleanStaleCheckpoints(): number {
    const cpDir = path.join(config.dir, ".vault", "checkpoints");
    if (!fs.existsSync(cpDir)) return 0;

    let cleaned = 0;
    const now = Date.now();

    for (const file of fs.readdirSync(cpDir)) {
      if (!file.endsWith(".json")) continue;
      const filePath = path.join(cpDir, file);
      try {
        const cp: Checkpoint = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        if (now - cp.savedAt > config.checkpointExpiry) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      } catch {
        try {
          fs.unlinkSync(filePath);
          cleaned++;
        } catch {
          /* ignore */
        }
      }
    }

    return cleaned;
  }

  // Step B: Conversation trimming with extraction
  async function extractAndTrimConversations(): Promise<number> {
    const convDir = path.join(config.dir, "conversations");
    if (!fs.existsSync(convDir)) return 0;

    const processed = loadProcessedSet();
    let affected = 0;

    for (const file of fs.readdirSync(convDir)) {
      if (!file.endsWith(".json") || file.startsWith(".")) continue;
      const filePath = path.join(convDir, file);

      try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        const messages: Array<{ role: string; text: string }> = data.messages;
        if (!Array.isArray(messages) || messages.length < 2) continue;

        const agentId = data.agentId ?? file.replace(".json", "");
        const fingerprint = `${agentId}:${messages.length}`;
        const needsExtraction = !processed.has(fingerprint);
        const needsTrim = messages.length > config.maxConversationMessages;

        if (!needsExtraction && !needsTrim) continue;

        const extractFrom = needsTrim
          ? messages.slice(0, messages.length - config.maxConversationMessages)
          : messages;

        if (needsExtraction) {
          const { decisions, lessons } = config.insightExtractor(extractFrom);

          if (decisions.length > 0) {
            await vault.append(agentId, "decisions", decisions.map((d) => `- ${d}`).join("\n"), ["compacted", "auto-extract"]);
          }
          if (lessons.length > 0) {
            await vault.append(agentId, "lessons", lessons.map((l) => `- ${l}`).join("\n"), ["compacted", "auto-extract"]);
          }
        }

        if (needsTrim) {
          const oldMessages = messages.slice(0, messages.length - config.maxConversationMessages);
          const agentMsgs = oldMessages.filter((m) => m.role === "agent");
          if (agentMsgs.length > 0) {
            const preview = agentMsgs
              .slice(-3)
              .map((m) => m.text.slice(0, 150).replace(/\n/g, " "))
              .join("\n- ");
            await vault.append(agentId, "handoffs", `Session compacted (${oldMessages.length} msgs removed):\n- ${preview}`, ["compacted", "auto-handoff"]);
          }
          data.messages = messages.slice(-config.maxConversationMessages);
          fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
        }

        const newCount = needsTrim ? config.maxConversationMessages : messages.length;
        processed.add(`${agentId}:${newCount}`);
        affected++;
      } catch {
        // Skip corrupted files
      }
    }

    saveProcessedSet(processed);
    return affected;
  }

  // Step C: Vault category capping
  async function capVaultEntries(): Promise<number> {
    const agents = await vault.listAgents();
    let merged = 0;

    for (const agentId of agents) {
      for (const category of config.categories) {
        const entries = await vault.read(agentId, category);
        if (entries.length <= config.maxVaultEntriesPerCategory) continue;

        const keep = entries.slice(0, config.keepVaultEntries);
        const old = entries.slice(config.keepVaultEntries);

        const mergedContent = old
          .map((e) => `- [${e.date}] ${e.content.slice(0, 200).replace(/\n/g, " ")}`)
          .join("\n");

        await vault.append(agentId, category, `Compacted ${old.length} older entries:\n${mergedContent}`, ["compacted"]);

        // Re-read and trim
        const updated = await vault.read(agentId, category);
        const final = updated.slice(0, config.keepVaultEntries + 1);
        const filePath = path.join(config.dir, agentId, `${category}.md`);

        const formatted = final
          .map((e) => {
            const tagStr = e.tags.length > 0 ? ` · ${e.tags.map((t) => `#${t}`).join(" ")}` : "";
            return `<!-- id:${e.id} -->\n## ${e.date}${tagStr}\n\n${e.content}\n\n---`;
          })
          .join("\n\n");
        fs.writeFileSync(filePath, formatted, "utf-8");

        merged += old.length;
      }
    }

    return merged;
  }

  // Step D: Search index rebuild
  async function rebuildSearchIndex(): Promise<boolean> {
    try {
      const iPath = path.join(config.dir, ".vault", "index.json");
      if (fs.existsSync(iPath)) fs.unlinkSync(iPath);
      await search.buildIndex();
      return true;
    } catch {
      return false;
    }
  }

  // Step E: Legacy file cleanup
  function cleanLegacyFiles(): number {
    if (!fs.existsSync(config.dir)) return 0;

    let cleaned = 0;
    const files = fs.readdirSync(config.dir);

    for (const file of files) {
      const filePath = path.join(config.dir, file);

      if (file.endsWith(".md.bak")) {
        try {
          fs.unlinkSync(filePath);
          cleaned++;
        } catch {
          /* ignore */
        }
        continue;
      }

      if (file.endsWith(".md") && !file.startsWith("_") && !file.startsWith(".")) {
        const agentId = file.replace(".md", "");
        const vaultDir = path.join(config.dir, agentId);
        const hasVault = fs.existsSync(vaultDir) && fs.statSync(vaultDir).isDirectory();
        const fileSize = fs.statSync(filePath).size;
        const isEmptyStub = fileSize < 200;
        if (hasVault || isEmptyStub) {
          try {
            fs.unlinkSync(filePath);
            cleaned++;
          } catch {
            /* ignore */
          }
        }
      }
    }

    return cleaned;
  }

  return {
    extractInsights: config.insightExtractor,

    getLastResult() {
      const logPath = compactLogPath();
      if (!fs.existsSync(logPath)) return null;
      try {
        return JSON.parse(fs.readFileSync(logPath, "utf-8"));
      } catch {
        return null;
      }
    },

    async run() {
      const checkpointsCleaned = cleanStaleCheckpoints();
      const conversationsTrimmed = await extractAndTrimConversations();
      const vaultEntriesMerged = await capVaultEntries();
      const indexRebuilt = await rebuildSearchIndex();
      const legacyFilesCleaned = cleanLegacyFiles();

      const result: CompactionResult = {
        timestamp: new Date().toISOString(),
        checkpointsCleaned,
        conversationsTrimmed,
        vaultEntriesMerged,
        indexRebuilt,
        legacyFilesCleaned,
      };

      try {
        const logDir = path.dirname(compactLogPath());
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        fs.writeFileSync(compactLogPath(), JSON.stringify(result, null, 2), "utf-8");
      } catch {
        /* non-critical */
      }

      return result;
    },
  };
}
