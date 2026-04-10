#!/usr/bin/env node
/**
 * End-to-end smoke: fs.watch on real Cursor transcripts dir, append JSONL,
 * expect a new vault decision containing MARKER after debounce.
 *
 * Run from repo root after build: node scripts/real-watcher-smoke.mjs
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createMemory } from "../dist/index.js";
import { startWatcher } from "../dist/watcher.js";
import { findTranscriptsDir } from "../dist/transcript-parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const MARKER = "watcher-e2e-smoke-verify-2026";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function line(role, text) {
  return JSON.stringify({
    role,
    message: { content: [{ type: "text", text }] },
  });
}

async function main() {
  const tDir = findTranscriptsDir(repoRoot);
  if (!tDir) {
    console.error(
      "No Cursor transcripts directory for this workspace. Open the repo in Cursor at least once.",
    );
    process.exit(1);
  }

  const id = crypto.randomUUID();
  const sessionDir = path.join(tDir, id);
  const jsonlPath = path.join(sessionDir, `${id}.jsonl`);
  fs.mkdirSync(sessionDir, { recursive: true });

  const seed =
    [
      line("user", "test user ping for watcher e2e smoke"),
      line("assistant", "acknowledged — seed lines only, no decision patterns here."),
    ].join("\n") + "\n";
  fs.writeFileSync(jsonlPath, seed, "utf-8");

  const mem = createMemory({ dir: path.join(repoRoot, ".memory") });
  const before = await mem.vault.read("default", "decisions");
  const beforeMarker = before.filter((e) => e.content.includes(MARKER)).length;

  const handle = startWatcher(mem, {
    debounceSec: 2,
    idleTimeoutSec: 7200,
    workspaceDir: repoRoot,
    quiet: false,
  });

  console.log(`[smoke] Transcripts: ${tDir}`);
  console.log(`[smoke] Session ${id} — waiting for startup debounce on seed...`);
  await sleep(3500);

  fs.appendFileSync(
    jsonlPath,
    line(
      "assistant",
      `We decided to use marker ${MARKER} so the automated watcher smoke test can find this entry reliably.`,
    ) + "\n",
    "utf-8",
  );
  console.log("[smoke] Appended assistant line with decision pattern; waiting process...");

  await sleep(6000);
  await mem.vault.writeQueue;

  const after = await mem.vault.read("default", "decisions");
  const afterMarker = after.filter((e) => e.content.includes(MARKER)).length;

  handle.stop();

  try {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  } catch (e) {
    console.warn("[smoke] Could not remove test session dir:", e?.message ?? e);
  }

  if (afterMarker > beforeMarker) {
    console.log("[smoke] PASS: new vault decision contains marker.");
    process.exit(0);
  }

  console.error("[smoke] FAIL: expected a new decision containing:", MARKER);
  console.error(`[smoke] decisions with marker: before=${beforeMarker} after=${afterMarker}`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
