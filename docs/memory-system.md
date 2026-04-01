# Persistent Memory System — @inosx/agent-memory

**Version:** 3.0
**Updated:** 2026-04-01
**Status:** Implemented and in production

---

## 1. Overview

The memory system solves the *context death* problem: with every new session, AI agents lose all accumulated knowledge. The solution is a five-layer complementary architecture that persists, structures, searches, injects, and compacts memory automatically.

```
┌──────────────────────────────────────────────────┐
│         Layer 5: Automatic Compaction             │
│  compact.ts cleans expired checkpoints,           │
│  trims conversations, consolidates vault & reindex│
├──────────────────────────────────────────────────┤
│         Layer 4: Context Injection                │
│  inject.ts assembles relevant memory              │
│  and injects it into new session prompts          │
├──────────────────────────────────────────────────┤
│         Layer 3: BM25 Search                      │
│  MiniSearch indexes the vault and retrieves       │
│  decisions/lessons relevant to the command        │
├──────────────────────────────────────────────────┤
│         Layer 2: Memory Vault                     │
│  Structured storage by agent and category         │
│  Markdown with ID frontmatter and tags            │
├──────────────────────────────────────────────────┤
│         Layer 1: Session Persistence              │
│  Chat sessions + conversation history             │
│  Checkpoints for recovery                         │
└──────────────────────────────────────────────────┘
```

### Simplified data flow

High-level loop: the **UI** writes **conversations**, **checkpoints**, and **handoffs**; **compaction** maintains size and feeds the **vault**; the **vault** and **index** feed **search** and **injection**, which produce the **enriched prompt** for the agent.

```mermaid
flowchart LR
    UI["Frontend\n(MainContent)"] -->|auto-save 30s| CONV["Conversations\n(.memory/conversations/)"]
    UI -->|checkpoint 30s| CP["Checkpoints\n(.vault/checkpoints/)"]
    UI -->|close agent| HO["Handoff\n(vault/handoffs.md)"]
    HO --> VAULT["Memory Vault\n(.memory/{agentId}/)"]
    COMPACT["Compaction\n(compact.ts)"] -->|heuristic extraction| VAULT
    COMPACT -->|trims| CONV
    COMPACT -->|cleans| CP
    VAULT --> SEARCH["BM25 Index\n(search.ts)"]
    SEARCH --> INJECT["Injection\n(inject.ts)"]
    VAULT --> INJECT
    INJECT -->|enriched prompt| AGENT["Agent CLI"]
```

### Expanded data flow

The diagram below splits the same system into **four planes**: what gets written at runtime, where it lives on disk, how maintenance reshapes data, and how read-time assembly builds the next prompt. Arrows show the *dominant* direction of data; some paths (e.g. `recover` reading checkpoints) are detailed in the list after the chart.

```mermaid
flowchart TB
    subgraph W["Write path (dashboard / host app)"]
        UI["UI: MainContent, timers, sendBeacon"]
        UI -->|"JSON autosave ~30s"| CONV[".memory/conversations/{agentId}.json"]
        UI -->|"checkpoint ~30s"| CP[".memory/.vault/checkpoints/{agentId}.json"]
        UI -->|"sleep / close bubble"| HO["append handoffs.md"]
        UI -->|"optional: direct vault edits"| VAULT
        HO --> VAULT["Per-agent vault: decisions, lessons, tasks, projects, handoffs"]
    end

    subgraph G["Global context"]
        PROJ["_project.md shared across agents"]
    end

    subgraph M["Layer 5 — Compaction (compact.ts)"]
        COMPACT["compact.run() steps A–E"]
        COMPACT -->|"Step B: extract + trim"| CONV
        COMPACT -->|"Step B: appendEntry tagged compacted"| VAULT
        COMPACT -->|"Step A: expiry"| CP
        COMPACT -->|"Step D"| IDX[".vault/index.json rebuild"]
        VAULT --> COMPACT
    end

    subgraph R["Layer 3–4 — Retrieval (search + inject)"]
        VAULT -->|"vault reads"| INJ["inject.buildContext"]
        PROJ --> INJ
        CP -->|"recover() if valid"| INJ
        IDX -->|"BM25 query"| SRCH["search.search"]
        SRCH --> INJ
        INJ -->|"buildTextBlock + token trim"| OUT["Prompt: MEMORY CONTEXT + command"]
    end

    OUT --> AGENT["Agent CLI / SSE stream"]
```

