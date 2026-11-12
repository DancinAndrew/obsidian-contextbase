import assert from "node:assert/strict";
import { existsSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { PATHS, tempVault } from "./helpers.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
let vault: string;
let client: Client;

// One server for the file, started the way Codex starts it: in the session's working folder.
before(async () => {
  vault = tempVault();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, "serve", "--vault", vault],
    cwd: join(vault, "旅行/京都 2026"),
    env: getDefaultEnvironment(),
    stderr: "ignore",
  });
  client = new Client({ name: "codex-mcp-client", version: "0.0.0" });
  await client.connect(transport);
});

after(async () => {
  await client.close();
});

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content ?? [];
  return content.map((part) => part.text ?? "").join("\n");
}

const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });

test("offers four tools and instructions that name the save tool", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ["fetch", "recent", "save", "search"]);
  assert.match(client.getInstructions() ?? "", /Use the `save` tool of the contextbase MCP server/);
  assert.equal(client.getServerVersion()?.name, "obsidian-contextbase");
});

test("search ranks memories and notes and marks replaced memories", async () => {
  const found = textOf(await call("search", { query: "宇治 交通" }));
  assert.match(found, new RegExp(PATHS.current));
  assert.match(found, /\[note\] 旅行\/京都 2026\/交通與票券\.md \(lines \d+-\d+, best match at line \d+\)/);

  const memories = textOf(await call("search", { query: "第二天 嵐山", kind: "memory" }));
  assert.match(memories, /REPLACED by Agent Memory\/2026-11\/2026-11-09 1432 第二天改去宇治\.md/);
});

test("fetch reads numbered lines and refuses anything outside the indexed vault", async () => {
  const line = textOf(await call("fetch", { path: "課程/資料庫系統/交易與隔離層級.md", lines: "5" }));
  assert.match(line, /^5\| - 幻讀/m);

  const excluded = await call("fetch", { path: "私人/密碼提示.md" });
  assert.equal(excluded.isError, true);
  assert.match(textOf(excluded), /excluded/);

  assert.equal((await call("fetch", { path: "../outside.md" })).isError, true);
  assert.equal((await call("fetch", { path: "nothing here.md" })).isError, true);
});

test("fetch refuses a link inside the vault that leads out of it", async () => {
  const outside = join(dirname(vault), "outside-secret.md");
  writeFileSync(outside, "secret\n");
  symlinkSync(outside, join(vault, "looks-inside.md"));
  const result = await call("fetch", { path: "looks-inside.md" });
  assert.equal(result.isError, true);
  assert.ok(!textOf(result).includes("secret\n"));
});

test("save checks about, writes the note with the client's name and the working folder, then holds back duplicates", async () => {
  const wrong = await call("save", {
    type: "decision",
    summary: "第五天改成上午去錦市場",
    body: "傍晚要搭 Haruka。",
    decided_by: "user",
    about: ["旅行/京都 2026"],
  });
  assert.equal(wrong.isError, true);
  assert.match(textOf(wrong), /Did you mean: "京都 2026 行程"/);

  const saved = textOf(
    await call("save", {
      type: "decision",
      summary: "第五天改成上午去錦市場",
      body: "傍晚要搭 Haruka，所以錦市場改到上午。\n\n**下一步：** 確認營業時間。",
      decided_by: "user",
      about: ["京都 2026 行程"],
    }),
  );
  const path = /^Saved (.+\.md)$/m.exec(saved)?.[1];
  assert.ok(path && existsSync(join(vault, path)), saved);
  const note = readFileSync(join(vault, path), "utf8");
  assert.match(note, /^agent: "codex"$/m);
  assert.match(note, /^cwd: "旅行\/京都 2026"$/m);

  const again = await call("save", {
    type: "decision",
    summary: "第五天上午去錦市場",
    body: "傍晚要搭 Haruka，所以錦市場改到上午。",
    decided_by: "user",
    about: ["京都 2026 行程"],
  });
  assert.notEqual(again.isError, true);
  assert.match(textOf(again), /Not saved yet: these memories look similar/);
});

test("recent centers on the working folder", async () => {
  const recent = textOf(await call("recent", {}));
  assert.match(recent.split("\n")[0] ?? "", /nearest to 旅行\/京都 2026 first/);
  const decisions = textOf(await call("recent", { type: "decision", limit: 2 }));
  assert.ok(!decisions.includes("progress"), decisions);
});
