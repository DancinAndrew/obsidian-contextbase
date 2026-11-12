import assert from "node:assert/strict";
import { test } from "node:test";
import { matchQuery, normalize, tokenize } from "../src/text.ts";

test("bigrams pair neighbouring CJK characters and keep other words whole", () => {
  assert.deepEqual(tokenize("宇治的交通", "bigram"), ["宇治", "治的", "的交", "交通"]);
  assert.deepEqual(tokenize("搭 JR 奈良線", "bigram"), ["搭", "jr", "奈良", "良線"]);
  assert.deepEqual(tokenize("茶", "bigram"), ["茶"]);
});

test("the segmenter splits Chinese into dictionary words", () => {
  const terms = tokenize("第二天改去宇治", "segmenter");
  assert.ok(terms.includes("宇治"), `got ${terms.join(" | ")}`);
  assert.ok(!terms.some((term) => term.includes(" ")));
});

test("both tokenizers treat English and full-width text the same way", () => {
  for (const name of ["segmenter", "bigram"] as const) {
    assert.deepEqual(tokenize("Intl.Segmenter splits ＢＭ２５", name), ["intl", "segmenter", "splits", "bm25"]);
  }
  assert.equal(normalize("ＡＢＣ"), "abc");
});

test("punctuation and spaces never become terms", () => {
  for (const name of ["segmenter", "bigram"] as const) {
    const terms = tokenize("（L1、L2）——「宇治」!?", name);
    assert.ok(terms.every((term) => /^[\p{L}\p{N}]+$/u.test(term)), `got ${terms.join(" | ")}`);
  }
});

test("a match query ORs quoted terms, drops repeats and escapes quotes", () => {
  assert.equal(matchQuery(["宇治", "交通", "宇治"]), '"宇治" OR "交通"');
  assert.equal(matchQuery(['say"hi']), '"say""hi"');
  assert.equal(matchQuery([]), null);
});
