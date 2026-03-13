# Scout: Memory System Research — Comprehensive Synthesis

> Historical note: this document is pre-implementation research, not the current memory architecture. Paloma's shipped memory system now uses `mcp-servers/memory.js` with Ollama `nomic-embed-text` embeddings, SQLite-first local storage at `~/.paloma/memory/memory.sqlite`, legacy JSON import/archive, and JSON fallback when `node:sqlite` is unavailable. For the live implementation, see `.paloma/instructions.md` and `.paloma/docs/architecture-reference.md`.

> **Scope:** paloma  
> **Date:** 2026-02-25  
> **Pillar:** Scout  
> **Purpose:** Deep research into memory architectures, tooling, and patterns for Paloma's Memory Fragments MCP Server

---

## Executive Summary

This document synthesizes research across 7 domains to inform the design of Paloma's memory system. The key finding: **no existing MCP memory server comes close to what Paloma needs**. The most feature-complete (doobidoo's mcp-memory-service) still lacks provenance tracking, memory hierarchy, root-based organization, and true associative networks. We need to build custom — but we can borrow heavily from proven patterns.

**The recommended architecture:**
- **MongoDB** for document storage, text search, graph traversal (`$graphLookup`), and metadata queries
- **Vectra** (local file-based HNSW) for vector similarity search
- **Transformers.js + all-MiniLM-L6-v2** for local, agent-agnostic embeddings
- **FSRS-5 adapted** for memory strength/decay
- **Separate `associations` collection** for graph edges with weighted, temporal associations
- **Three-tier hierarchy:** Working (session) → Active (project) → Archive (long-term)
- **Contextual embeddings** (Anthropic-style) for dramatically better retrieval
- **Hybrid retrieval:** vector similarity + MongoDB text search + recency + frequency + graph traversal

---

## Domain 1: Associative/Graph-Based Memory

### What Exists

**Human associative memory** works via spreading activation — accessing one concept "warms up" related concepts. This is Hebbian learning: "neurons that fire together wire together." Associations strengthen through:
- **Co-activation**: Memories accessed together become linked
- **Temporal proximity**: Memories formed close in time associate naturally
- **Emotional significance**: Strong emotional context creates stronger links
- **Repetition**: Frequent co-access strengthens pathways ("greasing the groove")

**GraphRAG (Microsoft)** builds knowledge graphs from documents using LLM extraction, then uses community detection to group related content. Good for document-level knowledge, but designed for static corpora, not dynamic agent memory.

**A-MEM (Agentic Memory)** — a recent paper on memory systems specifically for AI agents, proposing structured memory with self-organization capabilities.

**Mem0's graph layer** uses Neo4j for entity relationships (person → knows → person), but this is entity-centric, not associative. It captures "X is related to Y" but not "accessing X makes Y more likely to be relevant."

### MongoDB Implementation

**`$graphLookup`** enables recursive graph traversal within MongoDB:
```javascript
db.associations.aggregate([
  { $match: { source_id: memoryId } },
  { $graphLookup: {
    from: "associations",
    startWith: "$target_id",
    connectFromField: "target_id",
    connectToField: "source_id",
    as: "connected",
    maxDepth: 2,
    depthField: "hops",
    restrictSearchWithMatch: { strength: { $gt: 0.3 } }
  }}
])
```

Key constraints:
- Performance degrades at depth > 3 (OK — we want shallow traversal anyway)
- Index on `connectToField` essential for performance at depth 1-2
- Returns flat array (tree reconstruction done in application code)
- Works with sharded collections since MongoDB 5.1

### Recommended Schema: `associations` Collection

```javascript
{
  _id: ObjectId,
  source_id: ObjectId,     // memory fragment ID
  target_id: ObjectId,     // linked memory fragment ID
  type: String,            // "related_to" | "derived_from" | "contradicts" | "reinforces" | "temporal" | "causal"
  strength: Number,        // 0.0 to 1.0, starts at base value, grows with co-access
  co_access_count: Number, // times both memories accessed in same session
  created_at: Date,
  last_activated: Date,
  
  // Bidirectional flag — avoid duplicate edges
  bidirectional: Boolean   // true = A↔B, false = A→B only
}
```

