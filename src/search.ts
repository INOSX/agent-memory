import MiniSearch from "minisearch";
import fs from "fs";
import path from "path";
import type { VaultEntry, SearchResult, ResolvedConfig } from "./types.js";
import type { VaultApi } from "./vault.js";

const MS_OPTIONS = {
  fields: ["content", "tags"],
  storeFields: ["id", "date", "content", "tags", "agentId", "category"],
  idField: "id",
};

export interface SearchOptions {
  agentId?: string;
  category?: string;
  limit?: number;
}

export interface SearchApi {
  buildIndex(): Promise<void>;
  updateIndex(entry: VaultEntry): Promise<void>;
  removeFromIndex(id: string): Promise<void>;
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}

export function createSearch(config: ResolvedConfig, vault: VaultApi): SearchApi {
  let _ms: MiniSearch | null = null;

  function indexPath(): string {
    return path.join(config.dir, ".vault", "index.json");
  }

  function getIndex(): MiniSearch {
    if (!_ms) {
      _ms = new MiniSearch(MS_OPTIONS);
    }
    return _ms;
  }

  function persistIndex(): void {
    const iPath = indexPath();
    const dir = path.dirname(iPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (_ms) {
      fs.writeFileSync(iPath, JSON.stringify(_ms), "utf-8");
    }
  }

  function buildSnippet(content: string, query: string): string {
    const lower = content.toLowerCase();
    const words = query.toLowerCase().split(/\s+/);
    let best = 0;
    for (const word of words) {
      const idx = lower.indexOf(word);
      if (idx !== -1) {
        best = idx;
        break;
      }
    }
    const start = Math.max(0, best - 30);
    const end = Math.min(content.length, start + 120);
    return content.slice(start, end).trim();
  }

  const api: SearchApi = {
    async buildIndex() {
      const iPath = indexPath();
      if (fs.existsSync(iPath)) {
        const raw = fs.readFileSync(iPath, "utf-8");
        _ms = MiniSearch.loadJSON(raw, MS_OPTIONS);
        return;
      }

      _ms = new MiniSearch(MS_OPTIONS);
      if (!fs.existsSync(config.dir)) return;

      const agentDirs = fs
        .readdirSync(config.dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "conversations")
        .map((d) => d.name);

      for (const agentId of agentDirs) {
        for (const cat of config.categories) {
          const entries = await vault.read(agentId, cat);
          for (const entry of entries) {
            const doc = { ...entry, tags: entry.tags.join(" ") };
            if (!_ms.has(entry.id)) {
              _ms.add(doc);
            }
          }
        }
      }

      persistIndex();
    },

    async updateIndex(entry) {
      const ms = getIndex();
      const doc = { ...entry, tags: entry.tags.join(" ") };
      if (ms.has(entry.id)) {
        ms.replace(doc);
      } else {
        ms.add(doc);
      }
      persistIndex();
    },

    async removeFromIndex(id) {
      const ms = getIndex();
      if (ms.has(id)) {
        ms.discard(id);
        persistIndex();
      }
    },

    async search(query, options = {}) {
      if (getIndex().documentCount === 0) {
        await api.buildIndex();
      }
      const ms = getIndex();

      const raw = ms.search(query, { fuzzy: 0.2, prefix: true });
      let results = raw.map((r) => {
        const entry: VaultEntry = {
          id: r.id as string,
          date: r.date as string,
          content: r.content as string,
          tags: typeof r.tags === "string" ? r.tags.split(" ").filter(Boolean) : (r.tags as string[]),
          agentId: r.agentId as string,
          category: r.category as string,
        };
        const snippet = buildSnippet(entry.content, query);
        return { entry, score: r.score, snippet };
      });

      if (options.agentId) {
        results = results.filter((r) => r.entry.agentId === options.agentId);
      }
      if (options.category) {
        results = results.filter((r) => r.entry.category === options.category);
      }

      return results.slice(0, options.limit ?? 10);
    },
  };

  // Wire vault hooks so search index stays in sync
  vault._onEntryAdded = (entry) => api.updateIndex(entry);
  vault._onEntryRemoved = (id) => api.removeFromIndex(id);

  return api;
}
