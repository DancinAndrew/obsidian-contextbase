// "Recent work": what the session-start hook injects and what the `recent` tool returns.
//
// At the vault root the working folder says nothing about the topic, so memories are grouped by
// topic. In a subfolder, or in a project outside the vault, the memories nearest to it come
// first (decision D7). Replaced memories never appear: the injected text is read as current fact.
import type { MemoryInfo, Store } from "./store.ts";
import { locationOf } from "./vault.ts";

export interface RecentOptions {
  cwd?: string;
  type?: string;
  limit?: number;
}

export function sharedLevels(location: string | null, current: string): number {
  if (location === null) return 0;
  const here = current.split("/").filter(Boolean);
  const there = location.split("/").filter(Boolean);
  if (current.startsWith("/") !== location.startsWith("/")) return 0;
  let shared = 0;
  while (shared < here.length && shared < there.length && here[shared] === there[shared]) shared++;
  return shared;
}

// Memories that have not been replaced, newest first; away from the vault root, the ones that
// share more folder levels with the working folder come first.
export function recentMemories(store: Store, options: RecentOptions = {}): MemoryInfo[] {
  const { type, limit = 10 } = options;
  const here = locationOf(store.vault, options.cwd);
  const live = store.memories().filter((memory) => memory.supersededBy === null && (!type || memory.type === type));
  if (here === null || here === "") return live.slice(0, limit);
  return live
    .map((memory, order) => ({ memory, order, shared: sharedLevels(memory.topic, here) }))
    .sort((a, b) => b.shared - a.shared || a.order - b.order)
    .slice(0, limit)
    .map((item) => item.memory);
}

export interface DigestOptions {
  cwd?: string;
  maxChars?: number;
  topics?: number;
  perTopic?: number;
}

const FOOTER = "Use the search tool for details. Notes in Agent Memory/ are append-only; do not edit them by hand.";

// At most `topics` topics with `perTopic` memories each, cut to maxChars (assumption H2).
export function buildDigest(store: Store, options: DigestOptions = {}): string {
  const { maxChars = 1500, topics = 4, perTopic = 3 } = options;
  const here = locationOf(store.vault, options.cwd);
  const live = store.memories().filter((memory) => memory.supersededBy === null);
  if (live.length === 0) return "";

  const blocks: string[][] = [];
  let header: string;
  if (here === null || here === "") {
    header = "[Contextbase] Recent work, by topic";
    const groups = new Map<string, MemoryInfo[]>();
    for (const memory of live) {
      const key = memory.topic ?? "";
      groups.set(key, [...(groups.get(key) ?? []), memory]);
    }
    for (const [topic, items] of [...groups].slice(0, topics)) {
      blocks.push([topic === "" ? "(no topic)" : topic]);
      for (const memory of items.slice(0, perTopic)) blocks.push(describe(store, memory));
    }
  } else {
    header = `[Contextbase] Recent work, nearest to ${here} first`;
    for (const memory of recentMemories(store, { cwd: options.cwd, limit: topics * perTopic })) {
      blocks.push(describe(store, memory));
    }
  }
  return fit(header, blocks, FOOTER, maxChars);
}

export function describeMemory(store: Store, memory: MemoryInfo): string[] {
  return describe(store, memory);
}

function describe(store: Store, memory: MemoryInfo): string[] {
  const agent = memory.agent ?? "an agent";
  let who = agent;
  if (memory.type === "decision") {
    who = memory.decidedBy === "user" ? `decided by the user, recorded by ${agent}` : `proposed by ${agent}`;
  }
  const lines = [`- ${day(memory.created)} ${memory.type} (${who}): ${memory.summary}`];
  if (memory.next) lines.push(`  next: ${memory.next}`);
  if (memory.supersedes) {
    const path = store.resolve(memory.supersedes);
    const old = path ? store.memory(path) : undefined;
    if (old) lines.push(`  replaces ${day(old.created)}: ${old.summary}`);
  }
  return lines;
}

function day(created: string | null): string {
  return /^\d{4}-\d{2}-\d{2}/.exec(created ?? "")?.[0] ?? "undated";
}

// Adds whole blocks while they fit, and never leaves a topic heading without a memory under it.
function fit(header: string, blocks: string[][], footer: string, maxChars: number): string {
  const lines = [header];
  let used = header.length + footer.length + 2;
  for (const block of blocks) {
    const size = block.reduce((sum, line) => sum + line.length + 1, 0);
    if (used + size > maxChars) break;
    lines.push(...block);
    used += size;
  }
  while (lines.length > 1 && !lines.at(-1)!.startsWith(" ") && !lines.at(-1)!.startsWith("-")) lines.pop();
  if (lines.length === 1) return "";
  lines.push(footer);
  return lines.join("\n");
}