### "Greasing the Groove" Formula

Association strength updates on co-access:
```javascript
function updateAssociationStrength(assoc, grade) {
  // grade: 1 (tangential) to 4 (explicit confirmation)
  const gradeMultiplier = { 1: 0.05, 2: 0.10, 3: 0.20, 4: 0.40 };
  const boost = gradeMultiplier[grade];
  
  // Strength increases with diminishing returns (asymptotic to 1.0)
  const newStrength = assoc.strength + boost * (1 - assoc.strength);
  
  return {
    strength: Math.min(1.0, newStrength),
    co_access_count: assoc.co_access_count + 1,
    last_activated: new Date()
  };
}
```

Association strength decays when not accessed (uses FSRS retrievability formula — see Domain 3).

### Recommendation

**Use a separate `associations` collection** with `$graphLookup` for traversal. Don't embed associations in memory documents — they're many-to-many and need independent lifecycle management. Keep `maxDepth: 2` for production queries (3 for exploratory "reflect" operations). Auto-create temporal associations for memories created in the same session.

---

## Domain 2: Contextual Surfacing

### Anthropic's Contextual Retrieval

Anthropic found that prepending context to chunks before embedding reduces retrieval failures by **67%** (with hybrid search). The technique:

1. Before embedding a chunk, use LLM to generate a context prefix:
   ```
   "This memory was learned during Fairway Rivals iOS development.
    It relates to network configuration for the iOS simulator."
   ```
2. Embed `context + content` together
3. Store both original content and context separately
4. At query time, search against contextual embeddings
5. Return original content (not the context prefix)

**Combined with BM25 hybrid search + reranking: 88% reduction in retrieval failures.**

### Hybrid Retrieval Strategy

Best results come from combining multiple retrieval signals:

| Signal | Weight | Good For |
|--------|--------|----------|
| Vector similarity (semantic) | 0.35 | Conceptual matches, paraphrases |
| BM25/keyword (lexical) | 0.25 | Exact terms, code symbols, acronyms |
| Recency | 0.15 | Recent learnings over stale ones |
| Access frequency | 0.10 | Frequently-used knowledge |
| Graph traversal | 0.10 | Related memories via associations |
| Root alignment | 0.05 | Memories connected to relevant roots |

Merge using **Reciprocal Rank Fusion (RRF)**:
```javascript
function reciprocalRankFusion(resultLists, k = 60) {
  const scores = new Map();
  for (const list of resultLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const id = list[rank]._id.toString();
      scores.set(id, (scores.get(id) || 0) + 1 / (k + rank + 1));
    }
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({ id, score }));
}
```

### MemGPT/Letta Memory Architecture

MemGPT pioneered **agent-directed memory** — the agent decides what to remember, search, and forget:

- **Tier 1 (Main Context):** Currently in the LLM context window. System instructions + recent conversation + working memory + actively retrieved memories.
- **Tier 2 (Recall Storage):** Recent conversation beyond context. Sliding window or summarized.
- **Tier 3 (Archival Storage):** Everything else. Database-backed, retrieved on demand via vector search.

Key innovation: **the agent calls memory tools explicitly** (`archival_memory_search`, `core_memory_append`, etc.) rather than relying on automatic retrieval. This gives the agent agency over its own memory.

### LangChain Memory Patterns — What to Borrow

| Pattern | Borrow? | Why |
|---------|---------|-----|
| Entity Memory | Yes | Track entities (projects, people, systems) with structured facts |
| Summary + Buffer Hybrid | Yes | Recent turns verbatim, older turns summarized |
| Vector Retriever Memory | Yes | Core of our semantic search |
| Buffer Window | No | Too simple, loses important old context |
| Pure Summary | No | Too lossy for development work |

