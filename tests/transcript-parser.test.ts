import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  workspaceSlug,
  findTranscriptsDir,
  listTranscripts,
  parseTranscript,
} from "../src/transcript-parser.js";

describe("workspaceSlug", () => {
  it("replaces non-alphanumeric chars with dashes and strips leading dashes", () => {
    expect(workspaceSlug("/Users/mario.filho/agent-memory")).toBe(
      "Users-mario-filho-agent-memory",
    );
  });

  it("handles deeply nested paths", () => {
    expect(workspaceSlug("/Users/dev/Documents/projects/my-app")).toBe(
      "Users-dev-Documents-projects-my-app",
    );
  });
});

describe("parseTranscript", () => {
  it("returns empty for non-existent file", () => {
    const result = parseTranscript("/nonexistent/file.jsonl");
    expect(result.messages).toEqual([]);
    expect(result.lineCount).toBe(0);
  });

  it("parses user and assistant messages", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-tp-"));
    const file = path.join(dir, "test.jsonl");
    const lines = [
      JSON.stringify({
        role: "user",
        message: { content: [{ type: "text", text: "hello" }] },
      }),
      JSON.stringify({
        role: "assistant",
        message: { content: [{ type: "text", text: "hi there" }] },
      }),
    ];
    fs.writeFileSync(file, lines.join("\n"), "utf-8");

    const result = parseTranscript(file);
    expect(result.lineCount).toBe(2);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual({ role: "user", text: "hello" });
    expect(result.messages[1]).toEqual({ role: "agent", text: "hi there" });
  });

  it("maps assistant role to agent", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-tp-"));
    const file = path.join(dir, "test.jsonl");
    fs.writeFileSync(
      file,
      JSON.stringify({
        role: "assistant",
        message: { content: [{ type: "text", text: "response" }] },
      }),
      "utf-8",
    );

    const result = parseTranscript(file);
    expect(result.messages[0].role).toBe("agent");
  });

  it("strips <user_query> wrappers", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-tp-"));
    const file = path.join(dir, "test.jsonl");
    fs.writeFileSync(
      file,
      JSON.stringify({
        role: "user",
        message: {
          content: [
            { type: "text", text: "<user_query>\nfaça pull\n</user_query>" },
          ],
        },
      }),
      "utf-8",
    );

    const result = parseTranscript(file);
    expect(result.messages[0].text).toBe("faça pull");
  });

  it("ignores tool_use blocks, keeps text blocks", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-tp-"));
    const file = path.join(dir, "test.jsonl");
    fs.writeFileSync(
      file,
      JSON.stringify({
        role: "assistant",
        message: {
          content: [
            { type: "text", text: "Let me check" },
            { type: "tool_use", name: "Shell", input: { command: "ls" } },
            { type: "text", text: "Done" },
          ],
        },
      }),
      "utf-8",
    );

    const result = parseTranscript(file);
    expect(result.messages[0].text).toBe("Let me check\nDone");
  });

  it("supports incremental reading via fromLine", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-tp-"));
    const file = path.join(dir, "test.jsonl");
    const lines = [
      JSON.stringify({ role: "user", message: { content: [{ type: "text", text: "msg1" }] } }),
      JSON.stringify({ role: "assistant", message: { content: [{ type: "text", text: "msg2" }] } }),
      JSON.stringify({ role: "user", message: { content: [{ type: "text", text: "msg3" }] } }),
    ];
    fs.writeFileSync(file, lines.join("\n"), "utf-8");

    const result = parseTranscript(file, 2);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text).toBe("msg3");
    expect(result.lineCount).toBe(3);
  });

  it("skips malformed JSON lines gracefully", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-tp-"));
    const file = path.join(dir, "test.jsonl");
    const lines = [
      JSON.stringify({ role: "user", message: { content: [{ type: "text", text: "ok" }] } }),
      "NOT VALID JSON {{{",
      JSON.stringify({ role: "assistant", message: { content: [{ type: "text", text: "fine" }] } }),
    ];
    fs.writeFileSync(file, lines.join("\n"), "utf-8");

    const result = parseTranscript(file);
    expect(result.messages).toHaveLength(2);
    expect(result.lineCount).toBe(3);
  });

  it("skips lines with empty text", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-tp-"));
    const file = path.join(dir, "test.jsonl");
    fs.writeFileSync(
      file,
      JSON.stringify({
        role: "assistant",
        message: { content: [{ type: "tool_use", name: "Shell" }] },
      }),
      "utf-8",
    );

    const result = parseTranscript(file);
    expect(result.messages).toHaveLength(0);
  });
});

describe("listTranscripts", () => {
  it("returns empty for non-existent directory", () => {
    expect(listTranscripts("/nonexistent")).toEqual([]);
  });

  it("lists transcript directories with JSONL files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-tp-"));
    const uuid1 = "aaa-bbb-ccc";
    const uuid2 = "ddd-eee-fff";

    fs.mkdirSync(path.join(dir, uuid1));
    fs.writeFileSync(
      path.join(dir, uuid1, `${uuid1}.jsonl`),
      JSON.stringify({ role: "user", message: { content: [{ type: "text", text: "hi" }] } }),
      "utf-8",
    );

    fs.mkdirSync(path.join(dir, uuid2));
    fs.writeFileSync(
      path.join(dir, uuid2, `${uuid2}.jsonl`),
      [
        JSON.stringify({ role: "user", message: { content: [{ type: "text", text: "a" }] } }),
        JSON.stringify({ role: "assistant", message: { content: [{ type: "text", text: "b" }] } }),
      ].join("\n"),
      "utf-8",
    );

    const list = listTranscripts(dir);
    expect(list).toHaveLength(2);

    const ids = list.map((t) => t.id).sort();
    expect(ids).toEqual([uuid1, uuid2].sort());

    const t2 = list.find((t) => t.id === uuid2)!;
    expect(t2.lineCount).toBe(2);
  });

  it("ignores directories without matching JSONL file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-tp-"));
    fs.mkdirSync(path.join(dir, "orphan"));
    fs.writeFileSync(path.join(dir, "orphan", "other.txt"), "not a transcript", "utf-8");

    expect(listTranscripts(dir)).toEqual([]);
  });
});

describe("findTranscriptsDir", () => {
  it("returns null for workspace with no Cursor project", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-tp-"));
    expect(findTranscriptsDir(dir)).toBeNull();
  });
});
