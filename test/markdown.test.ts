import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { chunkLines, field, linkTarget, listField, parseNote } from "../src/markdown.ts";

const memoryFile = new URL("../fixtures/vault/Agent Memory/2026-11/2026-11-09 1432 第二天改去宇治.md", import.meta.url);

test("reads the front matter of a memory note", () => {
  const note = parseNote(readFileSync(memoryFile, "utf8"));
  assert.equal(field(note.data, "type"), "decision");
  assert.equal(field(note.data, "summary"), "第二天改去宇治，嵐山移到第四天");
  assert.equal(field(note.data, "agent"), "codex");
  assert.deepEqual(listField(note.data, "about"), ["[[京都 2026 行程]]", "[[交通與票券]]"]);
  assert.equal(linkTarget(field(note.data, "supersedes") ?? ""), "2026-11-08 2105 第二天去嵐山");
  assert.equal(field(note.data, "created"), "2026-11-09T14:32:00+08:00");
  assert.equal(note.lines[note.bodyStart], "第二天只有半天，嵐山想留給完整的一天，所以第二天改去宇治，嵐山移到第四天。");
});

test("tolerates comments, flow lists, empty values and nested maps", () => {
  const note = parseNote(
    [
      "---",
      "type: decision          # decision | progress | fact",
      "tags: [travel, \"kyoto 2026\"]",
      "supersedes:",
      "nested:",
      "  key: value",
      "title: 'It''s fine'",
      "---",
      "body",
    ].join("\n"),
  );
  assert.equal(field(note.data, "type"), "decision");
  assert.deepEqual(listField(note.data, "tags"), ["travel", "kyoto 2026"]);
  assert.equal(field(note.data, "supersedes"), undefined);
  assert.equal(field(note.data, "title"), "It's fine");
  assert.equal(note.bodyStart, 8);
});

test("a note without closed front matter is all body", () => {
  const note = parseNote("---\nnot closed\nstill body");
  assert.deepEqual(note.data, {});
  assert.equal(note.bodyStart, 0);
});

test("link targets drop the alias, the heading and the brackets", () => {
  assert.equal(linkTarget("[[京都 2026 行程|行程]]"), "京都 2026 行程");
  assert.equal(linkTarget("[[note#section]]"), "note");
  assert.equal(linkTarget("plain name"), "plain name");
});

test("chunks start at headings and keep 1-based line numbers", () => {
  const lines = ["# Title", "", "intro", "", "## Part", "one", "two", "", ""];
  assert.deepEqual(chunkLines(lines, 0), [
    { startLine: 1, endLine: 3, text: "# Title\n\nintro" },
    { startLine: 5, endLine: 7, text: "## Part\none\ntwo" },
  ]);
});

test("long sections are cut so a chunk never grows without bound", () => {
  const lines = Array.from({ length: 95 }, (_, i) => `line ${i}`);
  const chunks = chunkLines(lines, 0, 40);
  assert.deepEqual(
    chunks.map((chunk) => [chunk.startLine, chunk.endLine]),
    [
      [1, 40],
      [41, 80],
      [81, 95],
    ],
  );
});
