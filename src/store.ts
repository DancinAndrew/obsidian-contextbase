// The search index: SQLite FTS5 in <vault>/.contextbase/index.sqlite (decision D2).
//
// `notes` has one row per Markdown file; `chunks` splits each note into pieces with line numbers;
// `chunks_fts` holds the tokenized text of each chunk under the same rowid. A memory note is one
// chunk, and its front matter is copied into columns so that ranking and the digest never have
// to open files. Everything here can be rebuilt from the vault, so the index is disposable.
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { ensureContextbaseDir, loadConfig, type VaultConfig } from "./config.ts";
import { chunkLines, field, linkTarget, listField, parseNote, type Chunk } from "./markdown.ts";
import { finalScore, type RankFacts } from "./rank.ts";
import { indexText, matchQuery, tokenize, type TokenizerName } from "./text.ts";
import { locationOf, scanVault, type VaultFile } from "./vault.ts";

export const MEMORY_FOLDER = "Agent Memory";
export const MEMORY_TYPES = ["decision", "progress", "fact"] as const;
const SCHEMA_VERSION = "2"; // 2: the FTS table stores only its index, not the tokenized text

export interface MemoryInfo {
  path: string;
  name: string;
  type: string;
  summary: string;
  decidedBy: string | null;
  agent: string | null;
  cwd: string | null;
  about: string[]; // link targets as written
  supersedes: string | null; // link target as written
  created: string | null;
  next: string | null;
  supersededBy: string | null; // path of the memory that replaced this one
  topic: string | null; // folder of the first `about` note that resolves, else the cwd
}

export interface SearchHit {
  path: string;
  name: string;
  kind: "memory" | "note";
  title: string;
  startLine: number;
  endLine: number;
  line: number; // the line the snippet was taken from
  snippet: string;
  score: number; // after ranking
  relevance: number; // BM25 alone; larger is better
  memory?: MemoryInfo;
}

export interface SearchOptions {
  kind?: "memory" | "note" | "all";
  limit?: number;
  cwd?: string; // the agent's working folder, used for scope (decision D7)
  now?: Date;
  includeSuperseded?: boolean;
  ranking?: boolean; // false: order by BM25 alone, for evaluating what ranking adds
}

export interface SyncStats {
  scanned: number;
  indexed: number;
  removed: number;
  ms: number;
}

interface NoteRow {
  id: number;
  path: string;
  name: string;
  kind: string;
  mtime: number;
  size: number;
  type: string | null;
  summary: string | null;
  decided_by: string | null;
  agent: string | null;
  cwd: string | null;
  about: string | null;
  supersedes: string | null;
  created: string | null;
  next: string | null;
  superseded_by: string | null;
  topic: string | null;
}

interface HitRow extends NoteRow {
  chunk_id: number;
  start_line: number;
  end_line: number;
  text: string;
  bm25: number;
}

const NEXT_LINE = /^\s*(?:\*\*)?(?:下一步|next)\s*[:：]\s*(?:\*\*)?\s*(.+)$/i;

export class Store {
  readonly vault: string;
  readonly config: VaultConfig;
  readonly db: DatabaseSync;
  private names: { byName: Map<string, string[]>; byPath: Map<string, string> } | undefined;
  private statements: Record<string, StatementSync> = {};
  private writes: Record<string, StatementSync> = {};
  private lastSync = 0;

  static open(vault: string, config: VaultConfig = loadConfig(vault)): Store {
    return new Store(vault, config);
  }

  constructor(vault: string, config: VaultConfig) {
    this.vault = vault;
    this.config = config;
    const file = join(ensureContextbaseDir(vault), "index.sqlite");
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    this.migrate();
  }

  get tokenizer(): TokenizerName {
    return this.config.tokenizer;
  }

  close(): void {
    this.db.close();
  }

  // ---- schema --------------------------------------------------------------------------------

