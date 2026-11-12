// One-command install and uninstall for Claude Code and Codex (plan 5.2, assumptions H8–H13).
//
// `init` only plans by default: every change names the file it touches, and nothing is written
// until the user agrees. Files that already exist are copied to <file>.before-contextbase once,
// before the first change. In the user's own files only Contextbase's entries are added or
// removed: hooks whose command runs this CLI, one permission rule, and in Codex's TOML a block
// between two marker comments.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { ensureContextbaseDir } from "./config.ts";
import { readHookRuns } from "./state.ts";
import { Store } from "./store.ts";

export type Scope = "vault" | "user";

export interface InstallContext {
  vault: string; // absolute
  scope: Scope;
  home: string;
  node: string; // absolute path of the Node.js that runs Contextbase
  cli: string; // absolute path of this CLI
  claude: string | null; // the Claude Code CLI, if installed
}

export interface Change {
  what: string;
  apply: () => void;
}

export interface Plan {
  changes: Change[];
  notes: string[]; // things only the user can do, printed after the changes
}

const SERVER = "contextbase";
const PERMISSION = "mcp__contextbase";
const MARK_BEGIN = "# >>> obsidian-contextbase (managed by `contextbase init`; `contextbase uninstall` removes it)";
const MARK_END = "# <<< obsidian-contextbase";
const HOOK_TIMEOUT = 15; // seconds
const EVENTS = [
  ["SessionStart", "session-start"],
  ["UserPromptSubmit", "prompt"],
  ["Stop", "stop"],
] as const;

export function files(ctx: InstallContext) {
  const vaultScope = ctx.scope === "vault";
  return {
    claudeSettings: vaultScope ? join(ctx.vault, ".claude", "settings.local.json") : join(ctx.home, ".claude", "settings.json"),
    codexConfig: vaultScope ? join(ctx.vault, ".codex", "config.toml") : join(ctx.home, ".codex", "config.toml"),
    codexHooks: vaultScope ? join(ctx.vault, ".codex", "hooks.json") : join(ctx.home, ".codex", "hooks.json"),
    codexUserConfig: join(ctx.home, ".codex", "config.toml"),
  };
}

// ---- install -----------------------------------------------------------------------------------

export function planInstall(ctx: InstallContext): Plan {
  if (/[\\/]_npx[\\/]/.test(ctx.cli)) {
    throw new Error(
      "Install Contextbase with `npm install -g obsidian-contextbase` first, then run `contextbase init`: " +
        "npx keeps packages in a cache that can be cleaned, which would break the paths written into your settings.",
    );
  }
  const paths = files(ctx);
  const codexText = readText(paths.codexConfig);
  if (hasUnmanagedServer(codexText)) {
    throw new Error(
      `${paths.codexConfig} already defines [mcp_servers.${SERVER}] outside Contextbase's managed block. ` +
        "Remove that entry first, then run init again.",
    );
  }
  const where = ctx.scope === "vault" ? "sessions started in this vault" : "every project";
  const changes: Change[] = [
    {
      what: `Create ${join(ctx.vault, ".contextbase")}/ (kept out of Git by its own .gitignore) and build the search index`,
      apply: () => {
        ensureContextbaseDir(ctx.vault);
        const store = Store.open(ctx.vault);
        try {
          store.sync();
        } finally {
          store.close();
        }
      },
    },
  ];

  const claudeArgs = ["mcp", "add", SERVER, "--scope", ctx.scope === "vault" ? "local" : "user", "--", ...serverCommand(ctx)];
  const notes: string[] = [];
  if (ctx.claude) {
    changes.push({
      what: `Register the MCP server with Claude Code for ${where}: claude ${claudeArgs.map(shellQuote).join(" ")}`,
      apply: () => {
        runClaude(ctx, ["mcp", "remove", SERVER, "--scope", ctx.scope === "vault" ? "local" : "user"], true);
        runClaude(ctx, claudeArgs, false);
      },
    });
  } else {
    notes.push(`Claude Code's CLI was not found. To register the server, run in ${ctx.vault}: claude ${claudeArgs.map(shellQuote).join(" ")}`);
  }

  changes.push(
    {
      what: `Add three hooks (session start, prompt, stop) and the permission rule ${PERMISSION} to ${paths.claudeSettings}`,
      apply: () => editJson(paths.claudeSettings, (settings) => addClaudeEntries(settings, ctx)),
    },
    {
      what: `Add the MCP server, with its tools approved, to ${paths.codexConfig}`,
      apply: () => editText(paths.codexConfig, (text) => `${removeManagedBlock(text).trimEnd()}\n\n${codexBlock(ctx)}\n`.trimStart()),
    },
    {
      what: `Add three hooks to ${paths.codexHooks}`,
      apply: () => editJson(paths.codexHooks, (hooks) => addCodexHooks(hooks, ctx)),
    },
  );

  const ignore = missingIgnores(ctx);
  if (ignore.length > 0) {
    const gitignore = join(ctx.vault, ".gitignore");
    changes.push({
      what: `Add ${ignore.join(" and ")} to ${gitignore}, so these local settings stay out of the vault's Git history`,
      apply: () => editText(gitignore, (text) => `${text.trimEnd()}\n${ignore.join("\n")}\n`.trimStart()),
    });
  }

  if (ctx.scope === "vault" && !codexTrusts(ctx)) {
    notes.push(`Codex reads ${paths.codexConfig} only for trusted folders: open Codex in ${ctx.vault} once and trust it.`);
  }
  notes.push(
    "In Codex, run /hooks once and trust the three Contextbase hooks; until then Codex skips them without a warning.",
    `Start a new Claude Code or Codex session${ctx.scope === "vault" ? " in the vault" : ""}; sessions that are already open do not load the changes.`,
  );
  return { changes, notes };
}

