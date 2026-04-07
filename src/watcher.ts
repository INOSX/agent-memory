/**
 * File watcher daemon: monitors Cursor transcripts in real-time,
 * extracts insights and generates handoffs automatically.
 */
import fs from "fs";
import path from "path";
import type { AgentMemory } from "./index.js";
import {
  findTranscriptsDir,
  parseTranscript,
  type TranscriptInfo,
} from "./transcript-parser.js";

export interface WatcherOptions {
  /** Agent ID to attribute saved entries to. Default: "default". */
  agentId?: string;
  /** Seconds of inactivity before considering a session ended. Default: 180 (3 min). */
  idleTimeoutSec?: number;
  /** Seconds to debounce after file change before processing. Default: 30. */
  debounceSec?: number;
  /** Workspace directory (used to find Cursor transcripts). Default: process.cwd(). */
  workspaceDir?: string;
  /** Custom transcripts directory (bypasses auto-discovery). */
  transcriptsDir?: string;
  /** Suppress stdout output. Default: false. */
  quiet?: boolean;
  /** Polling interval in ms for environments without native fs.watch support. Default: 2000. */
  pollIntervalMs?: number;
}

export interface WatcherHandle {
  stop(): void;
  readonly transcriptsDir: string;
}

interface SessionState {
  lastLine: number;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  handoffGenerated: boolean;
}

interface ProcessedState {
  [transcriptId: string]: {
    lastLine: number;
    lastProcessedAt: number;
    handoffGenerated: boolean;
  };
}

function stateFilePath(memDir: string): string {
  return path.join(memDir, ".vault", "processed-transcripts.json");
}

function loadState(memDir: string): ProcessedState {
  const p = stateFilePath(memDir);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as ProcessedState;
  } catch {
    return {};
  }
}

function saveState(memDir: string, state: ProcessedState): void {
  const p = stateFilePath(memDir);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2), "utf-8");
}

function generateHandoffText(messages: Array<{ role: string; text: string }>): string {
  const agentMsgs = messages.filter((m) => m.role === "agent");
  const userMsgs = messages.filter((m) => m.role === "user");

  const lastAgent = agentMsgs.slice(-3).map((m) => m.text.slice(0, 200).replace(/\n/g, " "));
  const lastUser = userMsgs.slice(-2).map((m) => m.text.slice(0, 150).replace(/\n/g, " "));

  const parts: string[] = [];
  if (lastUser.length > 0) parts.push(`User asked: ${lastUser.join(" | ")}`);
  if (lastAgent.length > 0) parts.push(`Agent responded: ${lastAgent.join(" | ")}`);

  return `Auto-handoff from transcript (${messages.length} messages). ${parts.join(". ")}`;
}

function resolveJsonlPath(transcriptsDir: string, filename: string): string | null {
  // filename could be the uuid dir name or the .jsonl file
  const base = filename.replace(/\.jsonl$/, "").replace(/\/$/, "");
  const candidate = path.join(transcriptsDir, base, `${base}.jsonl`);
  if (fs.existsSync(candidate)) return candidate;
  return null;
}

function transcriptIdFromPath(filePath: string): string {
  return path.basename(path.dirname(filePath));
}

/**
 * Start watching Cursor transcripts for changes.
 * Returns a handle to stop the watcher.
 */
