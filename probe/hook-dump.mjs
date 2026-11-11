#!/usr/bin/env node
// M0 probe: records what a client sends to a hook, then answers the way the client documents.
//
//   --log <file>           file that receives one JSON line per call (its folder is created)
//   --purpose              on SessionStart, inject the memory's purpose text (decision D11)
//   --session-file <file>  on SessionStart, inject this file's text instead
//   --prompt-canary        on UserPromptSubmit, inject a canary line (experiments only)
//   --stop block           on Stop, block once (only while stop_hook_active is not true)
//   --stop-file <file>     on that block, use this file's text as the reason
//   --full-text            keep prompt and reply text in the log (default: their lengths only)
//
// Options are passed as arguments, not environment variables, because a client may not hand its
// environment to hook commands unchanged. A failure here must never break the user's session, so
// every step that can fail is caught and the hook still exits 0.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const flag = (name) => args.includes(name);
const logFile = option("--log");

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const raw = Buffer.concat(chunks).toString("utf8");

let input;
try {
  input = JSON.parse(raw);
} catch {
  input = { unparsed_chars: raw.length };
}
const event = typeof input.hook_event_name === "string" ? input.hook_event_name : "unknown";

// Prompt and reply text stay out of the log unless --full-text is given; their lengths are kept.
const logged = { ...input };
if (!flag("--full-text")) {
  for (const key of ["prompt", "last_assistant_message"]) {
    if (typeof logged[key] === "string") {
      logged[`${key}_chars`] = logged[key].length;
      delete logged[key];
    }
  }
}

// Values are recorded only for identifier-like names; every other variable is recorded by name alone.
const SAFE_VALUE = /^(PWD|OLDPWD)$|SESSION|THREAD|PROJECT_DIR|CWD|WORKSPACE|TURN/i;
const SECRET = /TOKEN|KEY|SECRET|PASSWORD|AUTH|COOKIE|CREDENTIAL/i;
const envValues = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => SAFE_VALUE.test(name) && !SECRET.test(name)),
);

if (logFile) {
  try {
    mkdirSync(dirname(logFile), { recursive: true });
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
        input: logged,
      })}\n`,
    );
  } catch {
    // Logging is best effort.
  }
}

function fileText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

async function purposeText() {
  try {
    const { MEMORY_PURPOSE } = await import(new URL("../src/instructions.ts", import.meta.url).href);
    return `[Contextbase] ${MEMORY_PURPOSE}\n`;
  } catch {
    return "";
  }
}

if (event === "SessionStart") {
  const sessionFile = option("--session-file");
  let text = "[Contextbase probe] SessionStart canary: PERSIMMON-START\n";
  if (sessionFile) text = fileText(sessionFile);
  else if (flag("--purpose")) text = await purposeText();
  process.stdout.write(text);
} else if (event === "UserPromptSubmit" && flag("--prompt-canary")) {
  process.stdout.write("[Contextbase probe] UserPromptSubmit canary: PERSIMMON-PROMPT\n");
} else if (event === "Stop" && option("--stop") === "block" && input.stop_hook_active !== true) {
  const stopFile = option("--stop-file");
  const reason =
    (stopFile && fileText(stopFile).trim()) ||
    "[Contextbase probe] The Stop hook wants one more reply: say STOPBLOCK-OK.";
  process.stdout.write(`${JSON.stringify({ decision: "block", reason })}\n`);
}
