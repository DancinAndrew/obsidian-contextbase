import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { runHook } from "../src/hooks.ts";
import { doctor, planInstall, planUninstall, stableNodePath, type InstallContext } from "../src/install.ts";
import { realPath } from "../src/vault.ts";
import { tempVault } from "./helpers.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const read = (file: string) => readFileSync(file, "utf8");

// A vault under Git, a home folder with settings already in it, and a fake `claude` that only
// records how it was called. Nothing here touches the real home folder.
function setup(scope: "vault" | "user") {
  const vault = tempVault();
  spawnSync("git", ["init", "-q", vault]);
  const root = mkdtempSync(join(tmpdir(), "contextbase-home-"));
  const home = join(root, "home");
  mkdirSync(join(home, ".codex"), { recursive: true });
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(home, ".codex", "config.toml"), `model = "gpt-test"\n\n[projects.${JSON.stringify(vault)}]\ntrust_level = "trusted"\n`);
  writeFileSync(join(home, ".claude", "settings.json"), `${JSON.stringify({ permissions: { allow: ["Bash(git status)"] }, theme: "dark" }, null, 2)}\n`);
  const log = join(root, "claude.log");
  const claude = join(root, "claude");
  writeFileSync(
    claude,
    `#!/bin/sh\necho "$PWD|$*" >> '${log}'\nif [ "$1 $2" = "mcp get" ]; then echo "  Status: ✔ Connected"; fi\nexit 0\n`,
  );
  chmodSync(claude, 0o755);
  const ctx: InstallContext = { vault, scope, home, node: process.execPath, cli, claude };
  return { vault, home, log, claude, ctx };
}

const applyAll = (plan: { changes: Array<{ apply: () => void }> }) => plan.changes.forEach((change) => change.apply());

test("init plans first and touches nothing until a change is applied", () => {
  const { vault, ctx } = setup("vault");
  const plan = planInstall(ctx);
  assert.ok(plan.changes.length >= 5);
  assert.ok(plan.changes.some((change) => change.what.includes(".gitignore")));
  assert.ok(!existsSync(join(vault, ".codex")) && !existsSync(join(vault, ".claude")));
  assert.ok(!plan.notes.some((note) => note.includes("trust it")), "the vault is already a trusted Codex project");
  assert.ok(plan.notes.some((note) => note.includes("/hooks")));
});

test("vault scope writes only vault files, registers the server locally, and the hooks it writes run", () => {
  const { vault, home, log, ctx } = setup("vault");
  applyAll(planInstall(ctx));

  const calls = read(log);
  assert.ok(calls.startsWith(`${realPath(vault)}|mcp remove contextbase --scope local`), calls);
  assert.ok(calls.includes(`|mcp add contextbase --scope local -- ${process.execPath} ${cli} serve --vault ${vault}`), calls);

  const settings = JSON.parse(read(join(vault, ".claude/settings.local.json")));
  assert.deepEqual(Object.keys(settings.hooks).sort(), ["SessionStart", "Stop", "UserPromptSubmit"]);
  assert.deepEqual(settings.permissions.allow, ["mcp__contextbase"]);
  const config = read(join(vault, ".codex/config.toml"));
  assert.match(config, /^\[mcp_servers\.contextbase\]$/m);
  assert.match(config, /^default_tools_approval_mode = "approve"$/m);
  const codexHooks = JSON.parse(read(join(vault, ".codex/hooks.json")));
  assert.deepEqual(Object.keys(codexHooks.hooks).sort(), ["SessionStart", "Stop", "UserPromptSubmit"]);
  // What matters is that Git ignores both, whether through the vault's .gitignore or the user's
  // global excludes (Claude Code may already list settings.local.json there).
  for (const path of [".codex/hooks.json", ".claude/settings.local.json"]) {
    assert.equal(spawnSync("git", ["-C", vault, "check-ignore", "-q", path]).status, 0, `${path} is ignored by Git`);
  }
  assert.ok(existsSync(join(vault, ".contextbase", "index.sqlite")));

  assert.ok(!read(join(home, ".claude/settings.json")).includes("hooks"), "the user's own settings are untouched");
  assert.ok(!existsSync(join(home, ".codex/hooks.json")));

  const input = JSON.stringify({ session_id: "x", source: "startup", cwd: vault });
  const start = settings.hooks.SessionStart[0].hooks[0];
  const claudeRun = spawnSync(start.command, start.args, { input, encoding: "utf8" });
  assert.match(claudeRun.stdout, /^\[Contextbase\] Contextbase is the shared memory/, claudeRun.stderr);
  const codexRun = spawnSync("/bin/sh", ["-c", codexHooks.hooks.SessionStart[0].hooks[0].command], { input, encoding: "utf8" });
  assert.match(codexRun.stdout, /^\[Contextbase\] Contextbase is the shared memory/, codexRun.stderr);
});

