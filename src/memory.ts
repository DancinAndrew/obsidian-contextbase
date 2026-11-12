// Writing memory notes: one note per memory in Agent Memory/<year-month>/ (decision D3).
//
// Before anything is written, the request is checked in this order, and the first problem is
// returned to the agent instead of being silently fixed:
//   1. words the vault keeps out of memory (config saveDeny),
//   2. `about` names that match no note (M0 saw agents write folder paths there),
//   3. a `supersedes` that names no memory,
//   4. similar memories that already exist (decision D9), unless the agent replaces one with
//      `supersedes` or insists with `confirm`.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { linkTarget } from "./markdown.ts";
import { jaccard, MEMORY_FOLDER, type MemoryInfo, type MEMORY_TYPES, type Store } from "./store.ts";
import { tokenize } from "./text.ts";
import { locationOf } from "./vault.ts";

export type MemoryType = (typeof MEMORY_TYPES)[number];

export interface SaveInput {
  type: MemoryType;
  summary: string;
  body: string;
  decidedBy: "user" | "agent";
  about?: string[];
  supersedes?: string;
  confirm?: boolean;
}

export interface SaveContext {
  agent: string;
  cwd?: string;
  now?: Date;
}

export interface SimilarMemory {
  path: string;
  link: string;
  summary: string;
  created: string | null;
  overlap: number;
}

export type SaveResult =
  | { status: "saved"; path: string; link: string; replaced?: string }
  | { status: "similar"; similar: SimilarMemory[] }
  | { status: "unresolved"; field: "about" | "supersedes"; names: Array<{ name: string; suggestions: string[] }> }
  | { status: "refused"; reason: string };

// Assumption M8: the same `about` note and 30 % shared character pairs, or 50 % on their own.
export const SIMILARITY = { sameAbout: 0.3, any: 0.5, max: 3 } as const;

// clientInfo.name as each client sends it (M0), mapped to the name a memory records.
export function agentName(clientName: string | undefined): string {
  if (!clientName) return "unknown";
  const known: Record<string, string> = { "claude-code": "claude-code", "codex-mcp-client": "codex" };
  return known[clientName] ?? clientName;
}

export function saveMemory(store: Store, input: SaveInput, context: SaveContext): SaveResult {
  store.sync();

  const denied = store.config.saveDeny.find((word) =>
    [input.summary, input.body, ...(input.about ?? []), input.supersedes ?? ""].some((text) => text.includes(word)),
  );
  if (denied) return { status: "refused", reason: `this vault keeps work that mentions "${denied}" out of agent memory` };

  const aboutPaths: string[] = [];
  const unresolved: Array<{ name: string; suggestions: string[] }> = [];
  for (const raw of input.about ?? []) {
    const name = linkTarget(raw);
    if (!name) continue;
    const path = store.resolve(name);
    if (path) aboutPaths.push(path);
    else unresolved.push({ name, suggestions: store.suggest(name) });
  }
  if (unresolved.length > 0) return { status: "unresolved", field: "about", names: unresolved };

  let replaced: MemoryInfo | undefined;
  if (input.supersedes) {
    const path = store.resolve(input.supersedes);
    replaced = path ? store.memory(path) : undefined;
    if (!replaced) {
      const name = linkTarget(input.supersedes);
      return { status: "unresolved", field: "supersedes", names: [{ name, suggestions: store.suggest(name) }] };
    }
  }

  if (!replaced && !input.confirm) {
    const similar = findSimilar(store, input, aboutPaths);
    if (similar.length > 0) return { status: "similar", similar };
  }

  const now = context.now ?? new Date();
  const month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const folder = join(store.vault, MEMORY_FOLDER, month);
  mkdirSync(folder, { recursive: true });
  const stem = `${datePart(now)} ${pad(now.getHours())}${pad(now.getMinutes())} ${safeFileName(input.summary)}`;
  const fileName = uniqueName(folder, stem);
  const where = locationOf(store.vault, context.cwd);
  writeFileSync(
    join(folder, fileName),
    renderNote({
      type: input.type,
      summary: input.summary.trim(),
      decidedBy: input.decidedBy,
      agent: context.agent,
      cwd: where === null || where === "" ? "." : where,
      about: aboutPaths.map((path) => linkTo(store, path)),
      supersedes: replaced ? linkTo(store, replaced.path) : null,
      created: localIso(now),
      body: input.body.trim(),
    }),
    { flag: "wx" },
  );
  store.sync();
  const path = `${MEMORY_FOLDER}/${month}/${fileName}`;
  return {
    status: "saved",
    path,
    link: `[[${fileName.replace(/\.md$/, "")}]]`,
    ...(replaced ? { replaced: replaced.path } : {}),
  };
}

