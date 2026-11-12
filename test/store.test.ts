import assert from "node:assert/strict";
import { appendFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { saveConfig } from "../src/config.ts";
import { Store } from "../src/store.ts";
import { NOW, PATHS, tempVault } from "./helpers.ts";

for (const tokenizer of ["bigram", "segmenter"] as const) {
  test(`[${tokenizer}] indexes the vault, skips excluded folders and derives memory links`, () => {
    const vault = tempVault({ tokenizer });
    const store = Store.open(vault);
    try {
      const stats = store.sync();
      assert.equal(stats.scanned, 37, "38 fixture files minus the excluded 私人 folder");
      assert.deepEqual(store.counts().memories, 10);
      assert.equal(store.counts().notes, 27);
      assert.equal(store.search("機密測試詞", { now: NOW }).length, 0);

      const replaced = store.memory(PATHS.replaced);
      assert.equal(replaced?.supersededBy, PATHS.current);
      const current = store.memory(PATHS.current);
      assert.equal(current?.supersededBy, null);
      assert.equal(current?.topic, "旅行/京都 2026");
      assert.equal(current?.next, "更新行程表第二天的交通。");
      assert.equal(store.memory("Agent Memory/2026-11/2026-11-03 0815 跑步改到早上.md")?.topic, "生活/健身");
    } finally {
      store.close();
    }
  });

  test(`[${tokenizer}] the current decision outranks the one it replaced`, () => {
    const store = Store.open(tempVault({ tokenizer }));
    try {
      store.sync();
      const hits = store.search("第二天 嵐山", { kind: "memory", now: NOW });
      const paths = hits.map((hit) => hit.path);
      assert.ok(paths.includes(PATHS.current) && paths.includes(PATHS.replaced), paths.join(", "));
      assert.ok(paths.indexOf(PATHS.current) < paths.indexOf(PATHS.replaced), paths.join(", "));
      assert.equal(hits.find((hit) => hit.path === PATHS.replaced)?.memory?.supersededBy, PATHS.current);
      const fresh = store.search("第二天 嵐山", { kind: "memory", now: NOW, includeSuperseded: false });
      assert.ok(!fresh.some((hit) => hit.path === PATHS.replaced));
    } finally {
      store.close();
    }
  });
}

test("working in a folder ranks the notes there first", () => {
  const vault = tempVault();
  const store = Store.open(vault);
  try {
    store.sync();
    const inTokyo = store.search("預算", { now: NOW, cwd: join(vault, "旅行/東京 2025") });
    assert.equal(inTokyo[0]?.path, "旅行/東京 2025/預算.md");
    const inKyoto = store.search("預算", { now: NOW, cwd: join(vault, "旅行/京都 2026") });
    assert.equal(inKyoto[0]?.path, "旅行/京都 2026/預算.md");
  } finally {
    store.close();
  }
});

test("a note hit points at the line that matched", () => {
  const store = Store.open(tempVault());
  try {
    store.sync();
    const hit = store.search("幻讀", { now: NOW })[0];
    assert.equal(hit?.path, "課程/資料庫系統/交易與隔離層級.md");
    assert.equal(hit?.line, 5);
    assert.match(hit?.snippet ?? "", /幻讀/);
    assert.equal(hit?.kind, "note");
  } finally {
    store.close();
  }
});

test("sync re-reads only what changed and forgets deleted notes", () => {
  const vault = tempVault();
  const store = Store.open(vault);
  try {
    store.sync();
    assert.equal(store.sync().indexed, 0);
    appendFileSync(join(vault, "讀書/深度工作.md"), "\n- 新加的一行：番茄鐘。\n");
    assert.equal(store.sync().indexed, 1);
    assert.equal(store.search("番茄鐘", { now: NOW })[0]?.path, "讀書/深度工作.md");
    rmSync(join(vault, "生活/料理/咖哩食譜.md"));
    assert.equal(store.sync().removed, 1);
    assert.equal(store.search("咖哩", { now: NOW }).length, 0);
  } finally {
    store.close();
  }
});

test("resolves note names like Obsidian and suggests close ones", () => {
  const store = Store.open(tempVault());
  try {
    store.sync();
    assert.equal(store.resolve("[[京都 2026 行程|行程]]"), PATHS.itinerary);
    assert.equal(store.resolve("旅行/東京 2025/預算"), "旅行/東京 2025/預算.md");
    assert.equal(store.resolve("預算"), "旅行/京都 2026/預算.md", "ambiguous: shortest path, then alphabetical");
    assert.equal(store.resolve("旅行/京都 2026"), null, "a folder is not a note");
    assert.ok(store.suggest("京都行程").includes("京都 2026 行程"));
  } finally {
    store.close();
  }
});

test("changing the tokenizer rebuilds the index", () => {
  const vault = tempVault({ tokenizer: "bigram" });
  let store = Store.open(vault);
  store.sync();
  store.close();
  saveConfig(vault, { exclude: ["私人"], saveDeny: [], tokenizer: "segmenter" });
  store = Store.open(vault);
  try {
    assert.equal(store.sync().indexed, 37);
    assert.ok(store.search("宇治", { now: NOW }).length > 0);
  } finally {
    store.close();
  }
});
