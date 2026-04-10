# Agent Memory Viewer — Guide

The **Agent Memory Viewer** is a built-in web dashboard for browsing, searching, and managing agent memory visually. It ships as part of the `@inosx/agent-memory` package — no extra dependencies required.

## Quick Start

```bash
# Launch the viewer (auto-opens browser on port 3737)
agent-memory viewer

# Or via npx
npx @inosx/agent-memory viewer
```

The viewer reads from the same `.memory/` directory used by the library and CLI.

**Related:**
- To refresh session checkpoints from `conversations/*.json` without a dashboard timer, run `agent-memory sync-checkpoints` (see [README](../README.md) and [user-guide.md](user-guide.md)).
- **Cursor / VS Code:** after `npm install @inosx/agent-memory`, a **folder-open task** runs **`watch --wait-for-transcripts`** automatically (see [README — Postinstall automation](../README.md#postinstall-automation-cursor-rules-and-vs-code-tasks)). Run **`agent-memory process`** yourself for a one-shot backlog pass.
- Entries created by transcript automation appear in the viewer with `autoextract` / `autohandoff` and `transcript` tags.

## CLI Options

```bash
agent-memory [global-options] viewer [viewer-options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--port <n>` | HTTP server port | `3737` |
| `--no-open` | Don't auto-open the browser | opens by default |
| `--dir <path>` (global) | Memory directory path | `.memory` |

### Examples

```bash
# Default usage
agent-memory viewer

# Custom port
agent-memory viewer --port 4000

# Custom memory directory, headless
agent-memory --dir /path/to/project/.memory viewer --no-open

# With environment variable
AGENT_MEMORY_DIR=/srv/project/.memory agent-memory viewer
```

## Features

### Agent Browser

The left sidebar lists all agents that have a vault directory under `.memory/`. Agents are sorted alphabetically and can be filtered using the search box at the top.

Agent names are derived from their directory names by converting kebab-case to Title Case (e.g., `bmad-master` → `BMad Master`).

### Category Navigation

Below the agent list, five vault categories are shown with entry counts:

| Category | Color | Purpose |
|----------|-------|---------|
| **decisions** | Green | Technical decisions taken during sessions |
| **lessons** | Yellow | Lessons learned and mistakes to avoid |
| **tasks** | Orange | Pending or in-progress tasks |
| **projects** | Purple | Project-level notes and context |
| **handoffs** | Cyan | Session summaries for continuity |

Click a category to view its entries for the selected agent.

### Entry Management

Each entry displays:
- **Date** — When the entry was created
- **Tags** — Colored labels (if any)
- **Content** — The full markdown content

Available actions per entry:
- **Edit** — Inline editing with save/cancel
- **Delete** — With confirmation dialog

Use the **+ New entry** button to create entries directly from the UI. New entries support content text and comma-separated tags.

### BM25 Search

The search bar in the top-right performs full-text BM25 search across **all agents and categories**. Results show:
- The entry content
- Origin indicator (agent · category) in purple
- Relevance-ranked ordering

Search is debounced (350ms) for a responsive experience.

### Project Context

Click the **_project.md** button to view the shared project context file in a modal overlay. This is the same file injected into every agent session via `buildContext()`.

### Compaction

Click the **Compact** button to run a full maintenance cycle:
- Clean expired session checkpoints
- Trim old conversation messages
- Cap vault entries per category
- Rebuild the search index

A toast notification shows the results.

### Stats

The header bar shows real-time stats:
- Total number of agents with vault data
- Total number of vault entries across all agents

## Architecture

The viewer is a single-file HTTP server with inline HTML, CSS, and JavaScript. No build step, no frontend framework, no extra dependencies.

```
┌──────────────────────────────────────────┐
│  Browser (SPA)                           │
│  ├── Vanilla JS + CSS                    │
│  ├── Fetch API → /api/*                  │
│  └── Responsive dark-theme UI            │
├──────────────────────────────────────────┤
│  Node.js HTTP Server (viewer.ts)         │
│  ├── GET  /           → inline HTML      │
│  ├── GET  /api/agents → vault.listAgents │
│  ├── GET  /api/vault  → vault.read       │
│  ├── POST /api/vault  → vault.append     │
│  ├── PUT  /api/vault  → vault.update     │
│  ├── DEL  /api/vault  → vault.remove     │
│  ├── GET  /api/counts → getCategoryCounts│
│  ├── GET  /api/search → search.search    │
│  ├── GET  /api/project→ read _project.md │
│  ├── POST /api/compact→ compact.run      │
│  └── GET  /api/stats  → aggregate counts │
├──────────────────────────────────────────┤
│  @inosx/agent-memory (createMemory)      │
│  └── .memory/ directory (filesystem)     │
└──────────────────────────────────────────┘
```

## API Endpoints

All endpoints return JSON. The viewer uses these internally, but they're available for scripting too.

| Method | Endpoint | Parameters | Description |
|--------|----------|------------|-------------|
| GET | `/api/agents` | — | List all agent IDs |
| GET | `/api/vault` | `agent`, `category` | Read entries |
| POST | `/api/vault` | `{ agent, category, content, tags? }` | Create entry |
| PUT | `/api/vault` | `{ agent, category, id, content }` | Update entry |
| DELETE | `/api/vault` | `{ agent, category, id }` | Delete entry |
| GET | `/api/counts` | `agent` | Category counts for agent |
| GET | `/api/search` | `q`, `limit?` | BM25 search |
| GET | `/api/project` | — | Read `_project.md` |
| POST | `/api/compact` | — | Run compaction |
| GET | `/api/stats` | — | Aggregate stats |

### Using the API with curl

```bash
# List agents
curl http://localhost:3737/api/agents

# Get decisions for an agent
curl "http://localhost:3737/api/vault?agent=bmad-master&category=decisions"

# Search
curl "http://localhost:3737/api/search?q=authentication&limit=10"

# Add an entry
curl -X POST http://localhost:3737/api/vault \
  -H "Content-Type: application/json" \
  -d '{"agent":"my-agent","category":"decisions","content":"Use JWT for auth","tags":["auth","security"]}'

# Run compaction
curl -X POST http://localhost:3737/api/compact
```

## Integration with npm Scripts

Add to your project's `package.json`:

```json
{
  "scripts": {
    "memory:viewer": "agent-memory viewer"
  }
}
```

Then: `npm run memory:viewer`

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Escape` | Close modal overlay |

## Troubleshooting

### Port already in use

```
Error: listen EADDRINUSE: address already in use :::3737
```

Use a different port: `agent-memory viewer --port 4000`

Or kill the process using the port:
```bash
lsof -ti :3737 | xargs kill
```

### No agents shown

The viewer lists directories under `.memory/` that contain vault files. If no agents appear:
1. Check that `--dir` points to the correct memory directory
2. Verify agents have been created: `agent-memory agents`
3. Create a test entry: `agent-memory vault add test-agent decisions --content "test"`

### Fonts not loading

The viewer loads JetBrains Mono and Inter from Google Fonts. If running offline, the UI falls back to system monospace and sans-serif fonts gracefully.