**Read-time assembly order (injection)** — `buildContext` composes sources in a fixed priority; trimming happens when the estimated token total exceeds the budget (`tokenBudget`, default 2 000):

| Stage | Source | Role |
|-------|--------|------|
| 1 | `_project.md` | Global project scope (always injected first) |
| 2 | Latest `handoffs` entry | “Last session” narrative |
| 3 | `search(command)` on `decisions` | Top 3 BM25 hits |
| 4 | `search(command)` on `lessons` | Top 2 BM25 hits |
| 5 | `tasks` with open `[ ]` | Full list of unchecked items |
| 6 | `recover(agentId)` | Up to last 3 messages if checkpoint exists and not expired |

**Trim when over budget:** lessons → decisions → handoff (handoff discarded last).

**Write-time side paths (not shown as separate nodes above):**

- Each `appendEntry` / `deleteEntry` on the vault triggers a **search index update** (`updateIndex` / `removeFromIndex`); failures are non-fatal and the next compaction rebuilds the index.
- **Vault writes** are serialized through a `writeQueue` so concurrent markdown updates do not corrupt files.
- **Compaction** is periodic (e.g. dashboard: ~10 min) or on demand (`POST /api/memory/compact` in the host app); it also caps vault entries per category and writes `compact-log.json`.

**Boundary:** anything that only uses the **library** (`createMemory`) without the dashboard still follows the same disk layout; the “UI” node is replaced by your host (CLI, API route, worker) calling `vault`, `session`, and `inject` explicitly.

---

## 2. Layer 1: Session Persistence

### Chat Sessions (`docs/chat-sessions.json`)

Maps `agentId` → `chatId` to allow resuming sessions with `--resume`.

```json
{ "bmad-master": "chat_abc123", "dev": "chat_def456" }
```

### Conversation History (`.memory/conversations/`)

Auto-saved every 30s via `setInterval` on the frontend and on `beforeunload` via `sendBeacon`.

```
.memory/conversations/
├── bmad-master.json
├── dev.json
└── tech-writer.json
```

Format of each file:

```json
{
  "agentId": "bmad-master",
  "savedAt": "2026-03-15T23:04:23.463Z",
  "messages": [
    { "role": "user", "text": "..." },
    { "role": "agent", "text": "..." }
  ]
}
```

### Checkpoints (`.memory/.vault/checkpoints/{agentId}.json`)

Automatically saved every 30s by the frontend for each agent with an open bubble. Also saved via `sendBeacon` when closing the browser. Valid for 7 days (`SEVEN_DAYS_MS = 7 * 24 * 3_600_000`). Expired checkpoints are automatically removed by Layer 5 (Compaction).

```json
{
  "agentId": "bmad-master",
  "savedAt": 1773679871839,
  "messages": [...],
  "chatId": "chat_abc123",
  "modelId": "claude-opus-4-6"
}
```

Each checkpoint stores the **last 50 messages** of the conversation.

### Session API (`lib/memory/session.ts`)

```typescript
checkpoint(agentId, messages, chatId?, modelId?)  // saves snapshot to .vault/checkpoints/
recover(agentId)                                   // reads checkpoint if < 7 days, null otherwise
sleep(agentId, messages, summary)                  // saves handoff to vault + checkpoint
```

