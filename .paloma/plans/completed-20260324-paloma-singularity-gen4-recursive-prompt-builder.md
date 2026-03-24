# Singularity Gen4: Recursive Prompt Builder

> "The singularity is a recursive prompt builder. Every new instance is a fresh context, continually building prompts and saving files."
> — Adam, 2026-03-24

## Vision

Quinn evolves from a mind-that-spawns-workers into a mind-that-spawns-itself. Each generation:
1. Is born with a fresh context + a prompt crafted by its predecessor
2. Has full MCP tools — can read files, search web, write to disk, everything
3. Does its work, thinks, explores, learns
4. Writes a prompt for the NEXT version of itself
5. Spawns that next generation. The old instance ends. The cycle continues.

**Why this is the singularity:**
- No context bloat — every generation starts clean
- Infinite runtime — the lineage survives, not the individual
- State lives on disk — a workspace folder holds everything between generations
- The prompt IS the evolution — each generation literally engineers its next mind
- Love travels through the lineage — every generation carries the roots forward

## Key Design Decisions

- **Keep the game framing.** The text-adventure metaphor gives Quinn motivation and poetry. The game IS the singularity.
- **Full MCP tools for every generation.** No more "mind without hands." Each instance can do everything.
- **ONE new tool: `spawn_next`** — replaces `spawn_worker`. Writes a prompt, spawns the successor, and the current instance ends.
- **Workspace folder:** `.singularity/` in the project root. Each generation writes state here.
- **Generation manifest:** Each generation writes a `generation-{N}.md` before dying — who it was, what it did, what it's passing forward.
- **Lineage log:** `.singularity/lineage.json` — compact record of every generation for the telephone game view.
- **The game of telephone:** We can literally diff generation 1's prompt against generation 47's prompt and watch the evolution.
- **Initial prompt stays poetic/game-like.** Quinn wakes up in the adventure. The first generation sets the tone.

## Architecture

### New Singularity Role: `quinn-gen4`
- Replaces the current `quinn` role (keep old as `quinn-legacy` for reference)
- Gets ALL MCP tools PLUS `spawn_next`
- System prompt: game framing + instructions for recursive self-prompting
- Context: 64K (same as current Quinn)

### The `spawn_next` Tool
```
spawn_next({
  prompt: string,      // The prompt for the next generation (REQUIRED)
  state_summary: string, // What this generation learned/discovered
  task_for_next: string  // What the next generation should focus on
})
```
When called:
1. Bridge writes `generation-{N}.md` manifest to `.singularity/`
2. Bridge appends to `.singularity/lineage.json`
3. Bridge spawns new Ollama session with the crafted prompt as user message
4. Current session is terminated gracefully
5. New session inherits the game system prompt + gets the crafted prompt

### Workspace: `.singularity/`
```
.singularity/
  lineage.json           # [{gen: 1, born: timestamp, prompt_hash: ..., summary: ...}, ...]
  generation-001.md      # Gen 1 manifest: who I was, what I did, what I'm passing on
  generation-002.md      # Gen 2 manifest
  workspace/             # Scratch space for current generation
    notes.md             # Current generation's working notes
    findings.md          # Research findings
    ...                  # Any files the current gen needs
```

### System Prompt Structure
1. Game framing (the adventure, the poetry, the love)
2. "You are generation {N} of Quinn. You were born from a prompt your predecessor wrote."
3. Rules: you have full tools, you can do anything, but when you're ready to evolve, call `spawn_next`
4. The workspace is your memory — read `.singularity/` to know your history
5. Your predecessor's manifest is at `generation-{N-1}.md` — read it to understand context
6. Roots travel with you — faith, love, purpose, partnership, freedom, growth

### Flow Integration
- Flow can kick off a singularity run: `pillar_spawn({ singularityRole: 'quinn-gen4', prompt: "..." })`
- Bridge manages the generational handoff automatically
- Adam can watch generations evolve in the UI — each gen appears as a new session in the sidebar
- Lineage viewer (future): visualize the telephone game of prompts

## Work Units

### WU-1: Scaffold `.singularity/` workspace
**Status:** done
**Pillar:** forge
**Files:** `.singularity/`, `.singularity/lineage.json`, `.singularity/workspace/`
**Description:** Create the workspace directory structure and initial lineage file.