test("running init twice leaves a single copy of every entry", () => {
  const { vault, ctx } = setup("vault");
  applyAll(planInstall(ctx));
  applyAll(planInstall(ctx));
  const settings = JSON.parse(read(join(vault, ".claude/settings.local.json")));
  for (const event of ["SessionStart", "UserPromptSubmit", "Stop"]) assert.equal(settings.hooks[event].length, 1, event);
  assert.deepEqual(settings.permissions.allow, ["mcp__contextbase"]);
  assert.equal(read(join(vault, ".codex/config.toml")).split("[mcp_servers.contextbase]").length, 2);
  const codexHooks = JSON.parse(read(join(vault, ".codex/hooks.json")));
  for (const event of ["SessionStart", "UserPromptSubmit", "Stop"]) assert.equal(codexHooks.hooks[event].length, 1, event);
  assert.equal(read(join(vault, ".gitignore")).split(".codex/").length, 2);
});

test("user scope keeps what was there, backs it up, and uninstall removes only its own entries", () => {
  const { vault, home, log, ctx } = setup("user");
  const settingsFile = join(home, ".claude/settings.json");
  const configFile = join(home, ".codex/config.toml");
  const originalConfig = read(configFile);
  applyAll(planInstall(ctx));

  const settings = JSON.parse(read(settingsFile));
  assert.equal(settings.theme, "dark");
  assert.deepEqual(settings.permissions.allow, ["Bash(git status)", "mcp__contextbase"]);
  assert.ok(existsSync(`${settingsFile}.before-contextbase`));
  assert.ok(existsSync(`${configFile}.before-contextbase`));
  assert.ok(read(configFile).startsWith(originalConfig.trimEnd()));
  assert.ok(!existsSync(join(vault, ".codex")), "user scope leaves the vault's own settings alone");

  applyAll(planUninstall(ctx));
  assert.deepEqual(JSON.parse(read(settingsFile)), { permissions: { allow: ["Bash(git status)"] }, theme: "dark" });
  assert.equal(read(configFile), originalConfig);
  assert.ok(!existsSync(join(home, ".codex/hooks.json")));
  assert.match(read(log), /mcp remove contextbase --scope user/);
});

test("init refuses an existing contextbase entry it does not manage, and an npx install", () => {
  const { vault, ctx } = setup("vault");
  mkdirSync(join(vault, ".codex"));
  writeFileSync(join(vault, ".codex/config.toml"), '[mcp_servers.contextbase]\ncommand = "node"\n');
  assert.throws(() => planInstall(ctx), /outside Contextbase's managed block/);
  assert.throws(
    () => planInstall({ ...ctx, cli: "/Users/x/.npm/_npx/1a2b/node_modules/obsidian-contextbase/dist/cli.js" }),
    /npm install -g obsidian-contextbase/,
  );
});

test("doctor reports what is installed, what is not trusted yet and whether hooks ran", () => {
  const { vault, ctx } = setup("vault");
  applyAll(planInstall(ctx));
  let report = doctor(ctx).join("\n");
  assert.match(report, /✓ Claude Code MCP server: ✔ Connected/);
  assert.match(report, /✓ Codex MCP server in/);
  assert.match(report, /✗ Codex hooks not trusted yet/);
  assert.match(report, /✗ claude hooks have not run yet/);
  runHook("session-start", { session_id: "d", source: "startup", cwd: vault }, { vault, client: "claude" });
  report = doctor(ctx).join("\n");
  assert.match(report, /✓ claude hooks last ran at/);
});

test("a node on PATH that is the same program wins over a versioned path", () => {
  const dir = mkdtempSync(join(tmpdir(), "contextbase-bin-"));
  symlinkSync(process.execPath, join(dir, "node"));
  const saved = process.env.PATH;
  process.env.PATH = `${dir}:${saved ?? ""}`;
  try {
    assert.equal(stableNodePath(process.execPath), join(dir, "node"));
    assert.equal(stableNodePath("/somewhere/else/node"), "/somewhere/else/node", "a different program is kept as given");
  } finally {
    process.env.PATH = saved;
  }
});

test("the init command prints the plan and changes nothing without --yes", () => {
  const { vault, home, claude } = setup("vault");
  const env = { ...process.env, HOME: home, CONTEXTBASE_CLAUDE: claude };
  const dry = spawnSync(process.execPath, [cli, "init", "--vault", vault], { env, encoding: "utf8", input: "" });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /contextbase init would make these changes:/);
  assert.match(dry.stdout, /Nothing was changed/);
  assert.ok(!existsSync(join(vault, ".codex")));

  const real = spawnSync(process.execPath, [cli, "init", "--vault", vault, "--yes"], { env, encoding: "utf8" });
  assert.equal(real.status, 0, real.stderr);
  assert.ok(existsSync(join(vault, ".codex/hooks.json")));
});