**`recover` flow:**
- Valid checkpoint (< 7 days) → `InjectContext.recovering = true` → injected into prompt
- Expired or missing checkpoint → fresh session

---

## 3. Layer 2: Memory Vault

### File Structure

```
.memory/
├── _project.md                    # Global project context (injected into all agents)
├── {agentId}/                     # Directory per agent
│   ├── decisions.md               # Technical and architectural decisions
│   ├── lessons.md                 # Lessons learned and bugs fixed
│   ├── handoffs.md                # Session summaries (newest first)
│   ├── tasks.md                   # Open tasks (checkboxes [ ] / [x])
│   └── projects.md                # Per-agent project context
├── conversations/                 # Raw history (gitignored)
└── .vault/
    ├── index.json                 # Persisted BM25 index from MiniSearch
    ├── compact-log.json           # Last compaction result
    └── checkpoints/{agentId}.json # Session checkpoints
```

### Categories (`VaultCategory`)

| Category | Usage |
|----------|-------|
| `decisions` | Technical decisions made ("we decided to use SSE", "going with...") |
| `lessons` | Lessons learned, bugs fixed, insights ("we learned", "the problem was...") |
| `handoffs` | Session summary — generated by the frontend when closing the agent |
| `tasks` | Open tasks in `- [ ] description` format |
| `projects` | Project context (stack, architecture, goals) |

### Markdown Entry Format

```markdown
<!-- id:1773679871839 -->
## 2026-03-16T16:51 · #react #typescript #components

Memory content in free-form markdown.

---
```

- `id` is `Date.now()` ensuring uniqueness (with monotonic increment for collisions)
- Tags automatically extracted via `/#(\w+)/g` from content
- Entries sorted by `id` descending (newest first)
- Tags `#compacted` and `#auto-extract` indicate entries created by Layer 5 (compaction)

### Vault API (`lib/memory/vault.ts`)

```typescript
readCategory(agentId, category): Promise<VaultEntry[]>
appendEntry(agentId, category, content, tags?): Promise<VaultEntry>
updateEntry(agentId, category, id, content): Promise<void>
deleteEntry(agentId, category, id): Promise<void>
listAgents(): Promise<string[]>
getCategoryCounts(agentId): Promise<Record<VaultCategory, number>>
```

### Write Serialization

All vault writes are serialized via `writeQueue` (Promise chain). This prevents race conditions when multiple concurrent operations attempt to modify the same markdown file:

```typescript
export let writeQueue: Promise<void> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(fn);
  writeQueue = result.then(() => {}, () => {});
  return result;
}
```

Failures in one operation do not block the queue — the chain advances regardless.

### Search Index Updates

After each `appendEntry` and `deleteEntry`, the vault performs a `dynamic import("./search")` to update the BM25 index. Errors in this update are silenced — the index will be rebuilt at the next compaction.

---

## 4. Layer 3: BM25 Search (`lib/memory/search.ts`)

The MiniSearch index is built over all vault entries. Persisted to `.memory/.vault/index.json` to avoid rebuilding on every request.

### How it works

1. On first search: reads all vault files and builds the index
2. On subsequent searches: loads `index.json` from disk
3. When creating a new entry (`appendEntry`): updates the index via `updateIndex(entry)`
4. When deleting an entry (`deleteEntry`): removes from the index via `removeFromIndex(id)`

### Search API

```typescript
search(query, { agentId?, category?, limit? }): Promise<SearchResult[]>
updateIndex(entry: VaultEntry): Promise<void>
removeFromIndex(id: string): Promise<void>
buildIndex(): Promise<void>
```

```typescript
interface SearchResult {
  entry: VaultEntry;
  score: number;
  snippet: string;  // ~120 chars with the relevant excerpt
}
```

### MiniSearch Configuration

| Parameter | Value |
|-----------|-------|
| Indexed fields | `content`, `tags` |
| Stored fields | `id`, `date`, `content`, `tags`, `agentId`, `category` |
| Fuzzy matching | `0.2` |
| Prefix search | `true` |
| Default limit | `10` results |

