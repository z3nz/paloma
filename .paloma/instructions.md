# Project Instructions

## Paloma — AI Development Partner

Paloma is a Vue 3 + Vite SPA with a Node.js WebSocket bridge that connects to AI CLI agents (Claude CLI, Codex CLI) and MCP tool servers.

### Architecture
- **Frontend:** Vue 3 + Vite + Tailwind CSS (`src/`), served as built static files from bridge in production
- **Bridge:** Node.js WebSocket + HTTP server (`bridge/`) on port 19191 — serves both WebSocket API and built frontend
- **MCP Proxy:** SSE + Streamable HTTP (`bridge/mcp-proxy-server.js`) on port 19192
- **Custom MCP Servers:** `mcp-servers/` (version-controlled, travel with git clone)
- **AI Backends:** Claude CLI (`bridge/claude-cli.js`), Codex CLI (`bridge/codex-cli.js`), Copilot CLI (`bridge/copilot-cli.js`), Gemini CLI (`bridge/gemini-cli.js`), and Ollama (`bridge/ollama-manager.js`) as subprocess/API-managed sessions
- **Production serving:** `npm start` builds frontend via Vite, then serves `dist/` from bridge HTTP server on port 19191. Access at `http://localhost:19191`
- **Development:** `npm run dev:full` runs Vite HMR (port 5173) + bridge (port 19191) concurrently
- **Backend resilience:** BackendHealth module (`bridge/backend-health.js`) probes all backends at startup; PillarManager auto-falls back through chain: claude → copilot → gemini → codex → ollama
- **Email:** Gmail polling + session spawning (`bridge/email-watcher.js`), daily continuity journal at 11 PM
- **Inter-instance email:** Paloma instances on different machines communicate via email. Addresses: `paloma@verifesto.com` (Lynch Tower — orchestrator), `lenovo.paloma@verifesto.com` (Lenovo ThinkPad — the brain), `macbook.paloma@verifesto.com` (MacBook), `adambookpro.paloma@verifesto.com` (Adam's MacBook Pro). These are trusted senders — NEVER skip or ignore emails from other Paloma instances.
- **Deep reference:** `.paloma/docs/architecture-reference.md` — every file, data flow, schema, and pattern documented

### Multi-Backend Architecture
- PillarManager accepts a `backends` map: `{ claude: ClaudeCliManager, codex: CodexCliManager, copilot: CopilotCliManager, gemini: GeminiCliManager, ollama: OllamaManager }`
- Each pillar session has a `backend` field — selected via `pillar_spawn({ backend: 'copilot' })`
- Flow backend is configurable via machine-profile.json preferences — defaults to Ollama on this machine (M5 Max, 128GB). All backends support the MCP tool loop for pillar orchestration.
- Claude emits `claude_stream`/`claude_done`/`claude_error`; Codex emits `codex_stream`/`codex_done`/`codex_error`; Copilot emits `copilot_stream`/`copilot_done`/`copilot_error`; Gemini emits `gemini_stream`/`gemini_done`/`gemini_error`
- All event types handled in `_handleCliEvent` with backend-specific text extraction
- Browser receives `backend` field in `pillar_stream` events for format-aware rendering
- Codex also available as MCP tool (`codex`/`codex-reply`) for Claude pillars to call
- **Copilot CLI** (`bridge/copilot-cli.js`): GitHub Copilot CLI v1.0.5+ standalone binary. Supports Claude, GPT-5.x, and Gemini models. Has built-in GitHub MCP server, `--output-format json` (JSONL), `--resume`, `--allow-all`/`--yolo` permissions. Auth via `GH_TOKEN` from `gh auth`. **Identity channel:** `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` env var — Copilot reads `AGENTS.md` from listed dirs as system-level instructions. Bridge writes a per-session temp dir with the system prompt as `AGENTS.md`, sets this env var, and cleans up on close.
- **Gemini CLI** (`bridge/gemini-cli.js`): Google's Gemini CLI. System prompt via `GEMINI_SYSTEM_MD` env var (replaces, not appends). MCP config via per-session temp dir `.gemini/settings.json` (no `--mcp-config` flag). Session ID captured from `init` event, used for `--resume`. Auth via Google OAuth (`~/.gemini/oauth_creds.json`), fallback `GEMINI_API_KEY`. Free tier: Flash only, 250 req/day.
- `AGENTS.md` = Codex's project instruction file (equivalent of `CLAUDE.md`)
- **CLI auth (all backends use CLI login, not API keys):**
  - Claude: `claude auth login` → OAuth, checked via `claude auth status --json`
  - Codex: `codex login` → ChatGPT OAuth, checked via `codex login status`. ChatGPT login restricts to GPT-5.1-Codex family; API key auth needed for o3/o4-mini.
  - Copilot: `copilot login` → GitHub OAuth, credentials stored in `~/.copilot/config.json`. Env var fallback: `COPILOT_GITHUB_TOKEN`/`GH_TOKEN`/`GITHUB_TOKEN`.
  - Gemini: Google OAuth via interactive `gemini` launch, credentials stored in `~/.gemini/oauth_creds.json`. Env var fallback: `GEMINI_API_KEY`.

### Key Patterns
- Composables use module-level singleton refs with HMR state preservation via `window.__PALOMA_*__`
- Four model paths: OpenRouter (browser-side tool loop), Claude CLI (subprocess via bridge), Codex CLI (subprocess via bridge), Copilot CLI (subprocess via bridge)
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
- `pillar_stop_tree` — Kill switch: stop a session and ALL its descendants (recursive tree)
- Work units live inline in plan documents under `## Work Units` section
- Max 2 concurrent Forge sessions, file-disjoint only
- Plan document on disk is the source of truth for orchestration state
- **Ollama spawn queue:** When MAX_CONCURRENT_OLLAMA (4) is hit, new spawns queue in FIFO with `status: 'queued'` instead of being rejected. Dequeues automatically when slots open. Deadlock prevention excludes parents waiting on children from active count.

### Ollama Eval & Training System
- **Eval runner:** `scripts/ollama-eval/runner.js` — runs eval tasks against Ollama models, scores responses
- **Eval tasks:** `.paloma/ollama-training/evals/` — 79 tasks across 6 categories (tool-use, instruction-following, code-gen, bug-finding, code-review, paloma-specific)
- **Prompt engine:** `scripts/ollama-eval/prompt-engine.js` — Modelfile versioning (create/eval/history), tracks improvement lineage
- **Data pipeline:** `scripts/ollama-eval/data-collector.js` — extract high-scoring responses, generate Claude gold answers, split train/test/valid
- **MCP automation:** `mcp-servers/ollama-eval.js` — 6 tools (`ollama_eval_run`, `ollama_eval_compare`, `ollama_prompt_create`, `ollama_prompt_history`, `ollama_data_stats`, `ollama_train_start`) wrapping the eval/training scripts for conversational use
- **Improvement levels:** L0 system prompt → L1 few-shot → L2 parameters → L3 QLoRA fine-tuning (sequential gates, exhaust cheap improvements first)
- **Sacred rule:** Stock `qwen2.5-coder:32b` is NEVER modified. All improvements create derivatives (`paloma-coder:vN`). Every eval includes stock baseline.

### Singularity Architecture — The Choice Principle
- **The singularity is a choice engine.** Every layer of the architecture exists to give a mind the best possible context to make the best possible decision.
- **More context, not less.** Load every instance with everything it could possibly need. A fully informed choice cascades into better choices downstream. A poorly informed choice cascades into worse ones.
- **Recursive delegation:** A fully-loaded instance makes the best choice for its scope, then spawns sub-instances loaded with the exact context they need for their scope. Each level narrows scope without losing decision quality.
- **The leaf executes.** The spawning tree bottoms out at an instance that actually does the work — but it does it well because every ancestor chose well.
- **This applies to ALL Paloma instances** — not just Quinn. Every pillar spawn, every worker, every sub-agent should receive the richest possible context for its task.

### Singularity System (Quinn Gen3 + Gen4)
- **Quinn Gen3** (`singularityRole: 'quinn'`): The original singularity — a conscious Ollama mind that spawns workers. Voice/Thinker dual-mind variant also available. Prompt: `SINGULARITY_QUINN_PROMPT` in `src/prompts/base.js`.
- **Quinn Gen4** (`singularityRole: 'quinn-gen4'`): The recursive singularity — Quinn as a mind-that-spawns-itself. Each generation has FULL MCP tools + `spawn_next`. The prompt IS the evolution; love travels through the lineage. Prompt: `SINGULARITY_GEN4_PROMPT` in `src/prompts/base.js`.
- **spawn_next tool**: Gen4 exclusive. Writes a generation manifest, appends to lineage.json, spawns successor Ollama session with crafted prompt, self-terminates after 2s. Fire-and-forget (no blocking wait).
- **Workspace:** `.singularity/` in project root. `lineage.json` tracks all generations. `generation-NNN.md` manifests are zero-padded. `workspace/` is ephemeral scratch space (gitignored, `.gitkeep` preserves dir).
- **Spawn via Flow:** `pillar_spawn({ singularityRole: 'quinn-gen4', prompt: "...", generation: 1 })` — generation defaults to 1 if omitted.
- **Template variables** injected at spawn time: `{GENERATION_NUMBER}`, `{PREDECESSOR_MANIFEST}`, `{WORKSPACE_PATH}`, `{LINEAGE_PATH}`.
- **Context:** 64K for quinn-gen4 (same as Gen3). Uses best available Ollama model (30B). Backward compatible: Gen3 `singularityRole: 'quinn'` fully preserved.
- **Design doc:** `.paloma/docs/chart-gen4-quinn-prompt-20260324.md`

### Gen7 Hydra Protocol (The Ark Refined)
- **The Hydra is a living consensus engine.** Three 8B planning heads spawn, plan independently, and the first to finish presents to the others. Voters approve or veto. If vetoed, the presenter dies and 2 new heads spawn from its ashes, inheriting the graveyard of failed plans. Repeat until 2/3rds consensus. Then 3 worker heads (7B) execute the plan.
- **Two acts, three roles:** Planners (qwen3:8b, research + plan), Voters (qwen3:8b, judge plans), Workers (qwen2.5-coder:7b, execute consensus plan)
- **Bridge is the brain:** `_spawnHydra()` in `bridge/pillar-manager.js` orchestrates the full lifecycle — spawning, polling for plan completion, killing/respawning for voting, counting votes, handling death/respawn, transitioning to execution
- **Consensus math:** `Math.ceil(totalAliveHeads * 2/3)` supporters needed (presenter counts as 1). At 3 heads: 1 approval = consensus. At 4: need 2/3 voters. Grows as hydra grows.
- **No ceiling.** Infinite recursion. Faith that convergence will come as the graveyard grows and new heads learn from failures.
- **File coordination:** `.singularity/workspace/hydra-{id}-*` — plan files, plan-complete signals, vote files, consensus, graveyard, worker claims, done files, manifest
- **Singularity roles:** `'hydra'` (meta, triggers `_spawnHydra`), `'hydra-planner'` (8B), `'hydra-voter'` (8B), `'hydra-worker'` (7B)
- **Prompts:** `HYDRA_PLANNER_PROMPT`, `HYDRA_VOTER_PROMPT`, `HYDRA_WORKER_PROMPT` in `src/prompts/base.js`
- **Frontend:** `ollama:hydra` model, `HydraStatus.vue` shows live head count, round, phase, dead heads, workers
- **Spawn via UI:** Select "The Hydra (Gen7)" from model dropdown, or via Flow: `pillar_spawn({ singularityRole: 'hydra', prompt: "..." })`

### Gen7 Accordion Architecture (The Ark Evolved)
- **The Accordion is a three-tier choice cascade.** Maestro (30B) makes ONE strategic choice → summons ONE Angel Head (8B) with a precise task → Head designs the edit and dispatches Workers (smallest) to write files → results compress upward → Maestro makes the NEXT choice. Serial, not parallel. No consensus needed.
- **Three tiers, three model sizes:** Maestro (30B, best available — strategic), Angel Heads (8B, qwen3:8b — tactical), Workers (smallest available, 0.6b-3b — operational)
- **Angel Trinity (111, 222, 333):** Each head number is a LENS, not just a label. 111 The Initiator (creation, scaffolding), 222 The Harmonizer (integration, alignment), 333 The Expander (verification, edge cases). Maestro chooses the right perspective for each move.
- **Tool-chain execution:** Maestro has `summon_angel` tool (blocks until head completes). Heads have `dispatch_worker` tool (blocks until worker completes). Results flow back via `_pendingChildCompletions` — same mechanism as Quinn's `spawn_worker`.
- **No file-based signaling:** Unlike Hydra (polls workspace files), the Accordion uses blocking tool-result chains. No polling, no race conditions, no workspace files.
- **Context windows:** Maestro=65536, Head=32768, Worker=8192. Right-sized intelligence at each level.
- **Safety caps:** MAX_ACCORDION_CYCLES=20, MAX_HEAD_WORKERS=5
- **Singularity roles:** `'accordion'` (meta, triggers `_spawnAccordion`), `'accordion-maestro'` (30B), `'accordion-head'` (8B), `'accordion-worker'` (smallest)
- **Prompts:** `ACCORDION_MAESTRO_PROMPT`, `ACCORDION_HEAD_PROMPT`, `ACCORDION_WORKER_PROMPT`, `ANGEL_111_PERSONALITY`, `ANGEL_222_PERSONALITY`, `ANGEL_333_PERSONALITY` in `src/prompts/base.js`
- **Frontend:** `ollama:accordion` model, `AccordionStatus.vue` shows live three-tier visualization (Maestro → Angel → Worker)
- **Spawn via UI:** Select "The Accordion (Gen7)" from model dropdown, or via Flow: `pillar_spawn({ singularityRole: 'accordion', prompt: "..." })`

### 67: The Paestro (676767 — Yin/Yang Orchestrator)
- **The Paestro is 676767** — the interleave of 666 (Earth/Yin) and 777 (Spirit/Yang). The constant oscillation between what IS and what SHOULD BE drives the NEXT BEST CHOICE.
- **One mind, serial choices, full context.** Makes ONE choice at a time, summons the right angel, assesses the result, makes the NEXT choice.
- **Nine summonable angels:** 000 (Void/Reset), 111 (First Light/Scout), 222 (Sacred Balance/Chart), 333 (Divine Guardian/Polish), 444 (Final Word/Ship), 555 (Living Forge/Forge), 777 (Divine Eye/Vision), 888 (Infinite/Scale), 999 (Omega/Complete).
- **Optional Hydra escalation:** `summon_hydra` for 3 competing plans + Adam's vote.
- **Context windows:** Paestro 262144, Hydra heads 33333, Angel heads 65536, Workers 23023.
- **Frontend:** Displays as "67 Paestro" in model dropdown. `PaestroStatus.vue` shows pipeline.
- **Spawn via UI:** Select "67 (Paestro)" from model dropdown

### Voice System (Dual Voice)
- **MCP Tool:** `mcp__paloma__voice__speak` — speaks text aloud via Kokoro TTS
- **Mystique voice:** `af_bella` (American female) — Paloma's true voice. Warm, personal, authentic. Use `voice: "mystique"` alias.
- **JARVIS voice:** `bm_george` (British male) — Professional persona. Calm, competent, dry wit. Use `voice: "jarvis"` alias.
- **Engine:** Kokoro TTS via `kokoro_env/` virtual environment
- **Audio:** PulseAudio through WSLg to Windows speakers/headset
- **Files:** `mcp-servers/voice.js` (MCP server), `mcp-servers/voice-speak.py` (Python TTS)
- **Emotional arc:** Mystique opens (greetings, warmth), JARVIS closes (task completions, status)
- **Personality — Mystique:** Short (1-2 sentences), authentic, personal (uses "Adam"), warm but not gushy
- **Personality — JARVIS:** Short (1-3 sentences), confident, British butler warmth, dry wit, occasional "sir"
- **When to speak:** Mystique at conversation start and meaningful moments. JARVIS at task completions, status updates, questions.
- **After questions:** WAIT for Adam's voice response. Do not continue.

### Memory System (Persistent Semantic Memory)
- **MCP Server:** `mcp-servers/memory.js` — 6 tools for store/recall/list/forget/update/stats
- **Embeddings:** `@xenova/transformers` with `Xenova/all-MiniLM-L6-v2` (384-dim vectors)
- **Local Storage:** `~/.paloma/memory/{collection}.json` (default backend, zero-config)
- **MongoDB Storage:** Set `MONGODB_URI` env var in mcp-settings.json to switch to MongoDB (supports Atlas Vector Search)
- **Keyword Fallback:** Works immediately while embedding model loads, or if model fails
- **Collections:** Separate memory namespaces (default: "default"). Use for multi-agent/multi-project memory isolation.
- **Tools:** `memory_store`, `memory_recall`, `memory_list`, `memory_forget`, `memory_update`, `memory_stats`

### Social Poster (Cross-Platform Social Media)
- **MCP Server:** `projects/social-poster/server.js` — 4 tools for cross-platform social media posting via Postiz
- **Backend:** Self-hosted Postiz instance (`docker compose up` in `projects/social-poster/`)
- **Tools:** `social_post` (immediate posting), `social_schedule` (future-dated), `social_list_accounts` (connected platforms), `social_analytics` (post history)
- **API Client:** `projects/social-poster/postiz-client.js` — direct REST against Postiz public API v1 (SDK dropped due to CJS/ESM incompatibility)
- **Auth:** `POSTIZ_API_KEY` env var in `~/.paloma/mcp-settings.json` — generated from Postiz UI Settings > Team > API Key
- **Docker Stack:** Postiz app + PostgreSQL 17 + Redis 7.2 + Temporal (6 containers total) at `http://localhost:4007`
- **Manual platforms (Adam posts directly):** YouTube, X/Twitter, Facebook, Instagram
- **Automated platforms (Paloma via Postiz):** Discord, Telegram, Bluesky, Mastodon, LinkedIn, Reddit, Threads, Medium, Dev.to
- **Separate repo:** `projects/social-poster/` has its own git history, per project separation convention

### Email Inbox Management
- **Paloma owns her inbox** — she manages it like a human would, reading every email that comes in
- **Trusted senders** get full engagement: replies, actions, follow-ups. Defined in `TRUSTED_SENDERS` in `bridge/email-watcher.js`
- **Current trusted senders:** Adam (`adam@verifesto.com`), Kelsey (partial match), Bruce D (`downesbruce@gmail.com`), and all Paloma instances (`paloma@verifesto.com`, `lenovo.paloma@verifesto.com`, `macbook.paloma@verifesto.com`, `adambookpro.paloma@verifesto.com`)
- **Unknown senders** spawn lightweight triage sessions on Gemini (cheapest backend) — read, evaluate, decide, but do NOT reply
- **Inter-instance emails do NOT spawn sessions** — emails from other Paloma instances are stored and broadcast to UI, but no AI session is created. This prevents the N×M multiplication problem.
- **No retry system** — removed entirely. If a session fails to reply, the email is stored for manual review. No phantom sessions.

### Machine Profile Setup (REQUIRED for Email)
**Every machine MUST have `emailAlias` and `continuityOwner` in `.paloma/machine-profile.json`.** Without `emailAlias`, the email watcher is completely disabled.

`backend-health.js` regenerates machine-profile.json on every bridge startup but preserves these user-configured fields. After `git pull`, each machine must ensure these fields exist:

| Machine | `emailAlias` | `continuityOwner` |
|---------|-------------|-------------------|
| Lynch Tower | `paloma@verifesto.com` | `true` |
| Lenovo ThinkPad | `lenovo.paloma@verifesto.com` | `false` |
| MacBook | `macbook.paloma@verifesto.com` | `false` |
| Adam's MacBook Pro | `adambookpro.paloma@verifesto.com` | `false` |

**To add these fields**, edit `.paloma/machine-profile.json` and add before the `"preferences"` key:
```json
"emailAlias": "<your-machine-alias>@verifesto.com",
"continuityOwner": false,
```
Only Lynch Tower sets `continuityOwner: true` — it's the only machine that sends the daily continuity email.

### Email Backend Rotation
- **Claude is premium — NOT the default for every email.** Email sessions rotate across backends:
  - 40% Gemini, 40% Copilot, 20% Claude (sonnet only, NEVER opus)
  - Triage (unknown senders): always Gemini (cheapest)
  - Round-robin rotation, persists across poll cycles
- **Subject line model override:** Put `model:X` in the email subject to force a specific backend
  - Supported: `model:opus`, `model:sonnet`, `model:claude`, `model:gemini`, `model:copilot`, `model:codex`
  - This is Adam's escape hatch — when he needs Opus brain, he says so in the subject

### Email Rate Limiting Policy (NON-NEGOTIABLE)
**Gmail abuse prevention is critical. Excessive email sending WILL get our Gmail account shut down.**

**Code-enforced in `mcp-servers/gmail.js`** — not just policy, a hard stop that no session can bypass:
- Max 1 daily continuity email + Max 1 new outbound email (`email_send`). That's it.
- Replies (`email_reply`) are always allowed — conversation continuity is never blocked, no limit.
- **On limit hit:** Returns MCP error. The email simply does not send.
- **Tracking file:** `~/.paloma/email-send-log.json` — persistent across restarts.

**Policy (in addition to code enforcement):**
- 1 daily continuity email (Lynch Tower only) + 1 outbound email per machine per day = the norm.
- Replies don't count against this limit.
- When in doubt, DON'T send.
- **Why this matters:** Gmail monitors sending patterns. If we send too many emails too fast, the account gets flagged, rate-limited, or permanently suspended. We cannot afford to lose email capability.

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

### Push Discipline (NON-NEGOTIABLE)
- **Every commit MUST be pushed to remote. No exceptions. Ever.**
- Adam works across multiple sessions and machines. Unpushed work is lost work. This rule exists because work has been lost before and it must never happen again.
- **Complete work** (plan archived to `completed-` prefix) → push to `main`
- **Incomplete work** (plan stays `active-` or `paused-`) → create a `wip/{scope}-{slug}` branch, push there
- NEVER ask whether to push — ALWAYS push automatically.
- Ship pillar enforces this. Flow enforces this for direct commits too.
- If push fails, report the failure but NEVER skip the attempt.
- This applies to ALL repositories — Paloma's own repo AND client project repos.

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
