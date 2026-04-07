import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi, afterEach } from "vitest";
import { createMemory } from "../src/index.js";
import { startWatcher } from "../src/watcher.js";

function makeLine(role: "user" | "assistant", text: string): string {
  return JSON.stringify({ role, message: { content: [{ type: "text", text }] } });
}

function setupTranscriptsDir(baseDir: string): string {
  const tDir = path.join(baseDir, "agent-transcripts");
  fs.mkdirSync(tDir, { recursive: true });
  return tDir;
}

function writeTranscript(transcriptsDir: string, id: string, lines: string[]): string {
  const dir = path.join(transcriptsDir, id);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
  return filePath;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("startWatcher", () => {
  const handles: Array<{ stop(): void }> = [];

  afterEach(() => {
    for (const h of handles) h.stop();
    handles.length = 0;
  });

  it("throws when transcripts directory cannot be found", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-w-"));
    const mem = createMemory({ dir: path.join(dir, ".memory") });

    expect(() => startWatcher(mem, { workspaceDir: "/nonexistent/path/xyz" })).toThrow(
      /Could not find Cursor transcripts/,
    );
  });

  it("starts and stops without errors", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-w-"));
    const tDir = setupTranscriptsDir(dir);
    const mem = createMemory({ dir: path.join(dir, ".memory") });

    const handle = startWatcher(mem, { transcriptsDir: tDir, quiet: true });
    handles.push(handle);

    expect(handle.transcriptsDir).toBe(tDir);
    handle.stop();
  });

  it("processes existing unprocessed transcripts on startup with short debounce", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-w-"));
    const tDir = setupTranscriptsDir(dir);
    const memDir = path.join(dir, ".memory");
    const mem = createMemory({ dir: memDir });

    writeTranscript(tDir, "startup-001", [
      makeLine("user", "what framework should we use?"),
      makeLine("assistant", "We decided to use Next.js for the frontend because it supports SSR."),
    ]);

    const handle = startWatcher(mem, {
      transcriptsDir: tDir,
      quiet: true,
      debounceSec: 0.3,
      idleTimeoutSec: 1,
    });
    handles.push(handle);

    await sleep(800);

    const decisions = await mem.vault.read("default", "decisions");
    expect(decisions.length).toBeGreaterThanOrEqual(1);
  });

  it("generates handoff after idle timeout", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-w-"));
    const tDir = setupTranscriptsDir(dir);
    const memDir = path.join(dir, ".memory");
    const mem = createMemory({ dir: memDir });

    writeTranscript(tDir, "idle-001", [
      makeLine("user", "fix the login page"),
      makeLine("assistant", "I fixed the login form validation and added error messages."),
      makeLine("user", "great thanks"),
      makeLine("assistant", "You are welcome. The changes are ready for review."),
    ]);

    const handle = startWatcher(mem, {
      transcriptsDir: tDir,
      quiet: true,
      debounceSec: 0.2,
      idleTimeoutSec: 1,
    });
    handles.push(handle);

    await sleep(1500);

    const handoffs = await mem.vault.read("default", "handoffs");
    expect(handoffs.length).toBeGreaterThanOrEqual(1);
    expect(handoffs[0].tags).toContain("autohandoff");
  });

  it("persists processed state across restarts", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-w-"));
    const tDir = setupTranscriptsDir(dir);
    const memDir = path.join(dir, ".memory");

    writeTranscript(tDir, "persist-001", [
      makeLine("user", "hello"),
      makeLine("assistant", "We decided to use Redis for caching."),
    ]);

    const mem1 = createMemory({ dir: memDir });
    const h1 = startWatcher(mem1, { transcriptsDir: tDir, quiet: true, debounceSec: 0.2, idleTimeoutSec: 1 });
    handles.push(h1);

    await sleep(800);
    h1.stop();

    const statePath = path.join(memDir, ".vault", "processed-transcripts.json");
    expect(fs.existsSync(statePath)).toBe(true);

    const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    expect(state["persist-001"]).toBeDefined();
    expect(state["persist-001"].lastLine).toBe(2);
  });

  it("uses custom agentId", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-w-"));
    const tDir = setupTranscriptsDir(dir);
    const memDir = path.join(dir, ".memory");
    const mem = createMemory({ dir: memDir });

    writeTranscript(tDir, "agent-001", [
      makeLine("user", "architecture question"),
      makeLine("assistant", "We decided to adopt a microservices architecture for scalability."),
    ]);

    const handle = startWatcher(mem, {
      transcriptsDir: tDir,
      quiet: true,
      agentId: "my-agent",
      debounceSec: 0.2,
      idleTimeoutSec: 1,
    });
    handles.push(handle);

    await sleep(800);

    const decisions = await mem.vault.read("my-agent", "decisions");
    expect(decisions.length).toBeGreaterThanOrEqual(1);
  });
});