function findSimilar(store: Store, input: SaveInput, aboutPaths: string[]): SimilarMemory[] {
  const aboutNames = aboutPaths.map((path) => posix.basename(path, ".md"));
  const wanted = new Set(tokenize([input.summary, aboutNames.join(" "), input.body].join("\n"), "bigram"));
  const about = new Set(aboutPaths);
  const found: SimilarMemory[] = [];
  for (const memory of store.memories()) {
    if (memory.supersededBy !== null) continue;
    const overlap = jaccard(wanted, new Set(tokenize(store.memoryText(memory.path), "bigram")));
    const sharesAbout = memory.about.some((name) => {
      const path = store.resolve(name);
      return path !== null && about.has(path);
    });
    if (overlap >= SIMILARITY.any || (sharesAbout && overlap >= SIMILARITY.sameAbout)) {
      found.push({
        path: memory.path,
        link: `[[${memory.name}]]`,
        summary: memory.summary,
        created: memory.created,
        overlap: Math.round(overlap * 100) / 100,
      });
    }
  }
  return found.sort((a, b) => b.overlap - a.overlap).slice(0, SIMILARITY.max);
}

// A link that resolves to exactly this note: the bare name when it is unique, else the path.
function linkTo(store: Store, path: string): string {
  const name = posix.basename(path, ".md");
  return store.resolve(name) === path ? `[[${name}]]` : `[[${path.replace(/\.md$/, "")}]]`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function datePart(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// ISO 8601 with the local offset, e.g. 2026-11-09T14:32:00+08:00.
export function localIso(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `${datePart(date)}T${time}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// Obsidian forbids \ / : in file names and # ^ [ ] | in link targets.
export function safeFileName(text: string): string {
  const cleaned = text.replace(/[\\/:*?"<>|#^[\]\r\n\t]/g, " ").replace(/\s+/g, " ").trim();
  return Array.from(cleaned).slice(0, 40).join("").trim() || "memory";
}

function uniqueName(folder: string, stem: string): string {
  let name = `${stem}.md`;
  for (let n = 2; existsSync(join(folder, name)); n++) name = `${stem} ${n}.md`;
  return name;
}

interface NoteFields {
  type: string;
  summary: string;
  decidedBy: string;
  agent: string;
  cwd: string;
  about: string[];
  supersedes: string | null;
  created: string;
  body: string;
}

export function renderNote(fields: NoteFields): string {
  return [
    "---",
    `type: ${fields.type}`,
    `summary: ${JSON.stringify(fields.summary)}`,
    `decided_by: ${fields.decidedBy}`,
    `agent: ${JSON.stringify(fields.agent)}`,
    `cwd: ${JSON.stringify(fields.cwd)}`,
    "about:",
    ...fields.about.map((link) => `  - ${JSON.stringify(link)}`),
    fields.supersedes ? `supersedes: ${JSON.stringify(fields.supersedes)}` : "supersedes:",
    `created: ${fields.created}`,
    "---",
    fields.body,
    "",
  ].join("\n");
}
