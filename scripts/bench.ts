// Times the index on a synthetic vault the size of the author's (about 2,500 notes and 28 MB),
// made by repeating and shuffling the fixture notes. The text repeats, so this measures speed,
// not search quality. Run: npm run bench [-- <number of notes>]
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { saveConfig } from "../src/config.ts";
import { Store } from "../src/store.ts";
import { TOKENIZER_NAMES } from "../src/text.ts";

const count = Number(process.argv[2] ?? 2500);
const bytesPerNote = 11_000;
const root = fileURLToPath(new URL("..", import.meta.url));

function fixtureTexts(dir: string): string[] {
  const texts: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) texts.push(...fixtureTexts(path));
    else if (entry.name.endsWith(".md")) texts.push(readFileSync(path, "utf8"));
  }
  return texts;
}

// A small linear congruential generator, so every run builds the same vault.
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

function makeVault(): { vault: string; bytes: number } {
  const vault = join(mkdtempSync(join(tmpdir(), "contextbase-bench-")), "vault");
  const paragraphs = fixtureTexts(join(root, "fixtures/vault"))
    .flatMap((text) => text.split(/\n\s*\n/))
    .filter((paragraph) => paragraph.trim() && !paragraph.startsWith("---"));
  let bytes = 0;
  for (let i = 0; i < count; i++) {
    const next = random(i + 1);
    const parts = [`# 筆記 ${i}`, `編號 note${i}`];
    let size = 0;
    while (size < bytesPerNote) {
      const paragraph = paragraphs[Math.floor(next() * paragraphs.length)]!;
      parts.push(paragraph);
      size += Buffer.byteLength(paragraph) + 2;
    }
    const folder = join(vault, `資料夾 ${i % 50}`);
    mkdirSync(folder, { recursive: true });
    const text = `${parts.join("\n\n")}\n`;
    writeFileSync(join(folder, `筆記 ${i}.md`), text);
    bytes += Buffer.byteLength(text);
  }
  return { vault, bytes };
}

const { queries } = JSON.parse(readFileSync(join(root, "fixtures/queries.json"), "utf8")) as {
  queries: Array<{ query: string }>;
};
const { vault, bytes } = makeVault();
console.log(`Synthetic vault: ${count} notes, ${(bytes / 1_048_576).toFixed(1)} MB\n`);
console.log(`| Tokenizer | Full index | Check, nothing changed | One note changed | Search (mean of ${queries.length}) | Index size |`);
console.log("| --- | --- | --- | --- | --- | --- |");
for (const tokenizer of TOKENIZER_NAMES) {
  saveConfig(vault, { exclude: [], saveDeny: [], tokenizer });
  const store = Store.open(vault);
  const time = (work: () => void): number => {
    const started = performance.now();
    work();
    return performance.now() - started;
  };
  const full = time(() => store.sync());
  const idle = time(() => store.sync());
  appendFileSync(join(vault, "資料夾 0", "筆記 0.md"), "\n新增的一行。\n");
  const one = time(() => store.sync());
  const search = time(() => {
    for (const { query } of queries) store.search(query, { limit: 5 });
  });
  store.close();
  const size = statSync(join(vault, ".contextbase", "index.sqlite")).size / 1_048_576;
  console.log(
    `| ${tokenizer} | ${(full / 1000).toFixed(1)} s | ${idle.toFixed(0)} ms | ${one.toFixed(0)} ms | ${(search / queries.length).toFixed(1)} ms | ${size.toFixed(0)} MB |`,
  );
}
