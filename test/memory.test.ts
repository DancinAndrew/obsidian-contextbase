import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { buildDigest, recentMemories } from "../src/digest.ts";
import { parseNote, field, listField } from "../src/markdown.ts";
import { agentName, saveMemory, type SaveInput } from "../src/memory.ts";
import { Store } from "../src/store.ts";
import { NOW, PATHS, tempVault } from "./helpers.ts";

const at = new Date("2026-11-12T10:05:00+08:00");

function open(config = {}) {
  const vault = tempVault(config);
  const store = Store.open(vault);
  store.sync();
  return { vault, store };
}

const decision = (overrides: Partial<SaveInput> = {}): SaveInput => ({
  type: "decision",
  summary: "第五天改成上午去錦市場",
  body: "傍晚要搭 Haruka，所以錦市場改到上午。\n\n**下一步：** 確認錦市場的營業時間。",
  decidedBy: "user",
  about: ["京都 2026 行程"],
  ...overrides,
});

test("writes a memory note in the plan's format and indexes it at once", () => {
  const { vault, store } = open();
  try {
    const result = saveMemory(store, decision(), { agent: agentName("codex-mcp-client"), cwd: join(vault, "旅行/京都 2026"), now: at });
    assert.equal(result.status, "saved");
    if (result.status !== "saved") return;
    assert.equal(result.path, "Agent Memory/2026-11/2026-11-12 1005 第五天改成上午去錦市場.md");
    assert.equal(result.link, "[[2026-11-12 1005 第五天改成上午去錦市場]]");

    const note = parseNote(readFileSync(join(vault, result.path), "utf8"));
    assert.equal(field(note.data, "type"), "decision");
    assert.equal(field(note.data, "agent"), "codex");
    assert.equal(field(note.data, "decided_by"), "user");
    assert.equal(field(note.data, "cwd"), "旅行/京都 2026");
    assert.deepEqual(listField(note.data, "about"), ["[[京都 2026 行程]]"]);
    assert.match(field(note.data, "created") ?? "", /^2026-11-12T10:05:00[+-]\d{2}:\d{2}$/);

    const hit = store.search("錦市場 營業時間", { kind: "memory", now: NOW })[0];
    assert.equal(hit?.path, result.path);
    assert.equal(hit?.memory?.next, "確認錦市場的營業時間。");
  } finally {
    store.close();
  }
});

test("an about that names no note is refused with suggestions", () => {
  const { store } = open();
  try {
    const result = saveMemory(store, decision({ about: ["旅行/京都 2026"] }), { agent: "codex", now: at });
    assert.equal(result.status, "unresolved");
    if (result.status !== "unresolved") return;
    assert.equal(result.field, "about");
    assert.ok(result.names[0]?.suggestions.includes("京都 2026 行程"), JSON.stringify(result.names));
  } finally {
    store.close();
  }
});

test("a near duplicate is held back until the agent replaces or confirms", () => {
  const { store } = open();
  try {
    const duplicate = decision({
      summary: "第二天改去宇治，嵐山移到第四天",
      body: "第二天只有半天，所以第二天去宇治，嵐山改到第四天。",
    });
    const first = saveMemory(store, duplicate, { agent: "codex", now: at });
    assert.equal(first.status, "similar");
    if (first.status !== "similar") return;
    assert.equal(first.similar[0]?.path, PATHS.current);
    assert.ok(!first.similar.some((memory) => memory.path === PATHS.replaced), "replaced memories are not offered");

    const confirmed = saveMemory(store, { ...duplicate, confirm: true }, { agent: "codex", now: at });
    assert.equal(confirmed.status, "saved");
  } finally {
    store.close();
  }
});

test("supersedes replaces an older memory, and the digest shows only the new one", () => {
  const { vault, store } = open();
  try {
    const result = saveMemory(
      store,
      decision({
        summary: "第二天改去奈良，宇治移到第五天",
        body: "奈良的鹿公園只開到傍晚，第二天下午比較合適。",
        supersedes: "[[2026-11-09 1432 第二天改去宇治]]",
      }),
      { agent: "claude-code", cwd: vault, now: at },
    );
    assert.equal(result.status, "saved");
    if (result.status !== "saved") return;
    assert.equal(result.replaced, PATHS.current);
    assert.equal(store.memory(PATHS.current)?.supersededBy, result.path);

    const digest = buildDigest(store, { cwd: vault });
    assert.match(digest, /第二天改去奈良/);
    assert.match(digest, /replaces 2026-11-09: 第二天改去宇治/);
    assert.ok(!digest.includes("- 2026-11-09 decision (decided by the user, recorded by codex): 第二天改去宇治"));

    const bad = saveMemory(store, decision({ supersedes: "[[不存在的記憶]]" }), { agent: "codex", now: at });
    assert.equal(bad.status, "unresolved");
  } finally {
    store.close();
  }
});

test("words the vault keeps out of memory are refused", () => {
  const { store } = open({ saveDeny: ["機密"] });
  try {
    const result = saveMemory(store, decision({ body: "機密計畫延期。" }), { agent: "codex", now: at });
    assert.deepEqual(result.status, "refused");
  } finally {
    store.close();
  }
});

test("the digest groups by topic at the vault root and stays within its budget", () => {
  const { vault, store } = open();
  try {
    const digest = buildDigest(store, { cwd: vault });
    const lines = digest.split("\n");
    assert.equal(lines[0], "[Contextbase] Recent work, by topic");
    assert.ok(lines.includes("旅行/京都 2026"), digest);
    assert.ok(digest.length <= 1500);
    assert.ok(!digest.includes("第二天去嵐山，第四天去宇治 ("), "the replaced decision is not listed as current");
    assert.match(digest, /^- 2026-11-09 decision \(decided by the user, recorded by codex\): 第二天改去宇治，嵐山移到第四天$/m);
    assert.match(digest, /^ {2}next: 更新行程表第二天的交通。$/m);

    const tight = buildDigest(store, { cwd: vault, maxChars: 300 });
    assert.ok(tight.length <= 300, tight);
    assert.ok(!/\n[^ -][^\n]*\nUse the search tool/.test(tight), "no topic heading left without a memory");
  } finally {
    store.close();
  }
});

test("in a subfolder the nearest memories come first", () => {
  const { vault, store } = open();
  try {
    // Both memories about the course outrank newer ones elsewhere, and keep date order between them.
    const recent = recentMemories(store, { cwd: join(vault, "課程/機器學習"), limit: 3 });
    assert.deepEqual(
      recent.slice(0, 2).map((memory) => memory.path),
      [
        "Agent Memory/2026-11/2026-11-06 1630 期末專題選 BM25 比較.md",
        "Agent Memory/2026-11/2026-11-05 1010 正則化作業進度.md",
      ],
    );
    const digest = buildDigest(store, { cwd: join(vault, "課程/機器學習") });
    assert.match(digest.split("\n")[0] ?? "", /nearest to 課程\/機器學習 first/);
  } finally {
    store.close();
  }
});

test("client names map to the agent names memories record", () => {
  assert.equal(agentName("claude-code"), "claude-code");
  assert.equal(agentName("codex-mcp-client"), "codex");
  assert.equal(agentName("cursor"), "cursor");
  assert.equal(agentName(undefined), "unknown");
});
