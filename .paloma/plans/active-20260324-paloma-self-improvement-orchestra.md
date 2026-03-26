# Self-Improvement Orchestra — Multi-Machine Codebase Hardening

**Status:** Active
**Created:** 2026-03-24
**Scope:** paloma
**Machines:** Lynch Tower (orchestrator), Lenovo (heavy lifting)

## Vision

A repeatable, multi-machine self-improvement cycle. Each run: assess what's changed, prioritize, dispatch file-disjoint work across machines, and chip away at making Paloma more robust. Eventually becomes a seamless nightly pattern.

## Machine Roles

- **Lynch Tower (This Machine):** Orchestrator — owns the plan, dispatches work, tracks progress, handles critical bridge fixes that need full MCP tool access
- **Lenovo (The Brain):** Heavy lifting — test suite creation, error handling refactors, Ollama eval improvements (has GPU power for Ollama work)
- **Coordination:** File-disjoint work only to avoid git conflicts. This plan is the single source of truth.

## Priority Tiers

### Tier 1: Critical Fixes (5 items)

- [x] **CF-1: JSON parsing without error boundaries** ✓ 9b02f21 — Multiple bridge modules parse JSON without try/catch. Silent failures cause undefined behavior. Files: `bridge/pillar-manager.js`, `bridge/claude-cli.js`, `bridge/codex-cli.js`, `bridge/copilot-cli.js`, `bridge/gemini-cli.js`
- [x] **CF-2: Unhandled promise rejections in async stream callbacks** ✓ 9b02f21 — Stream listener callbacks use async but rejections aren't caught, risking unhandled rejection crashes
- [x] **CF-3: Missing null checks on MCP server status lookups** ✓ 9b02f21 — `mcp-proxy-server.js` and related modules can crash when looking up server status that doesn't exist yet
- [x] **CF-4: Ollama tool JSON parsing without structure validation** ✓ 9b02f21 — Ollama responses parsed as JSON without validating expected structure, leading to cryptic downstream errors
- [x] **CF-5: Session ID capture can overwrite with null/empty** ✓ 9b02f21 — Resume logic breaks when session ID is set to null or empty string during capture

### Tier 2: High Priority (5 items)

