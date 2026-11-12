// How search results and save outcomes read to an agent (and to a person using the CLI).
import type { SaveResult } from "./memory.ts";
import type { SearchHit } from "./store.ts";

export function formatHit(hit: SearchHit, rank: number): string {
  if (hit.kind === "memory" && hit.memory) {
    const memory = hit.memory;
    const tags = [
      "memory",
      memory.type,
      memory.type === "decision" ? `decided by ${memory.decidedBy ?? "unknown"}` : null,
      memory.agent,
      memory.created?.slice(0, 10) ?? null,
      memory.supersededBy ? `REPLACED by ${memory.supersededBy}` : null,
    ].filter(Boolean);
    const lines = [`${rank}. [${tags.join(" · ")}] ${hit.path}`, `   ${memory.summary}`];
    if (memory.next) lines.push(`   next: ${memory.next}`);
    return lines.join("\n");
  }
  return `${rank}. [note] ${hit.path} (lines ${hit.startLine}-${hit.endLine}, best match at line ${hit.line})\n   ${hit.snippet}`;
}

export function formatSave(result: SaveResult): string {
  switch (result.status) {
    case "saved":
      return [
        `Saved ${result.path}`,
        `Link: ${result.link}`,
        result.replaced ? `It replaces ${result.replaced}, which search will now mark as replaced.` : "",
      ]
        .filter(Boolean)
        .join("\n");
    case "similar":
      return [
        "Not saved yet: these memories look similar.",
        ...result.similar.map((memory) => `- ${memory.link} (${memory.created?.slice(0, 10) ?? "undated"}): ${memory.summary}`),
        "If yours replaces one of them, call save again with supersedes set to its name.",
        "If it adds something new, call save again with confirm: true. If it repeats one, there is nothing to save.",
      ].join("\n");
    case "unresolved":
      return [
        `Not saved: ${result.field} must name ${result.field === "about" ? "notes" : "a memory"} in this vault.`,
        ...result.names.map((name) => {
          const hint = name.suggestions.length ? ` Did you mean: ${name.suggestions.map((s) => `"${s}"`).join(", ")}?` : "";
          return `- "${name.name}" matches nothing.${hint}`;
        }),
      ].join("\n");
    case "refused":
      return `Not saved: ${result.reason}.`;
  }
}