### Snippet Construction

The snippet is built by finding the first occurrence of a query word in the content. A window of ~30 characters before and 120 total characters is extracted to provide context for the result.

---

## 5. Layer 4: Context Injection (`lib/memory/inject.ts`)

Called in `POST /api/agents/command` when starting a new chat session.

### `buildContext(agentId, command)`

Assembles the `InjectContext` with a 2,000 token budget:

| Source | Method | Limit |
|--------|--------|-------|
| Global project context | `_project.md` (direct read) | unlimited |
| Latest handoff | `readCategory(agentId, "handoffs")[0]` | 1 entry |
| Relevant decisions | `search(command, { category: "decisions" })` | top 3 |
| Relevant lessons | `search(command, { category: "lessons" })` | top 2 |
| Open tasks | `readCategory(agentId, "tasks")` filtered by `[ ]` | all |
| Recovery snapshot | `recover(agentId)` | last 3 msgs |

**Token estimation:** `Math.ceil(text.length / 4)` — simple heuristic based on average character/token ratio.

**Token budget trimming** (discard order when > 2,000 tokens):
1. Lessons discarded first
2. Decisions discarded second
3. Handoff discarded last (most valuable)

### `buildTextBlock(ctx)`

Converts `InjectContext` into a text block injected into the prompt:

```
## MEMORY CONTEXT

Project:
[_project.md content]

Last Session:
[latest handoff]

Relevant Decisions:
- [relevant decision snippet]

Relevant Lessons:
- [relevant lesson snippet]

Open Tasks:
- [ ] open task

Recovering previous session:
[user]: ...
[agent]: ...

---
```

### `buildMemoryInstructions(agentId)`

Generates instructions so the agent knows where to write memories directly to the filesystem:

```
## MEMORY: When asked to save/learn/remember, WRITE to files (don't just say you will).
Shared: .memory/_project.md | Personal: .memory/{agentId}/{decisions,lessons,tasks,handoffs}.md
```

### `buildProjectScopeBlock(projectName, workspace)`

When installed inside another project, injects a scope block so agents analyze the host project rather than the dashboard infrastructure.

### Full agent pipeline flow

```mermaid
flowchart TD
    CMD["POST /api/agents/command"] --> CHAT{"chatId exists?"}
    CHAT -->|No| NEW["New session"]
    NEW --> BC["buildContext(agentId, command)"]
    BC --> BT["buildTextBlock(ctx)"]
    BT --> MDC["getAgentMdcContent()"]
    MDC --> PROMPT["prompt = persona + memory + command"]
    CHAT -->|Yes| RESUME["Existing session"]
    RESUME --> SIMPLE["prompt = user command"]
    PROMPT --> SPAWN["spawn agent CLI"]
    SIMPLE --> SPAWN
    SPAWN --> SSE["Stream SSE → frontend"]
```

---

## 6. Layer 5: Automatic Compaction (`lib/memory/compact.ts`)

The compaction system addresses unbounded vault growth. An endpoint (`POST /api/memory/compact`) executes five sequential steps. The frontend triggers compaction automatically every 10 minutes.

### Automatic trigger (frontend)

`MainContent.tsx` checks on mount whether the last compaction was more than 10 minutes ago. If so, it runs `POST /api/memory/compact`. A 10-minute `setInterval` maintains periodic compaction while the dashboard is open.

### The five steps (Steps A–E)

```mermaid
flowchart TD
    START["POST /api/memory/compact"] --> A["Step A\ncleanStaleCheckpoints()"]
    A --> B["Step B\ntrimConversations()"]
    B --> C["Step C\ncapVaultEntries()"]
    C --> D["Step D\nrebuildSearchIndex()"]
    D --> E["Step E\ncleanLegacyFiles()"]
    E --> LOG["Persist compact-log.json"]
```