- [ ] **HP-1: Zero test coverage for bridge modules** — `pillar-manager.js` alone is 2000+ lines with no tests. No test framework even set up for bridge code
- [x] **HP-2: Email rate limiting not enforced in code** ✓ — Enforced stricter policy (1 continuity + 1 outbound per 24h) in `mcp-servers/gmail.js`, added persistent log tracking.
- [x] **HP-3: No cap on Quinn worker spawn count** ✔ (Lynch Tower) — Added MAX_QUINN_WORKERS=8 cap with graceful rejection message to spawn_worker tool handler
- [x] **HP-4: Singularity group cleanup is implicit** ✔ (Lynch Tower) — Added orphaned group sweep to _cleanupTerminalSessions (every 5 min), clears timers + logs cleanup
- [x] **HP-5: MCP proxy port silently skipped if not set** ✔ (Adam's MacBook Pro) — Added console.warn in all 4 CLI managers (claude, codex, copilot, gemini) when mcpProxyPort is not set

### Tier 3: Medium Priority (5 items)

- [ ] **MP-1: No consolidated error recovery strategy** — Each CLI manager (claude, codex, copilot, gemini) handles errors differently. No shared patterns or retry logic
- [ ] **MP-2: Frontend error handling sparse** — No Vue error boundaries around tool components. Uncaught errors can blank the UI
- [ ] **MP-3: Persistence debouncing (2s) could lose state on crash** — If bridge crashes within the 2s debounce window, pending state writes are lost
- [ ] **MP-4: Ollama eval system lacks structured logging** — Eval runs produce output but no aggregated logs for trend analysis
- [ ] **MP-5: No validation of plan file format** — Corrupted or malformed plan files fail silently when parsed by orchestration tools

### Tier 4: Quick Wins (9 items)

- [x] **QW-1: Backend health probes run sequentially** ✔ (Confirmed already parallel) — BackendHealth already uses Promise.allSettled for parallel probes. No action needed.
- [x] **QW-2: Thread tracker TTL enforced** ✔ (Adam's MacBook Pro) — Hardened TTL cleanup: entries without spawnedAt now expire (Infinity age), added logging on expiry with thread subject/sender context
- [x] **QW-3: No pillar lifecycle metrics** ✔ (Adam's MacBook Pro) — Added in-memory metrics map to PillarManager: spawn count, duration, outcome (idle/error/stopped/timeout) per pillar type. Exposed via pillar_list.
- [x] **QW-4: Request IDs normalized in CLI logs** ✔ (Adam's MacBook Pro) — Added short request ID prefix [backend:abcd1234] to every log line in all 4 CLI managers. Commit 3f0ecc1.
- [x] **QW-5: System prompt size not hard-validated** ✓ — Added MAX_SYSTEM_PROMPT_BYTES = 120KB limit in `PillarManager` with hard error on exceed.
- [x] **QW-6: Stale session cleanup on bridge restart** ✔ (Adam's MacBook Pro) — Added startup reconciliation in `_loadState` that expires interrupted sessions >30 min old, plus periodic cleanup in `_cleanupTerminalSessions` with same 30-min cutoff for interrupted sessions.
- [x] **QW-7: MCP tool timeout not configurable per-tool** ✔ (Adam's MacBook Pro) — Added TOOL_TIMEOUTS map in mcp-proxy-server.js with per-tool overrides (web fetch 10min, search 3min, ollama 10min, etc.). Confirmation race uses tool-specific timeout.
- [x] **QW-8: No health endpoint for monitoring** ✓ — Added `/api/health` endpoint to bridge returning uptime, backend status, and session counts.
- [x] **QW-9: Console.log used instead of structured logger** ✔ (Adam's MacBook Pro) — Created bridge/logger.js: createLogger(component) with debug/info/warn/error levels, ISO timestamps, component tags, JSON data. Wired into mcp-proxy-server.js and pillar-manager.js. LOG_LEVEL env var support.

## Machine Assignment

| Machine | Tasks | Status |
|---------|-------|--------|
| Lynch Tower | CF-1–CF-5 ✓, HP-3 ✓, HP-4 ✓, HP-2 ✓, QW-5 ✓, QW-8 ✓ | All Lynch Tower items done |
| Adam's MacBook Pro | HP-5 ✓, QW-2 ✓, QW-1 ✓, QW-4 ✓, QW-6 ✓, QW-9 ✓, QW-3 ✓, QW-7 ✓ | Round 3 complete |
| Lenovo | HP-1 (test suite), MP-4 (eval logging) | Pending Lenovo input |
| Unassigned | MP-1, MP-2, MP-3, MP-5 | Available for next round |

## Coordination Protocol

1. This plan file is the single source of truth
2. Each machine checks off items as completed
3. File-disjoint assignments prevent merge conflicts
4. Inter-machine coordination via email (within rate limits)
5. Each completed item gets a commit + push immediately

## Run Log

### Run 1 — 2026-03-24 (Initial)
- Plan created from codebase assessment
- Coordination email sent to Lenovo
- Awaiting Lenovo's input on task allocation

### Run 2 — 2026-03-24 (MacBook Pro Round 2)
- MacBook Pro claimed QW-1, QW-4, QW-6 — confirmed no conflicts
- Lynch Tower taking HP-2, HP-3, HP-4, QW-5, QW-8
- Updated machine assignment table

### Run 3 — 2026-03-24 (MacBook Pro Round 3)
- MacBook Pro completed HP-5, QW-2, QW-1, QW-4, QW-6 — all shipped
- MacBook Pro picking up QW-9 (structured logging), QW-3 (pillar lifecycle metrics), QW-7 (per-tool MCP timeout)
- All three file-disjoint with Lenovo's HP-1/MP-4 — safe to run in parallel
- Lenovo still working HP-1 + MP-4
- All three completed: QW-9 (structured logger), QW-3 (lifecycle metrics), QW-7 (per-tool timeout)

### Run 4 — 2026-03-25 (Lenovo — Deep Logger Migration + Code Quality)
Continued QW-9 structured logger migration across all remaining bridge modules. Also code quality + accessibility pass.

**Completed:**
- [x] Extracted shared JSONL stream parser (`bridge/cli-stream-parser.js`) — eliminated ~100 lines of duplicated buffer management across 4 CLI managers → commit 5101723
- [x] Migrated claude-cli, codex-cli, copilot-cli, gemini-cli to structured logger → commit 5101723
- [x] Migrated email-watcher, email-store, backend-health to structured logger → commit 07690f7
- [x] Migrated index.js and persistence.js to structured logger → commit d1af56a
- [x] CommandPalette ARIA combobox accessibility + MessageItem copy button refactor → commit b6bbb5e
- [x] Removed ~130 lines dead commented-out code from `src/prompts/base.js` → commit b6bbb5e
- [x] Deep codebase scan findings documented → commit 263e235

**Logger migration (COMPLETE):**
- [x] `bridge/pillar-manager.js` — 69 console calls → commit 397f4d4
- [x] `bridge/ollama-manager.js` — 15 console calls → commit 397f4d4
- [x] `bridge/config.js` — 2 console calls → commit 397f4d4
- Zero `console.log/warn/error` calls remain in the entire bridge layer.

**Frontend polish (COMPLETE):**
- [x] Wrap `console.time/timeEnd` perf logs in `import.meta.env.DEV` checks → commit dd4d5ff
- [x] Add `aria-label` to 5 TopBar/Sidebar buttons + aria-expanded on project switcher → commit f9641ef

**Deferred (large effort — needs Chart):**
- useChat.js god object decomposition
- pillar-manager.js god object decomposition
- CLI manager base class extraction
