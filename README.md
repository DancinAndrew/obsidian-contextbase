# Obsidian Contextbase

> Scope-aware, cross-agent memory for Obsidian vaults: Claude Code, Codex and other MCP clients pick up each other's work without hand-written handoff documents.

**Status: design phase (November 2026). Nothing is implemented yet.** The design and roadmap are in [docs/plan.md](docs/plan.md) (Traditional Chinese); prior art is surveyed in [docs/related-work.md](docs/related-work.md).

## The problem

When several AI agents take turns in the same Obsidian vault, every switch needs a handoff document: what is current, what was decided, what is next, and where things live. These documents grow to tens of kilobytes and are rewritten by hand for each handoff.

A single vault-wide index and log (the "LLM Wiki" pattern) does not fix this once a vault mixes unrelated areas, such as a journal, travel notes, reading notes and a multi-month project. Project-level detail gets buried in the global timeline, and maintaining a separate wiki inside every project duplicates the machinery.

## The idea

- **Markdown stays the source of truth.** Decisions, checkpoints and open questions are plain notes in the vault. The search index is a disposable cache that keeps itself up to date.
- **Scopes instead of nested wikis.** Any folder can declare itself a scope. Scopes inherit rules from their parents, and retrieval starts in the current scope and widens only when asked.
- **A handoff is a query, not a document.** `resume(scope)` builds a short briefing (purpose, current state, recent decisions, open questions) from the records and links to details instead of copying them.
- **BM25 first, with Chinese word segmentation.** Keyword search handles exact identifiers, versions and dates without an embedding model. Chinese text is segmented with `Intl.Segmenter` or CJK bigrams, because SQLite FTS5's default tokenizer treats a whole run of Chinese characters as one token.
- **MCP as the delivery layer.** One server works from Claude Code, Codex, Claude Desktop and any other MCP client. Session-start hooks can inject the briefing automatically.

## Planned MCP tools (draft)

| Tool | Purpose |
| --- | --- |
| `resume` | Briefing for a scope: purpose, rules, current state, recent decisions, open questions |
| `search` | Scope-aware BM25 search over notes and records, returning line ranges for citation |
| `record` | Save a decision, checkpoint or question to a scope, including who made the decision and its evidence |
| `scopes` | List scopes with their purpose and latest activity |

## Roadmap

- [ ] M0 Design decisions and a minimal MCP server connected to Claude Code and Codex
- [ ] M1 Core: scopes, records, tokenizer, BM25 index, CLI
- [ ] M2 MCP server with the four tools and two prompts
- [ ] M3 Cross-agent demo on a real vault
- [ ] M4 Lifecycle hooks, retrieval evaluation, hybrid search, Obsidian plugin

## License

[MIT](LICENSE)