function serverCommand(ctx: InstallContext): string[] {
  return [ctx.node, ctx.cli, "serve", "--vault", ctx.vault];
}

function hookArgs(ctx: InstallContext, event: string, client: string): string[] {
  return [ctx.cli, "hook", event, "--vault", ctx.vault, "--client", client];
}

type Json = Record<string, unknown>;
interface HookGroup {
  matcher?: string;
  hooks?: Array<Record<string, unknown>>;
}

function addClaudeEntries(settings: Json, ctx: InstallContext): Json {
  const cleaned = removeClaudeEntries(settings, ctx);
  const hooks = (cleaned.hooks ?? {}) as Record<string, HookGroup[]>;
  for (const [event, name] of EVENTS) {
    hooks[event] = [
      ...(hooks[event] ?? []),
      { hooks: [{ type: "command", command: ctx.node, args: hookArgs(ctx, name, "claude"), timeout: HOOK_TIMEOUT }] },
    ];
  }
  const permissions = (cleaned.permissions ?? {}) as { allow?: string[] };
  permissions.allow = [...(permissions.allow ?? []), PERMISSION];
  return { ...cleaned, permissions, hooks };
}

function addCodexHooks(config: Json, ctx: InstallContext): Json {
  const cleaned = removeCodexHooks(config, ctx);
  const hooks = (cleaned.hooks ?? {}) as Record<string, HookGroup[]>;
  for (const [event, name] of EVENTS) {
    const command = [ctx.node, ...hookArgs(ctx, name, "codex")].map(shellQuote).join(" ");
    hooks[event] = [...(hooks[event] ?? []), { hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT }] }];
  }
  return { ...cleaned, hooks };
}

function codexBlock(ctx: InstallContext): string {
  return [
    MARK_BEGIN,
    `[mcp_servers.${SERVER}]`,
    `command = ${toml(ctx.node)}`,
    `args = [${serverCommand(ctx).slice(1).map(toml).join(", ")}]`,
    'default_tools_approval_mode = "approve"',
    MARK_END,
  ].join("\n");
}

// ---- uninstall ---------------------------------------------------------------------------------

export function planUninstall(ctx: InstallContext): Plan {
  const paths = files(ctx);
  const changes: Change[] = [];
  const notes: string[] = [];
  const scope = ctx.scope === "vault" ? "local" : "user";
  if (ctx.claude) {
    changes.push({
      what: `Remove the MCP server from Claude Code: claude mcp remove ${SERVER} --scope ${scope}`,
      apply: () => runClaude(ctx, ["mcp", "remove", SERVER, "--scope", scope], true),
    });
  } else {
    notes.push(`Claude Code's CLI was not found. To remove the server, run in ${ctx.vault}: claude mcp remove ${SERVER} --scope ${scope}`);
  }
  if (existsSync(paths.claudeSettings)) {
    changes.push({
      what: `Remove Contextbase's hooks and permission rule from ${paths.claudeSettings}`,
      apply: () => editJson(paths.claudeSettings, (settings) => removeClaudeEntries(settings, ctx)),
    });
  }
  if (readText(paths.codexConfig).includes(MARK_BEGIN)) {
    changes.push({
      what: `Remove Contextbase's block from ${paths.codexConfig}`,
      apply: () => editText(paths.codexConfig, (text) => removeManagedBlock(text)),
    });
  }
  if (existsSync(paths.codexHooks)) {
    changes.push({
      what: `Remove Contextbase's hooks from ${paths.codexHooks}`,
      apply: () => {
        const left = removeCodexHooks(readJson(paths.codexHooks), ctx);
        const empty = Object.keys((left.hooks ?? {}) as Json).length === 0 && Object.keys(left).length <= 1;
        if (empty) rmSync(paths.codexHooks);
        else writeJson(paths.codexHooks, left);
      },
    });
  }
  notes.push(
    `Memories stay in ${join(ctx.vault, "Agent Memory")}/, and the index stays in ${join(ctx.vault, ".contextbase")}/; delete that folder to remove the index.`,
  );
  return { changes, notes };
}

