import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliJs = path.join(__dirname, "..", "dist", "cli.js");

function runCli(args: string[], cwd: string, env?: NodeJS.ProcessEnv): string {
  return execFileSync(process.execPath, [cliJs, ...args], {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, ...env },
  });
}

describe("agent-memory CLI", () => {
  it("lists agents as empty JSON in fresh dir", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-cli-"));
    const out = runCli(["--dir", dir, "--json", "agents"], process.cwd());
    const data = JSON.parse(out) as { agents: string[] };
    expect(data.agents).toEqual([]);
  });

  it("adds a vault entry and finds it via search", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-cli-"));
    const id = runCli(
      ["--dir", dir, "vault", "add", "agent-a", "decisions", "--content", "Use Redis for cache"],
      process.cwd(),
    ).trim();
    expect(id).toMatch(/^\d+$/);
    const searchOut = runCli(["--dir", dir, "--json", "search", "Redis"], process.cwd());
    const search = JSON.parse(searchOut) as { results: Array<{ id: string }> };
    expect(search.results.length).toBe(1);
    expect(search.results[0].id).toBe(id);
  });

  it("project show reports missing file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-cli-"));
    const out = runCli(["--dir", dir, "--json", "project", "show"], process.cwd());
    const data = JSON.parse(out) as { exists: boolean };
    expect(data.exists).toBe(false);
  });

  it("migrate returns empty when no flat md files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-cli-"));
    const out = runCli(["--dir", dir, "--json", "migrate"], process.cwd());
    const data = JSON.parse(out) as { migrated: string[]; skipped: string[] };
    expect(data.migrated).toEqual([]);
    expect(data.skipped).toEqual([]);
  });

  it("sync-checkpoints returns empty result when no conversations", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-cli-"));
    const out = runCli(["--dir", dir, "--json", "sync-checkpoints"], process.cwd());
    const data = JSON.parse(out) as { synced: string[]; skipped: string[]; errors: unknown[] };
    expect(data.synced).toEqual([]);
    expect(data.skipped).toEqual([]);
    expect(data.errors).toEqual([]);
  });

  it("watch --help lists --wait-for-transcripts", () => {
    const out = runCli(["watch", "--help"], process.cwd());
    expect(out).toContain("wait-for-transcripts");
  });

  it("vault list and inject preview respect --dir (nested subcommands, Commander v14)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-cli-"));
    runCli(["--dir", dir, "vault", "add", "x", "decisions", "--content", "We decided to use tests"], process.cwd());
    const listOut = runCli(["--dir", dir, "--json", "vault", "list", "x", "decisions"], process.cwd());
    const list = JSON.parse(listOut) as { entries: Array<{ id: string }> };
    expect(list.entries.length).toBe(1);

    const injectOut = runCli(["--dir", dir, "inject", "preview", "x", "decisions about tests"], process.cwd());
    expect(injectOut).toContain("MEMORY CONTEXT");
  });
});