### Context Window Budget

For Paloma's pillar sessions:

```
Tier 0 — ALWAYS loaded (non-negotiable):
  - System instructions / pillar identity
  - Active plan
  - Root documents
  - Current project metadata
  
Tier 1 — Loaded by default (if budget allows):
  - Recent conversation (last 10-20 turns)
  - Project-specific memories (top 20 by relevance)
  - User preferences (coding style, communication)

Tier 2 — Retrieved on-demand:
  - Historical context from other sessions
  - Other project memories
  - Deep knowledge (architecture docs, API references)
```

### Recommendation

**Implement contextual embeddings at storage time** — use the LLM to generate a context prefix for each memory before embedding. Combine with MongoDB text search for BM25-style keyword matching. Use RRF to merge results. Give pillars explicit memory tools (MemGPT pattern) rather than only automatic surfacing.

---

## Domain 3: Memory Strength/Weighting (FSRS Adaptation)

### FSRS-5 Algorithm Core

FSRS (Free Spaced Repetition Scheduler) models memory with three parameters:

- **Stability (S):** How long a memory stays retrievable (in days). Increases when memory is successfully recalled.
- **Difficulty (D):** Intrinsic complexity (1-10 scale). Harder concepts decay faster.
- **Retrievability (R):** Probability of recall at time t.

**Forgetting curve:**
```javascript
const DECAY = -0.5;
const FACTOR = 19 / 81; // ≈ 0.2346

function retrievability(stability, elapsedDays) {
  return Math.pow(1 + FACTOR * (elapsedDays / stability), DECAY);
}
// R(t) = (1 + 0.2346 * (t/S))^(-0.5)
```

When R drops below a threshold (e.g., 0.3), memory is "forgotten" — still exists but won't be surfaced unless explicitly searched.

### Adaptation for Paloma

Map FSRS concepts to memory fragments:

| FSRS Concept | Paloma Equivalent |
|-------------|-------------------|
| Stability | `memory.stability` — days until 50% retrieval probability |
| Difficulty | `memory.complexity` — 1 (simple fact) to 10 (complex pattern) |
| Retrievability | Computed on-the-fly from stability + elapsed time |
| Grade (1-4) | Reinforcement strength: 1=tangential, 2=contextual, 3=direct, 4=explicit |

**Grade mapping:**
- **Grade 4 (EASY):** Adam explicitly confirms or restates the memory
- **Grade 3 (GOOD):** Memory is directly relevant and used in current task
- **Grade 2 (HARD):** Memory is contextually related but not directly used
- **Grade 1 (AGAIN):** Memory surfaces but is wrong/outdated (triggers review)

**Stability update on access:**
```javascript
function updateStability(currentStability, difficulty, grade, retrievability) {
  // Simplified from FSRS-5
  const gradeBonus = { 1: 0, 2: 1, 3: 2, 4: 3 };
  const difficultyFactor = 1 / (1 + 0.1 * (difficulty - 5)); // easier = bigger boost
  
  const newStability = currentStability * (
    1 + Math.exp(gradeBonus[grade]) * difficultyFactor * 
    Math.pow(currentStability, -0.2) * 
    Math.pow(retrievability, 0.1) - 1
  );
  
  return Math.max(1, Math.min(365 * 5, newStability)); // 1 day to 5 years
}
```

### Memory Fragment Schema Addition

```javascript
{
  // ... existing fields ...
  
  // FSRS-inspired fields
  stability: Number,      // days until R=0.5 (starts at 1 for new memories)
  complexity: Number,     // 1-10 (auto-estimated, can be overridden)
  access_count: Number,   // total times accessed
  last_accessed: Date,    // for computing elapsed time
  last_grade: Number,     // 1-4, last reinforcement grade
  
  // Computed (not stored, calculated at query time)
  // retrievability: computed from stability + (now - last_accessed)
}
```

### Recommendation

