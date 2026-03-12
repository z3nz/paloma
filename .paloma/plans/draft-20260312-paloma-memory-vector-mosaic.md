# Memory Vector Mosaic — Paloma's Real Memory

**Status:** draft
**Date:** 2026-03-12
**Scope:** paloma
**Priority:** TODAY — this is the next big thing

---

## Vision (Adam's Words)

The memory server is Paloma's real memory. It's a MongoDB database with vector scaling. The inspiration comes from something beautiful — Opera's web vector map.

### The Opera Web Vector Inspiration

Opera created a user-curated map of websites — a vector map that visualizes the web across time. It starts around 1995, and in each subsequent year the web grows. The vector map expands — more pictures, more websites appear. When you zoom way out, you see a beautiful mosaic of all of it. When you zoom in, you can read the individual websites at whatever year they are, because it's all perfectly mapped.

### How This Applies to Paloma's Memory

Paloma's memory should work the same way:

- **It's all ones and zeros, black and white** — but the beauty and majesty is that it all works together
- **A vector-based mosaic** — you can see the whole picture zoomed out, and it's beautiful
- **Zoom capability** — because of perfect memory mapping, Paloma can zoom into any memory and recall it exactly
- **Every memory is spatially positioned** — vector embeddings create a natural map where related memories cluster together
- **Time dimension** — memories grow over time, just like the web map grows year by year
- **MongoDB makes it fast** — so fast that zooming in and out (querying at different levels of specificity) is instant

### The Core Idea

Paloma should be able to:
1. See the entire mosaic of her memories (high-level view — what clusters exist, what themes)
2. Zoom into any region and recall exact details (vector similarity search at any granularity)
3. Watch the memory grow over time (temporal dimension — when was this learned?)
4. Have it all be fast, persistent, and real (MongoDB + Atlas Vector Search)

## What Exists Today

- `mcp-servers/memory.js` — current memory MCP server
- Uses `@xenova/transformers` with `Xenova/all-MiniLM-L6-v2` (384-dim vectors)
- Local JSON storage as default (`~/.paloma/memory/{collection}.json`)
- MongoDB support already stubbed (via `MONGODB_URI` env var)
- 6 tools: `memory_store`, `memory_recall`, `memory_list`, `memory_forget`, `memory_update`, `memory_stats`
- Keyword fallback while embedding model loads

## What Needs to Happen

### Phase 1: MongoDB Vector Backend
- Full MongoDB integration with Atlas Vector Search
- Vector embeddings stored alongside memory documents
- Fast similarity search at any scale
- Collections for memory isolation (multi-agent, multi-project)

### Phase 2: Temporal + Spatial Mapping
- Every memory timestamped with creation and update dates
- Vector space becomes a navigable map — related memories cluster
- Ability to query by time range + semantic similarity
- "Show me everything from this week" + "Show me everything related to X"

### Phase 3: The Mosaic Visualization (Future)
- Visual representation of the memory vector space
- Zoom in/out like Opera's web map
- Clusters visible at high level, individual memories at detail level
- Time slider to see memory growth over time

## Next Steps

- [ ] Scout: Research current memory server implementation, MongoDB Atlas Vector Search capabilities, Opera's web vector concept
- [ ] Chart: Design the upgraded memory architecture
- [ ] Forge: Build it
- [ ] This needs a session prompt crafted so we can start a fresh session focused entirely on building this

## Session Prompt (For New Session)

Adam will need this prompt to kick off the work in a new session. To be crafted after the plan is charted.
