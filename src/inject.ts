import fs from "fs";
import path from "path";
import type { InjectContext, ConversationMessage, ResolvedConfig } from "./types.js";
import type { VaultApi } from "./vault.js";
import type { SearchApi } from "./search.js";
import type { SessionApi } from "./session.js";

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface BuildOptions {
  recovering?: boolean;
  recoverySnapshot?: ConversationMessage[];
}

export interface InjectApi {
  /** Assemble full memory context for an agent given a command/prompt. */
  buildContext(agentId: string, command: string, options?: BuildOptions): Promise<InjectContext>;
  /** Format InjectContext into a markdown text block for prompt injection. */
  buildTextBlock(ctx: InjectContext): string;
  /** Build instructions telling agents where to persist memories. */
  buildMemoryInstructions(agentId: string): string;
  /** Path to the memory directory. */
  readonly dir: string;
}

export function createInject(
  config: ResolvedConfig,
  vault: VaultApi,
  search: SearchApi,
  session: SessionApi,
): InjectApi {
  function projectPath(): string {
    return path.join(config.dir, config.projectContextFile);
  }

  return {
    get dir() {
      return config.dir;
    },

    async buildContext(agentId, command, options = {}) {
      // 1. Global project context
      const pPath = projectPath();
      const projectContext = fs.existsSync(pPath)
        ? fs.readFileSync(pPath, "utf-8")
        : "";

      // 2. Latest handoff
      const handoffs = await vault.read(agentId, "handoffs");
      const handoff = handoffs[0]?.content;

      // 3. Relevant decisions (BM25)
      const decisions = await search.search(command, { agentId, category: "decisions", limit: 3 });

      // 4. Relevant lessons (BM25)
      const lessons = await search.search(command, { agentId, category: "lessons", limit: 2 });

      // 5. Open tasks
      const taskEntries = await vault.read(agentId, "tasks");
      const tasks = taskEntries
        .flatMap((e) => e.content.split("\n"))
        .filter((line) => line.includes("[ ]"))
        .map((line) => line.trim());

      // 5b. Recovery checkpoint
      const checkpoint = await session.recover(agentId);
      const recovering = options?.recovering ?? !!checkpoint;
      const recoverySnapshot = options?.recoverySnapshot ?? checkpoint?.messages;

      // 6. Token budget trimming (cut order: lessons -> decisions -> handoff)
      let tokenEstimate = estimateTokens(projectContext);
      let finalDecisions = decisions;
      let finalLessons = lessons;
      let finalHandoff: string | undefined = handoff;

      tokenEstimate += lessons.reduce((s, r) => s + estimateTokens(r.snippet), 0);
      tokenEstimate += decisions.reduce((s, r) => s + estimateTokens(r.snippet), 0);
      if (handoff) tokenEstimate += estimateTokens(handoff);
      tokenEstimate += tasks.reduce((s, t) => s + estimateTokens(t), 0);

      if (tokenEstimate > config.tokenBudget) {
        finalLessons = [];
        tokenEstimate -= lessons.reduce((s, r) => s + estimateTokens(r.snippet), 0);
      }
      if (tokenEstimate > config.tokenBudget) {
        finalDecisions = [];
        tokenEstimate -= decisions.reduce((s, r) => s + estimateTokens(r.snippet), 0);
      }
      if (tokenEstimate > config.tokenBudget) {
        finalHandoff = undefined;
      }

      return {
        projectContext,
        handoff: finalHandoff,
        decisions: finalDecisions,
        lessons: finalLessons,
        tasks,
        tokenEstimate,
        recovering,
        recoverySnapshot,
      };
    },

    buildTextBlock(ctx) {
      const lines: string[] = ["\n\n## MEMORY CONTEXT"];

      lines.push(`\nProject:\n${ctx.projectContext.trim()}`);

      if (ctx.handoff) {
        lines.push(`\nLast Session:\n${ctx.handoff.trim()}`);
      }

      if (ctx.decisions.length > 0) {
        lines.push("\nRelevant Decisions:");
        ctx.decisions.forEach((r) => lines.push(`- ${r.snippet}`));
      }

      if (ctx.lessons.length > 0) {
        lines.push("\nRelevant Lessons:");
        ctx.lessons.forEach((r) => lines.push(`- ${r.snippet}`));
      }

      if (ctx.tasks.length > 0) {
        lines.push("\nOpen Tasks:");
        ctx.tasks.forEach((t) => lines.push(t));
      }

      if (ctx.recovering && ctx.recoverySnapshot) {
        const recent = ctx.recoverySnapshot
          .slice(-3)
          .map((m) => `[${m.role}]: ${m.text.slice(0, 100)}`)
          .join("\n");
        lines.push(`\nRecovering previous session:\n${recent}`);
      }

      lines.push("\n---\n");
      return lines.join("\n");
    },

    buildMemoryInstructions(agentId) {
      return [
        "## MEMORY: When asked to save/learn/remember, WRITE to files (don't just say you will).",
        `Shared: ${path.join(config.dir, config.projectContextFile)} | Personal: ${path.join(config.dir, agentId)}/{${config.categories.join(",")}}.md`,
        "---",
      ].join("\n");
    },
  };
}
