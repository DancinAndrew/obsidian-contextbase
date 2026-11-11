// M0 probe: records what MCP clients actually send, so the design is checked against facts
// instead of documentation. Active only when CONTEXTBASE_PROBE_LOG points at a file.
// With CONTEXTBASE_PROBE_REDACT=1, tool arguments are recorded as their shape only: the text of
// a memory belongs in the vault, not in a log.
//
// A stdio MCP server talks to its client over stdout, so nothing here may print to stdout.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const logFile = process.env.CONTEXTBASE_PROBE_LOG;
const redact = process.env.CONTEXTBASE_PROBE_REDACT === "1";
let logFolderReady = false;

export function probe(kind: string, data: Record<string, unknown> = {}): void {
  if (!logFile) return;
  const line = JSON.stringify({ t: new Date().toISOString(), pid: process.pid, kind, ...data });
  try {
    if (!logFolderReady) {
      mkdirSync(dirname(logFile), { recursive: true });
      logFolderReady = true;
    }
    appendFileSync(logFile, `${line}\n`);
  } catch {
    // The probe must never break the server.
  }
}

export function describeArgs(args: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!redact || !args) return args;
  return Object.fromEntries(Object.entries(args).map(([key, value]) => [key, shapeOf(value)]));
}

function shapeOf(value: unknown): string {
  if (typeof value === "string") return `<${value.length} chars>`;
  if (Array.isArray(value)) return `<${value.length} items>`;
  return `<${typeof value}>`;
}

// Values are recorded only for identifier-like names; every other variable is recorded by name alone.
const SAFE_VALUE = /^(PWD|OLDPWD)$|SESSION|THREAD|PROJECT_DIR|CWD|WORKSPACE|TURN/i;
const SECRET = /TOKEN|KEY|SECRET|PASSWORD|AUTH|COOKIE|CREDENTIAL/i;

export function describeEnv(env: NodeJS.ProcessEnv): { names: string[]; values: Record<string, string> } {
  const names = Object.keys(env).sort();
  const values: Record<string, string> = {};
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && SAFE_VALUE.test(name) && !SECRET.test(name)) values[name] = value;
  }
  return { names, values };
}

interface WireTransport {
  onmessage?: (message: unknown, extra?: unknown) => void;
  send(message: unknown, options?: unknown): Promise<void>;
}

function redactMessage(message: unknown): unknown {
  if (!redact) return message;
  const call = message as { method?: string; params?: { arguments?: Record<string, unknown> } };
  if (call.method !== "tools/call" || !call.params) return message;
  return { ...call, params: { ...call.params, arguments: describeArgs(call.params.arguments) } };
}

// Call after server.connect(): the protocol layer has installed its own onmessage by then, and no
// message can arrive before the next event-loop turn, so the first one is not missed.
export function tapTransport(transport: object): void {
  if (!logFile) return;
  const wire = transport as WireTransport;
  const received = wire.onmessage;
  wire.onmessage = (message, extra) => {
    probe("recv", { message: redactMessage(message) });
    received?.(message, extra);
  };
  const send = wire.send.bind(wire);
  wire.send = (message, options) => {
    probe("send", { message });
    return send(message, options);
  };
}
