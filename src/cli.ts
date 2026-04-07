#!/usr/bin/env node
/**
 * CLI for @inosx/agent-memory — manage vault, search, project context, injection preview, compaction.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";
import { Command } from "commander";
import { createMemory } from "./index.js";
import { DEFAULT_CATEGORIES } from "./types.js";
import { startViewer } from "./viewer.js";
import { syncCheckpointsFromConversations } from "./sync-checkpoints.js";
import { processTranscripts } from "./process-transcripts.js";
import { findTranscriptsDir } from "./transcript-parser.js";
import { startWatcher } from "./watcher.js";
import type { AgentMemory } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readPackageVersion(): string {
  const pkgPath = path.join(__dirname, "..", "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version: string };
  return pkg.version;
}

function getRootCommand(cmd: Command): Command {
  let root: Command = cmd;
  while (root.parent) root = root.parent;
  return root;
}

type CommandWithOpts = Command & {
  optsWithGlobals?: () => Record<string, unknown>;
  opts?: () => Record<string, unknown>;
};

/** Commander v14 passes `{}` as the last `cmd` arg for nested subcommands; use the action's `this` instead. */
function getGlobalOpts(cmd: Command): { dir: string; json: boolean } {
  const c = cmd as CommandWithOpts;
  const merged =
    typeof c.optsWithGlobals === "function"
      ? c.optsWithGlobals()
      : typeof c.opts === "function"
        ? (c.opts() as Record<string, unknown>)
        : typeof (getRootCommand(cmd) as CommandWithOpts).opts === "function"
          ? ((getRootCommand(cmd) as CommandWithOpts).opts!() as Record<string, unknown>)
          : {};
  const opts = merged as { dir?: string; json?: boolean };
  const fromEnv = process.env.AGENT_MEMORY_DIR;
  const raw = fromEnv ?? opts.dir ?? ".memory";
  return {
    dir: path.resolve(process.cwd(), raw),
    json: !!opts.json,
  };
}

function createMem(cmd: Command): AgentMemory {
  const { dir } = getGlobalOpts(cmd);
  return createMemory({ dir });
}

function isValidCategory(cat: string): boolean {
  return (DEFAULT_CATEGORIES as readonly string[]).includes(cat);
}

function assertCategory(cat: string): void {
  if (!isValidCategory(cat)) {
    throw new Error(`Invalid category "${cat}". Use one of: ${DEFAULT_CATEGORIES.join(", ")}`);
  }
}

function outError(cmd: Command, message: string, code = 1): never {
  if (getGlobalOpts(cmd).json) {
    console.log(JSON.stringify({ error: message }));
  } else {
    console.error(message);
  }
  process.exit(code);
}

function snippet(text: string, max = 120): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8").trim();
}

async function resolveBody(opts: { content?: string; file?: string }): Promise<string> {
  if (opts.content !== undefined && opts.content !== "") return opts.content;
  if (opts.file) {
    return fs.readFileSync(path.resolve(opts.file), "utf-8");
  }
  const stdin = await readStdin();
  if (stdin) return stdin;
  throw new Error("Provide --content, --file, or pipe content on stdin.");
}

function projectFilePath(mem: AgentMemory): string {
  return path.join(mem.config.dir, mem.config.projectContextFile);
}

