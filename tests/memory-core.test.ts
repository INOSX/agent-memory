import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { createMemory } from "../src/index.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "am-mem-"));
}

describe("memory core (vault, search, inject, session, compact)", () => {
  it("vault: append, read, update, remove, listAgents", async () => {
    const dir = tmpDir();
    const mem = createMemory({ dir });

    const entry = await mem.vault.append("alpha", "decisions", "We decided to use SQLite for local dev.", [
      "sqlite",
      "database",
    ]);
    expect(entry.id).toMatch(/^\d+$/);
    expect(entry.content).toContain("SQLite");

    const read = await mem.vault.read("alpha", "decisions");
    expect(read).toHaveLength(1);
    expect(read[0].id).toBe(entry.id);

    await mem.vault.update("alpha", "decisions", entry.id, "We decided to use PostgreSQL in prod.");
    const afterUpdate = await mem.vault.read("alpha", "decisions");
    expect(afterUpdate[0].content).toContain("PostgreSQL");

    const agents = await mem.vault.listAgents();
    expect(agents).toContain("alpha");

    const counts = await mem.vault.getCategoryCounts("alpha");
    expect(counts.decisions).toBeGreaterThanOrEqual(1);

    await mem.vault.remove("alpha", "decisions", entry.id);
    expect(await mem.vault.read("alpha", "decisions")).toHaveLength(0);
  });

  it("search: BM25 finds appended entries", async () => {
    const dir = tmpDir();
    const mem = createMemory({ dir });
    await mem.vault.append("beta", "lessons", "Lesson: always validate JWT expiry on the server.", [
      "jwt",
      "security",
    ]);

    const results = await mem.search.search("JWT validate", { agentId: "beta", category: "lessons" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].snippet.toLowerCase()).toContain("jwt");
  });

  it("inject: buildContext includes project, handoff, tasks, decisions; buildTextBlock contains MEMORY", async () => {
    const dir = tmpDir();
    const mem = createMemory({ dir });
    fs.writeFileSync(path.join(dir, "_project.md"), "# Demo\nStack: Node 20.", "utf-8");
    await mem.vault.append("gamma", "handoffs", "Last time: fixed login redirect.");
    await mem.vault.append("gamma", "tasks", "- [ ] Ship v1\n- [x] Done item");
    await mem.vault.append("gamma", "decisions", "We decided to use OAuth2 for public API.");

    const ctx = await mem.inject.buildContext("gamma", "how should we authenticate the API");
    expect(ctx.projectContext).toContain("Node 20");
    expect(ctx.handoff).toContain("login");
    expect(ctx.tasks.some((t) => t.includes("Ship"))).toBe(true);
    expect(ctx.decisions.length).toBeGreaterThanOrEqual(1);

    const block = mem.inject.buildTextBlock(ctx);
    expect(block).toContain("MEMORY CONTEXT");
    expect(block).toMatch(/Project|OAuth|Ship/i);
    expect(mem.inject.buildMemoryInstructions("gamma")).toContain("gamma");
  });

  it("session: checkpoint then recover returns messages", async () => {
    const dir = tmpDir();
    const mem = createMemory({ dir });
    const messages = [
      { role: "user" as const, text: "hello" },
      { role: "agent" as const, text: "hi there" },
    ];
    await mem.session.checkpoint("delta", messages, "chat-1", "gpt-4");
    const cp = await mem.session.recover("delta");
    expect(cp).not.toBeNull();
    expect(cp!.chatId).toBe("chat-1");
    expect(cp!.messages.some((m) => m.text === "hello")).toBe(true);
  });

  it("session: sleep appends handoff and writes checkpoint", async () => {
    const dir = tmpDir();
    const mem = createMemory({ dir });
    await mem.session.sleep(
      "epsilon",
      [{ role: "user", text: "bye" }],
      "Session summary: shipped feature X.",
    );
    const handoffs = await mem.vault.read("epsilon", "handoffs");
    expect(handoffs[0].content).toContain("shipped feature");
    const cp = await mem.session.recover("epsilon");
    expect(cp).not.toBeNull();
  });

  it("compact: extractInsights finds decision and lesson patterns", () => {
    const dir = tmpDir();
    const mem = createMemory({ dir });
    const { decisions, lessons } = mem.compact.extractInsights([
      { role: "agent", text: "We decided to use Redis for the cache layer in production." },
      { role: "agent", text: "Note: the timeout must be set before connect() or it is ignored." },
    ]);
    expect(decisions.some((d) => d.toLowerCase().includes("redis"))).toBe(true);
    expect(lessons.some((l) => l.toLowerCase().includes("timeout"))).toBe(true);
  });

  it("compact: run completes and writes compact-log", async () => {
    const dir = tmpDir();
    const mem = createMemory({ dir });
    fs.mkdirSync(path.join(dir, "conversations"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "conversations", "zeta.json"),
      JSON.stringify({
        agentId: "zeta",
        savedAt: new Date().toISOString(),
        messages: [{ role: "user", text: "short" }],
      }),
      "utf-8",
    );

    const result = await mem.compact.run();
    expect(result).toMatchObject({
      timestamp: expect.any(String),
      indexRebuilt: expect.any(Boolean),
    });
    expect(fs.existsSync(path.join(dir, ".vault", "compact-log.json"))).toBe(true);
    const last = mem.compact.getLastResult();
    expect(last?.timestamp).toBe(result.timestamp);
  });

  it("migrate: migrateAll on empty layout returns empty migrated", async () => {
    const dir = tmpDir();
    const mem = createMemory({ dir });
    const { migrated, skipped } = await mem.migrate.migrateAll();
    expect(migrated).toEqual([]);
    expect(skipped).toEqual([]);
  });
});
