// Command-line helpers shared by the CLI and its subcommands.
import { statSync } from "node:fs";
import { resolve } from "node:path";

export type Options = Record<string, string | boolean | undefined>;

export class UsageError extends Error {}

export function vaultOf(values: Options): string {
  const value = typeof values.vault === "string" ? values.vault : process.env.CONTEXTBASE_VAULT;
  if (!value) throw new UsageError("Which vault? Pass --vault <path> or set CONTEXTBASE_VAULT.");
  const vault = resolve(value);
  let isDir = false;
  try {
    isDir = statSync(vault).isDirectory();
  } catch {
    // reported below
  }
  if (!isDir) throw new UsageError(`Not a folder: ${vault}`);
  return vault;
}

export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