function confirmDelete(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("agent-memory")
    .description("Manage agent memory vault (BM25, markdown files under --dir).")
    .version(readPackageVersion())
    .option("--dir <path>", "Memory directory (default: .memory, or AGENT_MEMORY_DIR)", ".memory")
    .option("--json", "Print machine-readable JSON where applicable");

  program
    .command("agents")
    .description("List agent IDs that have a vault directory")
    .action(async function (this: Command) {
      const cmd = this;
      try {
        const mem = createMem(cmd);
        const agents = await mem.vault.listAgents();
        if (getGlobalOpts(cmd).json) {
          console.log(JSON.stringify({ agents }));
        } else {
          if (agents.length === 0) console.log("(no agents)");
          else agents.forEach((a) => console.log(a));
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        outError(cmd, msg);
      }
    });

  program
    .command("project")
    .description("Shared project context file (_project.md)")
    .addCommand(
      new Command("show")
        .description("Print project context file contents")
        .action(async function (this: Command) {
          const cmd = this;
          try {
            const mem = createMem(cmd);
            const p = projectFilePath(mem);
            if (!fs.existsSync(p)) {
              if (getGlobalOpts(cmd).json) {
                console.log(JSON.stringify({ path: p, content: "", exists: false }));
              } else {
                console.log("(file does not exist)");
              }
              return;
            }
            const content = fs.readFileSync(p, "utf-8");
            if (getGlobalOpts(cmd).json) {
              console.log(JSON.stringify({ path: p, content, exists: true }));
            } else {
              process.stdout.write(content);
              if (!content.endsWith("\n")) console.log("");
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            outError(cmd, msg);
          }
        }),
    )
    .addCommand(
      new Command("edit")
        .description("Open project context in $EDITOR (or notepad on Windows)")
        .action(async function (this: Command) {
          const cmd = this;
          try {
            const mem = createMem(cmd);
            const p = projectFilePath(mem);
            const dir = path.dirname(p);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            if (!fs.existsSync(p)) fs.writeFileSync(p, "", "utf-8");

            const editor =
              process.env.EDITOR ||
              process.env.VISUAL ||
              (process.platform === "win32" ? "notepad" : "vi");
            const r = spawnSync(editor, [p], { stdio: "inherit", shell: process.platform === "win32" });
            if (r.error) throw r.error;
            if (r.status !== 0 && r.status !== null) {
              process.exit(r.status ?? 1);
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            outError(cmd, msg);
          }
        }),
    );

  const vault = new Command("vault").description("Read and edit vault entries");

  vault
    .command("list")
    .description("List entries in a category")
    .argument("<agentId>", "Agent id")
    .argument("<category>", "Vault category")
    .action(async function (this: Command, agentId: string, category: string) {
      const cmd = this;
      try {
        assertCategory(category);
        const mem = createMem(cmd);
        const entries = await mem.vault.read(agentId, category);
        if (getGlobalOpts(cmd).json) {
          console.log(
            JSON.stringify({
              agentId,
              category,
              entries: entries.map((e) => ({
                id: e.id,
                date: e.date,
                tags: e.tags,
                snippet: snippet(e.content),
              })),
            }),
          );
        } else {
          if (entries.length === 0) {
            console.log("(empty)");
            return;
          }
          for (const e of entries) {
            console.log(`${e.id}\t${e.date}\t${snippet(e.content)}`);
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        outError(cmd, msg);
      }
    });

  vault
    .command("get")
    .description("Print one entry by id")
    .argument("<agentId>", "Agent id")
    .argument("<category>", "Vault category")
    .argument("<id>", "Entry id")
    .action(async function (this: Command, agentId: string, category: string, id: string) {
      const cmd = this;
      try {
        assertCategory(category);
        const mem = createMem(cmd);
        const entries = await mem.vault.read(agentId, category);
        const entry = entries.find((e) => e.id === id);
        if (!entry) outError(cmd, `No entry with id ${id}`, 2);
        if (getGlobalOpts(cmd).json) {
          console.log(JSON.stringify(entry));
        } else {
          console.log(entry.content);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        outError(cmd, msg);
      }
    });

  vault
    .command("add")
    .description("Append a new entry")
    .argument("<agentId>", "Agent id")
    .argument("<category>", "Vault category")
    .option("-c, --content <text>", "Entry body")
    .option("-f, --file <path>", "Read body from file")
    .option("-t, --tags <list>", "Comma-separated tags (optional)")
    .action(async function (
      this: Command,
      agentId: string,
      category: string,
      opts: { content?: string; file?: string; tags?: string },
    ) {
      const cmd = this;
      try {
        assertCategory(category);
        const mem = createMem(cmd);
        const body = await resolveBody(opts);
        const tags = opts.tags
          ? opts.tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : undefined;
        const entry = await mem.vault.append(agentId, category, body, tags);
        if (getGlobalOpts(cmd).json) {
          console.log(JSON.stringify(entry));
        } else {
          console.log(entry.id);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        outError(cmd, msg);
      }
    });

  vault
    .command("edit")
    .description("Replace entry body by id")
    .argument("<agentId>", "Agent id")
    .argument("<category>", "Vault category")
    .argument("<id>", "Entry id")
    .option("-c, --content <text>", "New body")
    .option("-f, --file <path>", "Read new body from file")
    .action(async function (
      this: Command,
      agentId: string,
      category: string,
      id: string,
      opts: { content?: string; file?: string },
    ) {
      const cmd = this;
      try {
        assertCategory(category);
        const mem = createMem(cmd);
        const body = await resolveBody(opts);
        await mem.vault.update(agentId, category, id, body);
        if (getGlobalOpts(cmd).json) {
          console.log(JSON.stringify({ ok: true, agentId, category, id }));
        } else {
          console.log("Updated.");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        outError(cmd, msg);
      }
    });

  vault
    .command("delete")
    .description("Remove an entry by id")
    .argument("<agentId>", "Agent id")
    .argument("<category>", "Vault category")
    .argument("<id>", "Entry id")
    .option("--force", "Skip confirmation (required in non-interactive mode)")
    .action(async function (
      this: Command,
      agentId: string,
      category: string,
      id: string,
      opts: { force?: boolean },
    ) {
      const cmd = this;
      try {
        assertCategory(category);
        const mem = createMem(cmd);
        const entries = await mem.vault.read(agentId, category);
        if (!entries.find((e) => e.id === id)) {
          outError(cmd, `No entry with id ${id}`, 2);
        }
        if (!opts.force) {
          if (process.stdin.isTTY) {
            const ok = await confirmDelete(`Delete entry ${id}? [y/N] `);
            if (!ok) {
              console.log("Cancelled.");
              return;
            }
          } else {
            outError(cmd, "Non-interactive delete requires --force", 2);
          }
        }
        await mem.vault.remove(agentId, category, id);
        if (getGlobalOpts(cmd).json) {
          console.log(JSON.stringify({ ok: true, agentId, category, id }));
        } else {
          console.log("Deleted.");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        outError(cmd, msg);
      }
    });

  program.addCommand(vault);

  program
    .command("search")
    .description("BM25 search across the vault")
    .argument("<query>", "Search query")
    .option("-a, --agent <agentId>", "Limit to one agent")
    .option("-c, --category <name>", "Limit to category")
    .option("-l, --limit <n>", "Max results", "10")
    .action(async function (this: Command, query: string, opts: { agent?: string; category?: string; limit?: string }) {
      const cmd = this;
      try {
        if (opts.category) assertCategory(opts.category);
        const mem = createMem(cmd);
        const limit = Math.min(100, Math.max(1, parseInt(opts.limit ?? "10", 10) || 10));
        const results = await mem.search.search(query, {
          agentId: opts.agent,
          category: opts.category,
          limit,
        });
        if (getGlobalOpts(cmd).json) {
          console.log(
            JSON.stringify({
              query,
              results: results.map((r) => ({
                id: r.entry.id,
                agentId: r.entry.agentId,
                category: r.entry.category,
                date: r.entry.date,
                score: r.score,
                snippet: r.snippet,
                content: r.entry.content,
              })),
            }),
          );
        } else {
          if (results.length === 0) {
            console.log("(no results)");
            return;
          }
          for (const r of results) {
            console.log(
              `[${r.entry.agentId}/${r.entry.category}] ${r.entry.id} score=${r.score.toFixed(3)}\n  ${r.snippet}\n`,
            );
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        outError(cmd, msg);
      }
    });

  const inject = new Command("inject").description("Preview injected memory context");

  inject
    .command("preview")
    .description("Show the MEMORY CONTEXT block for an agent and command")
    .argument("<agentId>", "Agent id")
    .argument("[command...]", "Command / prompt fragment")
    .action(async function (this: Command, agentId: string, commandParts: string[]) {
      const cmd = this;
      try {
        const mem = createMem(cmd);
        const command = commandParts.join(" ").trim() || "(empty)";
        const ctx = await mem.inject.buildContext(agentId, command);
        const block = mem.inject.buildTextBlock(ctx);
        if (getGlobalOpts(cmd).json) {
          console.log(JSON.stringify({ agentId, command, context: ctx, block }));
        } else {
          process.stdout.write(block);
          if (!block.endsWith("\n")) console.log("");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        outError(cmd, msg);
      }
    });

  program.addCommand(inject);

  program
    .command("sync-checkpoints")
    .description(
      "Write session checkpoints from conversations/*.json when newer than .vault/checkpoints (or missing)",
    )
    .option("--force", "Write checkpoints even when existing checkpoint is newer or same timestamp")
    .action(async function (this: Command, opts: { force?: boolean }) {
      const cmd = this;
      try {
        const mem = createMem(cmd);
        const result = await syncCheckpointsFromConversations(mem, { force: !!opts.force });
        if (getGlobalOpts(cmd).json) {
          console.log(JSON.stringify(result));
        } else {
          if (result.synced.length) console.log(`Synced: ${result.synced.join(", ")}`);
          if (result.skipped.length) console.log(`Skipped (checkpoint up to date): ${result.skipped.join(", ")}`);
          if (result.errors.length) {
            for (const e of result.errors) console.error(`${e.agentId}: ${e.error}`);
          }
          if (!result.synced.length && !result.skipped.length && !result.errors.length) {
            console.log("(no conversation JSON files under conversations/)");
          }
        }
        if (result.errors.length) process.exit(1);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        outError(cmd, msg);
      }
    });

  program
    .command("compact")
    .description("Run full compaction (checkpoints, conversations, vault cap, index rebuild)")
    .action(async function (this: Command) {
      const cmd = this;
      try {
        const mem = createMem(cmd);
        const result = await mem.compact.run();
        if (getGlobalOpts(cmd).json) {
          console.log(JSON.stringify(result));
        } else {
          console.log(`Checkpoints cleaned: ${result.checkpointsCleaned}`);
          console.log(`Conversations trimmed: ${result.conversationsTrimmed}`);
          console.log(`Vault entries merged: ${result.vaultEntriesMerged}`);
          console.log(`Index rebuilt: ${result.indexRebuilt}`);
          console.log(`Legacy files cleaned: ${result.legacyFilesCleaned}`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        outError(cmd, msg);
      }
    });

  program
    .command("migrate")
    .description("Migrate flat per-agent .md files into vault directories")
    .action(async function (this: Command) {
      const cmd = this;
      try {
        const mem = createMem(cmd);
        const result = await mem.migrate.migrateAll();
        if (getGlobalOpts(cmd).json) {
          console.log(JSON.stringify(result));
        } else {
          console.log(`Migrated: ${result.migrated.length ? result.migrated.join(", ") : "(none)"}`);
          console.log(`Skipped: ${result.skipped.length ? result.skipped.join(", ") : "(none)"}`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        outError(cmd, msg);
      }
    });

  program
    .command("watch")
    .description("Watch Cursor transcripts and automatically extract insights + handoffs")
    .option("-a, --agent <id>", "Agent ID for saved entries", "default")
    .option("--idle-timeout <seconds>", "Seconds of inactivity to consider session ended", "180")
    .option("--debounce <seconds>", "Seconds to wait after file change before processing", "30")
    .option("--transcripts-dir <path>", "Custom transcripts directory (bypass auto-discovery)")
    .option(
      "--wait-for-transcripts",
      "Poll until Cursor transcripts directory exists (recommended with automatic folder-open tasks)",
    )
    .option("-q, --quiet", "Suppress output")
    .action(async function (
      this: Command,
      opts: {
        agent?: string;
        idleTimeout?: string;
        debounce?: string;
        transcriptsDir?: string;
        quiet?: boolean;
        waitForTranscripts?: boolean;
      },
    ) {
      const cmd = this;
      try {
        const mem = createMem(cmd);
        const quiet = !!opts.quiet;
        const cwd = process.cwd();
        if (opts.waitForTranscripts && !opts.transcriptsDir) {
          const pollSec = 15;
          while (!findTranscriptsDir(cwd)) {
            if (!quiet) {
              console.log(
                `[agent-memory watch] Waiting for Cursor transcripts directory (poll every ${pollSec}s). Open a chat in this workspace in Cursor.`,
              );
            }
            await new Promise((r) => setTimeout(r, pollSec * 1000));
          }
        }
        const handle = startWatcher(mem, {
          agentId: opts.agent ?? "default",
          idleTimeoutSec: Math.max(10, parseInt(opts.idleTimeout ?? "180", 10) || 180),
          debounceSec: Math.max(1, parseInt(opts.debounce ?? "30", 10) || 30),
          transcriptsDir: opts.transcriptsDir,
          workspaceDir: cwd,
          quiet,
        });

        const shutdown = () => {
          handle.stop();
          process.exit(0);
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        outError(cmd, msg);
      }
    });

  program
    .command("process")
    .description("One-shot: process all unprocessed Cursor transcripts (extract insights + handoffs)")
    .option("-a, --agent <id>", "Agent ID for saved entries", "default")
    .option("--threshold <minutes>", "Minutes of inactivity to consider session ended", "5")
    .option("--transcripts-dir <path>", "Custom transcripts directory (bypass auto-discovery)")
    .action(async function (this: Command, opts: { agent?: string; threshold?: string; transcriptsDir?: string }) {
      const cmd = this;
      try {
        const mem = createMem(cmd);
        const result = await processTranscripts(mem, {
          agentId: opts.agent ?? "default",
          idleThresholdMinutes: Math.max(1, parseInt(opts.threshold ?? "5", 10) || 5),
          transcriptsDir: opts.transcriptsDir,
        });
        if (getGlobalOpts(cmd).json) {
          console.log(JSON.stringify(result));
        } else {
          console.log(`Transcripts processed: ${result.transcriptsProcessed}`);
          console.log(`Decisions extracted: ${result.decisionsExtracted}`);
          console.log(`Lessons extracted: ${result.lessonsExtracted}`);
          console.log(`Handoffs generated: ${result.handoffsGenerated}`);
          if (result.errors.length > 0) {
            for (const e of result.errors) console.error(`  ${e.transcriptId}: ${e.error}`);
          }
        }
        if (result.errors.length > 0) process.exit(1);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        outError(cmd, msg);
      }
    });

  program
    .command("viewer")
    .description("Launch the standalone web-based memory dashboard")
    .option("-p, --port <n>", "HTTP server port", "3737")
    .option("--no-open", "Don't auto-open the browser")
    .action(function (this: Command, opts: { port?: string; open?: boolean }) {
      const cmd = this;
      const mem = createMem(cmd);
      const port = Math.max(1, parseInt(opts.port ?? "3737", 10) || 3737);
      startViewer({ mem, port, open: opts.open !== false });
    });

  await program.parseAsync(process.argv);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
