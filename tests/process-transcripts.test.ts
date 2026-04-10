import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { createMemory } from "../src/index.js";
import { processTranscripts } from "../src/process-transcripts.js";
import { isDuplicate } from "../src/dedup.js";
import { defaultInsightExtractor } from "../src/compact.js";

function makeLine(role: "user" | "assistant", text: string): string {
  return JSON.stringify({ role, message: { content: [{ type: "text", text }] } });
}

function setupTranscript(
  transcriptsDir: string,
  id: string,
  lines: string[],
  mtimeOffsetMs = 0,
): string {
  const dir = path.join(transcriptsDir, id);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
  if (mtimeOffsetMs !== 0) {
    const now = Date.now();
    const mtime = new Date(now + mtimeOffsetMs);
    fs.utimesSync(filePath, mtime, mtime);
  }
  return filePath;
}

describe("processTranscripts", () => {
  it("returns zeros when no transcripts directory exists", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-pt-"));
    const mem = createMemory({ dir });
    const r = await processTranscripts(mem, { transcriptsDir: "/nonexistent" });
    expect(r.transcriptsProcessed).toBe(0);
    expect(r.decisionsExtracted).toBe(0);
    expect(r.lessonsExtracted).toBe(0);
    expect(r.handoffsGenerated).toBe(0);
    expect(r.sessionsFound).toBe(0);
    expect(r.sessionsUpToDate).toBe(0);
  });

  it("extracts decisions from transcript with decision patterns", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-pt-"));
    const transcriptsDir = path.join(dir, "transcripts");
    fs.mkdirSync(transcriptsDir);

    setupTranscript(transcriptsDir, "abc-123", [
      makeLine("user", "what should we use for state?"),
      makeLine("assistant", "We decided to use Zustand for global state management because it is lightweight."),
    ], -600_000);

    const mem = createMemory({ dir: path.join(dir, ".memory") });
    const r = await processTranscripts(mem, { transcriptsDir, idleThresholdMinutes: 5 });

    expect(r.transcriptsProcessed).toBe(1);
    expect(r.decisionsExtracted).toBeGreaterThanOrEqual(1);
  });

  it("extracts lessons from transcript with lesson patterns", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-pt-"));
    const transcriptsDir = path.join(dir, "transcripts");
    fs.mkdirSync(transcriptsDir);

    setupTranscript(transcriptsDir, "def-456", [
      makeLine("user", "what was the bug?"),
      makeLine("assistant", "We learned that spawn() on Windows does not fire close with reliable exit code."),
    ], -600_000);

    const mem = createMemory({ dir: path.join(dir, ".memory") });
    const r = await processTranscripts(mem, { transcriptsDir, idleThresholdMinutes: 5 });

    expect(r.lessonsExtracted).toBeGreaterThanOrEqual(1);
  });

  it("generates handoff for idle sessions", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-pt-"));
    const transcriptsDir = path.join(dir, "transcripts");
    fs.mkdirSync(transcriptsDir);

    setupTranscript(transcriptsDir, "ghi-789", [
      makeLine("user", "fix the auth bug"),
      makeLine("assistant", "I found the issue in the token validation middleware and fixed it."),
      makeLine("user", "great, thanks"),
      makeLine("assistant", "You are welcome. The fix is deployed to staging."),
    ], -600_000);

    const mem = createMemory({ dir: path.join(dir, ".memory") });
    const r = await processTranscripts(mem, { transcriptsDir, idleThresholdMinutes: 5 });

    expect(r.handoffsGenerated).toBe(1);

    const handoffs = await mem.vault.read("default", "handoffs");
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0].tags).toContain("autohandoff");
    expect(handoffs[0].tags).toContain("transcript");
  });

  it("does not re-process already processed transcripts", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-pt-"));
    const transcriptsDir = path.join(dir, "transcripts");
    fs.mkdirSync(transcriptsDir);

    setupTranscript(transcriptsDir, "jkl-012", [
      makeLine("user", "hello"),
      makeLine("assistant", "We decided to use PostgreSQL for the database."),
    ], -600_000);

    const memDir = path.join(dir, ".memory");
    const mem = createMemory({ dir: memDir });

    const r1 = await processTranscripts(mem, { transcriptsDir, idleThresholdMinutes: 5 });
    expect(r1.transcriptsProcessed).toBe(1);

    const r2 = await processTranscripts(mem, { transcriptsDir, idleThresholdMinutes: 5 });
    expect(r2.transcriptsProcessed).toBe(0);
    expect(r2.sessionsFound).toBe(1);
    expect(r2.sessionsUpToDate).toBe(1);
  });

  it("processes new lines incrementally after initial processing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-pt-"));
    const transcriptsDir = path.join(dir, "transcripts");
    fs.mkdirSync(transcriptsDir);

    const transcriptDir = path.join(transcriptsDir, "inc-001");
    fs.mkdirSync(transcriptDir);
    const filePath = path.join(transcriptDir, "inc-001.jsonl");

    fs.writeFileSync(filePath, [
      makeLine("user", "start"),
      makeLine("assistant", "beginning work"),
    ].join("\n"), "utf-8");
    // Set old mtime so it's considered idle
    const oldTime = new Date(Date.now() - 600_000);
    fs.utimesSync(filePath, oldTime, oldTime);

    const memDir = path.join(dir, ".memory");
    const mem = createMemory({ dir: memDir });

    await processTranscripts(mem, { transcriptsDir, idleThresholdMinutes: 5 });

    // Append new lines with a decision
    fs.appendFileSync(filePath, "\n" + [
      makeLine("user", "what database?"),
      makeLine("assistant", "We decided to use SQLite for simplicity."),
    ].join("\n"), "utf-8");
    const newOldTime = new Date(Date.now() - 600_000);
    fs.utimesSync(filePath, newOldTime, newOldTime);

    const r2 = await processTranscripts(mem, { transcriptsDir, idleThresholdMinutes: 5 });
    expect(r2.transcriptsProcessed).toBe(1);
    expect(r2.decisionsExtracted).toBeGreaterThanOrEqual(1);
  });

  it("does not generate handoff for active sessions", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-pt-"));
    const transcriptsDir = path.join(dir, "transcripts");
    fs.mkdirSync(transcriptsDir);

    // mtime = now (active session)
    setupTranscript(transcriptsDir, "active-001", [
      makeLine("user", "working on something"),
      makeLine("assistant", "Let me help with that right now."),
    ]);

    const mem = createMemory({ dir: path.join(dir, ".memory") });
    const r = await processTranscripts(mem, { transcriptsDir, idleThresholdMinutes: 5 });

    expect(r.handoffsGenerated).toBe(0);
  });

  it("uses custom agentId", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-pt-"));
    const transcriptsDir = path.join(dir, "transcripts");
    fs.mkdirSync(transcriptsDir);

    setupTranscript(transcriptsDir, "custom-001", [
      makeLine("user", "setup"),
      makeLine("assistant", "We decided to adopt TypeScript strict mode for the project."),
    ], -600_000);

    const mem = createMemory({ dir: path.join(dir, ".memory") });
    await processTranscripts(mem, { transcriptsDir, agentId: "my-agent", idleThresholdMinutes: 5 });

    const decisions = await mem.vault.read("my-agent", "decisions");
    expect(decisions.length).toBeGreaterThanOrEqual(1);
  });

  it("skips duplicate decisions already in vault", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-pt-"));
    const transcriptsDir = path.join(dir, "transcripts");
    fs.mkdirSync(transcriptsDir);

    const memDir = path.join(dir, ".memory");
    const mem = createMemory({ dir: memDir });

    await mem.vault.append("default", "decisions", "We decided to use PostgreSQL for the database.", ["manual"]);

    setupTranscript(transcriptsDir, "dup-001", [
      makeLine("user", "hello"),
      makeLine("assistant", "We decided to use PostgreSQL for the database."),
    ], -600_000);

    const r = await processTranscripts(mem, { transcriptsDir, idleThresholdMinutes: 5 });
    expect(r.decisionsExtracted).toBe(0);

    const decisions = await mem.vault.read("default", "decisions");
    expect(decisions).toHaveLength(1);
  });
});