#### Step A: Expired checkpoint cleanup

Removes checkpoints in `.memory/.vault/checkpoints/` older than 7 days. Corrupted checkpoints (invalid JSON) are also removed.

| Parameter | Value |
|-----------|-------|
| Threshold | 7 days |
| Criteria | `Date.now() - checkpoint.savedAt > SEVEN_DAYS_MS` |
| Corrupted checkpoints | Removed unconditionally |

#### Step B: Heuristic extraction and conversation trimming

For **all** conversations in `.memory/conversations/`, the system extracts insights via pattern matching. Conversations with more than 20 messages are additionally trimmed. A `processed-conversations.json` file tracks the hash of each conversation to avoid redundant reprocessing.

For conversations with more than 20 messages:

1. **Separates messages** into "old" (removed) and "recent" (last 20, preserved)
2. **Extracts insights from old messages** using pattern matching on agent lines:
   - **Decisions**: detected by regex (`/\bdecid/i`, `/\bchose\b/i`, `/\bwill use\b/i`, etc.)
   - **Lessons**: detected by regex (`/\blearned\b/i`, `/\bimportant/i`, `/\bdiscovery/i`, etc.)
   - Maximum 10 decisions and 10 lessons per trimmed conversation
   - Each insight limited to 300 characters
   - Only lines with more than 15 characters are analyzed
3. **Persists insights** to the vault via `appendEntry()` with tags `["compacted", "auto-extract"]`
4. **Generates a compacted handoff** with the last 3 agent messages from the removed portion, tagged `["compacted", "auto-handoff"]`
5. **Rewrites the conversation file** containing only the 20 most recent messages

| Parameter | Value |
|-----------|-------|
| MAX_CONVERSATION_MESSAGES | 20 |
| Decision patterns | 10 regex (PT + EN) |
| Lesson patterns | 10 regex (PT + EN) |
| Max insights per conversation | 10 decisions + 10 lessons |
| Limit per insight | 300 chars |
| Minimum line length | 15 chars |

**Decision regex:**
```
/\bdecid/i, /\bchose\b/i, /\bwill use\b/i, /\bdecisão/i,
/\bescolh/i, /\boptamos/i, /\badotamos/i, /\bvamos usar\b/i,
/\bwent with\b/i, /\bsettled on\b/i
```

**Lesson regex:**
```
/\blearned\b/i, /\bimportant/i, /\bnote:/i, /\baprendemos/i,
/\bimportante/i, /\blição/i, /\bdiscovery/i, /\binsight/i,
/\bdescobr/i, /\bobserv/i
```

#### Step C: Vault category consolidation

For each agent and each category, if the number of entries exceeds 30:

1. **Keeps the 20 most recent**
2. **Consolidates the rest** into a single summary entry prefixed with "Compacted N older entries:"
3. Each consolidated entry is represented as `- [date] preview (200 chars)`
4. **Rewrites the category file** with 21 entries (20 originals + 1 summary)

| Parameter | Value |
|-----------|-------|
| MAX_VAULT_ENTRIES_PER_CATEGORY | 30 (trigger) |
| KEEP_VAULT_ENTRIES | 20 (retained) |

#### Step D: Search index rebuild

Deletes `index.json` and calls `buildIndex()` via dynamic import from `search.ts`. Ensures consistency after trimming and capping operations that modify the vault directly.

#### Step E: Legacy file cleanup

Removes two types of files:

1. **`.md.bak` files**: generated by `migrate.ts` during flat → vault migration
2. **Flat agent `.md` files**: removed when a corresponding vault directory already exists

### Compaction API

#### `GET /api/memory/compact`

Returns the result of the last compaction run (read from `.vault/compact-log.json`).

```json
{
  "lastCompaction": {
    "timestamp": "2026-03-24T10:30:00.000Z",
    "checkpointsCleaned": 3,
    "conversationsTrimmed": 2,
    "vaultEntriesMerged": 15,
    "indexRebuilt": true,
    "legacyFilesCleaned": 1
  }
}
```

