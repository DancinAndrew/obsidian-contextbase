import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverFile = fileURLToPath(new URL("../src/server.ts", import.meta.url));

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((part) => part.text ?? "").join("\n");
}

test("the server lists its tools, answers search and writes a memory note", async () => {
  const vault = mkdtempSync(join(tmpdir(), "contextbase-vault-"));
  const probeLog = join(vault, "probe.jsonl");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverFile],
    env: { ...getDefaultEnvironment(), CONTEXTBASE_VAULT: vault, CONTEXTBASE_PROBE_LOG: probeLog },
  });
  const client = new Client({ name: "smoke-test", version: "0.0.0" });
  await client.connect(transport);

  try {
    assert.equal(client.getServerVersion()?.name, "obsidian-contextbase");
    assert.match(client.getInstructions() ?? "", /shared memory between the AI agents/);

    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ["save", "search"]);

    const found = await client.callTool({ name: "search", arguments: { query: "宇治" } });
    assert.match(textOf(found), /fake data/);

    const saved = await client.callTool({
      name: "save",
      arguments: {
        type: "decision",
        summary: "第二天改去宇治",
        body: "第二天只有半天。\n\n**下一步：** 更新行程表。",
        decided_by: "user",
        about: ["京都 2026 行程"],
      },
    });
    assert.notEqual(saved.isError, true);
    assert.match(textOf(saved), /Saved Agent Memory\/\d{4}-\d{2}\/\d{4}-\d{2}-\d{2} \d{4} 第二天改去宇治\.md/);

    const month = readdirSync(join(vault, "Agent Memory"))[0] ?? "";
    const name = readdirSync(join(vault, "Agent Memory", month))[0] ?? "";
    const note = readFileSync(join(vault, "Agent Memory", month, name), "utf8");
    assert.match(note, /^type: decision$/m);
    assert.match(note, /^decided_by: user$/m);
    assert.match(note, /^agent: "smoke-test"$/m);
    assert.match(note, /^ {2}- "\[\[京都 2026 行程\]\]"$/m);
    assert.match(note, /\*\*下一步：\*\* 更新行程表。/);

    // The probe log is written by the server process, which may lag a moment behind the replies.
    for (let attempt = 0; attempt < 20 && !existsSync(probeLog); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const records = readFileSync(probeLog, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { kind: string });
    assert.ok(records.some((record) => record.kind === "recv"), "wire log has received messages");
    assert.ok(records.some((record) => record.kind === "initialized"), "wire log has the client facts");
  } finally {
    await client.close();
  }
});
