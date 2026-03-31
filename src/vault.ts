import fs from "fs";
import path from "path";
import type { VaultEntry, ResolvedConfig } from "./types.js";

function agentDir(config: ResolvedConfig, agentId: string): string {
  return path.join(config.dir, agentId);
}

function categoryPath(config: ResolvedConfig, agentId: string, category: string): string {
  return path.join(agentDir(config, agentId), `${category}.md`);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function extractTags(content: string): string[] {
  const matches = content.match(/#(\w+)/g) ?? [];
  return matches.map((t) => t.slice(1));
}

function formatDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 16);
}

function entriesToMarkdown(entries: VaultEntry[]): string {
  return entries
    .map((e) => {
      const tagStr = e.tags.length > 0 ? ` · ${e.tags.map((t) => `#${t}`).join(" ")}` : "";
      return `<!-- id:${e.id} -->\n## ${e.date}${tagStr}\n\n${e.content}\n\n---`;
    })
    .join("\n\n");
}

function markdownToEntries(agentId: string, category: string, content: string): VaultEntry[] {
  const blocks = content.split(/\n---\n?/).filter((b) => b.trim());
  return blocks
    .map((block): VaultEntry | null => {
      const idMatch = block.match(/<!-- id:(\d+) -->/);
      const headerMatch = block.match(/## ([\dT:\-]+)(?: · (.+))?/);
      if (!headerMatch) return null;

      const id = idMatch?.[1] ?? Date.now().toString();
      const date = headerMatch[1];
      const tagLine = headerMatch[2] ?? "";
      const tags = tagLine ? tagLine.match(/#(\w+)/g)?.map((t) => t.slice(1)) ?? [] : [];
      const entryContent = block
        .replace(/<!-- id:\d+ -->/, "")
        .replace(/## [\dT:\-]+(?:\s·\s.+)?/, "")
        .trim();

      return { id, date, content: entryContent, tags, agentId, category };
    })
    .filter((e): e is VaultEntry => e !== null)
    .sort((a, b) => Number(b.id) - Number(a.id));
}

let _lastId = 0;
function uniqueId(): string {
  const now = Date.now();
  _lastId = now > _lastId ? now : _lastId + 1;
  return _lastId.toString();
}

export interface VaultApi {
  read(agentId: string, category: string): Promise<VaultEntry[]>;
  append(agentId: string, category: string, content: string, tags?: string[]): Promise<VaultEntry>;
  update(agentId: string, category: string, id: string, newContent: string): Promise<void>;
  remove(agentId: string, category: string, id: string): Promise<void>;
  listAgents(): Promise<string[]>;
  getCategoryCounts(agentId: string): Promise<Record<string, number>>;
  /** Internal: serialize writes. */
  readonly writeQueue: Promise<void>;
  /** Internal: exposed for search module integration. */
  _onEntryAdded?: (entry: VaultEntry) => Promise<void>;
  _onEntryRemoved?: (id: string) => Promise<void>;
}

export function createVault(config: ResolvedConfig): VaultApi {
  let writeQueue: Promise<void> = Promise.resolve();

  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = writeQueue.then(fn);
    writeQueue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  const api: VaultApi = {
    get writeQueue() {
      return writeQueue;
    },

    async read(agentId, category) {
      const filePath = categoryPath(config, agentId, category);
      if (!fs.existsSync(filePath)) return [];
      const content = fs.readFileSync(filePath, "utf-8");
      return markdownToEntries(agentId, category, content);
    },

    async append(agentId, category, content, tags?) {
      const id = uniqueId();
      const date = formatDate(Number(id));
      const extractedTags = tags ?? extractTags(content);
      const entry: VaultEntry = { id, date, content, tags: extractedTags, agentId, category };

      return enqueue(async () => {
        ensureDir(agentDir(config, agentId));
        const filePath = categoryPath(config, agentId, category);
        const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
        const entries = markdownToEntries(agentId, category, existing);
        entries.unshift(entry);
        fs.writeFileSync(filePath, entriesToMarkdown(entries), "utf-8");

        if (api._onEntryAdded) {
          try {
            await api._onEntryAdded(entry);
          } catch {
            // search not ready — safe to ignore
          }
        }

        return entry;
      });
    },

    async update(agentId, category, id, newContent) {
      return enqueue(async () => {
        const filePath = categoryPath(config, agentId, category);
        if (!fs.existsSync(filePath)) return;
        const existing = fs.readFileSync(filePath, "utf-8");
        const entries = markdownToEntries(agentId, category, existing);
        const idx = entries.findIndex((e) => e.id === id);
        if (idx === -1) return;
        entries[idx] = { ...entries[idx], content: newContent, tags: extractTags(newContent) };
        fs.writeFileSync(filePath, entriesToMarkdown(entries), "utf-8");
      });
    },

    async remove(agentId, category, id) {
      return enqueue(async () => {
        const filePath = categoryPath(config, agentId, category);
        if (!fs.existsSync(filePath)) return;
        const existing = fs.readFileSync(filePath, "utf-8");
        const entries = markdownToEntries(agentId, category, existing).filter((e) => e.id !== id);
        fs.writeFileSync(filePath, entriesToMarkdown(entries), "utf-8");

        if (api._onEntryRemoved) {
          try {
            await api._onEntryRemoved(id);
          } catch {
            // search not ready — safe to ignore
          }
        }
      });
    },

    async listAgents() {
      if (!fs.existsSync(config.dir)) return [];
      const reserved = new Set(["conversations", ".vault"]);
      return fs
        .readdirSync(config.dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith(".") && !reserved.has(d.name))
        .map((d) => d.name);
    },

    async getCategoryCounts(agentId) {
      const counts: Record<string, number> = {};
      for (const cat of config.categories) {
        const entries = await api.read(agentId, cat);
        counts[cat] = entries.length;
      }
      return counts;
    },
  };

  return api;
}
