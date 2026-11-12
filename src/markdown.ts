// Just enough Markdown for indexing: front matter, wikilinks, and chunks with line numbers.
//
// The front matter parser covers the flat YAML that memory notes use (scalars, quoted strings,
// block and flow lists). Anything else in a user's note, such as nested maps, is skipped rather
// than rejected, because a note that the parser does not understand must still be searchable.

export type FrontmatterValue = string | string[];

export interface ParsedNote {
  data: Record<string, FrontmatterValue>;
  lines: string[];
  bodyStart: number; // index of the first line after the front matter
}

export function parseNote(text: string): ParsedNote {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { data: {}, lines, bodyStart: 0 };
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "---" || line === "...") {
      return { data: parseYamlLite(lines.slice(1, i)), lines, bodyStart: i + 1 };
    }
  }
  return { data: {}, lines, bodyStart: 0 }; // never closed: treat it all as body
}

export function field(data: Record<string, FrontmatterValue>, key: string): string | undefined {
  const value = data[key];
  const first = Array.isArray(value) ? value[0] : value;
  return first ? first : undefined;
}

export function listField(data: Record<string, FrontmatterValue>, key: string): string[] {
  const value = data[key];
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).filter((item) => item !== "");
}

function parseYamlLite(lines: string[]): Record<string, FrontmatterValue> {
  const data: Record<string, FrontmatterValue> = {};
  let list: string[] | undefined;
  for (const line of lines) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && list) {
      list.push(scalar(item[1]!));
      continue;
    }
    const pair = /^([^\s:#][^:]*?):(?:\s+(.*))?$/.exec(line);
    if (!pair) {
      list = undefined; // a nested map or something else this parser does not read
      continue;
    }
    const key = pair[1]!.trim();
    const value = (pair[2] ?? "").trim();
    if (value === "") {
      list = [];
      data[key] = list;
      continue;
    }
    list = undefined;
    data[key] = value.startsWith("[") && value.endsWith("]") ? flowList(value) : scalar(value);
  }
  return data;
}

function scalar(raw: string): string {
  let value = raw.trim();
  if (value.startsWith('"')) {
    try {
      return String(JSON.parse(value));
    } catch {
      const end = value.lastIndexOf('"');
      return end > 0 ? value.slice(1, end) : value.slice(1);
    }
  }
  if (value.startsWith("'")) {
    const end = value.lastIndexOf("'");
    return (end > 0 ? value.slice(1, end) : value.slice(1)).replaceAll("''", "'");
  }
  const comment = value.search(/\s#/);
  if (comment !== -1) value = value.slice(0, comment).trimEnd();
  return value;
}

function flowList(value: string): string[] {
  const inner = value.slice(1, -1).trim();
  if (inner === "") return [];
  return inner
    .split(",")
    .map(scalar)
    .filter((item) => item !== "");
}

// "[[京都 2026 行程|行程]]", "[[note#heading]]" and a bare name all give the note name.
export function linkTarget(value: string): string {
  const inner = value.trim().replace(/^!?\[\[/, "").replace(/\]\]$/, "");
  return inner.split("|")[0]!.split("#")[0]!.trim();
}

export interface Chunk {
  startLine: number; // 1-based, inclusive
  endLine: number;
  text: string;
}

const HEADING = /^#{1,6}\s/;

// Splits a note body into chunks that start at headings and stay small enough for a snippet to
// point at the right place. Long sections are cut at a blank line once they pass maxChars, or
// after maxLines lines.
export function chunkLines(lines: string[], from: number, maxLines = 40, maxChars = 1500): Chunk[] {
  const chunks: Chunk[] = [];
  let start = -1;
  let chars = 0;

  const flush = (end: number): void => {
    if (start === -1) return;
    let last = end;
    while (last > start && lines[last - 1]!.trim() === "") last--;
    if (last > start) chunks.push({ startLine: start + 1, endLine: last, text: lines.slice(start, last).join("\n") });
    start = -1;
    chars = 0;
  };

  for (let i = from; i < lines.length; i++) {
    const line = lines[i]!;
    if (HEADING.test(line)) flush(i);
    if (start === -1) {
      if (line.trim() === "") continue;
      start = i;
    }
    chars += line.length + 1;
    const size = i - start + 1;
    const atBreak = line.trim() === "";
    if (size >= maxLines || (chars >= maxChars && atBreak) || chars >= maxChars * 2) flush(i + 1);
  }
  flush(lines.length);
  return chunks;
}
