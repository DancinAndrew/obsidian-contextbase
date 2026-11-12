// Per-vault settings, kept next to the index in <vault>/.contextbase/ (decision D2).
// The folder carries its own .gitignore that ignores everything, so neither the index nor this
// file ever reaches the user's Git history, and Obsidian Sync skips folders that start with a dot.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TOKENIZER_NAMES, type TokenizerName } from "./text.ts";

export interface VaultConfig {
  exclude: string[]; // vault-relative folders kept out of the index and out of fetch
  saveDeny: string[]; // a memory that mentions one of these words is not written
  tokenizer: TokenizerName;
}

// Provisional until the author decides (assumption M2 in docs/assumptions.md).
export const DEFAULT_TOKENIZER: TokenizerName = "bigram";

export function contextbaseDir(vault: string): string {
  return join(vault, ".contextbase");
}

export function ensureContextbaseDir(vault: string): string {
  const dir = contextbaseDir(vault);
  mkdirSync(dir, { recursive: true });
  const ignore = join(dir, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
  return dir;
}

export function normalizeFolder(folder: string): string {
  return folder
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part !== "" && part !== ".")
    .join("/");
}

export function loadConfig(vault: string): VaultConfig {
  const file = join(contextbaseDir(vault), "config.json");
  let raw: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch (error) {
      throw new Error(`${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  const tokenizer = TOKENIZER_NAMES.includes(raw.tokenizer as TokenizerName)
    ? (raw.tokenizer as TokenizerName)
    : DEFAULT_TOKENIZER;
  return {
    exclude: strings(raw.exclude).map(normalizeFolder).filter(Boolean),
    saveDeny: strings(raw.saveDeny).map((word) => word.trim()).filter(Boolean),
    tokenizer,
  };
}

export function saveConfig(vault: string, config: VaultConfig): void {
  const dir = ensureContextbaseDir(vault);
  writeFileSync(join(dir, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
}
