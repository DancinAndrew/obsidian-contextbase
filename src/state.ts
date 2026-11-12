// Small state files that let the hooks and the MCP server cooperate without talking to each other.
//
// Both sides know the client's session id (M0: Codex sends it in each tool call's _meta, Claude
// Code puts it in the server's environment), so they meet in .contextbase/sessions/<id>.json.
// When the server cannot tell the session, the hooks fall back to the time of the last save
// (assumption H6). Writes go through a temporary file and a rename, so a reader never sees half
// a file.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { contextbaseDir } from "./config.ts";

export interface SessionState {
  client: string;
  startedAt: string;
  turn: number; // prompts submitted so far
  turnStartedAt: string | null;
  firstPromptHandled: boolean;
  lastSaveAt: string | null;
  lastSaveTurn: number | null;
  lastBlockTurn: number | null; // the turn in which the Stop hook last asked for a save
}

export function newSession(client: string, now: Date): SessionState {
  return {
    client,
    startedAt: now.toISOString(),
    turn: 0,
    turnStartedAt: null,
    firstPromptHandled: false,
    lastSaveAt: null,
    lastSaveTurn: null,
    lastBlockTurn: null,
  };
}

function safeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100) || "unknown";
}

function sessionsDir(vault: string): string {
  return join(contextbaseDir(vault), "sessions");
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(join(file, ".."), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, file);
}

export function readSession(vault: string, sessionId: string): SessionState | null {
  return readJson<SessionState>(join(sessionsDir(vault), `${safeId(sessionId)}.json`));
}

export function writeSession(vault: string, sessionId: string, state: SessionState): void {
  writeJson(join(sessionsDir(vault), `${safeId(sessionId)}.json`), state);
}

// Session files older than maxAgeDays are deleted when a new session starts.
export function pruneSessions(vault: string, now: Date, maxAgeDays = 30): void {
  const dir = sessionsDir(vault);
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    try {
      if (now.getTime() - statSync(file).mtimeMs > maxAgeDays * 86_400_000) rmSync(file);
    } catch {
      // another process removed it first
    }
  }
}

export interface LastSave {
  at: string;
  sessionId: string | null;
}

// Called by the server after every save.
export function recordSave(vault: string, sessionId: string | undefined, now: Date): void {
  writeJson(join(contextbaseDir(vault), "state", "last-save.json"), {
    at: now.toISOString(),
    sessionId: sessionId ?? null,
  } satisfies LastSave);
  if (!sessionId) return;
  const state = readSession(vault, sessionId);
  if (!state) return; // a session whose hooks never ran has no turn count to update
  state.lastSaveAt = now.toISOString();
  state.lastSaveTurn = state.turn;
  writeSession(vault, sessionId, state);
}

export function readLastSave(vault: string): LastSave | null {
  return readJson<LastSave>(join(contextbaseDir(vault), "state", "last-save.json"));
}

// The doctor command reads these to tell whether a client's hooks have ever run.
export function recordHookRun(vault: string, client: string, event: string, now: Date): void {
  const file = join(contextbaseDir(vault), "state", "hook-runs.json");
  const runs = readJson<Record<string, string>>(file) ?? {};
  runs[`${client}:${event}`] = now.toISOString();
  writeJson(file, runs);
}

export function readHookRuns(vault: string): Record<string, string> {
  return readJson<Record<string, string>>(join(contextbaseDir(vault), "state", "hook-runs.json")) ?? {};
}
