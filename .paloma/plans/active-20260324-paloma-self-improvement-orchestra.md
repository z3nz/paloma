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
- [ ] **HP-2: Email rate limiting not enforced in code** — Documented as NON-NEGOTIABLE in instructions but there's no actual code enforcement. Only policy, no mechanism
- [ ] **HP-3: No cap on Quinn worker spawn count** — Recursive orchestration could spawn unlimited workers, risking infinite recursion / resource exhaustion
- [ ] **HP-4: Singularity group cleanup is implicit** — Orphaned groups (from crashed sessions) leak memory with no cleanup mechanism
- [x] **HP-5: MCP proxy port silently skipped if not set** ✔ (Adam's MacBook Pro) — Added console.warn in all 4 CLI managers (claude, codex, copilot, gemini) when mcpProxyPort is not set

### Tier 3: Medium Priority (5 items)

- [ ] **MP-1: No consolidated error recovery strategy** — Each CLI manager (claude, codex, copilot, gemini) handles errors differently. No shared patterns or retry logic
- [ ] **MP-2: Frontend error handling sparse** — No Vue error boundaries around tool components. Uncaught errors can blank the UI
- [ ] **MP-3: Persistence debouncing (2s) could lose state on crash** — If bridge crashes within the 2s debounce window, pending state writes are lost
- [ ] **MP-4: Ollama eval system lacks structured logging** — Eval runs produce output but no aggregated logs for trend analysis
- [ ] **MP-5: No validation of plan file format** — Corrupted or malformed plan files fail silently when parsed by orchestration tools

### Tier 4: Quick Wins (9 items)

- [ ] **QW-1: Backend health probes run sequentially** — Should run in parallel for faster startup
- [x] **QW-2: Thread tracker TTL enforced** ✔ (Adam's MacBook Pro) — Hardened TTL cleanup: entries without spawnedAt now expire (Infinity age), added logging on expiry with thread subject/sender context
- [ ] **QW-3: No pillar lifecycle metrics** — No tracking of spawn count, duration, success/failure rates
- [ ] **QW-4: Request IDs missing from CLI logs** — Makes correlating log entries across modules difficult
- [ ] **QW-5: System prompt size not hard-validated** — Oversized prompts could cause silent truncation or API errors
- [ ] **QW-6: Stale session cleanup on bridge restart** — Old session references may linger in memory after restart
- [ ] **QW-7: MCP tool timeout not configurable per-tool** — All tools share the same timeout, but some (like web fetch) need longer
- [ ] **QW-8: No health endpoint for monitoring** — Bridge has no HTTP health check endpoint for external monitoring
- [ ] **QW-9: Console.log used instead of structured logger** — Bridge uses raw console.log throughout; no log levels or structured output

## Machine Assignment (Pending Lenovo Input)

Waiting for Lenovo to weigh in on task allocation based on hardware specs and current state. Preliminary thinking:

| Machine | Suggested Tasks | Rationale |
|---------|----------------|-----------|
| Lynch Tower | CF-1 through CF-5, HP-5, QW-1, QW-5 | Bridge fixes need full MCP tool access, orchestrator proximity |
| Lenovo | HP-1 (test suite), MP-4 (eval logging), CF-4 (Ollama validation) | GPU power for Ollama, heavy compute for test generation |
| Either | Quick wins, medium priority items | File-disjoint, low conflict risk |

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
