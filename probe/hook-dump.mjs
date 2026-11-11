#!/usr/bin/env node
// M0 probe: records what a client sends to a hook, then answers the way the client documents.
//
//   --log <file>           file that receives one JSON line per call
//   --stop block           on Stop, block once (only while stop_hook_active is not true)
//   --stop-file <file>     on that block, use this file's text as the reason
//   --session-file <file>  on SessionStart, inject this file's text instead of the canary
//
// Options are passed as arguments, not environment variables, because a client may not hand its
// environment to hook commands unchanged.
import { appendFileSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const logFile = option("--log");
const stopMode = option("--stop");
const sessionFile = option("--session-file");
const stopFile = option("--stop-file");

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const raw = Buffer.concat(chunks).toString("utf8");

let input;
try {
  input = JSON.parse(raw);
} catch {
  input = { unparsed: raw };
}
const event = typeof input.hook_event_name === "string" ? input.hook_event_name : "unknown";

// Values are recorded only for identifier-like names; every other variable is recorded by name alone.
const SAFE_VALUE = /^(PWD|OLDPWD)$|SESSION|THREAD|PROJECT_DIR|CWD|WORKSPACE|TURN/i;
const SECRET = /TOKEN|KEY|SECRET|PASSWORD|AUTH|COOKIE|CREDENTIAL/i;
const envValues = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => SAFE_VALUE.test(name) && !SECRET.test(name)),
);

if (logFile) {
  appendFileSync(
    logFile,
    `${JSON.stringify({
      t: new Date().toISOString(),
      pid: process.pid,
      kind: "hook",
      event,
      cwd: process.cwd(),
      argv: args,
      envNames: Object.keys(process.env).sort(),
      envValues,
      input,
    })}\n`,
  );
}

if (event === "SessionStart") {
  process.stdout.write(
    sessionFile ? readFileSync(sessionFile, "utf8") : "[Contextbase probe] SessionStart canary: PERSIMMON-START\n",
  );
} else if (event === "UserPromptSubmit") {
  process.stdout.write("[Contextbase probe] UserPromptSubmit canary: PERSIMMON-PROMPT\n");
} else if (event === "Stop" && stopMode === "block" && input.stop_hook_active !== true) {
  process.stdout.write(
    `${JSON.stringify({
      decision: "block",
      reason: stopFile
        ? readFileSync(stopFile, "utf8").trim()
        : "[Contextbase probe] The Stop hook wants one more reply: say STOPBLOCK-OK.",
    })}\n`,
  );
}
