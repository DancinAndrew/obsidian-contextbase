import assert from "node:assert/strict";
import { test } from "node:test";
import { finalScore, recencyWeight, scopeWeight, typeWeight, type RankFacts } from "../src/rank.ts";

const memory = (overrides: Partial<RankFacts> = {}): RankFacts => ({
  kind: "memory",
  type: "decision",
  decidedBy: "user",
  created: "2026-11-12T12:00:00+08:00",
  superseded: false,
  location: "旅行/京都 2026",
  ...overrides,
});
const now = new Date("2026-11-12T12:00:00+08:00");

test("the user's decisions weigh most, then an agent's, then facts, then progress", () => {
  const weights = [
    typeWeight(memory()),
    typeWeight(memory({ decidedBy: "agent" })),
    typeWeight(memory({ type: "fact" })),
    typeWeight(memory({ type: "progress" })),
  ];
  assert.deepEqual([...weights].sort((a, b) => b - a), weights);
  assert.equal(typeWeight(memory({ kind: "note" })), 1);
});

test("a memory's recency bonus halves every 30 days and never drops below one half", () => {
  assert.equal(recencyWeight(memory(), now), 1);
  assert.equal(recencyWeight(memory({ created: "2026-10-13T12:00:00+08:00" }), now), 0.75);
  const ancient = recencyWeight(memory({ created: "2020-01-01T00:00:00Z" }), now);
  assert.ok(ancient >= 0.5 && ancient < 0.51, String(ancient));
  assert.equal(recencyWeight(memory({ kind: "note" }), now), 1);
  assert.equal(recencyWeight(memory({ created: "not a date" }), now), 1);
});

test("scope counts shared folder levels, and the vault root gives no hint", () => {
  assert.equal(scopeWeight("旅行/京都 2026", "旅行/京都 2026"), 1.5);
  assert.equal(scopeWeight("旅行/東京 2025", "旅行/京都 2026"), 1.25);
  assert.equal(scopeWeight("課程", "旅行/京都 2026"), 1);
  assert.equal(scopeWeight("旅行/京都 2026", ""), 1);
  assert.equal(scopeWeight("旅行/京都 2026", null), 1);
  assert.equal(scopeWeight("/Users/x/code/app", "/Users/x/code/app"), 1.5);
  assert.equal(scopeWeight("code/app", "/Users/x/code/app"), 1);
});

test("a superseded memory keeps 30 percent of its score", () => {
  const kept = finalScore(10, memory(), null, now);
  const replaced = finalScore(10, memory({ superseded: true }), null, now);
  assert.ok(Math.abs(replaced / kept - 0.3) < 1e-9);
});
