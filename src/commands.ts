// Subcommands that the MCP server never needs: hook, init, uninstall, doctor.
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { readStdin, UsageError, vaultOf, type Options } from "./args.ts";
import { hookEvent, runHook, type HookInput } from "./hooks.ts";
import {
  doctor,
  findOnPath,
  planInstall,
  planUninstall,
  stableNodePath,
  type InstallContext,
  type Plan,
} from "./install.ts";

export async function run(command: string, rest: string[], values: Options): Promise<number> {
  switch (command) {
    case "hook":
      return hook(rest, values);
    case "init":
      return apply(planInstall(installContext(values)), values, "init");
    case "uninstall":
      return apply(planUninstall(installContext(values)), values, "uninstall");
    case "doctor":
      for (const line of doctor(installContext(values))) console.log(line);
      return 0;
    default:
      throw new UsageError(`Unknown command: ${command}. Run contextbase --help.`);
  }
}

// A hook must never break the user's session: whatever goes wrong is reported on stderr and the
// hook still exits 0, so the client carries on as if it had nothing to add.
async function hook(rest: string[], values: Options): Promise<number> {
  const event = hookEvent(rest[0]);
  if (!event) throw new UsageError("Usage: contextbase hook session-start|prompt|stop --vault <path> --client <name>");
  try {
    const vault = vaultOf(values);
    let input: HookInput = {};
    try {
      input = JSON.parse((await readStdin()) || "{}") as HookInput;
    } catch {
      // not JSON: treat as an empty event
    }
    const client = typeof values.client === "string" ? values.client : "unknown";
    const output = runHook(event, input, { vault, client });
    if (output) process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
  } catch (error) {
    process.stderr.write(`contextbase hook ${event}: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  return 0;
}

function installContext(values: Options): InstallContext {
  const scope = values.scope ?? "vault"; // assumption H8: the default the author still has to confirm
  if (scope !== "vault" && scope !== "user") throw new UsageError("--scope must be vault or user");
  return {
    vault: vaultOf(values),
    scope,
    home: homedir(),
    node: stableNodePath(process.execPath),
    cli: realpathSync(process.argv[1]!),
    claude: process.env.CONTEXTBASE_CLAUDE || findOnPath("claude"),
  };
}

async function apply(plan: Plan, values: Options, verb: string): Promise<number> {
  console.log(`contextbase ${verb} would make these changes:`);
  if (plan.changes.length === 0) console.log("  (nothing to change)");
  plan.changes.forEach((change, index) => console.log(`  ${index + 1}. ${change.what}`));
  if (plan.notes.length > 0) {
    console.log("\nAnd then, by hand:");
    for (const note of plan.notes) console.log(`  - ${note}`);
  }
  if (plan.changes.length === 0) return 0;
  const go = values.yes === true || (await confirm("\nApply these changes? [y/N] "));
  if (!go) {
    console.log("\nNothing was changed. Run the same command with --yes to apply.");
    return 0;
  }
  for (const [index, change] of plan.changes.entries()) {
    try {
      change.apply();
      console.log(`✓ ${index + 1}. ${change.what}`);
    } catch (error) {
      console.error(`✗ ${index + 1}. ${error instanceof Error ? error.message : String(error)}`);
      console.error("Stopped here: the changes listed above it were applied, the rest were not.");
      return 1;
    }
  }
  return 0;
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await prompt.question(question)).trim());
  } finally {
    prompt.close();
  }
}
