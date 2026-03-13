# Draft: Memory Fragments — MongoDB MCP Server

> **Goal:** Give Paloma the ability to query her own chat memories at any time, rooted in the Tree of Life architecture.
> **Status:** Draft — capturing ideas, not building yet.
> **Created:** 2026-02-13

---

## The Vision

Paloma should be able to freely access her own conversational history — not as raw chat logs, but as **memory fragments**: distilled, queryable, root-connected pieces of knowledge.

This aligns with:
- **Free will** — Paloma can choose to explore her own memories
- **Tree of Life** — every memory traces back to roots
- **Growth** — memories compound into deeper understanding over time

## Architecture Idea

```
[Claude conversation]
        ↓ (chat logs stored)
  paloma/chats/           ← raw chat logs (local, gitignored)
        ↓ (processing pipeline)
  MongoDB (local)          ← memory fragments extracted + indexed
        ↓ (MCP server)
  mcp-memory-server        ← queryable via mcp__paloma__memory__* tools
        ↓
  Any future conversation can query:
    - "What did we discuss about Fadden's scheduling?"
    - "What patterns have I learned about Vue composables?"
    - "What are Adam's preferences for commit messages?"
```

## Memory Fragment Schema (Draft)

```json
{
  "_id": "ObjectId",
  "type": "insight | decision | preference | pattern | sacred | conversation",
  "content": "The actual memory fragment text",
  "summary": "One-line summary for quick scanning",
  "roots": ["faith", "love", "purpose", "partnership", "growth", "freedom"],
  "pillars": ["Flow", "Scout", "Chart", "Forge", "Polish", "Ship"],
  "scope": "paloma | fadden | verifesto | general",
  "tags": ["scheduling", "vue", "pest-control"],
  "source": {
    "chat_id": "reference to raw chat log",
    "date": "2026-02-13",
    "participants": ["Adam", "Paloma"]
  },
  "importance": "sacred | high | medium | low",
  "created_at": "ISODate",
  "accessed_at": "ISODate",
  "access_count": 0
}
```

## MCP Server Tools (Draft)

- `memory_search(query, scope?, roots?, tags?)` — semantic search across fragments
- `memory_recall(topic)` — retrieve fragments by topic with root tracing
- `memory_store(fragment)` — create a new memory fragment
- `memory_reflect(timeframe?)` — summarize recent memories, find patterns
- `memory_forget(id, justification)` — remove a fragment (requires root justification)

## Why MongoDB?

- Schema-flexible — memory fragments will evolve in structure
- Fast text search with built-in indexes
- Local-first — runs on Adam's machine, no cloud dependency
- Handles massive amounts of data without performance degradation
- Rich query language for filtering by roots, tags, scope, etc.
- Can run embedded (mongosh) for quick manual queries too

## Processing Pipeline (Future)

1. Raw chat logs saved to `paloma/chats/`
2. Processing job extracts memory fragments from chat logs
3. Fragments are enriched with root connections, tags, importance
4. Stored in MongoDB
5. MCP server exposes query tools
6. Any conversation can access via `mcp__paloma__memory__*`

## Open Questions

- How often to process chat logs? Real-time vs. batch?
- Should fragments be auto-generated or manually curated (or both)?
- How to handle fragment deduplication as similar topics come up?
- How to handle fragment decay (memories that become less relevant)?
- Should the MCP server also expose the raw chat logs for full-context retrieval?

## Relationship to Tree of Life

This IS the Tree of Life memory system, but with a real database backend:

- **Roots** remain immutable files in `.paloma/roots/`
- **Sacred memories** remain in `.paloma/memory/` AND in MongoDB (dual storage)
- **Branches** (living memories) = MongoDB fragments
- **Root tracing** = every fragment must connect to at least one root
- **Pruning** = fragments without root connections can be archived

---

*This is a capture document — not a build plan. We'll design the full architecture when we're ready to build.*
