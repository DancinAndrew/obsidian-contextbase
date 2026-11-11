// M0 server: the tool names and shapes follow docs/plan.md section 5.4, but `search` returns fake data
// and `save` writes a minimal note. Its purpose is to find out what Claude Code and Codex really do.
//
// Environment (all optional):
//   CONTEXTBASE_VAULT      folder that receives `Agent Memory/` notes
//   CONTEXTBASE_TOOLS      comma list of tools to register, default "search,save"
//   CONTEXTBASE_CANARY     "1" adds head and tail canaries to the instructions
//   CONTEXTBASE_SAVE_DENY  comma list of words; a memory that mentions one of them is refused
//   CONTEXTBASE_PROBE_LOG  file that receives the wire log (see probe.ts)
//   CONTEXTBASE_PROBE_REDACT  "1" records tool arguments as their shape only
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { buildInstructions } from "./instructions.ts";
import { describeArgs, describeEnv, probe, tapTransport } from "./probe.ts";

const vault = process.env.CONTEXTBASE_VAULT;
const saveDeny = (process.env.CONTEXTBASE_SAVE_DENY ?? "")
  .split(",")
  .map((word) => word.trim())
  .filter(Boolean);
const enabledTools = new Set(
  (process.env.CONTEXTBASE_TOOLS ?? "search,save").split(",").map((name) => name.trim()),
);

const server = new McpServer(
  { name: "obsidian-contextbase", version: "0.0.0" },
  {
    instructions: buildInstructions({
      hasSearch: enabledTools.has("search"),
      canary: process.env.CONTEXTBASE_CANARY === "1",
    }),
  },
);

// ---- what the client tells us about where it is working ----------------------------------------

let rootPaths: string[] = [];

server.server.oninitialized = () => {
  void captureClientFacts();
};

async function captureClientFacts(): Promise<void> {
  probe("initialized", {
    clientInfo: server.server.getClientVersion(),
    capabilities: server.server.getClientCapabilities(),
    cwd: process.cwd(),
    ppid: process.ppid,
    env: describeEnv(process.env),
  });
  try {
    const { roots } = await server.server.listRoots(undefined, { timeout: 5000 });
    rootPaths = roots.filter((root) => root.uri.startsWith("file:")).map((root) => fileURLToPath(root.uri));
    probe("roots", { roots });
  } catch (error) {
    probe("roots-error", { message: error instanceof Error ? error.message : String(error) });
  }
}

function resolveCwd(): { value: string; source: string } {
  const firstRoot = rootPaths[0];
  if (firstRoot) return { value: firstRoot, source: "roots/list" };
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (projectDir) return { value: projectDir, source: "CLAUDE_PROJECT_DIR" };
  return { value: process.cwd(), source: "process.cwd" };
}

// ---- tools -------------------------------------------------------------------------------------

const FAKE_SEARCH_RESULT = [
  "[M0 probe: fake data, not from a real index]",
  "1. [memory, decision] Agent Memory/2026-11/2026-11-09 1432 第二天改去宇治.md (lines 1-7)",
  "   score 1.50 | codex | 2026-11-09 | decided by the user",
  "   第二天改去宇治，嵐山移到第四天。",
  "2. [memory, decision, superseded] Agent Memory/2026-11/2026-11-08 2105 第二天去嵐山.md (lines 1-6)",
  "   score 1.32 | claude-code | 2026-11-08 | superseded by the 11-09 decision",
].join("\n");

