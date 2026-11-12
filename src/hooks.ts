// The three hooks (decision D4, plan 5.6), shared by Claude Code and Codex.
//
//   session-start  the memory's purpose (D11) and the recent-work digest
//   prompt         on a session's first prompt only, the memories most related to it (D7)
//   stop           at the end of a turn, ask once for a save when work may have gone unsaved
//
// Both clients send the same JSON on stdin and accept the same replies (M0): plain text on stdout
// becomes context for session-start and prompt, and {"decision":"block","reason":...} keeps a
// Stop from ending the turn, with the reason handed to the agent.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildDigest, describeMemory } from "./digest.ts";
import { MEMORY_PURPOSE } from "./instructions.ts";
import {
  newSession,
  pruneSessions,
  readLastSave,
  readSession,
  recordHookRun,
  writeSession,
  type SessionState,
} from "./state.ts";
import { MEMORY_FOLDER, Store } from "./store.ts";
import { realPath } from "./vault.ts";

export interface HookInput {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  source?: string;
  prompt?: string;
  stop_hook_active?: boolean;
}

export interface HookOptions {
  vault: string;
  client: string;
  now?: Date;
}

export type HookEvent = "session-start" | "prompt" | "stop";

// Decision D4 with assumptions H4 and H5.
export const STOP_RULES = {
  turnsWithoutSave: 5,
  quietTurnsAfterBlock: 3,
  scanLimit: 5000,
} as const;

// Assumption H3: at most two memories, each at least half as relevant as the best one. The floor
// of 3 comes from the fixture vault, where related first prompts scored 5 to 12.6 and unrelated
// ones at most 2.8 (character pairs such as 天的 match across words). BM25 grows with the size of
// the vault, so this needs re-checking against real use.
export const RECALL = {
  maxMemories: 2,
  minRelevance: 3,
  relativeToTop: 0.5,
} as const;

export const STOP_REASON =
  "[Contextbase] Before you finish: if this turn produced a decision, finished a piece of work, or revealed a " +
  "preference that another agent would need later, save it now with the `save` tool of the contextbase MCP server " +
  "(what and why, then what comes next). If there is nothing worth keeping, say so in one short sentence and stop.";

const EVENT_NAMES: Record<string, HookEvent> = {
  "session-start": "session-start",
  sessionstart: "session-start",
  prompt: "prompt",
  userpromptsubmit: "prompt",
  stop: "stop",
};

export function hookEvent(name: string | undefined): HookEvent | undefined {
  return name ? EVENT_NAMES[name.toLowerCase()] : undefined;
}

// Returns what the hook prints on stdout; an empty string means "nothing to add".
export function runHook(event: HookEvent, input: HookInput, options: HookOptions): string {
  const now = options.now ?? new Date();
  recordHookRun(options.vault, options.client, event, now);
  switch (event) {
    case "session-start":
      return sessionStart(input, options, now);
    case "prompt":
      return prompt(input, options, now);
    case "stop":
      return stop(input, options);
  }
}

function sessionStart(input: HookInput, options: HookOptions, now: Date): string {
  const id = input.session_id;
  if (id) {
    const existing = readSession(options.vault, id);
    // A resumed or compacted session keeps its turn count; a new or cleared one starts over.
    if (!existing || input.source === "startup" || input.source === "clear") {
      writeSession(options.vault, id, newSession(options.client, now));
    }
    if (input.source === "startup") pruneSessions(options.vault, now);
  }
  const store = Store.open(options.vault);
  try {
    store.sync();
    const digest = buildDigest(store, input.cwd ? { cwd: input.cwd } : {});
    return [`[Contextbase] ${MEMORY_PURPOSE}`, digest].filter(Boolean).join("\n\n");
  } finally {
    store.close();
  }
}

function prompt(input: HookInput, options: HookOptions, now: Date): string {
  const id = input.session_id ?? "unknown";
  const state = readSession(options.vault, id) ?? newSession(options.client, now);
  state.turn += 1;
  state.turnStartedAt = now.toISOString();
  let output = "";
  if (!state.firstPromptHandled && input.prompt?.trim()) {
    state.firstPromptHandled = true;
    output = recall(input.prompt, input.cwd, options, now);
  }
  writeSession(options.vault, id, state);
  return output;
}

// The memories most related to the first prompt, so the agent does not have to think of searching.
export function recall(text: string, cwd: string | undefined, options: HookOptions, now: Date): string {
  const store = Store.open(options.vault);
  try {
    store.sync();
    const hits = store.search(text, { kind: "memory", limit: 5, now, includeSuperseded: false, ...(cwd ? { cwd } : {}) });
    const top = hits[0]?.relevance ?? 0;
    const picked = hits
      .filter((hit) => hit.relevance >= RECALL.minRelevance && hit.relevance >= top * RECALL.relativeToTop)
      .slice(0, RECALL.maxMemories);
    if (picked.length === 0) return "";
    const lines = ["[Contextbase] Memories related to this request:"];
    for (const hit of picked) {
      if (!hit.memory) continue;
      lines.push(...describeMemory(store, hit.memory), `  (${hit.path})`);
    }
    return lines.join("\n");
  } finally {
    store.close();
  }
}

function stop(input: HookInput, options: HookOptions): string {
  if (input.stop_hook_active) return ""; // already continuing because of a Stop hook
  const id = input.session_id ?? "unknown";
  const state = readSession(options.vault, id);
  if (!state) return ""; // without the other hooks there is no turn to judge
  const turnStart = Date.parse(state.turnStartedAt ?? state.startedAt);

  if (savedSince(options.vault, id, state, turnStart)) return "";
  if (state.lastBlockTurn !== null && state.turn - state.lastBlockTurn < STOP_RULES.quietTurnsAfterBlock) return "";
  const quietTurns = state.turn - (state.lastSaveTurn ?? 0);
  const changed = changedSince(input.cwd ?? options.vault, turnStart, options.vault);
  if (!changed && quietTurns < STOP_RULES.turnsWithoutSave) return "";

  state.lastBlockTurn = state.turn;
  writeSession(options.vault, id, state);
  return JSON.stringify({ decision: "block", reason: STOP_REASON });
}

function savedSince(vault: string, id: string, state: SessionState, since: number): boolean {
  if (state.lastSaveAt && Date.parse(state.lastSaveAt) >= since) return true;
  // The server could not tell which session saved: any save in this turn's time window counts.
  const last = readLastSave(vault);
  return last !== null && Date.parse(last.at) >= since && (last.sessionId === null || last.sessionId === id);
}

// Whether any file under root changed after `since`, looking at no more than scanLimit entries.
// Dot-folders, node_modules and the memory folder itself do not count (assumption H4).
export function changedSince(root: string, since: number, vault: string): boolean {
  const memoryFolder = realPath(join(vault, MEMORY_FOLDER));
  const pending = [realPath(root)];
  let seen = 0;
  while (pending.length > 0) {
    const dir = pending.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (++seen > STOP_RULES.scanLimit) return false; // too big to tell cheaply: do not interrupt
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (path !== memoryFolder) pending.push(path);
      } else if (entry.isFile()) {
        try {
          if (statSync(path).mtimeMs > since) return true;
        } catch {
          // removed while scanning
        }
      }
    }
  }
  return false;
}