#### `POST /api/memory/compact`

Runs full compaction. **Restricted to localhost** (rejects requests with external `x-forwarded-for` or `x-real-ip`).

---

## 7. Handoff Generation

Handoffs are generated by the frontend (`MainContent.tsx`) when closing an agent's chat window.

### Closing flow

```mermaid
sequenceDiagram
    participant U as User
    participant FE as MainContent.tsx
    participant CP as /api/memory/checkpoint
    participant VL as /api/memory/vault

    U->>FE: Close bubble (×) or drawer
    FE->>FE: Filter non-internal messages
    FE->>CP: POST checkpoint (agentId, messages, modelId)
    FE->>FE: saveHandoffToVault()
    FE->>FE: Format last 6 messages
    FE->>VL: POST entry (category: "handoffs", tags: auto-handoff, session-close)
    FE->>FE: Dismiss bubble/drawer
```

### Automatic handoff format

`saveHandoffToVault` extracts the last 6 messages from the conversation, formats each as `[User/Agent]: text (up to 200 chars)`, and saves as a vault entry with tags `auto-handoff` and `session-close`.

### Insight extraction on chat close

In addition to the handoff, the frontend also extracts decisions and lessons from the **entire conversation** using the same heuristic patterns as compaction (PT+EN regex: `decidimos`, `escolhemos`, `will use`, `recommendation`, `stack principal`, `aprendemos`, `lesson`, `risk`, etc.). Extracted insights are saved as vault entries for the agent with tags `auto-extract` and `session-close`.

---

## 8. Flat → Vault Migration (`lib/memory/migrate.ts`)

Converts memory files from the old format (flat `.md` per agent) to the vault directory/category structure.

### Flow

1. Scans `.memory/` for `.md` files (excluding `_` and `.` prefixes)
2. For each file: splits into `## Title` sections
3. Classifies each section into a `VaultCategory` via `SECTION_MAP` (PT + EN, with fuzzy match)
4. Persists each section as a vault entry via `appendEntry()`
5. Renames the original file to `.md.bak` (idempotent: existing `.bak` or already-created vault directory → skip)

### Section mapping

| Section (header) | Vault category |
|------------------|----------------|
| Decisions, Technical Decisions | `decisions` |
| Lessons, Findings, Notes, Session Notes | `lessons` |
| Tasks | `tasks` |
| Context, Project Context, Projects | `projects` |
| Handoffs | `handoffs` |
| *(fallback for any unrecognized section)* | `lessons` |

### API

`POST /api/memory/migrate` — restricted to localhost. Returns `{ migrated: string[], skipped: string[] }`.

---

## 9. REST APIs

| Route | Method | Description |
|-------|--------|-------------|
| `/api/memory` | GET | Load conversations (all or by agentId) |
| `/api/memory` | POST | Save conversations, append memory, init project |
| `/api/memory/vault` | GET | List agents, count categories, read entries |
| `/api/memory/vault` | POST | Create new entry |
| `/api/memory/vault` | PUT | Update existing entry |
| `/api/memory/vault` | DELETE | Remove entry |
| `/api/memory/search` | GET | BM25 search in vault |
| `/api/memory/checkpoint` | GET | Recover session checkpoint |
| `/api/memory/checkpoint` | POST | Save session checkpoint |
| `/api/memory/compact` | GET | Return last compaction result |
| `/api/memory/compact` | POST | Run full compaction (localhost only) |
| `/api/memory/migrate` | POST | Migrate flat `.md` files to vault structure (localhost only) |

### `GET /api/memory/search` — Parameters

| Param | Type | Required | Default |
|-------|------|----------|---------|
| `q` | string | yes | — |
| `agentId` | string | no | all |
| `category` | VaultCategory | no | all |
| `limit` | number | no | 10 (max 100) |