if (enabledTools.has("search")) {
  server.registerTool(
    "search",
    {
      title: "Search memories and notes",
      description: "Search the vault's memories and notes by keyword. Returns ranked snippets with their paths.",
      inputSchema: {
        query: z.string().describe("Keywords to look for"),
        kind: z.enum(["memory", "note", "all"]).optional().describe("Only memories, only ordinary notes, or all (default)"),
        limit: z.number().int().min(1).max(20).optional().describe("Maximum number of results, default 5"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, kind, limit }, extra) => {
      probe("tool-call", {
        tool: "search",
        args: describeArgs({ query, kind, limit }),
        meta: extra._meta,
        sessionId: extra.sessionId,
        requestId: extra.requestId,
      });
      return { content: [{ type: "text", text: FAKE_SEARCH_RESULT }] };
    },
  );
}

if (enabledTools.has("save")) {
  server.registerTool(
    "save",
    {
      title: "Save a memory",
      description:
        "Write one memory note about a decision, a piece of progress or a fact (a preference the user states is a fact). " +
        "Give a one-line summary, then a body that says what was decided, why, and what comes next. " +
        'Set decided_by to "user" only when the user made the decision; a model\'s own proposal is "agent". ' +
        "List the notes the memory is about in `about`.",
      inputSchema: {
        type: z.enum(["decision", "progress", "fact"]).describe("What kind of memory this is"),
        summary: z.string().min(1).describe("One line that identifies the memory"),
        body: z.string().min(1).describe("What was decided or done, why, and what should happen next"),
        decided_by: z.enum(["user", "agent"]).describe("Who made the decision"),
        about: z.array(z.string()).optional().describe("Names of the vault notes this memory is about"),
        supersedes: z.string().optional().describe("Name of an older memory this one replaces"),
        confirm: z.boolean().optional().describe("Save even if similar memories exist (not used in M0)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args, extra) => {
      const where = resolveCwd();
      probe("tool-call", {
        tool: "save",
        args: describeArgs(args),
        meta: extra._meta,
        sessionId: extra.sessionId,
        requestId: extra.requestId,
        cwd: where,
      });
      if (!vault) return failure("CONTEXTBASE_VAULT is not set, so there is nowhere to save.");

      // Matches explicit mentions only; the real exclusion list (decision D6) comes in M1.
      const memoryText = [args.summary, args.body, ...(args.about ?? []), args.supersedes ?? ""].join("\n");
      const denied = saveDeny.find((word) => memoryText.includes(word));
      if (denied) {
        probe("save-denied", { word: denied });
        return failure(`Not saved: this vault keeps work that mentions "${denied}" out of agent memory.`);
      }

      const now = new Date();
      const folder = join(vault, "Agent Memory", `${now.getFullYear()}-${pad(now.getMonth() + 1)}`);
      mkdirSync(folder, { recursive: true });
      const stem = `${datePart(now)} ${pad(now.getHours())}${pad(now.getMinutes())} ${safeFileName(args.summary)}`;
      const file = uniquePath(folder, stem);
      writeFileSync(
        file,
        renderNote({
          type: args.type,
          summary: args.summary,
          decidedBy: args.decided_by,
          agent: server.server.getClientVersion()?.name ?? "unknown",
          cwd: displayCwd(vault, where.value),
          about: (args.about ?? []).map(asLink),
          supersedes: args.supersedes ? asLink(args.supersedes) : "",
          created: localIso(now),
          body: args.body,
        }),
        { flag: "wx" },
      );
      return { content: [{ type: "text", text: `Saved ${relative(vault, file)}\nLink: [[${basename(file, ".md")}]]` }] };
    },
  );
}

function failure(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

// ---- note writing ------------------------------------------------------------------------------

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function datePart(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localIso(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `${datePart(date)}T${time}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// Obsidian forbids \ / : in file names and # ^ [ ] | in link targets.
function safeFileName(text: string): string {
  const cleaned = text.replace(/[\\/:*?"<>|#^[\]\r\n\t]/g, " ").replace(/\s+/g, " ").trim();
  return Array.from(cleaned).slice(0, 40).join("") || "memory";
}

function uniquePath(folder: string, stem: string): string {
  let candidate = join(folder, `${stem}.md`);
  for (let n = 2; existsSync(candidate); n++) candidate = join(folder, `${stem} ${n}.md`);
  return candidate;
}

function asLink(name: string): string {
  return `[[${name.trim().replace(/^\[\[|\]\]$/g, "")}]]`;
}

// The working folder as the note records it: relative to the vault, or absolute when outside it.
function displayCwd(vaultPath: string, cwd: string): string {
  const rel = relative(vaultPath, cwd);
  if (rel === "") return ".";
  return rel.startsWith("..") || isAbsolute(rel) ? cwd : rel;
}

function renderNote(fields: {
  type: string;
  summary: string;
  decidedBy: string;
  agent: string;
  cwd: string;
  about: string[];
  supersedes: string;
  created: string;
  body: string;
}): string {
  const lines = [
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
    fields.body.trim(),
    "",
  ];
  return lines.join("\n");
}

// ---- start -------------------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
tapTransport(transport);
