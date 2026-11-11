// What the server tells every connecting agent about the memory (decision D10 in docs/plan.md):
// the purpose goes here, how to call each tool goes in the tool descriptions.
//
// Codex advises keeping the first 512 characters of server instructions self-contained, so the
// purpose and the moments to save come first.
const PURPOSE = [
  "Contextbase is the shared memory between the AI agents that work in this Obsidian vault (Claude Code, Codex and others).",
  "Another agent will pick up your work later without the user writing a handoff document, and what you save here is all it will know.",
  "Save a memory when the user makes a decision, when you finish a piece of work, or when the user states a preference.",
  "Write what was decided and why, and what should happen next, in the language the user works in.",
].join(" ");

const SEARCH_HINT = "Use search to look for earlier decisions before asking the user to repeat them.";

// Padding that pushes the tail canary well past 512 characters, to see whether anything is cut off.
const FILLER = "Keep memories short, factual and written so that a reader who was not there can act on them. ".repeat(10);

export function buildInstructions(options: { hasSearch: boolean; canary: boolean }): string {
  const base = options.hasSearch ? `${PURPOSE} ${SEARCH_HINT}` : PURPOSE;
  if (!options.canary) return base;
  return `[head canary: PERSIMMON-HEAD] ${base} ${FILLER.trim()} [tail canary: PERSIMMON-TAIL]`;
}