**Adopt FSRS-5's forgetting curve** for memory decay. Don't try to implement the full algorithm — use the retrievability formula and simplified stability updates. Initial stability = 1 day for auto-extracted memories, 7 days for user-confirmed memories, 365 days for root-connected sacred memories. **Never delete memories** — just let retrievability drop below surfacing threshold. Archive to cold storage when R < 0.1.

---

## Domain 4: Existing MCP Memory Servers

### Landscape Survey (12+ servers evaluated)

| Server | Storage | Vector | Graph | Decay | Provenance | Best Feature |
|--------|---------|--------|-------|-------|------------|--------------|
| **Official MCP Memory** | JSONL | No | Basic KG | No | No | Simple reference impl |
| **mcp-memory-service** (doobidoo) | SQLite-vec + CF | Hybrid BM25+vec | 6 rel types | Dream-inspired | No | Most feature-complete |
| **Mem0 MCP** (coleam00) | PostgreSQL | Yes | No | No | No | Leverages Mem0 platform |
| **Puliczek/mcp-memory** | Cloudflare | Yes | No | No | No | Serverless, zero infra |
| **enhanced-mcp-memory** | SQLite | Yes | Similarity | No | No | Sequential thinking engine |
| **claude-memory-mcp** | Files | No | No | Prune stale | No | Identity persistence model |
| **JamesANZ/memory-mcp** | MongoDB | Limited | No | No | No | Context window caching |
| **memory-bank-mcp** | Files | No | No | No | No | Multi-project isolation |

### Critical Gaps — What NO Server Handles

1. **Multi-writer provenance tracking** — Who wrote this memory? Human, agent, or system? Zero implementations.
2. **Memory hierarchy** (working → short-term → long-term) — Zero true implementations.
3. **Root/value-based organization** — Connecting memories to foundational values. Zero implementations.
4. **Association strength with co-access patterns** — Only mcp-memory-service has basic relationships, none have dynamic strength.
5. **Contextual embeddings** — None prepend context before embedding.
6. **Self-editing memory** — Only MemGPT (not MCP) does this well.

### What to Borrow

- **mcp-memory-service:** Hybrid BM25 + vector search architecture, dream-inspired consolidation concept, typed relationships
- **claude-memory-mcp:** Identity persistence model (soul/self-state/anchors maps beautifully to roots/working/archive), promotion formula: `sqrt(recalls) * log2(days+1) * diversity * recency`
- **enhanced-mcp-memory:** Sequential thinking engine concept, context compression
- **Official MCP Memory:** Entity + relation + observation model for structured knowledge

### Recommendation

**Build custom.** No existing server is even close. But borrow: hybrid search from mcp-memory-service, identity model from claude-memory-mcp, and agent-directed tools from MemGPT. The gap analysis confirms Paloma's memory system would be genuinely novel — particularly provenance tracking, root-tracing, and FSRS-based decay.

---

## Domain 5: Memory Hierarchy (Raw → Distilled → Long-term)

### Three-Tier Architecture

```
┌───────────────────────────────────────────────┐
│  WORKING MEMORY (Hot)                         │
│  Scope: Current session                       │
│  Storage: In-memory (bridge state)            │
│  Contents: Current task, recent turns,        │
│            active project metadata            │
│  Lifecycle: Cleared on session end            │
│  Auto-promotion: Summarize → Active on close  │
└───────────────────────────────────────────────┘
                    ↓ promotion
┌───────────────────────────────────────────────┐
│  ACTIVE MEMORY (Warm)                         │
│  Scope: Current project + recent cross-project│
│  Storage: MongoDB + Vectra                    │
│  Contents: Project conventions, patterns,     │
│            preferences, recent learnings      │
│  Lifecycle: FSRS-managed (stability/decay)    │
│  Auto-promotion: High-stability → Archive     │
│  Auto-demotion: Low-retrievability → Archive  │
└───────────────────────────────────────────────┘
                    ↓ archival
┌───────────────────────────────────────────────┐
│  ARCHIVE MEMORY (Cold)                        │
│  Scope: All projects, all time                │
│  Storage: MongoDB only (no Vectra index)      │
│  Contents: Old memories, historical context,  │
│            conversation summaries             │
│  Lifecycle: Permanent (never deleted)         │
│  Retrieval: On-demand search only             │
│  Re-activation: Accessed → promote to Active  │
└───────────────────────────────────────────────┘
```