  private migrate(): void {
    this.transaction(() => {
      this.db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
      const read = this.db.prepare("SELECT value FROM meta WHERE key = ?");
      const schema = (read.get("schema") as { value: string } | undefined)?.value;
      const tokenizer = (read.get("tokenizer") as { value: string } | undefined)?.value;
      if (schema === SCHEMA_VERSION && tokenizer === this.config.tokenizer) return;

      // Another schema or tokenizer makes every stored term wrong, so start over.
      this.db.exec("DROP TABLE IF EXISTS chunks_fts; DROP TABLE IF EXISTS chunks; DROP TABLE IF EXISTS notes;");
      try {
        // Snippets come from `chunks`, so FTS5 does not need its own copy of the text: a
        // contentless table keeps only the index, and contentless_delete still allows deletes.
        this.db.exec(
          "CREATE VIRTUAL TABLE chunks_fts USING fts5(title, body, content = '', contentless_delete = 1, tokenize = 'unicode61')",
        );
      } catch (error) {
        throw new Error(
          `This Node.js build cannot create SQLite FTS5 tables (${message(error)}). ` +
            "Contextbase needs a Node.js release whose built-in SQLite includes FTS5.",
        );
      }
      this.db.exec(`
        CREATE TABLE notes (
          id INTEGER PRIMARY KEY,
          path TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          kind TEXT NOT NULL,
          mtime REAL NOT NULL,
          size INTEGER NOT NULL,
          type TEXT, summary TEXT, decided_by TEXT, agent TEXT, cwd TEXT,
          about TEXT, supersedes TEXT, created TEXT, next TEXT,
          superseded_by TEXT, topic TEXT
        );
        CREATE TABLE chunks (
          id INTEGER PRIMARY KEY,
          note_id INTEGER NOT NULL,
          start_line INTEGER NOT NULL,
          end_line INTEGER NOT NULL,
          text TEXT NOT NULL
        );
        CREATE INDEX chunks_by_note ON chunks(note_id);
      `);
      const setMeta = this.write(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      );
      setMeta.run("schema", SCHEMA_VERSION);
      setMeta.run("tokenizer", this.config.tokenizer);
    });
  }

  private statement(sql: string): StatementSync {
    return (this.statements[sql] ??= this.db.prepare(sql));
  }

  // Every write goes through here. run() reports the connection's last inserted rowid, and a
  // delete from the contentless FTS5 table can leave it at an internal page id above 2^53
  // (65537 << 37 on Node 26 in CI). Some Node.js releases throw ERR_OUT_OF_RANGE instead of
  // returning such a number, so writes read their result as a BigInt; the two inserts that
  // need the new id convert it back, since note and chunk ids stay small.
  private write(sql: string): StatementSync {
    let statement = this.writes[sql];
    if (!statement) {
      statement = this.db.prepare(sql);
      statement.setReadBigInts(true);
      this.writes[sql] = statement;
    }
    return statement;
  }

  private transaction(work: () => void): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      work();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  // ---- keeping the index current -------------------------------------------------------------

  // Compares every file's modification time and size with the index, re-reads only the files
  // that changed, and drops the ones that are gone (assumption M5).
  sync(): SyncStats {
    const started = performance.now();
    const files = scanVault(this.vault, this.config.exclude);
    const known = new Map<string, { id: number; mtime: number; size: number }>();
    for (const row of this.statement("SELECT id, path, mtime, size FROM notes").all() as unknown as NoteRow[]) {
      known.set(row.path, row);
    }
    const changed = files.filter((file) => {
      const row = known.get(file.path);
      return !row || row.mtime !== file.mtimeMs || row.size !== file.size;
    });
    const present = new Set(files.map((file) => file.path));
    const removed = [...known.entries()].filter(([path]) => !present.has(path)).map(([, row]) => row.id);

    if (changed.length > 0 || removed.length > 0) {
      this.transaction(() => {
        for (const id of removed) this.deleteNote(id);
        for (const file of changed) this.indexFile(file, known.get(file.path)?.id);
        this.names = undefined;
        this.refreshMemoryLinks();
      });
    }
    this.lastSync = Date.now();
    return { scanned: files.length, indexed: changed.length, removed: removed.length, ms: Math.round(performance.now() - started) };
  }

