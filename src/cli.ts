#!/usr/bin/env node
// The `contextbase` command: the MCP server, the hooks, installation, and a few commands for
// looking at the index by hand. Hooks run on every prompt, so the MCP SDK is loaded only by the
// commands that need it.
import { parseArgs } from "node:util";
import { UsageError, vaultOf, type Options } from "./args.ts";
import { loadConfig, normalizeFolder, saveConfig } from "./config.ts";
import { buildDigest } from "./digest.ts";
import { formatHit } from "./format.ts";
import { Store } from "./store.ts";
import { VERSION } from "./version.ts";

const USAGE = `contextbase ${VERSION}: shared memory for AI agents, kept as notes in an Obsidian vault

Usage:
  contextbase serve --vault <path>                 run the MCP server on stdio
  contextbase index --vault <path>                 bring the index up to date
  contextbase search <words> --vault <path>        search notes and memories
  contextbase recent --vault <path>                print the recent-work digest
  contextbase exclude list|add|remove [folder] --vault <path>
  contextbase hook session-start|prompt|stop --vault <path> --client claude|codex
  contextbase init --vault <path> [--scope vault|user] [--yes]
  contextbase uninstall --vault <path> [--scope vault|user] [--yes]
  contextbase doctor --vault <path>

--vault can be left out when CONTEXTBASE_VAULT is set.`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      vault: { type: "string" },
      kind: { type: "string" },
      limit: { type: "string" },
      cwd: { type: "string" },
      client: { type: "string" },
      scope: { type: "string" },
      yes: { type: "boolean", short: "y" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean" },
    },
  });
  const [command, ...rest] = positionals;
  if (values.version) {
    console.log(VERSION);
    return 0;
  }
  if (values.help || !command) {
    console.log(USAGE);
    return command || values.help ? 0 : 1;
  }

  switch (command) {
    case "serve": {
      const { runServer } = await import("./server.ts");
      await runServer(vaultOf(values));
      return 0;
    }
    case "index":
      return withStore(values, (store) => {
        const stats = store.sync();
        const counts = store.counts();
        console.log(
          `${counts.notes} notes and ${counts.memories} memories indexed ` +
            `(${stats.indexed} re-read, ${stats.removed} removed, ${stats.ms} ms, tokenizer ${store.tokenizer}).`,
        );
        return 0;
      });
    case "search":
      return withStore(values, (store) => {
        store.sync();
        const kind = values.kind === "memory" || values.kind === "note" ? values.kind : "all";
        const hits = store.search(rest.join(" "), {
          kind,
          limit: Number(values.limit ?? 5),
          cwd: typeof values.cwd === "string" ? values.cwd : process.cwd(),
        });
        console.log(hits.length ? hits.map((hit, index) => formatHit(hit, index + 1)).join("\n") : "No matches.");
        return 0;
      });
    case "recent":
      return withStore(values, (store) => {
        store.sync();
        const cwd = typeof values.cwd === "string" ? values.cwd : process.cwd();
        console.log(buildDigest(store, { cwd }) || "No memories yet.");
        return 0;
      });
    case "exclude":
      return exclude(values, rest);
    default: {
      const { run } = await import("./commands.ts");
      return run(command, rest, values);
    }
  }
}

function withStore(values: Options, work: (store: Store) => number): number {
  const store = Store.open(vaultOf(values));
  try {
    return work(store);
  } finally {
    store.close();
  }
}

function exclude(values: Options, rest: string[]): number {
  const vault = vaultOf(values);
  const config = loadConfig(vault);
  const [action = "list", folder] = rest;
  if (action === "list") {
    console.log(config.exclude.length ? config.exclude.join("\n") : "Nothing excluded besides dot-folders and node_modules.");
    return 0;
  }
  if (!folder || (action !== "add" && action !== "remove")) {
    throw new UsageError("Usage: contextbase exclude list|add|remove <folder> --vault <path>");
  }
  const target = normalizeFolder(folder);
  const next = config.exclude.filter((item) => item !== target);
  if (action === "add") next.push(target);
  saveConfig(vault, { ...config, exclude: next.sort() });
  console.log(`${action === "add" ? "Excluded" : "No longer excluded"}: ${target}. The next search updates the index.`);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code !== 0) process.exitCode = code; // `serve` keeps running until the client hangs up
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(error instanceof UsageError ? message : `contextbase: ${message}`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  },
);