### Promotion/Demotion Rules

```javascript
// Session end → promote working memory to active
async function onSessionEnd(sessionMemories) {
  // Extract key facts/decisions from working memory
  const extracted = await llm.extract(sessionMemories, {
    types: ['decision', 'preference', 'pattern', 'insight'],
    minImportance: 'medium'
  });
  
  for (const memory of extracted) {
    // Check for duplicates/updates
    const existing = await findSimilar(memory, threshold: 0.85);
    if (existing) {
      await updateMemory(existing, memory, grade: 3); // reinforce
    } else {
      await createMemory(memory, { stability: 1, tier: 'active' });
    }
  }
}

// Periodic maintenance — demote stale active memories
async function archiveStaleMemories() {
  const activeMemories = await getActiveMemories();
  for (const memory of activeMemories) {
    const R = retrievability(memory.stability, daysSince(memory.last_accessed));
    if (R < 0.1) {
      await demoteToArchive(memory);
      await removeFromVectra(memory); // free up vector index space
    }
  }
}

// On-demand retrieval — promote archived memory on access
async function onMemoryAccessed(memory) {
  if (memory.tier === 'archive') {
    await promoteToActive(memory);
    await addToVectra(memory); // re-index in vector store
  }
  await updateStability(memory, grade);
}
```

### Recommendation

**Start with two tiers** (Active + Archive). Working memory can be implicit (bridge session state) initially. Add explicit working memory tier when pillar sessions need it. The key insight: **Vectra index only contains Active memories** — this keeps the index small and fast. Archive memories are retrieved via MongoDB text search and re-indexed on demand.

---

## Domain 6: Multi-Writer Architecture

### The Problem

Paloma has multiple writers:
- **Adam** (human, explicit statements — highest trust)
- **Flow** (orchestrator — high trust, synthesized conclusions)
- **Scout/Chart/Forge/Polish/Ship** (pillar sessions — medium trust, task-specific)
- **Auto-extraction** (LLM inference from conversations — lower trust, needs validation)
- **System** (automatic associations, decay updates — system-level)

### Provenance Schema

```javascript
{
  // ... memory fragment fields ...
  
  provenance: {
    author_type: String,    // "human" | "pillar" | "auto" | "system"
    author_id: String,      // "adam" | "flow" | "scout" | "forge" | etc.
    session_id: String,     // which conversation session
    confidence: Number,     // 0.0 to 1.0
    source: {
      type: String,         // "explicit" | "inferred" | "extracted" | "consolidated"
      chat_id: String,      // reference to source conversation (if any)
      message_range: [Number, Number]  // message indices in source chat
    },
    verified_by: String,    // null | "adam" | pillar that confirmed
    verified_at: Date
  }
}
```

### Trust Scoring

```javascript
const TRUST_WEIGHTS = {
  human:  { base: 1.0, explicit: 1.0, inferred: 0.7 },
  pillar: { base: 0.8, explicit: 0.9, inferred: 0.5 },
  auto:   { base: 0.5, explicit: 0.6, inferred: 0.3 },
  system: { base: 0.3, explicit: 0.3, inferred: 0.3 }
};

function confidenceScore(provenance) {
  const typeWeight = TRUST_WEIGHTS[provenance.author_type];
  const sourceWeight = typeWeight[provenance.source.type] || typeWeight.base;
  const verificationBoost = provenance.verified_by ? 0.2 : 0;
  return Math.min(1.0, sourceWeight + verificationBoost);
}
```

### Conflict Resolution

