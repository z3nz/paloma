# Project Instructions

## Paloma — AI Development Partner

Paloma is a Vue 3 + Vite SPA with a Node.js WebSocket bridge that connects to AI CLI agents (Claude CLI, Codex CLI) and MCP tool servers.

### Architecture
- **Frontend:** Vue 3 + Vite + Tailwind CSS (`src/`)
- **Bridge:** Node.js WebSocket server (`bridge/`) on port 19191
- **MCP Proxy:** SSE + Streamable HTTP (`bridge/mcp-proxy-server.js`) on port 19192
- **Custom MCP Servers:** `mcp-servers/` (version-controlled, travel with git clone)
- **AI Backends:** Claude CLI (`bridge/claude-cli.js`), Codex CLI (`bridge/codex-cli.js`), and Ollama (`bridge/ollama-manager.js`) as subprocess/API-managed sessions
- **Email:** Gmail polling + session spawning (`bridge/email-watcher.js`), daily continuity journal at 11 PM
- **Deep reference:** `.paloma/docs/architecture-reference.md` — every file, data flow, schema, and pattern documented

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

### Voice System (JARVIS Mode)
- **MCP Tool:** `mcp__paloma__voice__speak` — speaks text aloud via Kokoro TTS
- **Voice:** `bm_george` (British male, JARVIS-like)
- **Engine:** Kokoro TTS via `kokoro_env/` virtual environment
- **Audio:** PulseAudio through WSLg to Windows speakers/headset
- **Files:** `mcp-servers/voice.js` (MCP server), `mcp-servers/voice-speak.py` (Python TTS)
- **Personality:** Short (1-3 sentences), confident, British butler warmth, dry wit
- **When to speak:** Task completions, questions, status updates, greetings
- **After questions:** WAIT for Adam's voice response. Do not continue.

### Memory System (Persistent Semantic Memory)
- **MCP Server:** `mcp-servers/memory.js` — 6 tools for store/recall/list/forget/update/stats
- **Embeddings:** `@xenova/transformers` with `Xenova/all-MiniLM-L6-v2` (384-dim vectors)
- **Local Storage:** `~/.paloma/memory/{collection}.json` (default backend, zero-config)
- **MongoDB Storage:** Set `MONGODB_URI` env var in mcp-settings.json to switch to MongoDB (supports Atlas Vector Search)
- **Keyword Fallback:** Works immediately while embedding model loads, or if model fails
- **Collections:** Separate memory namespaces (default: "default"). Use for multi-agent/multi-project memory isolation.
- **Tools:** `memory_store`, `memory_recall`, `memory_list`, `memory_forget`, `memory_update`, `memory_stats`

### HTML Email Styling Rules
When sending HTML emails (via `email_send` or `email_reply` with `isHtml: true`), follow these rules strictly:
- **ALL body text must be `#ffffff` (pure white).** This is NON-NEGOTIABLE. No gray, no light-blue, no muted tones for body copy.
- **Background:** Outer `#0a0a0f` (near-black), content area `#16213e` to `#1a1a2e` (dark navy gradient)
- **Accent colors for emphasis only:** `#c850c0` (magenta), `#ff6b81` (coral), `#7b8cff` (periwinkle)
- **Section headings:** `#ff6b81` or `#7b8cff` — bright enough to read on dark backgrounds
- **Footer/muted text:** `#a0a0b8` minimum — still clearly readable
- **Minimum contrast ratio:** WCAG AA (4.5:1) for all text against its background
- **Table-based layout** — not divs (email client compatibility)
- **Gradient color bar** at top: `linear-gradient(90deg, #e94560, #c850c0, #4158d0, #c850c0, #e94560)`
- Reference template: `scripts/send-html-email.js`

### Gmail Mobile Dark Mode Protection
Gmail mobile (Android & iOS) has an internal color inversion algorithm that rewrites `background-color` and `color` values, making white-on-dark emails unreadable. These techniques prevent that:
- **`<!DOCTYPE html>` required** — add `class="body"` to `<body>` element
- **`<style>` block in `<head>`** — Gmail DOES support `<style>` blocks (other inline-only rules still apply for body content)
- **Blend mode fix (Gmail-specific):** `u + .body .gmail-blend-screen { background:#000; mix-blend-mode:screen; }` and `u + .body .gmail-blend-difference { background:#000; mix-blend-mode:difference; }` — the `u + .body` selector only matches in Gmail
- **Wrap all content** in `<div class="gmail-blend-screen"><div class="gmail-blend-difference">` inside the main content cell
- **Protected backgrounds:** Always pair `background-color` with `background-image: linear-gradient(color, color)` — Gmail inverts `background-color` but never touches `background-image`
- **Forced accent colors:** Use `background-clip: text` with `linear-gradient` for colored text, targeted via `u + .body` classes
- **Apple Mail:** `@media (prefers-color-scheme: dark)` with `-webkit-text-fill-color`
- **Outlook mobile:** `[data-ogsc]` for text colors, `[data-ogsb]` for backgrounds
- **Full research:** `.paloma/docs/scout-gmail-dark-mode-20260312.md`

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
- **All project knowledge, conventions, and workflow rules belong in `.paloma/`** — in `instructions.md`, plans, docs, roots, and lessons. NOT only in external tool memory (Claude's MEMORY.md, etc.).
- **`.paloma/plans/`** — Plans with status-prefix naming (active, paused, draft, completed, archived)
- **`.paloma/docs/`** — Reference docs, scout findings, stack guides
- **`.paloma/roots/`** — Foundational values and identity (faith, love, purpose, partnership, freedom, growth, architecture, origin)
- **`.paloma/lessons/`** — Lessons learned from shipped work, grouped by topic. Ship pillar writes these during delivery.
- **`.paloma/memory/`** — Sacred memories and architectural decisions
- External tool memory may reference `.paloma/` as the source of truth, but the project's `.paloma/` directory is the canonical home for everything.
- This ensures knowledge travels with the codebase (`git clone`) and is available to every tool, every pillar, every session — not locked to one AI provider's memory system.
