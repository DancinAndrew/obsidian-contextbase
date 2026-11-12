// The MCP server: four tools over the vault index (plan 5.4), spoken over stdio.
//
// The client starts one server process per session, with the session's working folder as the
// process's working folder (M0), so process.cwd() is where the agent is working.
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { buildDigest, describeMemory, recentMemories } from "./digest.ts";
import { formatHit, formatSave } from "./format.ts";
import { serverInstructions } from "./instructions.ts";
import { agentName, saveMemory } from "./memory.ts";
import { describeArgs, probe, tapTransport } from "./probe.ts";
import { recordSave } from "./state.ts";
import { Store } from "./store.ts";
import { insideVault, isExcluded } from "./vault.ts";
import { VERSION } from "./version.ts";

const FETCH_LIMIT = 400; // lines returned when no range is given

export async function runServer(vault: string): Promise<void> {
  const store = Store.open(vault);
  store.sync();
  const server = createServer(store);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  tapTransport(transport);
}

export function createServer(store: Store): McpServer {
  const server = new McpServer({ name: "obsidian-contextbase", version: VERSION }, { instructions: serverInstructions() });
  const agent = (): string => agentName(server.server.getClientVersion()?.name);

  server.registerTool(
    "search",
    {
      title: "Search memories and notes",
      description:
        "Search the vault's notes and the agents' memory notes. Results are ranked by BM25 relevance, " +
        "then by who decided, how recent a memory is and how close it is to the working folder; a memory " +
        "that a newer one replaced is marked as replaced. Each result gives a path, line numbers and a snippet; " +
        "call fetch to read more.",
      inputSchema: {
        query: z.string().min(1).describe("Words to look for, in any language"),
        kind: z.enum(["memory", "note", "all"]).optional().describe("Only memories, only notes, or both (default)"),
        limit: z.number().int().min(1).max(20).optional().describe("Maximum number of results, default 5"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, kind, limit }, extra) =>
      guard(() => {
        probe("tool-call", { tool: "search", args: describeArgs({ query, kind, limit }), meta: extra._meta });
        store.syncIfStale();
        const hits = store.search(query, { kind: kind ?? "all", limit: limit ?? 5, cwd: process.cwd() });
        if (hits.length === 0) return text("Nothing in the vault matches. Try other words, or fewer of them.");
        return text(hits.map((hit, index) => formatHit(hit, index + 1)).join("\n"));
      }),
  );

  server.registerTool(
    "fetch",
    {
      title: "Read a note",
      description:
        "Read a note or memory from the vault with line numbers. Give the path exactly as search returned it. " +
        `Without lines, the first ${FETCH_LIMIT} lines are returned.`,
      inputSchema: {
        path: z.string().min(1).describe("Vault-relative path ending in .md, as search returned it"),
        lines: z
          .string()
          .regex(/^\d+(-\d+)?$/)
          .optional()
          .describe('A line or a range such as "12" or "10-40"'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ path, lines }, extra) =>
      guard(() => {
        probe("tool-call", { tool: "fetch", args: describeArgs({ path, lines }), meta: extra._meta });
        return text(readNote(store, path, lines));
      }),
  );

  server.registerTool(
    "save",
    {
      title: "Save a memory",
      description:
        "Write one memory note about a decision, a piece of progress, or a fact (a preference the user states is a fact). " +
        "Give a one-line summary, then a body that says what was decided or done, why, and what comes next; " +
        'start the last part with "**Next:**" or "**下一步：**". ' +
        'Set decided_by to "user" only when the user made the decision; your own proposal is "agent". ' +
        "List the vault notes the memory is about by their names in `about`. " +
        "If a similar memory exists, nothing is written and the similar ones are returned: " +
        "replace one by naming it in `supersedes`, or save anyway with `confirm: true`.",
      inputSchema: {
        type: z.enum(["decision", "progress", "fact"]).describe("What kind of memory this is"),
        summary: z.string().min(1).max(200).describe("One line that identifies the memory"),
        body: z.string().min(1).describe("What was decided or done, why, and what should happen next"),
        decided_by: z.enum(["user", "agent"]).describe("Who made the decision"),
        about: z.array(z.string()).optional().describe("Names of the vault notes this memory is about"),
        supersedes: z.string().optional().describe("Name of the older memory this one replaces"),
        confirm: z.boolean().optional().describe("Save even though similar memories exist"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args, extra) =>
      guard(() => {
        probe("tool-call", { tool: "save", args: describeArgs(args), meta: extra._meta });
        const now = new Date();
        const result = saveMemory(
          store,
          {
            type: args.type,
            summary: args.summary,
            body: args.body,
            decidedBy: args.decided_by,
            ...(args.about ? { about: args.about } : {}),
            ...(args.supersedes ? { supersedes: args.supersedes } : {}),
            ...(args.confirm !== undefined ? { confirm: args.confirm } : {}),
          },
          { agent: agent(), cwd: process.cwd(), now },
        );
        if (result.status === "saved") recordSave(store.vault, sessionIdOf(extra._meta), now);
        return text(formatSave(result), result.status !== "saved" && result.status !== "similar");
      }),
  );

  server.registerTool(
    "recent",
    {
      title: "Recent memories",
      description:
        "The latest memories that no newer memory replaced. At the vault root they are grouped by topic; " +
        "in a subfolder, or a project outside the vault, the ones nearest to it come first.",
      inputSchema: {
        scope: z.string().optional().describe("A vault folder to center on; default is the working folder"),
        type: z.enum(["decision", "progress", "fact"]).optional().describe("Only this kind of memory"),
        limit: z.number().int().min(1).max(50).optional().describe("Maximum number of memories, default 10"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ scope, type, limit }, extra) =>
      guard(() => {
        probe("tool-call", { tool: "recent", args: describeArgs({ scope, type, limit }), meta: extra._meta });
        store.syncIfStale();
        const cwd = scope === undefined ? process.cwd() : (insideVault(store.vault, scope) ?? store.vault);
        if (type === undefined) {
          const digest = buildDigest(store, { cwd, maxChars: 6000, topics: 10, perTopic: limit ?? 5 });
          return text(digest || "No memories yet.");
        }
        const memories = recentMemories(store, { cwd, type, limit: limit ?? 10 });
        if (memories.length === 0) return text(`No ${type} memories yet.`);
        return text(memories.flatMap((memory) => describeMemory(store, memory)).join("\n"));
      }),
  );

  return server;
}

// Codex sends its session id with every tool call; Claude Code puts it in the server's environment.
function sessionIdOf(meta: Record<string, unknown> | undefined): string | undefined {
  const fromMeta = meta?.sessionId;
  if (typeof fromMeta === "string" && fromMeta) return fromMeta;
  return process.env.CLAUDE_CODE_SESSION_ID || undefined;
}

export function readNote(store: Store, path: string, lines: string | undefined): string {
  const normalized = path.replaceAll("\\", "/");
  const absolute = insideVault(store.vault, normalized);
  if (!absolute || !normalized.toLowerCase().endsWith(".md")) throw new Error(`Not a note in this vault: ${path}`);
  if (isExcluded(normalized, store.config.exclude)) throw new Error(`This folder is excluded from Contextbase: ${path}`);
  let content: string;
  try {
    content = readFileSync(absolute, "utf8");
  } catch {
    throw new Error(`No such note: ${path}`);
  }
  const all = content.split(/\r?\n/);
  if (all.at(-1) === "") all.pop();
  let start = 1;
  let end = Math.min(all.length, FETCH_LIMIT);
  if (lines) {
    const [from, to] = lines.split("-").map(Number);
    start = Math.max(1, from!);
    end = Math.min(all.length, to ?? from!);
  }
  if (start > all.length) return `${normalized} has ${all.length} lines.`;
  const width = String(end).length;
  const body = all
    .slice(start - 1, end)
    .map((line, index) => `${String(start + index).padStart(width)}| ${line}`)
    .join("\n");
  const more = !lines && all.length > end ? `\n(${end} of ${all.length} lines; pass lines to read the rest)` : "";
  return `${normalized} (lines ${start}-${end} of ${all.length})\n${body}${more}`;
}

function text(value: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text: value }], ...(isError ? { isError: true } : {}) };
}

function guard(work: () => CallToolResult): CallToolResult {
  try {
    return work();
  } catch (error) {
    return text(error instanceof Error ? error.message : String(error), true);
  }
}
