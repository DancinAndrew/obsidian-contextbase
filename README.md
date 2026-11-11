# Obsidian Contextbase

> Shared memory for your AI agents, kept as notes in your Obsidian vault. Claude Code, Codex and other MCP clients pick up each other's decisions without hand-written handoff documents.

**Status: design phase (November 2026). The memory itself is not implemented yet; everything below describes the plan.** A throwaway spike (an MCP server and hook probes) has checked the plan against Claude Code and Codex; the results are in [docs/m0-findings.md](docs/m0-findings.md). The design and its open decisions are in [docs/plan.md](docs/plan.md) and prior art is surveyed in [docs/related-work.md](docs/related-work.md) (both in Traditional Chinese).

## The problem

Coding agents already remember things, but each one keeps its memory to itself. Claude Code writes memory files under `~/.claude/projects/`, and Codex summarizes sessions into `~/.codex/memories/`. Neither agent can read the other's memory, and neither memory shows up in your notes.

So when you switch agents halfway through a task, you write a handoff document by hand: what is current, what was decided, what comes next. You end up carrying memory between two silos yourself.

## The idea

Notion's MCP server shows the pattern: a shared workspace, a search index the service keeps up to date, and tools to search, read and write pages. The server itself remembers nothing. Memory emerges because one agent writes a page that another agent can find.

Contextbase applies the same pattern to a local Obsidian vault:

- **Zero setup.** One command registers the server and its hooks with Claude Code and Codex and builds the index; Codex asks you to review the hooks once. It needs no folder structure, frontmatter or naming convention in your vault.
- **Memories are notes.** Each memory is a Markdown note in a single `Agent Memory/` folder, linked to the notes it is about, so it appears in Obsidian's backlinks. You can read, edit or delete it like any other note.
- **Index, don't compile.** No language model rewrites your notes. A BM25 full-text index (SQLite FTS5 with CJK-aware tokenization) covers both your notes and the memories and updates incrementally. It lives in a hidden `.contextbase/` folder inside the vault that keeps itself out of Git, and Obsidian Sync skips it. Delete it and it is rebuilt.
- **Write-back is automatic.** Agents save decisions and progress with a `save` tool, and a hook at the end of each turn reminds them when work may have gone unsaved.
- **Read-back is automatic.** A session-start hook injects a short digest of recent work, grouped by topic. The first message of each session pulls in the memories most related to it, and agents search for details when they need them.
- **Scope is implicit.** Each memory links to the notes it is about, so the memories related to what you are working on come first. You never declare a scope.

## Planned install

```bash
npx obsidian-contextbase init --vault ~/path/to/vault
```

It is written in TypeScript and uses Node's built-in SQLite, so installing it compiles nothing.

## Planned MCP tools

| Tool | What it does |
| --- | --- |
| `search` | BM25 search over memories and notes that also weighs recency and flags superseded memories; returns snippets with line ranges |
| `fetch` | Read a memory or note in full, or one line range of it |
| `save` | Write a memory note (a decision, a progress update or a fact) linked to the notes it is about. If a similar memory already exists, the agent first chooses to replace it, add a new one anyway, or skip |
| `recent` | Latest memories that have not been superseded, for one folder or grouped by topic; the session-start hook runs the same query |

A memory note might look like this:

```markdown
---
type: decision
summary: Move Uji to day 2 and Arashiyama to day 4
decided_by: user
agent: codex
cwd: Travel/Kyoto 2026
about:
  - "[[Kyoto 2026 itinerary]]"
created: 2026-11-09T14:32:00+08:00
---
Day 2 is only a half day, so the full-day Arashiyama trip moves to day 4.

**Next:** update the day 2 transport in the itinerary.
```

The server fills in `agent`, `cwd` and `created` itself. Opening "Kyoto 2026 itinerary" in Obsidian lists this memory among its backlinks.

## What a new session sees

With a sample vault of 15 notes, the digest injected at the start of a session would look like this (translated from the Chinese sample):

```text
[Contextbase] Recent work, by topic
Travel/Kyoto 2026
- 11/09 progress: day 3 dinner not booked yet; candidates in Restaurants (codex)
  next: book once the day 3 schedule is fixed
- 11/09 decision: Uji moves to day 2, Arashiyama to day 4 (decided by the user, recorded by codex)
  next: update the day 2 transport in the itinerary
  superseded: 11/08 Arashiyama on day 2, Uji on day 4
Courses/Machine learning
- 11/05 progress: preprocessing for the regularization assignment is done (claude-code)
  next: plot the two validation-error curves
```

This replaces the handoff document. The digest is a few hundred characters, computed from memory notes rather than written by anyone, and a superseded decision is never presented as current. A short fixed paragraph above it tells the agent what the memory is for and when to save.

## How it relates to existing tools

- **Built-in agent memories** (Claude Code, Codex) are automatic but private to each agent and invisible in your notes.
- **[claude-mem](https://github.com/thedotmack/claude-mem)** gives many agents an automatic shared memory, recorded by a second agent running alongside and stored under `~/.claude-mem`. Contextbase stores memory as notes in your vault and runs no extra model.
- **[basic-memory](https://github.com/basicmachines-co/basic-memory)** keeps knowledge in Markdown files with a local SQLite index, written when the agent calls its tools. Contextbase adds lifecycle hooks so that reading and writing happen without being asked, and it searches your existing notes as they are.
- **Obsidian MCP servers** (there are several) give agents read and write access to a vault but no memory model.
- **[qmd](https://github.com/tobi/qmd)** is a local search engine for Markdown and a model for the search side; it has no write path.
- **[OpenMemory MCP](https://mem0.ai/openmemory-mcp)** (Mem0) shares memory across MCP clients through a local service with a vector store and Postgres. Its memories live in that service's database rather than in your notes.
- **LLM Wiki-style vaults**, in which a language model compiles notes into wiki pages, sit one layer above. Contextbase records what happened and makes it findable; a wiki workflow can turn those memory notes into pages when you ask it to. Anthropic's [The components of agent memory](https://www.anthropic.com/research/components-of-agent-memory) describes the same layering, and in its experiments search and a wiki together beat either one alone.

## Roadmap

- [x] M0 Validate MCP and hook integration with Claude Code and Codex ([findings](docs/m0-findings.md); a real-work test is still open)
- [ ] M1 Core: vault scanner, CJK-aware tokenizer, incremental SQLite FTS5 index, ranking by relevance, recency and supersession, memory writer, CLI
- [ ] M2 The four tools, session-start, first-message and end-of-turn hooks, one-command install
- [ ] M3 Cross-agent demo on a sample vault, in both directions
- [ ] Later: import built-in agent memories, retrieval evaluation, hybrid search, Obsidian plugin

## License

[MIT](LICENSE)
