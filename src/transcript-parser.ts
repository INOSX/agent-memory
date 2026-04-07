/**
 * Parse Cursor agent transcript JSONL files into ConversationMessage[].
 * Handles discovery of the Cursor transcripts directory and incremental reading.
 */
import fs from "fs";
import path from "path";
import os from "os";
import type { ConversationMessage } from "./types.js";

export interface TranscriptInfo {
  id: string;
  path: string;
  lineCount: number;
  lastModified: number;
}

export interface ParseResult {
  messages: ConversationMessage[];
  lineCount: number;
}

interface TranscriptLine {
  role: "user" | "assistant";
  message?: {
    content?: Array<{ type: string; text?: string; name?: string }>;
  };
}

/**
 * Derive the Cursor project slug from an absolute workspace path.
 * Cursor uses: replace every non-alphanumeric char with `-`, strip leading `-`.
 */
export function workspaceSlug(workspacePath: string): string {
  return workspacePath.replace(/[^a-zA-Z0-9]/g, "-").replace(/^-+/, "");
}

/**
 * Find the Cursor transcripts directory for a given workspace path.
 * Returns null if the directory doesn't exist.
 */
export function findTranscriptsDir(workspaceDir: string): string | null {
  const resolved = path.resolve(workspaceDir);
  const slug = workspaceSlug(resolved);
  const cursorDir = path.join(os.homedir(), ".cursor", "projects", slug, "agent-transcripts");

  if (fs.existsSync(cursorDir)) return cursorDir;

  // Fallback: scan ~/.cursor/projects/ for a directory ending with the basename
  const projectsRoot = path.join(os.homedir(), ".cursor", "projects");
  if (!fs.existsSync(projectsRoot)) return null;

  const baseName = path.basename(resolved);
  try {
    for (const dir of fs.readdirSync(projectsRoot)) {
      if (!dir.endsWith(baseName)) continue;
      const candidate = path.join(projectsRoot, dir, "agent-transcripts");
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {
    /* ignore */
  }

  return null;
}

/**
 * List all transcript sessions in a transcripts directory.
 * Each transcript is a subdirectory containing a .jsonl file with the same UUID name.
 */
export function listTranscripts(transcriptsDir: string): TranscriptInfo[] {
  if (!fs.existsSync(transcriptsDir)) return [];

  const results: TranscriptInfo[] = [];

  for (const entry of fs.readdirSync(transcriptsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const jsonlPath = path.join(transcriptsDir, entry.name, `${entry.name}.jsonl`);
    if (!fs.existsSync(jsonlPath)) continue;

    try {
      const stat = fs.statSync(jsonlPath);
      const content = fs.readFileSync(jsonlPath, "utf-8");
      const lineCount = content.split("\n").filter((l) => l.trim().length > 0).length;

      results.push({
        id: entry.name,
        path: jsonlPath,
        lineCount,
        lastModified: stat.mtimeMs,
      });
    } catch {
      /* skip unreadable files */
    }
  }

  return results.sort((a, b) => b.lastModified - a.lastModified);
}

function extractText(line: TranscriptLine): string {
  const blocks = line.message?.content;
  if (!Array.isArray(blocks)) return "";

  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === "text" && typeof block.text === "string") {
      // Strip Cursor system wrappers like <user_query>...</user_query>
      let text = block.text;
      const queryMatch = text.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/);
      if (queryMatch) text = queryMatch[1];
      parts.push(text.trim());
    }
  }
  return parts.join("\n").trim();
}

/**
 * Parse a Cursor transcript JSONL file into ConversationMessage[].
 * Supports incremental reading via `fromLine` (0-based).
 */
export function parseTranscript(filePath: string, fromLine = 0): ParseResult {
  if (!fs.existsSync(filePath)) return { messages: [], lineCount: 0 };

  const content = fs.readFileSync(filePath, "utf-8");
  const rawLines = content.split("\n").filter((l) => l.trim().length > 0);
  const messages: ConversationMessage[] = [];

  for (let i = fromLine; i < rawLines.length; i++) {
    try {
      const parsed = JSON.parse(rawLines[i]) as TranscriptLine;
      const role = parsed.role;
      if (role !== "user" && role !== "assistant") continue;

      const text = extractText(parsed);
      if (!text) continue;

      messages.push({
        role: role === "assistant" ? "agent" : "user",
        text,
      });
    } catch {
      /* skip malformed lines */
    }
  }

  return { messages, lineCount: rawLines.length };
}
