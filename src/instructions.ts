// What the server tells every connecting agent about the memory (decision D10). The same purpose
// text opens the session-start hook's output (decision D11), because Codex does not show server
// instructions to the model until the model discovers the tools.
//
// Codex advises keeping the first 512 characters of server instructions self-contained, so the
// purpose and the moments to save come first. The text names the `save` tool and the server,
// because a Codex model that has not discovered the tools yet does not know they exist. How to
// call each tool belongs in the tool descriptions, not here.
export const MEMORY_PURPOSE = [
  "Contextbase is the shared memory between the AI agents that work in this Obsidian vault (Claude Code, Codex and others).",
  "Another agent will pick up your work later without the user writing a handoff document, and what you save here is all it will know.",
  "Use the `save` tool of the contextbase MCP server when the user makes a decision, when you finish a piece of work, or when the user states a preference.",
  "Write what was decided and why, and what should happen next, in the language the user works in.",
].join(" ");

export const SEARCH_HINT =
  "Use the `search` tool to look for earlier decisions and notes before asking the user to repeat them.";

export function serverInstructions(): string {
  return `${MEMORY_PURPOSE} ${SEARCH_HINT}`;
}