  // Tools call this before every query; within maxAgeMs of the last sync the index is trusted.
  syncIfStale(maxAgeMs = 2000): SyncStats | null {
    return Date.now() - this.lastSync < maxAgeMs ? null : this.sync();
  }

  private deleteNote(id: number): void {
    this.write("DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE note_id = ?)").run(id);
    this.write("DELETE FROM chunks WHERE note_id = ?").run(id);
    this.write("DELETE FROM notes WHERE id = ?").run(id);
  }

  private indexFile(file: VaultFile, oldId: number | undefined): void {
    if (oldId !== undefined) this.deleteNote(oldId);
    let text: string;
    try {
      text = readFileSync(join(this.vault, file.path), "utf8");
    } catch {
      return; // gone since the scan
    }
    const note = parseNote(text);
    const name = posix.basename(file.path).replace(/\.md$/i, "");
    const type = field(note.data, "type");
    const isMemory =
      file.path.startsWith(`${MEMORY_FOLDER}/`) && type !== undefined && (MEMORY_TYPES as readonly string[]).includes(type);
    const body = note.lines.slice(note.bodyStart);

    let title = name;
    let chunks: Chunk[];
    let row: unknown[] = [null, null, null, null, null, null, null, null, null];
    if (isMemory) {
      const summary = field(note.data, "summary") ?? name;
      const about = listField(note.data, "about").map(linkTarget).filter(Boolean);
      const supersedes = field(note.data, "supersedes");
      title = summary;
      // The note's own words plus the names of the notes it is about, so a search for a topic
      // also finds the memories linked to it.
      chunks = [{ startLine: 1, endLine: lastNonBlank(note.lines), text: [summary, about.join(" "), ...body].join("\n").trim() }];
      row = [
        type,
        summary,
        field(note.data, "decided_by") ?? null,
        field(note.data, "agent") ?? null,
        field(note.data, "cwd") ?? null,
        JSON.stringify(about),
        supersedes ? linkTarget(supersedes) || null : null,
        field(note.data, "created") ?? null,
        findNext(body),
      ];
    } else {
      chunks = chunkLines(note.lines, note.bodyStart);
      if (chunks.length === 0) chunks = [{ startLine: 1, endLine: 1, text: "" }]; // still findable by name
    }

    const inserted = this.write(
      `INSERT INTO notes (path, name, kind, mtime, size, type, summary, decided_by, agent, cwd, about, supersedes, created, next)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(file.path, name, isMemory ? "memory" : "note", file.mtimeMs, file.size, ...(row as (string | null)[]));
    const noteId = Number(inserted.lastInsertRowid);
    const titleTerms = indexText(tokenize(title, this.tokenizer));
    for (const chunk of chunks) {
      const added = this.write("INSERT INTO chunks (note_id, start_line, end_line, text) VALUES (?, ?, ?, ?)").run(
        noteId,
        chunk.startLine,
        chunk.endLine,
        chunk.text,
      );
      this.write("INSERT INTO chunks_fts (rowid, title, body) VALUES (?, ?, ?)").run(
        Number(added.lastInsertRowid),
        titleTerms,
        indexText(tokenize(chunk.text, this.tokenizer)),
      );
    }
  }

  // "Superseded" and "topic" depend on other notes, so they are derived after every change
  // instead of being stored in the memory note itself (plan 5.3: memories are never rewritten).
  private refreshMemoryLinks(): void {
    const rows = this.statement(
      "SELECT id, path, about, supersedes, cwd, created FROM notes WHERE kind = 'memory' ORDER BY created, path",
    ).all() as unknown as NoteRow[];
    const supersededBy = new Map<string, string>();
    for (const row of rows) {
      if (!row.supersedes) continue;
      const target = this.resolve(row.supersedes);
      if (target && target !== row.path) supersededBy.set(target, row.path); // the later memory wins
    }
    const update = this.write("UPDATE notes SET superseded_by = ?, topic = ? WHERE id = ?");
    for (const row of rows) {
      let topic: string | null = null;
      for (const name of parseList(row.about)) {
        const path = this.resolve(name);
        if (path) {
          topic = folderOf(path);
          break;
        }
      }
      if (topic === null && row.cwd) topic = row.cwd === "." ? "" : row.cwd;
      update.run(supersededBy.get(row.path) ?? null, topic, row.id);
    }
  }

  // ---- names and links -----------------------------------------------------------------------

  private nameMaps(): { byName: Map<string, string[]>; byPath: Map<string, string> } {
    if (!this.names) {
      const byName = new Map<string, string[]>();
      const byPath = new Map<string, string>();
      for (const { path, name } of this.statement("SELECT path, name FROM notes").all() as unknown as NoteRow[]) {
        const key = nameKey(name);
        const list = byName.get(key) ?? [];
        list.push(path);
        byName.set(key, list);
        byPath.set(nameKey(path.replace(/\.md$/i, "")), path);
      }
      // Like Obsidian, an ambiguous name goes to the note with the shortest path.
      for (const list of byName.values()) list.sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
      this.names = { byName, byPath };
    }
    return this.names;
  }

  // The path of the note a wikilink or a bare name points to, or null.
  resolve(target: string): string | null {
    const name = linkTarget(target).replace(/\.md$/i, "");
    if (!name) return null;
    const { byName, byPath } = this.nameMaps();
    const key = nameKey(name);
    if (key.includes("/")) return byPath.get(key) ?? null;
    return byName.get(key)?.[0] ?? null;
  }

  // Note names that look like the target, for an `about` that does not resolve (assumption M9).
  suggest(target: string, limit = 3): string[] {
    const wanted = new Set(tokenize(linkTarget(target), "bigram"));
    const wantedKey = nameKey(linkTarget(target));
    const scored: Array<{ label: string; score: number }> = [];
    for (const [key, paths] of this.nameMaps().byName) {
      const have = new Set(tokenize(key, "bigram"));
      let score = jaccard(wanted, have);
      if (key.includes(wantedKey) || wantedKey.includes(key)) score += 0.3;
      if (score <= 0) continue;
      for (const path of paths) {
        scored.push({ label: paths.length > 1 ? path.replace(/\.md$/i, "") : posix.basename(path, ".md"), score });
      }
    }
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.label);
  }

  // ---- reading -------------------------------------------------------------------------------

  memories(): MemoryInfo[] {
    const rows = this.statement("SELECT * FROM notes WHERE kind = 'memory' ORDER BY created DESC, path DESC").all();
    return (rows as unknown as NoteRow[]).map(toMemory);
  }

  memory(path: string): MemoryInfo | undefined {
    const row = this.statement("SELECT * FROM notes WHERE kind = 'memory' AND path = ?").get(path);
    return row ? toMemory(row as unknown as NoteRow) : undefined;
  }

  // The indexed text of a memory: summary, the names it is about, and its body.
  memoryText(path: string): string {
    const row = this.statement(
      "SELECT c.text FROM chunks c JOIN notes n ON n.id = c.note_id WHERE n.path = ? AND n.kind = 'memory' LIMIT 1",
    ).get(path) as { text: string } | undefined;
    return row?.text ?? "";
  }

  counts(): { notes: number; memories: number; chunks: number } {
    const one = (sql: string): number => Number((this.statement(sql).get() as { n: number }).n);
    return {
      notes: one("SELECT count(*) AS n FROM notes WHERE kind = 'note'"),
      memories: one("SELECT count(*) AS n FROM notes WHERE kind = 'memory'"),
      chunks: one("SELECT count(*) AS n FROM chunks"),
    };
  }

  search(query: string, options: SearchOptions = {}): SearchHit[] {
    const { kind = "all", limit = 5, now = new Date(), includeSuperseded = true } = options;
    const terms = tokenize(query, this.tokenizer);
    const match = matchQuery(terms);
    if (match === null) return [];
    const kindFilter = kind === "all" ? "" : "AND n.kind = ?";
    const rows = this.statement(
      `SELECT n.*, c.id AS chunk_id, c.start_line, c.end_line, c.text, bm25(chunks_fts, 2.0, 1.0) AS bm25
       FROM chunks_fts
       JOIN chunks c ON c.id = chunks_fts.rowid
       JOIN notes n ON n.id = c.note_id
       WHERE chunks_fts MATCH ? ${kindFilter}
       ORDER BY bm25
       LIMIT 400`,
    ).all(...(kind === "all" ? [match] : [match, kind])) as unknown as HitRow[];

    const here = locationOf(this.vault, options.cwd);
    const best = new Map<string, { row: HitRow; score: number }>();
    for (const row of rows) {
      const relevance = -row.bm25; // FTS5 returns negative scores: more negative is better
      const facts: RankFacts = {
        kind: row.kind === "memory" ? "memory" : "note",
        type: row.type,
        decidedBy: row.decided_by,
        created: row.created,
        superseded: row.superseded_by !== null,
        location: row.kind === "memory" ? row.topic : folderOf(row.path),
      };
      const score = options.ranking === false ? relevance : finalScore(relevance, facts, here, now);
      const current = best.get(row.path);
      if (!current || score > current.score) best.set(row.path, { row, score });
    }

    const termSet = new Set(terms);
    return [...best.values()]
      .filter(({ row }) => includeSuperseded || row.superseded_by === null)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ row, score }) => {
        const isMemory = row.kind === "memory";
        const picked = isMemory
          ? { line: 1, snippet: clip(row.summary ?? row.name, 160) }
          : bestLine(row.text, row.start_line, termSet, this.tokenizer);
        return {
          path: row.path,
          name: row.name,
          kind: isMemory ? "memory" : "note",
          title: isMemory ? (row.summary ?? row.name) : row.name,
          startLine: row.start_line,
          endLine: row.end_line,
          line: picked.line,
          snippet: picked.snippet,
          score,
          relevance: -row.bm25,
          ...(isMemory ? { memory: toMemory(row) } : {}),
        } satisfies SearchHit;
      });
  }
}

// ---- helpers ---------------------------------------------------------------------------------

function toMemory(row: NoteRow): MemoryInfo {
  return {
    path: row.path,
    name: row.name,
    type: row.type ?? "progress",
    summary: row.summary ?? row.name,
    decidedBy: row.decided_by,
    agent: row.agent,
    cwd: row.cwd,
    about: parseList(row.about),
    supersedes: row.supersedes,
    created: row.created,
    next: row.next,
    supersededBy: row.superseded_by,
    topic: row.topic,
  };
}

function parseList(json: string | null): string[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function folderOf(path: string): string {
  const dir = posix.dirname(path);
  return dir === "." ? "" : dir;
}

function nameKey(name: string): string {
  return name.normalize("NFC").toLowerCase();
}

function lastNonBlank(lines: string[]): number {
  let last = lines.length;
  while (last > 1 && lines[last - 1]!.trim() === "") last--;
  return Math.max(1, last);
}

function findNext(body: string[]): string | null {
  for (const line of body) {
    const match = NEXT_LINE.exec(line);
    if (match) return match[1]!.trim();
  }
  return null;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared++;
  return shared / (a.size + b.size - shared);
}

export function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

// The line of a chunk that contains the most query terms, with its line number in the file.
function bestLine(
  text: string,
  startLine: number,
  terms: Set<string>,
  tokenizer: TokenizerName,
): { line: number; snippet: string } {
  const lines = text.split("\n");
  let best = 0;
  let bestCount = -1;
  for (let i = 0; i < lines.length; i++) {
    let count = 0;
    for (const term of new Set(tokenize(lines[i]!, tokenizer))) if (terms.has(term)) count++;
    if (count > bestCount) {
      best = i;
      bestCount = count;
    }
  }
  return { line: startLine + best, snippet: clip((lines[best] ?? "").trim(), 160) };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