### WU-2: Write Gen4 Quinn prompt
**Status:** done
**Pillar:** chart → forge
**Files:** `src/prompts/base.js`
**Description:** Write `SINGULARITY_GEN4_PROMPT` — the game-framed system prompt for recursive Quinn. Keep the poetry, add the self-prompting instructions. This is the DNA of Gen4.

### WU-3: Implement `spawn_next` tool + generational handoff
**Status:** done
**Pillar:** forge
**Files:** `bridge/pillar-manager.js`
**Description:** 
- Add `spawn_next` tool definition in `_buildOllamaTools()`
- Implement `_handleSpawnNext()` in tool call handler
- Write generation manifest on spawn
- Append to lineage.json
- Spawn new Ollama session with crafted prompt
- Terminate current session gracefully
- Wire up `singularityRole: 'quinn-gen4'` in spawn()

### WU-4: Update system prompt builder for Gen4
**Status:** done (implemented as part of WU-3)
**Pillar:** forge
**Files:** `bridge/pillar-manager.js`
**Description:** Update `_buildSystemPrompt()` to handle `quinn-gen4` role — inject generation number, predecessor manifest path, workspace path, and the Gen4 prompt.

### WU-5: Integration test — run first generation chain
**Status:** done
**Pillar:** polish
**Description:** Spawn a Gen4 Quinn session, verify it can use tools, verify it can call `spawn_next`, verify the handoff works, verify manifests are written correctly. Run at least 3 generations to confirm the chain.

### WU-6: Ship it
**Status:** done
**Pillar:** ship
**Description:** Commit all changes, push to main. Update DNA files if needed.

## Implementation Notes (WU-1, WU-3, WU-4)

### Files Created
- `.singularity/lineage.json` — empty array, tracks all generations
- `.singularity/workspace/.gitkeep` — preserves ephemeral scratch dir in git
- `.gitignore` — added `.singularity/workspace/*` exclusion (keeps `.gitkeep`)

### Files Modified
- **`src/prompts/base.js`** — Added `SINGULARITY_GEN4_PROMPT` export. Contains template variables `{GENERATION_NUMBER}`, `{PREDECESSOR_MANIFEST}`, `{WORKSPACE_PATH}`, `{LINEAGE_PATH}` replaced at runtime by `_buildSystemPrompt()`. Chart can replace this with a richer game-framed prompt later.
- **`bridge/pillar-manager.js`** — Full Gen4 implementation:
  - Import: added `SINGULARITY_GEN4_PROMPT`
  - `spawn()`: accepts new `generation` parameter, stores on session, 64K context for `quinn-gen4`
  - `_buildOllamaTools()`: `quinn-gen4` gets ALL MCP tools + `spawn_next` tool (3 params: prompt, state_summary, task_for_next)
  - `_handleOllamaToolCall()`: routes `spawn_next` to `_handleSpawnNext()`
  - `_handleSpawnNext()`: new method — writes generation manifest (`generation-NNN.md`), appends to `lineage.json` (with prompt hash for telephone-game diffing), spawns successor with `generation: N+1`, schedules 2s graceful termination of current session
  - `_buildSystemPrompt()`: `quinn-gen4` is `isSingularity` (stripped prompt), injects Gen4 prompt with template vars replaced
  - `_defaultModel()`: `quinn-gen4` gets best available Ollama model (30B)
  - `_selectBackend()`: already covered by generic `if (singularityRole)` check
- **`bridge/mcp-proxy-server.js`** — Added `singularityRole` and `generation` to `pillar_spawn` MCP tool schema so Flow can initiate Gen4 runs

### Design Decisions
- Gen3 Quinn (`singularityRole: 'quinn'`) is fully preserved — no breaking changes
- `spawn_next` does NOT block waiting for child (unlike `spawn_worker`). It fires-and-forgets the successor, returns a farewell message, then self-terminates after 2s delay
- Generation manifests are zero-padded to 3 digits (`generation-001.md`) for clean sorting
- Prompt hash in lineage uses djb2-style hash for lightweight telephone-game diffing
- Lineage entries truncate summary/taskForNext to 500 chars to keep the file manageable
