/**
 * One-shot processor: scans Cursor transcripts, extracts insights, generates handoffs.
 * Tracks processed state in .memory/.vault/processed-transcripts.json to avoid re-processing.
 */
import fs from "fs";
import path from "path";
import type { AgentMemory } from "./index.js";
import type { InsightExtractor } from "./types.js";
import {
  findTranscriptsDir,
  listTranscripts,
  parseTranscript,
  type TranscriptInfo,
} from "./transcript-parser.js";

export interface ProcessOptions {
  /** Agent ID to attribute saved entries to. Default: "default". */
  agentId?: string;
  /** Minutes of inactivity to consider a session ended. Default: 5. */
  idleThresholdMinutes?: number;
  /** Workspace directory (used to find Cursor transcripts). Default: process.cwd(). */
  workspaceDir?: string;
  /** Custom transcripts directory (bypasses auto-discovery). */
  transcriptsDir?: string;
}

export interface ProcessResult {
  transcriptsProcessed: number;
  decisionsExtracted: number;
  lessonsExtracted: number;
  handoffsGenerated: number;
  errors: Array<{ transcriptId: string; error: string }>;
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

function isSessionIdle(transcript: TranscriptInfo, thresholdMs: number): boolean {
  return Date.now() - transcript.lastModified > thresholdMs;
}

function generateHandoffText(
  messages: Array<{ role: string; text: string }>,
): string {
  const agentMsgs = messages.filter((m) => m.role === "agent");
  const userMsgs = messages.filter((m) => m.role === "user");

  const lastAgent = agentMsgs.slice(-3).map((m) => m.text.slice(0, 200).replace(/\n/g, " "));
  const lastUser = userMsgs.slice(-2).map((m) => m.text.slice(0, 150).replace(/\n/g, " "));

  const parts: string[] = [];
  if (lastUser.length > 0) {
    parts.push(`User asked: ${lastUser.join(" | ")}`);
  }
  if (lastAgent.length > 0) {
    parts.push(`Agent responded: ${lastAgent.join(" | ")}`);
  }

  return `Auto-handoff from transcript (${messages.length} messages). ${parts.join(". ")}`;
}

/**
 * Process all unprocessed Cursor transcripts: extract insights and generate handoffs.
 */
export async function processTranscripts(
  mem: AgentMemory,
  options?: ProcessOptions,
): Promise<ProcessResult> {
  const agentId = options?.agentId ?? "default";
  const idleMs = (options?.idleThresholdMinutes ?? 5) * 60_000;
  const workspaceDir = options?.workspaceDir ?? process.cwd();

  const transcriptsDir = options?.transcriptsDir ?? findTranscriptsDir(workspaceDir);
  if (!transcriptsDir) {
    return { transcriptsProcessed: 0, decisionsExtracted: 0, lessonsExtracted: 0, handoffsGenerated: 0, errors: [] };
  }

  const transcripts = listTranscripts(transcriptsDir);
  if (transcripts.length === 0) {
    return { transcriptsProcessed: 0, decisionsExtracted: 0, lessonsExtracted: 0, handoffsGenerated: 0, errors: [] };
  }

  const state = loadState(mem.config.dir);
  const extractor = mem.config.insightExtractor;
  const result: ProcessResult = {
    transcriptsProcessed: 0,
    decisionsExtracted: 0,
    lessonsExtracted: 0,
    handoffsGenerated: 0,
    errors: [],
  };

  for (const transcript of transcripts) {
    try {
      const prev = state[transcript.id];
      const fromLine = prev?.lastLine ?? 0;

      if (fromLine >= transcript.lineCount && prev?.handoffGenerated) continue;

      const hasNewLines = fromLine < transcript.lineCount;
      let newMessages: Array<{ role: string; text: string }> = [];

      if (hasNewLines) {
        const parsed = parseTranscript(transcript.path, fromLine);
        newMessages = parsed.messages;

        if (newMessages.length > 0) {
          const { decisions, lessons } = extractor(newMessages);

          for (const d of decisions) {
            await mem.vault.append(agentId, "decisions", d, ["autoextract", "transcript"]);
            result.decisionsExtracted++;
          }

          for (const l of lessons) {
            await mem.vault.append(agentId, "lessons", l, ["autoextract", "transcript"]);
            result.lessonsExtracted++;
          }
        }
      }

      const shouldHandoff = isSessionIdle(transcript, idleMs) && !(prev?.handoffGenerated);
      if (shouldHandoff) {
        const fullParsed = parseTranscript(transcript.path);
        if (fullParsed.messages.length >= 2) {
          const last6 = fullParsed.messages.slice(-6);
          const handoffText = generateHandoffText(last6);
          await mem.vault.append(agentId, "handoffs", handoffText, ["autohandoff", "transcript"]);
          result.handoffsGenerated++;
        }
      }

      state[transcript.id] = {
        lastLine: transcript.lineCount,
        lastProcessedAt: Date.now(),
        handoffGenerated: prev?.handoffGenerated || shouldHandoff,
      };

      if (hasNewLines || shouldHandoff) result.transcriptsProcessed++;
    } catch (e) {
      result.errors.push({
        transcriptId: transcript.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  saveState(mem.config.dir, state);
  return result;
}
