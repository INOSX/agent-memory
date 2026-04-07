# @inosx/agent-memory

File-based memory system for AI agents. Gives your agents persistent memory using plain markdown files — no database required.

Built and battle-tested inside [AITEAM-X](https://github.com/INOSX/AITeam), extracted as a standalone framework.

![Architecture](docs/architecture.png)

## Features

- **Vault** — Categorized markdown persistence (decisions, lessons, tasks, projects, handoffs — or your own categories)
- **Search** — Full-text BM25 search with fuzzy matching via [MiniSearch](https://github.com/lucaong/minisearch)
- **Context injection** — Assemble relevant memory into prompts with automatic token budget trimming
- **Session checkpoints** — Save and recover agent sessions with automatic expiry
- **Compaction** — Extract insights from conversations, trim old messages, cap vault entries
- **Transcript automation** — Automatically process Cursor agent transcripts: extract decisions/lessons and generate handoffs without manual intervention
- **Migration** — One-way migration from flat markdown to structured vault format
- **CLI** — `agent-memory` command to list agents, manage vault entries, search, edit project context, preview injection, **sync checkpoints from conversation files**, **watch/process Cursor transcripts**, run compaction, and migrate
- **Viewer** — Built-in standalone web dashboard to browse agents, vault entries, search, and run compaction — zero extra dependencies
- **Cursor / VS Code** — `postinstall` installs rules into `.cursor/rules/` and merges **folder-open tasks** (transcript `process` + `watch`) into `.vscode/tasks.json`

## Install

```bash
npm install @inosx/agent-memory
```

The package exposes a `bin` named `agent-memory` (also available via `npx @inosx/agent-memory` after install).

### Postinstall automation (Cursor rules and VS Code tasks)

On `npm install`, a **lifecycle script**:

1. Copies every `.mdc` from the package into your project’s **`.cursor/rules/`** (creates folders if needed).
2. **Merges** VS Code/Cursor **`.vscode/tasks.json`** so that when you **open the workspace folder**, two tasks run automatically:
   - **`agent-memory: process transcript backlog`** — one-shot `npx agent-memory process`
   - **`agent-memory: watch transcripts`** — `npx agent-memory watch --wait-for-transcripts` (polls until Cursor’s transcript folder exists, then keeps running)
3. If `.vscode/settings.json` has no `task.allowAutomaticTasks`, it sets **`"task.allowAutomaticTasks": "on"`** so folder-open tasks are allowed (you may still see a one-time trust prompt in the editor).

No extra steps in normal setups: install the package, open the project in Cursor/VS Code, accept automatic tasks if prompted.

- **Disable rules only:** `AGENT_MEMORY_SKIP_CURSOR_RULE=1 npm install`
- **Disable VS Code task merge only:** `AGENT_MEMORY_SKIP_VSCODE_AUTOMATION=1 npm install`
- **Silent by default** — set `AGENT_MEMORY_VERBOSE=1` to print paths.
- **Skipped entirely** when: `CI=true`, global npm install, or while developing this repository (not installed from `node_modules`).
- **Publishing:** run `npm run sync:cursor-rule` after editing [`.cursor/rules/memory-five-layers.mdc`](.cursor/rules/memory-five-layers.mdc) so [`cursor-rules/`](cursor-rules/) matches before release (`prepublishOnly` runs this automatically).

**Environment variables (reference)**

| Variable | When | Effect |
|----------|------|--------|
| `AGENT_MEMORY_DIR` | Runtime (CLI / tasks) | Overrides `--dir` / default `.memory` root. |
| `AGENT_MEMORY_SKIP_CURSOR_RULE=1` | `npm install` | Do not copy `.mdc` files into `.cursor/rules/`. |
| `AGENT_MEMORY_SKIP_VSCODE_AUTOMATION=1` | `npm install` | Do not merge `.vscode/tasks.json` or touch `task.allowAutomaticTasks`. |
| `AGENT_MEMORY_VERBOSE=1` | `npm install` | Print postinstall paths and counts. |

This repository includes **`.vscode/tasks.json`** and **`.vscode/settings.json`** so contributors get the same folder-open behaviour without relying on postinstall inside the package source tree.

## CLI

Global options (place before the subcommand, e.g. `agent-memory --dir ./.memory agents`):

| Option | Description |
|--------|-------------|
| `--dir <path>` | Memory root directory (default: `.memory` relative to the current working directory) |
| `AGENT_MEMORY_DIR` | Environment variable override for the memory directory |
| `--json` | Machine-readable JSON output for scripts and automation |

### Commands

| Command | Description |
|---------|-------------|
| `agents` | List agent IDs (directories under the memory root) |
| `project show` | Print `_project.md` (JSON includes `exists: false` if missing) |
| `project edit` | Create or open `_project.md` in `$EDITOR` (or `notepad` on Windows) |
| `vault list <agentId> <category>` | List entries (id, date, snippet) |
| `vault get <agentId> <category> <id>` | Print full entry body |
| `vault add <agentId> <category>` | Append entry; body via `--content`, `--file`, or stdin |
| `vault edit <agentId> <category> <id>` | Replace body; body via `--content`, `--file`, or stdin |
| `vault delete <agentId> <category> <id>` | Remove entry; use `--force` in non-interactive scripts |
| `search <query>` | BM25 search (`--agent`, `--category`, `--limit`) |
| `inject preview <agentId> [command...]` | Print the same memory block as `buildTextBlock(buildContext(...))` |
| `sync-checkpoints` | Copy `conversations/*.json` → `.vault/checkpoints/` when newer (optional `--force`) |
| `watch` | Watch Cursor transcripts in real-time; auto-extract insights and generate handoffs (`--agent`, `--idle-timeout`, `--debounce`, `--wait-for-transcripts`, `--quiet`) |
| `process` | One-shot: process all unprocessed Cursor transcripts (`--agent`, `--threshold`) |
| `compact` | Run full compaction (checkpoints, conversations, vault cap, index rebuild) |
| `migrate` | Migrate flat `*.md` per agent into vault layout |
| `viewer` | Launch the standalone web dashboard (`--port`, `--no-open`) |

Categories for vault commands must be one of: `decisions`, `lessons`, `tasks`, `projects`, `handoffs`.

### Examples

```bash
# List agents using a custom memory directory
agent-memory --dir .memory agents

# Add a decision (tags optional)
agent-memory vault add bmad-master decisions --content "Adopt SSE for streaming" --tags sse,architecture

# Search and pipe JSON
agent-memory --json search "authentication" --agent bmad-master

# Preview what the agent would receive for a prompt
agent-memory inject preview bmad-master "fix the login flow"

# Align checkpoints with conversation JSON (e.g. Cursor / scripts; no dashboard required)
agent-memory sync-checkpoints

# Watch Cursor transcripts — auto-extract decisions/lessons and generate handoffs
agent-memory watch

# Wait until Cursor has created the transcripts folder (same as default folder-open task)
agent-memory watch --wait-for-transcripts

# One-shot: process all Cursor transcripts from past sessions
agent-memory process

# Maintenance
agent-memory compact

# Launch the web viewer dashboard
agent-memory viewer

# Custom port and memory directory
agent-memory --dir /path/to/.memory viewer --port 4000
```

## Quick Start

```typescript
import { createMemory } from "@inosx/agent-memory";

const mem = createMemory({ dir: ".memory" });

// Store a decision
await mem.vault.append("agent-1", "decisions", "Use PostgreSQL for the persistence layer");

// Search across all agents
const results = await mem.search.search("database");

// Build context for a prompt
const ctx = await mem.inject.buildContext("agent-1", "fix the migration bug");
const block = mem.inject.buildTextBlock(ctx);
// → markdown block with project context, relevant decisions, lessons, open tasks

// Save a session checkpoint
await mem.session.checkpoint("agent-1", messages, "chat-123");

// Recover a session (returns null if expired)
const checkpoint = await mem.session.recover("agent-1");

// Run maintenance (extract insights, trim conversations, cap entries)
const result = await mem.compact.run();

// Process Cursor transcripts (extract decisions/lessons, generate handoffs)
import { processTranscripts } from "@inosx/agent-memory";
const pr = await processTranscripts(mem, { agentId: "default" });

// Or watch transcripts in real-time
import { startWatcher } from "@inosx/agent-memory";
const handle = startWatcher(mem, { agentId: "default" });
// handle.stop() to terminate
```

## Configuration

All options are optional except `dir`:

```typescript
const mem = createMemory({
  // Required: path to the memory directory (absolute or relative)
  dir: ".memory",

  // Vault categories (default: decisions, lessons, tasks, projects, handoffs)
  categories: ["decisions", "lessons", "tasks", "projects", "handoffs", "custom"],

  // Max token budget for context injection (default: 2000)
  tokenBudget: 2000,

  // Shared project context filename inside dir (default: "_project.md")
  projectContextFile: "_project.md",

  // Checkpoint expiry in ms (default: 7 days)
  checkpointExpiry: 7 * 24 * 60 * 60 * 1000,

  // Custom insight extractor for compaction (default: built-in PT+EN patterns)
  insightExtractor: (messages) => {
    const decisions: string[] = [];
    const lessons: string[] = [];
    // your extraction logic here
    return { decisions, lessons };
  },

  // Compaction limits
  maxConversationMessages: 20,   // keep last N messages after trim
  maxVaultEntriesPerCategory: 30, // trigger compaction above this
  keepVaultEntries: 20,           // entries to keep after compaction
});
```

## API Reference

### `createMemory(config)` → `AgentMemory`

Creates a new memory instance. Returns an object with the following modules:

### `mem.vault`

| Method | Description |
|--------|-------------|
| `read(agentId, category)` | Read all entries from a category |
| `append(agentId, category, content, tags?)` | Add a new entry |
| `update(agentId, category, id, newContent)` | Update an existing entry |
| `remove(agentId, category, id)` | Delete an entry |
| `listAgents()` | List all agent IDs in the memory directory |
| `getCategoryCounts(agentId)` | Get entry count per category |

### `mem.search`

| Method | Description |
|--------|-------------|
| `search(query, options?)` | Full-text search with BM25 scoring. Options: `agentId`, `category`, `limit` |
| `buildIndex()` | Build or reload the search index |
| `updateIndex(entry)` | Add/update a single entry in the index |
| `removeFromIndex(id)` | Remove an entry from the index |

The search index auto-syncs with vault operations — manual index management is rarely needed.

### `mem.session`

| Method | Description |
|--------|-------------|
| `checkpoint(agentId, messages, chatId?, modelId?)` | Save a session checkpoint (keeps last 50 messages) |
| `recover(agentId)` | Load checkpoint if it exists and hasn't expired |
| `sleep(agentId, messages, summary)` | Save handoff + final checkpoint |

### `syncCheckpointsFromConversations`

| Export | Description |
|--------|-------------|
| `syncCheckpointsFromConversations(mem, { force? })` | Read `conversations/*.json` under `mem.config.dir` and call `session.checkpoint` when the conversation `savedAt` is newer than the checkpoint (or checkpoint missing). Skips messages with `internal: true`. |

Same behaviour as CLI `sync-checkpoints`.

### Transcript automation

| Export | Description |
|--------|-------------|
| `parseTranscript(filePath, fromLine?)` | Parse a Cursor `.jsonl` transcript into `ConversationMessage[]`. Supports incremental reading. |
| `findTranscriptsDir(workspaceDir)` | Discover the Cursor transcripts directory for a workspace (`~/.cursor/projects/<slug>/agent-transcripts/`). |
| `listTranscripts(transcriptsDir)` | List all transcript sessions with line counts and modification times. |
| `processTranscripts(mem, options?)` | One-shot: process all unprocessed transcripts — extract decisions/lessons, generate handoffs for idle sessions. |
| `startWatcher(mem, options?)` | Start a real-time file watcher on Cursor transcripts. Returns a `WatcherHandle` with `stop()`. |

The watcher monitors `~/.cursor/projects/<slug>/agent-transcripts/` using `fs.watch` (with polling fallback). It debounces file changes, extracts insights via the same PT+EN heuristic patterns used by compaction, and generates handoffs when a session goes idle. State is persisted in `.memory/.vault/processed-transcripts.json`.

### `mem.inject`

| Method | Description |
|--------|-------------|
| `buildContext(agentId, command, options?)` | Assemble memory context for a prompt |
| `buildTextBlock(ctx)` | Format `InjectContext` into a markdown block |
| `buildMemoryInstructions(agentId)` | Generate instructions for agents on where to save memories |

Context injection automatically:
- Loads shared project context (`_project.md`)
- Finds the latest handoff for the agent
- Searches for relevant decisions (top 3) and lessons (top 2) using BM25
- Collects open tasks (unchecked checkboxes)
- Checks for recoverable session checkpoints
- Trims to fit the token budget (cuts lessons first, then decisions, then handoff)

### `mem.compact`

| Method | Description |
|--------|-------------|
| `run()` | Full compaction cycle (cleanup, extract, trim, cap, rebuild index) |
| `getLastResult()` | Get the result of the last compaction run |
| `extractInsights(messages)` | Extract decisions/lessons from messages |

### `mem.migrate`

| Method | Description |
|--------|-------------|
| `migrateAll()` | Migrate flat markdown files to structured vault format |

## Storage Format

Memory is stored as plain markdown files:

```
.memory/
├── _project.md                  # Shared project context
├── agent-1/
│   ├── decisions.md             # Categorized entries
│   ├── lessons.md
│   ├── tasks.md
│   ├── projects.md
│   └── handoffs.md
├── conversations/
│   └── agent-1.json             # Conversation history
└── .vault/
    ├── checkpoints/
    │   └── agent-1.json             # Session checkpoint
    ├── index.json                   # Search index (auto-generated)
    ├── compact-log.json             # Last compaction result
    └── processed-transcripts.json   # Watcher/process state (auto-generated)
```

Each vault entry in the markdown files follows this format:

```markdown
<!-- id:1711234567890 -->
## 2026-03-23T14:32 · #postgresql #database

Use PostgreSQL for the persistence layer. Considered SQLite but need concurrent writes.

---
```

## Viewer

The package includes a built-in web dashboard for browsing and managing agent memory visually. No extra dependencies — it's a lightweight Node.js HTTP server with inline HTML/CSS/JS.

```bash
# Launch on default port 3737
agent-memory viewer

# Custom port, don't auto-open browser
agent-memory --dir .memory viewer --port 4000 --no-open
```

![Viewer](docs/viewer-screenshot.png)

**Features:**
- Browse all agents and their vault entries
- Navigate categories (decisions, lessons, tasks, projects, handoffs) with counts
- Full-text BM25 search across all agents
- Create, edit, and delete entries
- View shared project context (`_project.md`)
- Run compaction from the UI
- Filter agents by name
- Stats overview (total agents, total entries)

See [Viewer Guide](docs/viewer-guide.md) for details.

## Documentation

- [**User Guide**](docs/user-guide.md) — Package overview, installation (**postinstall**, `.vscode` tasks), core concepts, library and **CLI**, transcript automation, BMAD-style integration, troubleshooting
- [Documentation index](docs/README.md) — Table of contents for all docs (technical guides, comparison, viewer, integration prompt)
- [Memory System — Technical Reference](docs/memory-system.md) — Architecture overview, 5-layer design, data flow diagrams, transcript automation, API details, error handling patterns, and system constants
- [Memory System — Dashboard Guide](docs/memory-system-guide.md) — Using memory inside an AI agent dashboard (vault UI, session lifecycle, compaction, troubleshooting)
- [Memory System — Comparison](docs/memory-system-comparison.md) — ChatGPT, Claude, OpenClaw, ClawVault, AITeam, plus **§11 @inosx/agent-memory (npm)**
- [**Viewer Guide**](docs/viewer-guide.md) — Standalone web dashboard: usage, features, API endpoints, and customization

## Requirements

- Node.js >= 18
- Single dependency: [minisearch](https://www.npmjs.com/package/minisearch)

## License

MIT — [Mario Mayerle](https://inosx.com) / [INOSX](https://github.com/INOSX)
