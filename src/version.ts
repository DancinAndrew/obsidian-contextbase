import { readFileSync } from "node:fs";

// Read from package.json, which sits one folder up from both src/ and dist/.
export const VERSION = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }
).version;
