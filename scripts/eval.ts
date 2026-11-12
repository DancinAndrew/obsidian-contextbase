// Compares the two tokenizers on the fixture vault (assumption M2), each with and without the
// ranking on top of BM25 (decision D8). Prints recall@5 and MRR@10, the queries each setting
// misses, and the index's size and build time. Run: npm run eval
//
// recall@5: of the notes a query should find, the share that appear in the top 5.
// MRR@10:   1 / (rank of the first right answer), 0 if none is in the top 10, averaged.
import { cpSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { saveConfig } from "../src/config.ts";
import { Store } from "../src/store.ts";
import { tokenize, TOKENIZER_NAMES, type TokenizerName } from "../src/text.ts";

interface Query {
  query: string;
  relevant: string[];
}

const root = fileURLToPath(new URL("..", import.meta.url));
const { queries } = JSON.parse(readFileSync(join(root, "fixtures/queries.json"), "utf8")) as { queries: Query[] };
const now = new Date("2026-11-12T12:00:00+08:00");

interface Result {
  setting: string;
  recall: number;
  mrr: number;
  misses: string[];
  buildMs: number;
  sizeKb: number;
}

function evaluate(tokenizer: TokenizerName, ranking: boolean): Result {
  const vault = join(mkdtempSync(join(tmpdir(), "contextbase-eval-")), "vault");
  cpSync(join(root, "fixtures/vault"), vault, { recursive: true });
  saveConfig(vault, { exclude: ["私人"], saveDeny: [], tokenizer });
  const started = performance.now();
  const store = Store.open(vault);
  store.sync();
  const buildMs = performance.now() - started;

  let recall = 0;
  let mrr = 0;
  const misses: string[] = [];
  for (const { query, relevant } of queries) {
    const paths = store.search(query, { limit: 10, now, ranking }).map((hit) => hit.path);
    const found = relevant.filter((path) => paths.slice(0, 5).includes(path)).length;
    recall += found / relevant.length;
    const first = paths.findIndex((path) => relevant.includes(path));
    mrr += first === -1 ? 0 : 1 / (first + 1);
    if (found < relevant.length) {
      const top = paths.slice(0, 3).map((path) => path.split("/").at(-1));
      misses.push(`${query}: ${found}/${relevant.length} in top 5; top 3 were ${top.join(", ") || "nothing"}`);
    }
  }
  store.close();
  return {
    setting: `${tokenizer}, ${ranking ? "BM25 + ranking" : "BM25 only"}`,
    recall: recall / queries.length,
    mrr: mrr / queries.length,
    misses,
    buildMs,
    sizeKb: statSync(join(vault, ".contextbase", "index.sqlite")).size / 1024,
  };
}

const results = TOKENIZER_NAMES.flatMap((tokenizer) => [evaluate(tokenizer, false), evaluate(tokenizer, true)]);
console.log(`${queries.length} queries on fixtures/vault\n`);
console.log("| Setting | Recall@5 | MRR@10 | Index build | Index size |");
console.log("| --- | --- | --- | --- | --- |");
for (const result of results) {
  console.log(
    `| ${result.setting} | ${result.recall.toFixed(3)} | ${result.mrr.toFixed(3)} | ${result.buildMs.toFixed(0)} ms | ${result.sizeKb.toFixed(0)} KB |`,
  );
}
for (const result of results) {
  console.log(`\nMissed by ${result.setting}:`);
  console.log(result.misses.length ? result.misses.map((miss) => `- ${miss}`).join("\n") : "- none");
}

// Words in context. For every 2–4 character word that the segmenter recognises on its own and
// that occurs in a note, check whether the segmenter, splitting the note in context, produced
// that same word. If it did not, searching for the word alone cannot find the note under the
// segmenter. Bigrams always find it: every pair inside the word is also a pair in the note.
const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu;
const notes = fixtureNotes(join(root, "fixtures/vault"));
let words = 0;
const lost: string[] = [];
for (const text of notes) {
  const inContext = new Set(tokenize(text, "segmenter"));
  const seen = new Set<string>();
  for (const run of text.match(CJK_RUN) ?? []) {
    const chars = Array.from(run);
    for (let length = 2; length <= 4; length++) {
      for (let i = 0; i + length <= chars.length; i++) {
        const word = chars.slice(i, i + length).join("");
        if (seen.has(word)) continue;
        seen.add(word);
        const alone = tokenize(word, "segmenter");
        if (alone.length !== 1 || alone[0] !== word) continue; // not a word the segmenter knows
        words++;
        if (!inContext.has(word)) lost.push(word);
      }
    }
  }
}
console.log(`\nWords in context: ${words} (note, dictionary word) pairs occur in the fixture notes.`);
console.log(
  `The segmenter index cannot find ${lost.length} of them (${((100 * lost.length) / words).toFixed(1)}%) by searching for the word alone; bigrams find all of them.`,
);
console.log(`Examples: ${[...new Set(lost)].slice(0, 20).join("、")}`);

function fixtureNotes(dir: string): string[] {
  const texts: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) texts.push(...fixtureNotes(path));
    else if (entry.name.endsWith(".md")) texts.push(readFileSync(path, "utf8"));
  }
  return texts;
}
