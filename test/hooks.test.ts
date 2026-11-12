import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { runHook, STOP_REASON, type HookInput } from "../src/hooks.ts";
import { readHookRuns, readSession, recordSave } from "../src/state.ts";
import { NOW, PATHS, tempVault } from "./helpers.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

// A simulated session in which turn k starts at base + k × 10 s. Edits and saves are stamped a
// second or two into the current turn, so the test does not depend on how fast it runs.
function session(vault: string, id: string, client = "claude") {
  const options = { vault, client };
  const base = Date.now();
  let turn = 0;
  const at = (offset: number) => base + turn * 10_000 + offset;
  runHook("session-start", { session_id: id, source: "startup", cwd: vault }, { ...options, now: new Date(base) });
  return {
    prompt: (prompt = "繼續") => {
      turn++;
      return runHook("prompt", { session_id: id, prompt, cwd: vault }, { ...options, now: new Date(at(0)) });
    },
    touch: () => {
      const file = join(vault, PATHS.itinerary);
      appendFileSync(file, "\n- 第六天：自由活動。\n");
      utimesSync(file, at(1000) / 1000, at(1000) / 1000);
    },
    save: () => recordSave(vault, id, new Date(at(2000))),
    stop: (extra: Partial<HookInput> = {}) => runHook("stop", { session_id: id, cwd: vault, ...extra }, options),
  };
}

test("session start injects the purpose and the digest, and opens a session", () => {
  const vault = tempVault();
  const output = runHook("session-start", { session_id: "s1", source: "startup", cwd: vault }, { vault, client: "claude" });
  assert.match(output, /^\[Contextbase\] Contextbase is the shared memory/);
  assert.match(output, /\[Contextbase\] Recent work, by topic/);
  assert.equal(readSession(vault, "s1")?.turn, 0);
  assert.ok(readHookRuns(vault)["claude:session-start"]);
});

test("the first prompt recalls related memories; later prompts and unrelated ones add nothing", () => {
  const vault = tempVault();
  const options = { vault, client: "codex", now: NOW };
  runHook("session-start", { session_id: "s1", source: "startup", cwd: vault }, options);
  const first = runHook("prompt", { session_id: "s1", prompt: "第二天的交通怎麼排？", cwd: vault }, options);
  assert.match(first, /^\[Contextbase\] Memories related to this request:/);
  assert.match(first, /第二天改去宇治，嵐山移到第四天/);
  assert.ok(!first.includes("decided by the user, recorded by claude-code): 第二天去嵐山"), "replaced memories are never injected");
  assert.equal(runHook("prompt", { session_id: "s1", prompt: "第二天的交通怎麼排？", cwd: vault }, options), "");
  assert.equal(readSession(vault, "s1")?.turn, 2);

  runHook("session-start", { session_id: "s2", source: "startup", cwd: vault }, options);
  assert.equal(runHook("prompt", { session_id: "s2", prompt: "幫我寫一首關於秋天的詩", cwd: vault }, options), "");
});

test("stop asks once when the turn changed files and saved nothing", () => {
  const vault = tempVault();
  const s = session(vault, "s3");
  s.prompt();
  assert.equal(s.stop(), "", "nothing changed yet");
  s.touch();
  assert.deepEqual(JSON.parse(s.stop()), { decision: "block", reason: STOP_REASON });
  assert.equal(s.stop({ stop_hook_active: true }), "", "the continuation the block caused may end");
});

test("a save in the turn keeps stop quiet, and after a reminder it waits three turns", () => {
  const vault = tempVault();
  const s = session(vault, "s4");
  s.prompt();
  s.touch();
  s.save();
  assert.equal(s.stop(), "", "saved during this turn");

  const outcomes: boolean[] = [];
  for (let turn = 2; turn <= 5; turn++) {
    s.prompt();
    s.touch();
    outcomes.push(s.stop() !== "");
  }
  assert.deepEqual(outcomes, [true, false, false, true]);
});

test("five turns without a save bring a reminder even when no file changed", () => {
  const vault = tempVault();
  const s = session(vault, "s5");
  const outcomes: boolean[] = [];
  for (let turn = 1; turn <= 5; turn++) {
    s.prompt();
    outcomes.push(s.stop() !== "");
  }
  assert.deepEqual(outcomes, [false, false, false, false, true]);
});

test("the hook command reads stdin, prints the reply and always exits 0", () => {
  const vault = tempVault();
  const ok = spawnSync(process.execPath, [cli, "hook", "session-start", "--vault", vault, "--client", "codex"], {
    input: JSON.stringify({ session_id: "s6", source: "startup", cwd: vault }),
    encoding: "utf8",
  });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^\[Contextbase\] Contextbase is the shared memory/);

  const garbage = spawnSync(process.execPath, [cli, "hook", "stop", "--vault", vault], { input: "not json", encoding: "utf8" });
  assert.equal(garbage.status, 0);
  assert.equal(garbage.stdout, "");

  const missing = spawnSync(process.execPath, [cli, "hook", "prompt", "--vault", join(vault, "nope")], { input: "{}", encoding: "utf8" });
  assert.equal(missing.status, 0, "a broken setup must not break the session");
  assert.match(missing.stderr, /Not a folder/);
});