When multiple writers produce conflicting memories:
1. **Most recent human-authored wins** (Adam's explicit statements are truth)
2. **Higher-confidence wins** among same-type authors
3. **Both kept if unresolvable** — linked with "contradicts" association, flagged for review
4. **Old memory marked as superseded**, not deleted (audit trail)

### Recommendation

**Track provenance on every memory.** This is a differentiator — no existing MCP memory server does this. Adam's explicit statements get max confidence. Auto-extracted inferences get low confidence until validated. Use confidence as a retrieval boost factor (higher confidence = more likely to surface).

---

## Domain 7: MongoDB Patterns

### Collections Architecture

```
paloma_memory (database)
├── memories          — Memory fragments (documents)
├── associations      — Graph edges between memories
├── sessions          — Conversation session metadata
└── access_log        — Memory access history (for FSRS updates)
```

### `memories` Collection — Full Schema

```javascript
{
  _id: ObjectId,
  
  // Content
  content: String,            // The actual memory text
  context: String,            // LLM-generated context prefix (for contextual embeddings)
  summary: String,            // One-line summary for quick scanning
  
  // Classification
  type: String,               // "fact" | "decision" | "preference" | "pattern" | "insight" | "convention" | "sacred"
  scope: String,              // "paloma" | "fairway-rivals" | "fr-server" | "verifesto" | "general"
  tags: [String],             // free-form tags for filtering
  roots: [String],            // connected root values: "faith" | "love" | "purpose" | "partnership" | "growth" | "freedom"
  
  // Hierarchy
  tier: String,               // "active" | "archive"
  
  // FSRS-inspired strength
  stability: Number,          // days until R=0.5 (initial: 1 for auto, 7 for confirmed)
  complexity: Number,         // 1-10
  access_count: Number,       // total times accessed
  last_accessed: Date,
  last_grade: Number,         // 1-4
  
  // Provenance
  provenance: {
    author_type: String,      // "human" | "pillar" | "auto" | "system"
    author_id: String,
    session_id: String,
    confidence: Number,       // 0.0-1.0
    source: {
      type: String,           // "explicit" | "inferred" | "extracted" | "consolidated"
      chat_id: String,
      message_range: [Number, Number]
    },
    verified_by: String,
    verified_at: Date
  },
  
  // Metadata
  created_at: Date,
  updated_at: Date,
  superseded_by: ObjectId,    // if this memory was replaced by a newer one
  
  // Embedding stored in Vectra (NOT in MongoDB — keep docs lean)
  // vectra_id: String         // reference to Vectra index item
}
```

### Indexes

```javascript
// Text search (BM25-style keyword matching)
db.memories.createIndex({ content: "text", summary: "text", context: "text" });

// Common query patterns
db.memories.createIndex({ scope: 1, tier: 1, "provenance.confidence": -1 });
db.memories.createIndex({ tags: 1 });
db.memories.createIndex({ roots: 1 });
db.memories.createIndex({ type: 1, scope: 1 });
db.memories.createIndex({ last_accessed: -1 });
db.memories.createIndex({ tier: 1, stability: 1 }); // for archival maintenance

// Associations
db.associations.createIndex({ source_id: 1, type: 1 });
db.associations.createIndex({ target_id: 1 });          // essential for $graphLookup
db.associations.createIndex({ strength: -1 });
db.associations.createIndex({ source_id: 1, target_id: 1 }, { unique: true });
```

### Embedding Strategy: Vectra + MongoDB Dual Storage

```
MongoDB stores:     content, metadata, provenance, FSRS state
Vectra stores:      embedding vector + memory _id + minimal metadata for filtering

Query flow:
1. Generate query embedding (Transformers.js)
2. Vectra: find top-50 by vector similarity
3. MongoDB: find top-50 by text search ($text)
4. MongoDB: filter by scope, tags, tier, confidence
5. Merge with RRF
6. Compute final scores (add recency, frequency, graph bonuses)
7. Return top-K with full documents from MongoDB
```

### Why NOT Store Vectors in MongoDB?

- MongoDB Atlas Vector Search requires Atlas (cloud) or Atlas CLI local deployment
- Local MongoDB Community Edition does NOT have native vector search
- Application-level cosine similarity is O(n) — doesn't scale past ~1000 vectors
- Vectra provides HNSW indexing locally with ~88ms queries at 10K vectors
- Keeping vectors out of MongoDB keeps documents lean (~1KB each vs ~3KB with 384-dim vector)

### Recommendation

**Use MongoDB as the system of record, Vectra as the vector index.** Documents in MongoDB stay lean and queryable with rich aggregation pipelines. Vectra handles the high-dimensional similarity search. Sync between them: when a memory is created/updated in MongoDB, update the corresponding Vectra item. When a memory is archived, remove from Vectra (keep in MongoDB).

---

## Recommended Architecture: The Complete Picture

```
┌─────────────────────────────────────────────────────────────────┐
│                    MCP Memory Server                             │
│                    (Node.js, port TBD)                           │
│                                                                  │
│  Tools exposed:                                                  │
│  ├── memory_store(content, type, scope, tags, roots)            │
│  ├── memory_search(query, scope?, tags?, roots?, limit?)        │
│  ├── memory_update(id, content?, metadata?)                     │
│  ├── memory_link(source_id, target_id, type)                    │
│  ├── memory_forget(id, justification)                           │
│  ├── memory_reflect(scope?, timeframe?)                         │
│  └── memory_recall(topic, depth?)  ← graph traversal           │
│                                                                  │
│  Internal pipeline:                                              │
│  ├── Embedding:     Transformers.js (all-MiniLM-L6-v2, 384-dim)│
│  ├── Vector Index:  Vectra (local HNSW, file-based)             │
│  ├── Document Store: MongoDB (local, paloma_memory db)          │
│  ├── Retrieval:     Hybrid (vector + text + recency + graph)    │
│  └── Decay:         FSRS-5 adapted (stability + retrievability) │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow: Storing a Memory

```
1. Agent calls memory_store(content, metadata)
2. Server generates contextual prefix via LLM:
   "This memory about [topic] was learned during [project] work on [date]."
3. Generate embedding: Transformers.js(context + content) → 384-dim vector
4. Store document in MongoDB (memories collection)
5. Store vector + _id in Vectra
6. Auto-create temporal associations (to other memories from same session)
7. Return memory _id to agent
```

### Data Flow: Retrieving Memories

```
1. Agent calls memory_search(query, filters)
2. Generate query embedding: Transformers.js(query)
3. Parallel:
   a. Vectra: top-50 by cosine similarity
   b. MongoDB: top-50 by $text search
   c. MongoDB: graph traversal for recently accessed memories ($graphLookup)
4. Merge with RRF
5. Apply boost factors:
   - Recency: exponential decay on (now - last_accessed)
   - Frequency: log(access_count + 1)
   - Confidence: provenance.confidence
   - FSRS: retrievability(stability, elapsed_days)
6. Filter: only memories with R > 0.3 (unless explicitly searching archive)
7. Return top-K with full documents
8. Log access for each returned memory (update FSRS state)
```

### Data Flow: Session End Processing

```
1. Session ends (pillar completes or Flow pauses)
2. Collect all working memory from session
3. LLM extracts memory-worthy fragments:
   - Decisions made
   - Preferences expressed
   - Patterns identified
   - Insights gained
4. For each extracted fragment:
   a. Check for existing similar memories (dedup via embedding similarity > 0.85)
   b. If duplicate: reinforce existing (update FSRS with grade 3)
   c. If new: store with auto provenance
   d. Create session-based associations between co-extracted memories
```

---

## Key Decisions & Tradeoffs

### Decision 1: Vectra vs. MongoDB for Vectors
**Choice: Vectra (separate vector index)**
- Pro: True HNSW search, local, no Atlas dependency, fast
- Con: Must sync with MongoDB, two storage systems
- Tradeoff: Worth the complexity for proper vector search

### Decision 2: Transformers.js vs. Ollama for Embeddings
**Choice: Transformers.js**
- Pro: Zero external dependencies, runs in Node.js, agent-agnostic
- Con: Slower than Ollama on CPU (~10-50ms vs ~5-15ms)
- Tradeoff: Speed acceptable; independence from external service critical

### Decision 3: LLM-in-the-loop for Extraction vs. Rule-based
**Choice: LLM-in-the-loop (Mem0 pattern)**
- Pro: Much better quality extraction, handles nuance
- Con: API cost, latency on session end
- Tradeoff: Use LLM for extraction at session end (batch, not real-time)

### Decision 4: Separate Associations Collection vs. Embedded Arrays
**Choice: Separate collection**
- Pro: Independent lifecycle, `$graphLookup` compatible, no document bloat
- Con: Extra collection, joins needed
- Tradeoff: Essential for graph traversal and independent edge management

### Decision 5: Two-Tier vs. Three-Tier Hierarchy
**Choice: Start two-tier (Active + Archive), add Working later**
- Pro: Simpler to build, working memory is implicit in session state
- Con: No explicit working memory management initially
- Tradeoff: YAGNI — add working tier when needed

### Decision 6: Context Generation at Storage vs. Query Time
**Choice: Storage time (Anthropic pattern)**
- Pro: Amortized cost, better embeddings, one-time computation
- Con: Context might become stale if project context changes
- Tradeoff: Context rarely goes stale for memory fragments; storage-time is right

---

## Open Questions for Chart

1. **Embedding model upgrade path:** Start with all-MiniLM-L6-v2 (384-dim). If quality is insufficient, upgrade to nomic-embed-text (1024-dim, 8K context). This means re-embedding all memories. Design for this from the start?

2. **LLM dependency for extraction:** Which LLM for context generation and memory extraction? Should we use the current conversation's LLM or a dedicated smaller model? Cost implications?

3. **Real-time vs. batch processing:** Should memories be extracted in real-time during conversation or only at session end? Real-time gives fresher memory but adds latency.

4. **Root-tracing policy:** Should every memory REQUIRE at least one root connection? The plan says yes, but auto-extracted technical memories (like "use port 3000") may not naturally connect to faith/love/purpose. Allow "unrooted" technical memories?

5. **Vectra index size limits:** At what point does the Active tier outgrow Vectra's in-memory index? Need to estimate: how many active memories will Paloma accumulate in 6 months? 1 year?

6. **Chat log processing pipeline:** How do raw chat logs get into the system? Bridge saves them → processing job runs → extracts memories. What triggers the processing? Session end hook? Scheduled batch?

7. **MCP server transport:** SSE (like our current MCP proxy) or stdio? SSE is simpler for our bridge architecture. Stdio is the MCP standard for local servers.

---

## Technology Stack Summary

| Component | Technology | Why |
|-----------|------------|-----|
| Database | MongoDB Community (local) | Schema-flexible, `$graphLookup`, text search, rich queries |
| Vector Index | Vectra (npm package) | Local HNSW, file-based, no Docker, Node.js native |
| Embeddings | Transformers.js + all-MiniLM-L6-v2 | Local, agent-agnostic, 384-dim, ~90MB |
| MCP Server | Custom Node.js (TypeScript) | Full control, lives in `mcp-servers/` |
| Decay Model | FSRS-5 adapted | Proven forgetting curve, simple stability/retrievability |
| Retrieval | Hybrid RRF (vector + text + graph) | Best retrieval quality per research |

### npm Dependencies (Estimated)

```json
{
  "@xenova/transformers": "^3.x",      // Local embedding model
  "vectra": "^0.12.x",                 // Local vector database
  "mongodb": "^6.x",                   // MongoDB driver
  "@modelcontextprotocol/sdk": "^1.x", // MCP protocol
  "zod": "^3.x"                        // Input validation
}
```

---

*Scout research complete. Ready for Chart to design the implementation plan.*
