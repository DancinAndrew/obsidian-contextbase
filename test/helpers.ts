import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { saveConfig, type VaultConfig } from "../src/config.ts";

export const FIXTURE_VAULT = fileURLToPath(new URL("../fixtures/vault", import.meta.url));

// Every test runs at the same moment, so recency weights do not drift with the calendar.
export const NOW = new Date("2026-11-12T12:00:00+08:00");

export const PATHS = {
  current: "Agent Memory/2026-11/2026-11-09 1432 第二天改去宇治.md",
  replaced: "Agent Memory/2026-11/2026-11-08 2105 第二天去嵐山.md",
  itinerary: "旅行/京都 2026/京都 2026 行程.md",
};

// A copy of the fixture vault in a temporary folder, with the 私人 folder excluded.
export function tempVault(config: Partial<VaultConfig> = {}): string {
  const vault = join(mkdtempSync(join(tmpdir(), "contextbase-test-")), "vault");
  // Keeping the fixture's timestamps leaves every note older than the turns a test simulates.
  cpSync(FIXTURE_VAULT, vault, { recursive: true, preserveTimestamps: true });
  saveConfig(vault, { exclude: ["私人"], saveDeny: [], tokenizer: "bigram", ...config });
  return vault;
}
