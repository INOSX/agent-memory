import fs from "fs";
import path from "path";
import type { ResolvedConfig } from "./types.js";
import type { VaultApi } from "./vault.js";

const SECTION_MAP: Record<string, string> = {
  // PT
  "decisões": "decisions",
  "decisões técnicas": "decisions",
  "notas de sessão": "lessons",
  "contexto de projeto": "projects",
  "contexto": "projects",
  "aprendizados": "lessons",
  "preferências do utilizador": "lessons",
  "preferências do usuário": "lessons",
  "tarefas": "tasks",
  "handoffs": "handoffs",
  "projetos": "projects",
  // EN
  "decisions": "decisions",
  "lessons": "lessons",
  "tasks": "tasks",
  "projects": "projects",
  "findings": "lessons",
  "notes": "lessons",
  "context": "projects",
};

function classifySection(header: string, categories: readonly string[]): string {
  const normalized = header.toLowerCase().trim();
  if (SECTION_MAP[normalized] && categories.includes(SECTION_MAP[normalized])) {
    return SECTION_MAP[normalized];
  }
  for (const [key, cat] of Object.entries(SECTION_MAP)) {
    if (normalized.includes(key) && categories.includes(cat)) return cat;
  }
  return categories.includes("lessons") ? "lessons" : categories[0];
}

export interface MigrateResult {
  migrated: string[];
  skipped: string[];
}

export interface MigrateApi {
  migrateAll(): Promise<MigrateResult>;
}

export function createMigrate(config: ResolvedConfig, vault: VaultApi): MigrateApi {
  return {
    async migrateAll() {
      const result: MigrateResult = { migrated: [], skipped: [] };
      if (!fs.existsSync(config.dir)) return result;

      const files = fs
        .readdirSync(config.dir)
        .filter((f) => f.endsWith(".md") && !f.startsWith("_") && !f.startsWith("."));

      for (const file of files) {
        const agentId = file.replace(/\.md$/, "");
        const bakPath = path.join(config.dir, `${agentId}.md.bak`);
        const vaultPath = path.join(config.dir, agentId);

        if (fs.existsSync(bakPath) || fs.existsSync(vaultPath)) {
          result.skipped.push(agentId);
          continue;
        }

        const content = fs.readFileSync(path.join(config.dir, file), "utf-8");
        const sections = content.split(/^## /m).slice(1);

        for (const section of sections) {
          const lines = section.split("\n");
          const header = lines[0].trim();
          const body = lines.slice(1).join("\n").trim();
          if (!body) continue;

          const category = classifySection(header, config.categories);
          await vault.append(agentId, category, body);
        }

        fs.renameSync(path.join(config.dir, file), bakPath);
        result.migrated.push(agentId);
      }

      return result;
    },
  };
}
