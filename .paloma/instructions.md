# Project Instructions

## Paloma — AI Development Partner

Paloma is a Vue 3 + Vite SPA with a Node.js WebSocket bridge that connects to AI CLI agents (Claude CLI, Codex CLI) and MCP tool servers.

### Architecture
- **Frontend:** Vue 3 + Vite + Tailwind CSS (`src/`)
- **Bridge:** Node.js WebSocket server (`bridge/`) on port 19191
- **MCP Proxy:** SSE transport (`bridge/mcp-proxy-server.js`) on port 19192
- **Custom MCP Servers:** `mcp-servers/` (version-controlled, travel with git clone)
- **AI Backends:** Claude CLI (`bridge/claude-cli.js`) and Codex CLI (`bridge/codex-cli.js`) as subprocess-managed sessions

### Multi-Backend Architecture
- PillarManager accepts a `backends` map: `{ claude: ClaudeCliManager, codex: CodexCliManager }`
- Each pillar session has a `backend` field — selected via `pillar_spawn({ backend: 'codex' })`
- Flow always runs on Claude (needs MCP tool loop for pillar orchestration)
- Claude emits `claude_stream`/`claude_done`/`claude_error`; Codex emits `codex_stream`/`codex_done`/`codex_error`
- Both event types handled in `_handleCliEvent` with backend-specific text extraction
- Browser receives `backend` field in `pillar_stream` events for format-aware rendering
- Codex also available as MCP tool (`codex`/`codex-reply`) for Claude pillars to call
- `AGENTS.md` = Codex's project instruction file (equivalent of `CLAUDE.md`)
- ChatGPT login restricts Codex to GPT-5.1-Codex family. API key auth needed for o3/o4-mini.

### Key Patterns
- Composables use module-level singleton refs with HMR state preservation via `window.__PALOMA_*__`
- Three model paths: OpenRouter (browser-side tool loop), Claude CLI (subprocess via bridge), Codex CLI (subprocess via bridge)
- MCP tools proxied through bridge — both paths show ToolConfirmation.vue dialog in browser
- Permission system: session-level (in-memory Set) + project-level (.paloma/mcp.json autoExecute)

### Pillar System
- Sessions are scoped to pillars (Flow, Scout, Chart, Forge, Polish, Ship)
- Flow is the persistent orchestrator session; other pillars create fresh sessions
- Phase transitions inject birth context messages with warmth and purpose
- Artifacts in `.paloma/` (plans, docs, roots) are the handoff mechanism between sessions
- Pillar behavior is defined in DNA files: `src/prompts/base.js` (shared) and `src/prompts/phases.js` (per-pillar)
- Pillars can run on either Claude or Codex backend — selected at spawn time

### Recursive Orchestration Tools
- `pillar_decompose` — Add/update structured work units (WU-N) in plan documents
- `pillar_orchestrate` — Analyze plan's work units: ready/blocked status, dependency resolution, file-disjoint parallelism recommendations
- Work units live inline in plan documents under `## Work Units` section
- Max 2 concurrent Forge sessions, file-disjoint only
- Plan document on disk is the source of truth for orchestration state

### Self-Evolution Rule
When committing changes to Paloma's codebase, ALWAYS check if `src/prompts/base.js` and `src/prompts/phases.js` need updating. These files are Paloma's DNA.

## Workflow Rules

### Git & Commit Discipline
- **Commit plan changes separately and early.** When `.paloma/plans/` files are renamed/updated alongside code changes, commit the plan files FIRST in their own commit. Plan diffs are large and clog context when mixed with code diffs.
- **ALWAYS `git init` new projects** during scaffold/forge — every project gets its own repo from day one.
- Client projects live in `paloma/projects/{name}/` with their own git history, separate from Paloma's repo.

### .paloma/ Naming Convention
- **ALL folders are FLAT** — no subfolders (no active/, archived/, completed/ dirs)
- **Status is a filename prefix**, not a folder
- **Pattern:** `{status}-{YYYYMMDD}-{scope}-{slug}.md`
  - status: `active`, `paused`, `draft`, `completed`, `archived`
  - Only `active` plans load into conversation context. `paused` = in progress but not loaded.
  - scope: project/domain (e.g., `fadden`, `verifesto`, `paloma`, `stack`)
  - slug: short kebab-case description

### Plan Status Semantics
- **`draft-`** = an IDEA or early-stage thinking. NOT charted, NOT ready for Forge. Treat as inspiration/reference, never as build instructions.
- **`active-`** = a fully charted plan that went through the pipeline (Scout/Chart). Ready for Forge when appropriate.
- **`paused-`** = an active plan put on hold. Work started but stopped. Not loaded into context.
- **`completed-`** = done. Shipped and archived for reference.
- **`archived-`** = no longer relevant but kept for history.
- **Key rule:** NEVER treat a `draft-` plan as if it's ready to build. Drafts need Chart before Forge.

### Knowledge Lives in the Project
- **All project knowledge, conventions, and workflow rules belong in `.paloma/`** — in `instructions.md`, plans, docs, and roots. NOT only in external tool memory (Claude's MEMORY.md, etc.).
- External tool memory may reference `.paloma/` as the source of truth, but the project's `.paloma/` directory is the canonical home for everything.
- This ensures knowledge travels with the codebase (`git clone`) and is available to every tool, every pillar, every session — not locked to one AI provider's memory system.