function removeClaudeEntries(settings: Json, ctx: InstallContext): Json {
  const result: Json = { ...settings };
  if (result.hooks && typeof result.hooks === "object") {
    result.hooks = withoutOurHooks(result.hooks as Record<string, HookGroup[]>, (hook) =>
      isOurCli(ctx, Array.isArray(hook.args) ? String(hook.args[0] ?? "") : ""),
    );
    if (Object.keys(result.hooks as Json).length === 0) delete result.hooks;
  }
  const permissions = result.permissions as { allow?: unknown } | undefined;
  if (permissions && Array.isArray(permissions.allow)) {
    result.permissions = { ...permissions, allow: permissions.allow.filter((rule) => rule !== PERMISSION) };
  }
  return result;
}

function removeCodexHooks(config: Json, ctx: InstallContext): Json {
  const result: Json = { ...config };
  if (result.hooks && typeof result.hooks === "object") {
    result.hooks = withoutOurHooks(result.hooks as Record<string, HookGroup[]>, (hook) => {
      const command = typeof hook.command === "string" ? hook.command : "";
      return / hook (session-start|prompt|stop) /.test(command) && (command.includes(ctx.cli) || /obsidian-contextbase/.test(command));
    });
  }
  return result;
}

function withoutOurHooks(
  hooks: Record<string, HookGroup[]>,
  isOurs: (hook: Record<string, unknown>) => boolean,
): Record<string, HookGroup[]> {
  const result: Record<string, HookGroup[]> = {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = groups
      .map((group) => ({ ...group, hooks: (group.hooks ?? []).filter((hook) => !isOurs(hook)) }))
      .filter((group) => group.hooks.length > 0);
    if (kept.length > 0) result[event] = kept;
  }
  return result;
}

// The CLI that wrote an entry may have moved since (a reinstall), so recognise it by name too.
function isOurCli(ctx: InstallContext, path: string): boolean {
  return path === ctx.cli || /[\\/]obsidian-contextbase[\\/]dist[\\/]cli\.js$/.test(path);
}

