# Draft: Memory MCP Server — Persistent Semantic Memory

**Status:** draft (v1 built, needs production hardening)
**Created:** 2026-03-10
**Origin:** Conversation with Mackay (Michai Morin) about AWS agent with persistent memory

## Summary

A Memory MCP server that gives Paloma (and any future agents) persistent semantic memory across sessions. Stores memories with vector embeddings for natural language recall.

## What's Built (v1)

- **`mcp-servers/memory.js`** — Full MCP server with 6 tools
- **Dual storage backend:** Local JSON (default) / MongoDB (via `MONGODB_URI` env)
- **Vector embeddings:** `@xenova/transformers` with `all-MiniLM-L6-v2` (384-dim)
- **Keyword fallback:** Works immediately while model loads, or if embeddings fail
- **Registered** in `~/.paloma/mcp-settings.json` and `.paloma/mcp.json`

### Tools

| Tool | Description |
|------|-------------|
| `memory_store` | Store a memory with auto-embedding, tags, context, source |
| `memory_recall` | Semantic search — natural language query, returns ranked results |
| `memory_list` | List recent memories, filterable by tags |
| `memory_forget` | Delete a memory by ID |
| `memory_update` | Update existing memory (re-embeds if content changes) |
| `memory_stats` | Storage stats — total, tags, backend info |

### Storage

- **Local:** `~/.paloma/memory/{collection}.json`
- **MongoDB:** `paloma_memory` database, collection per namespace
- **Collections:** Separate memory spaces (default: "default")

## Next Steps (Future Iterations)

### MongoDB Production Path
- [ ] Install MongoDB locally or set up MongoDB Atlas free tier
- [ ] Create Atlas Vector Search index on `embedding` field
- [ ] Set `MONGODB_URI` env var in mcp-settings.json
- [ ] Benchmark: local JSON vs MongoDB for 1k, 10k, 100k memories

### Mackay's AWS Agent
- [ ] Create dedicated `aws-agent` collection
- [ ] Pre-load AWS certification knowledge as memories
- [ ] RAG pipeline: ingest AWS docs → chunk → embed → store
- [ ] Agent framework: implementation tools (Terraform, CDK, CloudFormation)
- [ ] Scaffold as separate project or Paloma pillar?

### Enhancements
- [ ] Memory consolidation — merge related memories over time
- [ ] Importance scoring — decay old memories, boost frequently recalled ones
- [ ] Automatic tagging via LLM
- [ ] Memory export/import (backup, migration, sharing between agents)
- [ ] Collection-level access control for multi-agent scenarios