describe("defaultInsightExtractor filters", () => {
  it("rejects markdown table rows", () => {
    const result = defaultInsightExtractor([
      { role: "agent", text: "| **Decisions** | Escolhas que foram feitas | \"Vamos usar SSE e não WebSocket\" |" },
    ]);
    expect(result.decisions).toHaveLength(0);
    expect(result.lessons).toHaveLength(0);
  });

  it("rejects headings", () => {
    const result = defaultInsightExtractor([
      { role: "agent", text: "### Recomendação em Git para este projecto" },
    ]);
    expect(result.decisions).toHaveLength(0);
  });

  it("rejects agent reasoning lines", () => {
    const result = defaultInsightExtractor([
      { role: "agent", text: "Let me re-read the docs and code to understand the intended design better." },
      { role: "agent", text: "The user seems to think there should be some automatic population." },
      { role: "agent", text: "Actually, I think we should approach this differently for now." },
    ]);
    expect(result.decisions).toHaveLength(0);
    expect(result.lessons).toHaveLength(0);
  });

  it("rejects code fence markers and blockquotes", () => {
    const fences = defaultInsightExtractor([
      { role: "agent", text: "```typescript we decided to use this specific approach for the entire project```" },
    ]);
    expect(fences.decisions).toHaveLength(0);

    const quotes = defaultInsightExtractor([
      { role: "agent", text: "> Important: we decided to use this approach in the quote block specifically" },
    ]);
    expect(quotes.decisions).toHaveLength(0);
  });

  it("rejects lines shorter than 30 chars", () => {
    const result = defaultInsightExtractor([
      { role: "agent", text: "We decided to use X." },
    ]);
    expect(result.decisions).toHaveLength(0);
  });

  it("accepts real decisions that pass all filters", () => {
    const result = defaultInsightExtractor([
      { role: "agent", text: "We decided to use Zustand for global state management because it is lightweight and simple." },
    ]);
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]).toContain("Zustand");
  });

  it("accepts real lessons that pass all filters", () => {
    const result = defaultInsightExtractor([
      { role: "agent", text: "We learned that spawn() on Windows does not fire close event with reliable exit code." },
    ]);
    expect(result.lessons).toHaveLength(1);
  });
});

describe("isDuplicate", () => {
  it("detects exact duplicate content", () => {
    const existing = [
      { id: "1", date: "2026-01-01", content: "We decided to use PostgreSQL for the database.", tags: [], agentId: "default", category: "decisions" },
    ];
    expect(isDuplicate("We decided to use PostgreSQL for the database.", existing)).toBe(true);
  });

  it("detects case-insensitive duplicates", () => {
    const existing = [
      { id: "1", date: "2026-01-01", content: "We decided to use PostgreSQL for the database.", tags: [], agentId: "default", category: "decisions" },
    ];
    expect(isDuplicate("we decided to use postgresql for the database.", existing)).toBe(true);
  });

  it("allows different content", () => {
    const existing = [
      { id: "1", date: "2026-01-01", content: "We decided to use PostgreSQL for the database.", tags: [], agentId: "default", category: "decisions" },
    ];
    expect(isDuplicate("We decided to use SQLite for simplicity and portability.", existing)).toBe(false);
  });

  it("returns false for very short candidates", () => {
    const existing = [
      { id: "1", date: "2026-01-01", content: "short", tags: [], agentId: "default", category: "decisions" },
    ];
    expect(isDuplicate("short", existing)).toBe(false);
  });
});