function hasUnmanagedServer(text: string): boolean {
  return /^\s*\[mcp_servers\.("?)contextbase\1\]/m.test(removeManagedBlock(text));
}

function removeManagedBlock(text: string): string {
  const start = text.indexOf(MARK_BEGIN);
  if (start === -1) return text;
  const end = text.indexOf(MARK_END, start);
  if (end === -1) return text;
  const before = text.slice(0, start).trimEnd();
  const after = text.slice(end + MARK_END.length).replace(/^\n+/, "").trimEnd();
  const joined = before && after ? `${before}\n\n${after}` : `${before}${after}`;
  return joined ? `${joined}\n` : "";
}

// ---- checks ------------------------------------------------------------------------------------

function missingIgnores(ctx: InstallContext): string[] {
  if (ctx.scope !== "vault" || !existsSync(join(ctx.vault, ".git"))) return [];
  const wanted = [".codex/", ".claude/settings.local.json"];
  return wanted.filter((path) => {
    const check = spawnSync("git", ["-C", ctx.vault, "check-ignore", "-q", path]);
    if (check.status === 0) return false; // already ignored
    if (check.status === 1) return true;
    const text = readText(join(ctx.vault, ".gitignore")); // git missing: fall back to a plain look
    return !text.split(/\r?\n/).some((line) => line.trim().replace(/\/$/, "") === path.replace(/\/$/, ""));
  });
}

function codexTrusts(ctx: InstallContext): boolean {
  const text = readText(files(ctx).codexUserConfig);
  const header = `[projects.${JSON.stringify(ctx.vault)}]`;
  const start = text.indexOf(header);
  if (start === -1) return false;
  const section = text.slice(start + header.length).split(/\n\[/)[0] ?? "";
  return /trust_level\s*=\s*"trusted"/.test(section);
}

export function doctor(ctx: InstallContext): string[] {
  const paths = files(ctx);
  const lines: string[] = [];
  const mark = (ok: boolean, text: string) => lines.push(`${ok ? "✓" : "✗"} ${text}`);

  const store = Store.open(ctx.vault);
  try {
    const stats = store.sync();
    const counts = store.counts();
    mark(true, `Index: ${counts.notes} notes and ${counts.memories} memories (tokenizer ${store.tokenizer}, ${stats.ms} ms to check)`);
  } finally {
    store.close();
  }

  if (ctx.claude) {
    const result = spawnSync(ctx.claude, ["mcp", "get", SERVER], { cwd: ctx.vault, encoding: "utf8" });
    const status = /Status:\s*(.+)/.exec(result.stdout ?? "")?.[1]?.trim();
    mark(result.status === 0 && Boolean(status?.includes("Connected")), `Claude Code MCP server: ${status ?? "not registered for this vault"}`);
  } else {
    lines.push("? Claude Code MCP server: the claude CLI was not found, so it cannot be checked");
  }
  const claudeHooks = JSON.stringify(readJson(paths.claudeSettings).hooks ?? {});
  mark(claudeHooks.includes(ctx.cli), `Claude Code hooks in ${paths.claudeSettings}`);
  mark(readText(paths.codexConfig).includes(MARK_BEGIN), `Codex MCP server in ${paths.codexConfig}`);
  const codexHooks = readText(paths.codexHooks);
  mark(codexHooks.includes(ctx.cli), `Codex hooks in ${paths.codexHooks}`);
  const trusted = readText(paths.codexUserConfig).includes(`[hooks.state."${paths.codexHooks}:session_start`);
  mark(trusted, trusted ? "Codex hooks trusted" : "Codex hooks not trusted yet: run /hooks in Codex and trust them");

  const runs = readHookRuns(ctx.vault);
  for (const client of ["claude", "codex"]) {
    const last = Object.entries(runs)
      .filter(([key]) => key.startsWith(`${client}:`))
      .map(([, at]) => at)
      .sort()
      .at(-1);
    mark(Boolean(last), last ? `${client} hooks last ran at ${last}` : `${client} hooks have not run yet`);
  }
  return lines;
}

// ---- small file helpers ------------------------------------------------------------------------

function runClaude(ctx: InstallContext, args: string[], tolerateFailure: boolean): void {
  const result = spawnSync(ctx.claude!, args, { cwd: ctx.vault, encoding: "utf8" });
  if (result.status !== 0 && !tolerateFailure) {
    throw new Error(`claude ${args.join(" ")} failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
}

// Homebrew runs Node from a versioned Cellar folder that the next upgrade deletes, while the
// `node` in its bin folder is a link that follows upgrades. Prefer the first `node` on PATH when it
// is the same program, so the commands written into settings keep working after an upgrade.
export function stableNodePath(execPath: string): string {
  const onPath = findOnPath("node");
  if (!onPath || onPath === execPath) return execPath;
  try {
    return realpathSync(onPath) === realpathSync(execPath) ? onPath : execPath;
  } catch {
    return execPath;
  }
}

export function findOnPath(command: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, command);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function readText(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function readJson(file: string): Json {
  const text = readText(file);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Json;
  } catch (error) {
    throw new Error(`${file} is not valid JSON, so it was left alone (${error instanceof Error ? error.message : String(error)})`);
  }
}

function writeJson(file: string, value: Json): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function backupOnce(file: string): void {
  const backup = `${file}.before-contextbase`;
  if (existsSync(file) && !existsSync(backup)) copyFileSync(file, backup);
}

function editJson(file: string, change: (value: Json) => Json): void {
  const value = readJson(file); // throws before anything is touched if the file is broken
  backupOnce(file);
  writeJson(file, change(value));
}

function editText(file: string, change: (text: string) => string): void {
  const text = readText(file);
  backupOnce(file);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, change(text));
}

function toml(value: string): string {
  return JSON.stringify(value); // TOML basic strings use the same escapes
}

export function shellQuote(value: string): string {
  return /^[A-Za-z0-9_/.:=@%+-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}
