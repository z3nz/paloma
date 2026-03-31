# Self-Improvement: Code Quality, Performance & DX

**Status:** Active
**Created:** 2026-03-29
**Scope:** paloma
**Author:** Flow (autonomous self-improve mode)

## Summary

Flow-initiated autonomous improvement pass across Paloma's codebase. Focused on code quality, performance, and developer experience. No feature additions — just making existing code cleaner, faster, and more maintainable.

## Findings

### 1. MCP Manager Timeout Leak (Performance)
`mcp-manager.js:callTool()` uses `Promise.race` with a `setTimeout` that's never cleared when the tool completes first. Every successful tool call leaks a timer until it naturally fires. Fix: use AbortController or clear the timer on resolve.

### 2. Backend Dispatch Ternary Chains (Code Quality / DX)
`useCliChat.js` has 8-level nested ternaries for `sendFn` selection and model name resolution. Same pattern repeated 3-4 times. Fix: create a `resolveBackend(model)` utility that returns `{ sendFn, streamGenerator, modelName, backendKey }` from a lookup table.

### 3. decodeEntities Creates DOM Element Per Call (Performance)
`MessageItem.vue:decodeEntities()` creates a new `<textarea>` on every invocation just to decode HTML entities. Fix: reuse a single module-level element.

### 4. Bridge index.js Monolith (Code Quality / DX)
800+ line file mixing HTTP routes, WS handlers, static serving. The HTTP handler alone has email API, usage API, files API, health API all inline with if/else chains. Fix: extract route handlers into `bridge/routes/*.js` modules.

### 5. Duplicated WS Chat Handlers (Code Quality)
`claude_chat`, `codex_chat`, `copilot_chat`, `gemini_chat` handlers in index.js are nearly identical — same structure, different manager and event type names. Fix: unified dispatcher function.

### 6. MCP Server Auto-Reconnect (Resilience)
If an MCP server process crashes, it stays dead until bridge restart. Fix: add health check + auto-restart on `callTool` failure.

## Work Units

### WU-1: Quick Fixes (Flow direct)
- Fix MCP Manager timeout leak
- Fix decodeEntities textarea reuse
- Create backend dispatch utility
**Files:** `bridge/mcp-manager.js`, `src/components/chat/MessageItem.vue`, `src/services/backendDispatch.js` (new), `src/composables/useCliChat.js`

### WU-2: Bridge Route Extraction (Forge)
- Extract HTTP route handlers from index.js into modular files
- Unify WS chat handlers into single dispatcher
**Files:** `bridge/index.js`, `bridge/routes/` (new dir)

### WU-3: MCP Auto-Reconnect (Forge)
- Add reconnection logic to MCP Manager
**Files:** `bridge/mcp-manager.js`
