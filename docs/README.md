# Documentation — @inosx/agent-memory

Index of documentation for the package.

| Document | Description |
|----------|-------------|
| [**Memória explicada para leigos**](memoria-explicada-leigos.md) | **PT:** pitch acessível — o que é o framework, para quem, benefícios e limitações (não é manual técnico) |
| [**User Guide**](user-guide.md) | **Start here:** installation (postinstall: Cursor rules + VS Code folder-open tasks), concepts, library, CLI, BMAD integration, troubleshooting |
| [Memory System (technical)](memory-system.md) | Architecture (five layers), data flow, postinstall / `.vscode` folder-open tasks, Layer 1 `sync-checkpoints`, transcript automation (Section 18: watch, `process`, `--wait-for-transcripts`), REST notes, compaction, types |
| [Memory System Guide (dashboard)](memory-system-guide.md) | End-user guide when memory is used inside an agent dashboard (sessions, Memory Vault UI, lifecycle) |
| [Memory System Comparison](memory-system-comparison.md) | Comparison with ChatGPT Memory, Claude, OpenClaw, ClawVault, AITeam |
| [**Viewer Guide**](viewer-guide.md) | Standalone web dashboard: usage, features, API endpoints, architecture |
| [Integration planning prompt](prompt-plano-integracao.md) | **Meta-prompt** for another AI: produce an integration & utilization plan for a target project |

**Diagram:** [architecture.png](architecture.png) (referenced from the root README)

## Automatic activation (summary)

After **`npm install @inosx/agent-memory`** in a consumer project, **postinstall** installs Cursor rules and merges **VS Code/Cursor** tasks that run **`agent-memory process`** and **`agent-memory watch --wait-for-transcripts`** when the **workspace folder opens**. Details, opt-out env vars, and the full env table: root [README — Postinstall automation](../README.md#postinstall-automation-cursor-rules-and-vs-code-tasks).

## Quick links

- npm package: [`@inosx/agent-memory`](https://www.npmjs.com/package/@inosx/agent-memory) (when published)
- Source: [github.com/INOSX/agent-memory](https://github.com/INOSX/agent-memory)
- Postinstall & env vars: [README § Postinstall automation](../README.md#postinstall-automation-cursor-rules-and-vs-code-tasks)