### `POST /api/memory/checkpoint` — Body

```json
{
  "agentId": "bmad-master",
  "messages": [{ "role": "user", "text": "..." }],
  "chatId": "chat_abc123",
  "modelId": "claude-opus-4-6"
}
```

### `POST /api/memory/vault` — Body

```json
{
  "agentId": "bmad-master",
  "category": "decisions",
  "content": "We decided to use SSE instead of WebSockets.",
  "tags": ["sse", "architecture"]
}
```

---

## 10. TypeScript Types (`lib/memory/types.ts`)

```typescript
type VaultCategory = "decisions" | "lessons" | "tasks" | "projects" | "handoffs";

const VAULT_CATEGORIES: VaultCategory[] = [
  "decisions", "lessons", "tasks", "projects", "handoffs",
];

interface ConversationMessage {
  role: "user" | "agent";
  text: string;
  internal?: boolean;   // internal messages are not saved in checkpoints/handoffs
}

interface VaultEntry {
  id: string;           // Date.now().toString()
  date: string;         // ISO datetime "2026-03-16T14:32"
  content: string;      // free-form markdown
  tags: string[];       // extracted via /#(\w+)/g
  agentId: string;
  category: VaultCategory;
}

interface Checkpoint {
  agentId: string;
  savedAt: number;      // Date.now()
  messages: ConversationMessage[];
  chatId?: string;
  modelId?: string;
}

interface SearchResult {
  entry: VaultEntry;
  score: number;
  snippet: string;      // ~120 chars
}

interface InjectContext {
  projectContext: string;
  handoff?: string;
  decisions: SearchResult[];
  lessons: SearchResult[];
  tasks: string[];
  tokenEstimate: number;
  recovering?: boolean;
  recoverySnapshot?: ConversationMessage[];
}

interface CompactionResult {
  timestamp: string;
  checkpointsCleaned: number;
  conversationsTrimmed: number;
  vaultEntriesMerged: number;
  indexRebuilt: boolean;
  legacyFilesCleaned: number;
}
```

---

## 11. Module Dependency Graph

```mermaid
graph TD
    TYPES["types.ts"] --> VAULT["vault.ts"]
    TYPES --> SEARCH["search.ts"]
    TYPES --> SESSION["session.ts"]
    TYPES --> INJECT["inject.ts"]
    TYPES --> COMPACT["compact.ts"]
    TYPES --> MIGRATE["migrate.ts"]

    VAULT -->|readCategory, appendEntry| SEARCH
    VAULT -->|appendEntry| SESSION
    VAULT -->|readCategory, appendEntry, listAgents| COMPACT

    SEARCH -->|search| INJECT
    VAULT -->|readCategory| INJECT
    SESSION -->|recover| INJECT

    SEARCH -.->|dynamic import buildIndex| COMPACT
    VAULT -.->|dynamic import updateIndex/removeFromIndex| SEARCH

    style TYPES fill:#f9f,stroke:#333
    style VAULT fill:#bbf,stroke:#333
    style SEARCH fill:#bfb,stroke:#333
    style INJECT fill:#fbb,stroke:#333
    style COMPACT fill:#fbf,stroke:#333
```

**Circular dependencies avoided** via `dynamic import()`:
- `vault.ts` → `search.ts`: index update after append/delete (try/catch, errors silenced)
- `compact.ts` → `search.ts`: index rebuild after compaction

---

## 12. File System Layout

```
.memory/
├── _project.md                         # Global context — injected into all agents
├── bmad-master/                        # bmad-master agent vault
│   ├── decisions.md                    #   Technical decisions
│   ├── lessons.md                      #   Lessons learned
│   ├── handoffs.md                     #   Session summaries
│   ├── tasks.md                        #   Open tasks
│   └── projects.md                     #   Project context
├── dev/                                # dev agent vault
│   └── ...
├── conversations/                      # Raw history (gitignored)
│   ├── bmad-master.json
│   └── dev.json
└── .vault/                             # System internal data
    ├── index.json                      # BM25 index (MiniSearch)
    ├── compact-log.json                # Last compaction log
    └── checkpoints/                    # Session checkpoints
        ├── bmad-master.json
        └── dev.json
```