export function startWatcher(mem: AgentMemory, options?: WatcherOptions): WatcherHandle {
  const agentId = options?.agentId ?? "default";
  const idleTimeoutMs = (options?.idleTimeoutSec ?? 180) * 1000;
  const debounceMs = (options?.debounceSec ?? 30) * 1000;
  const workspaceDir = options?.workspaceDir ?? process.cwd();
  const quiet = options?.quiet ?? false;
  const pollMs = options?.pollIntervalMs ?? 2000;

  const tDirOrNull = options?.transcriptsDir ?? findTranscriptsDir(workspaceDir);
  if (!tDirOrNull) {
    throw new Error(
      `Could not find Cursor transcripts directory for workspace: ${workspaceDir}. ` +
      `Ensure Cursor has been used in this project, or pass --transcripts-dir explicitly.`,
    );
  }
  const tDir: string = tDirOrNull;

  const log = quiet ? () => {} : (msg: string) => console.log(`[agent-memory watch] ${msg}`);

  const sessions = new Map<string, SessionState>();
  const persistedState = loadState(mem.config.dir);

  function getSession(transcriptId: string): SessionState {
    if (!sessions.has(transcriptId)) {
      const prev = persistedState[transcriptId];
      sessions.set(transcriptId, {
        lastLine: prev?.lastLine ?? 0,
        debounceTimer: null,
        idleTimer: null,
        handoffGenerated: prev?.handoffGenerated ?? false,
      });
    }
    return sessions.get(transcriptId)!;
  }

  async function processNewLines(transcriptId: string, jsonlPath: string): Promise<void> {
    const session = getSession(transcriptId);

    try {
      const content = fs.readFileSync(jsonlPath, "utf-8");
      const totalLines = content.split("\n").filter((l) => l.trim().length > 0).length;

      if (totalLines <= session.lastLine) return;

      const parsed = parseTranscript(jsonlPath, session.lastLine);
      if (parsed.messages.length === 0) {
        session.lastLine = totalLines;
        return;
      }

      const { decisions, lessons } = mem.config.insightExtractor(parsed.messages);

      for (const d of decisions) {
        await mem.vault.append(agentId, "decisions", d, ["autoextract", "transcript"]);
        log(`Decision saved: ${d.slice(0, 80)}...`);
      }

      for (const l of lessons) {
        await mem.vault.append(agentId, "lessons", l, ["autoextract", "transcript"]);
        log(`Lesson saved: ${l.slice(0, 80)}...`);
      }

      session.lastLine = totalLines;

      persistedState[transcriptId] = {
        lastLine: totalLines,
        lastProcessedAt: Date.now(),
        handoffGenerated: session.handoffGenerated,
      };
      saveState(mem.config.dir, persistedState);
    } catch (e) {
      log(`Error processing ${transcriptId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function generateSessionHandoff(transcriptId: string, jsonlPath: string): Promise<void> {
    const session = getSession(transcriptId);
    if (session.handoffGenerated) return;

    try {
      const fullParsed = parseTranscript(jsonlPath);
      if (fullParsed.messages.length < 2) return;

      const last6 = fullParsed.messages.slice(-6);
      const handoffText = generateHandoffText(last6);
      await mem.vault.append(agentId, "handoffs", handoffText, ["autohandoff", "transcript"]);

      session.handoffGenerated = true;
      persistedState[transcriptId] = {
        lastLine: session.lastLine,
        lastProcessedAt: Date.now(),
        handoffGenerated: true,
      };
      saveState(mem.config.dir, persistedState);
      log(`Handoff generated for session ${transcriptId.slice(0, 8)}...`);
    } catch (e) {
      log(`Error generating handoff for ${transcriptId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function scheduleProcessing(transcriptId: string, jsonlPath: string): void {
    const session = getSession(transcriptId);

    // Reset debounce
    if (session.debounceTimer) clearTimeout(session.debounceTimer);
    session.debounceTimer = setTimeout(() => {
      processNewLines(transcriptId, jsonlPath);
    }, debounceMs);

    // Reset idle timer
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      processNewLines(transcriptId, jsonlPath).then(() => {
        generateSessionHandoff(transcriptId, jsonlPath);
      });
    }, idleTimeoutMs);

    // Mark as active session (new transcript = reset handoff flag)
    if (!persistedState[transcriptId]) {
      session.handoffGenerated = false;
    }
  }

  function onFileChange(filename: string | null): void {
    if (!filename) return;
    const jsonlPath = resolveJsonlPath(tDir, filename);
    if (!jsonlPath) return;
    const transcriptId = transcriptIdFromPath(jsonlPath);
    scheduleProcessing(transcriptId, jsonlPath);
  }

  // Start watching
  let watcher: fs.FSWatcher | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  try {
    watcher = fs.watch(tDir, { recursive: true }, (_event, filename) => {
      if (filename && filename.endsWith(".jsonl")) {
        onFileChange(filename);
      }
    });
  } catch {
    // Fallback: polling for environments without recursive fs.watch
    log("fs.watch not available with recursive, falling back to polling");
    const knownMtimes = new Map<string, number>();

    pollInterval = setInterval(() => {
      try {
        for (const entry of fs.readdirSync(tDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const jsonlPath = path.join(tDir, entry.name, `${entry.name}.jsonl`);
          if (!fs.existsSync(jsonlPath)) continue;
          const mtime = fs.statSync(jsonlPath).mtimeMs;
          const prev = knownMtimes.get(entry.name);
          if (!prev || mtime > prev) {
            knownMtimes.set(entry.name, mtime);
            if (prev) onFileChange(entry.name);
          }
        }
      } catch {
        /* ignore scan errors */
      }
    }, pollMs);
  }

  // Scan existing transcripts on startup for any that need processing
  try {
    for (const entry of fs.readdirSync(tDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const jsonlPath = path.join(tDir, entry.name, `${entry.name}.jsonl`);
      if (!fs.existsSync(jsonlPath)) continue;

      const prev = persistedState[entry.name];
      const content = fs.readFileSync(jsonlPath, "utf-8");
      const lineCount = content.split("\n").filter((l) => l.trim().length > 0).length;

      if (!prev || prev.lastLine < lineCount) {
        scheduleProcessing(entry.name, jsonlPath);
      }
    }
  } catch {
    /* ignore startup scan errors */
  }

  log(`Watching: ${tDir}`);
  log(`Agent: ${agentId} | Debounce: ${debounceMs / 1000}s | Idle timeout: ${idleTimeoutMs / 1000}s`);

  return {
    get transcriptsDir() {
      return tDir;
    },
    stop() {
      if (watcher) {
        watcher.close();
        watcher = null;
      }
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      for (const session of sessions.values()) {
        if (session.debounceTimer) clearTimeout(session.debounceTimer);
        if (session.idleTimer) clearTimeout(session.idleTimer);
      }
      sessions.clear();
      log("Stopped.");
    },
  };
}