---

## 13. Gitignore and Versioning

| Path | Version | Reason |
|------|---------|--------|
| `.memory/_project.md` | Yes | Curated project context |
| `.memory/{agentId}/` | Yes | Structured vault with valuable memories |
| `.memory/.vault/index.json` | No | Automatically rebuilt |
| `.memory/.vault/compact-log.json` | No | Operational log, regenerated on each compaction |
| `.memory/.vault/checkpoints/` | No | Volatile session data |
| `.memory/conversations/` | No | High volume, transient data |
| `docs/chat-sessions.json` | No | Volatile session IDs |

---

## 14. Error Handling Patterns

The system adopts a **silent resilience** philosophy: subsystem failures do not block the main flow.

| Module | Failure scenario | Behavior |
|--------|-----------------|----------|
| `vault.ts` | Dynamic import of search fails | Silenced — index updated at next compaction |
| `vault.ts` | Category file doesn't exist | Returns empty array |
| `session.ts` | Corrupted checkpoint (invalid JSON) | Returns `null` — fresh session |
| `session.ts` | Expired checkpoint (> 7 days) | Returns `null` |
| `search.ts` | `index.json` missing | Rebuilds index from scratch on next search |
| `compact.ts` | Corrupted conversation | Skips the file, continues with others |
| `compact.ts` | Index rebuild fails | `indexRebuilt: false` in result |
| `compact.ts` | Failed to delete legacy file | Silenced via try/catch |
| `inject.ts` | BM25 search fails | Context injected without decisions/lessons |

---

## 15. System Constants

| Constant | Value | Module | Purpose |
|----------|-------|--------|---------|
| `TOKEN_BUDGET` | 2000 | inject.ts | Token limit for injected context |
| `SEVEN_DAYS_MS` | 604,800,000 | session.ts, compact.ts | Checkpoint validity |
| `MAX_CONVERSATION_MESSAGES` | 20 | compact.ts | Conversation trimming trigger |
| `MAX_VAULT_ENTRIES_PER_CATEGORY` | 30 | compact.ts | Consolidation trigger |
| `KEEP_VAULT_ENTRIES` | 20 | compact.ts | Entries retained after consolidation |
| `COMPACT_INTERVAL` | 600,000 (10 min) | MainContent.tsx | Automatic compaction frequency |
| Checkpoint size | 50 msgs | session.ts | Messages retained in checkpoint |
| Handoff preview | 6 msgs | MainContent.tsx | Messages used to generate handoff |
| Search fuzzy | 0.2 | search.ts | Fuzzy matching tolerance |
| Search limit default | 10 | search.ts | Results per search |

---

## 16. Utility Script

### `scripts/import-conversations.mjs`

Imports existing conversation history (`.memory/conversations/`) into the vault using keyword matching.

**What it imports:** handoffs, decisions (PT+EN keywords), lessons (PT+EN keywords), projects (`_project.md`)

```bash
node scripts/import-conversations.mjs
```

---

## 17. Planned Evolution

| Phase | Feature | Priority | Status |
|-------|---------|----------|--------|
| v3.1 | Heuristic insight extraction on session close and compaction | High | **Implemented** |
| v3.2 | LLM-based extraction (complementing heuristics) | Medium | Pending |
| v3.3 | Semantic search with embeddings (beyond BM25) | Medium | Pending |
| v3.4 | Knowledge graph — wiki-links between agent memories | Low | Pending |
| v3.5 | Context profiles — adjust injection by task type | Low | Pending |
| v4.0 | Obsidian vault synchronization | Low | Pending |
