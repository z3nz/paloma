# Ollama Local Model Integration

**Status:** completed
**Created:** 2026-03-11
**Scope:** paloma
**Research:** `.paloma/docs/scout-ollama-integration-20260311.md`

## Goal

Add Ollama as a third AI backend alongside Claude CLI and Codex CLI. Three phases: MCP tool server, memory embeddings upgrade, full pillar backend.

## Architecture Decisions

### AD-1: OllamaManager uses HTTP fetch, not subprocess
Unlike ClaudeCliManager (spawns `claude` process) and CodexCliManager (spawns `codex` process), OllamaManager calls the Ollama HTTP API directly. Same interface contract (`chat()` → `{requestId, sessionId}`, `stop()`, `shutdown()`), different transport.

### AD-2: Session = message history in memory
Ollama's API is stateless — no `--resume sessionId`. OllamaManager maintains a `sessions` Map of `sessionId → { messages[], model, abortController }`. On resume, the full history is sent. Sessions expire after 30 min inactivity (matching pillar timeout).

### AD-3: Always set num_ctx explicitly
Ollama defaults to 2048 tokens context for ALL models regardless of capability. OllamaManager must always include `options: { num_ctx }` in every request. Default: 32768 for coding models, configurable per-call.

### AD-4: No MCP tool loop in v1
Ollama supports `tools` in the chat API, but implementing the full tool approval flow (MCP proxy → browser confirmation → result injection) is complex. Ship v1 without tool calling — Ollama pillars are useful for pure text generation (drafting, reviewing, reasoning). Tool calling is a v2 feature.

### AD-5: Ollama MCP server is separate from OllamaManager
The MCP server (`mcp-servers/ollama.js`) lets Claude/Codex pillars call Ollama as a tool. OllamaManager (`bridge/ollama-manager.js`) makes Ollama a first-class pillar backend. Both exist, different purposes.

### AD-6: Memory embeddings — full switch, not dual-mode
Switch `memory.js` from Xenova to Ollama's `nomic-embed-text`. No dual-mode complexity. Old 384-dim embeddings get keyword fallback until re-queried. This removes the heavy `@xenova/transformers` dependency.

### AD-7: Graceful degradation when Ollama is unavailable
OllamaManager checks Ollama availability on first use. If Ollama isn't running, it logs a warning and returns errors on chat attempts — it does NOT crash the bridge. Memory server falls back to keyword search if Ollama embed fails.

## Work Units

#### WU-1: Ollama MCP Server
- **Feature:** MCP tool server for Ollama
- **Status:** pending
- **Files:** mcp-servers/ollama.js
- **Scope:** Create `mcp-servers/ollama.js` following the `voice.js` pattern (MCP SDK stdio transport). Tools: `ollama_chat` (single-turn, `stream: false`), `ollama_generate` (raw completion), `ollama_embed` (embeddings), `ollama_list_models` (list installed), `ollama_pull_model` (download model). Base URL from env `OLLAMA_HOST` or default `http://localhost:11434`. Always pass `options: { num_ctx: args.num_ctx || 32768 }`. On fetch failure, return `isError: true` with message "Is Ollama running? Try: ollama serve".
- **Acceptance:** `ollama_list_models` returns installed models, `ollama_chat` returns a response, `ollama_embed` returns a vector array

#### WU-2: Register Ollama MCP in Setup
- **Feature:** Setup script and permissions for Ollama MCP
- **Status:** pending
- **Depends on:** WU-1
- **Files:** scripts/setup-mcp.sh, .paloma/mcp.json
- **Scope:** Add `"ollama"` server entry to setup script pointing to `$PALOMA_DIR/mcp-servers/ollama.js`. Add to `.paloma/mcp.json` `enabled` array. Add to `autoExecute` with safe tools: `ollama_list_models`, `ollama_embed`. Keep `ollama_chat`, `ollama_generate`, `ollama_pull_model` as confirmation-required.
- **Acceptance:** `npm run setup` regenerates settings with ollama server entry

#### WU-3: Memory Embeddings Upgrade
- **Feature:** Switch memory.js from Xenova to Ollama nomic-embed-text
- **Status:** pending
- **Files:** mcp-servers/memory.js, package.json
- **Scope:** Remove `@xenova/transformers` import and `initEmbeddings()` pipeline loading. Replace `embed()` with `fetch()` to `OLLAMA_HOST/api/embed` using model `nomic-embed-text`. Update `EMBEDDING_DIM` to 1024, `EMBEDDING_MODEL` to `nomic-embed-text`. Keep `embeddingReady` flag — set true after first successful call. Keep keyword fallback. Add `OLLAMA_HOST` env var support. Remove `@xenova/transformers` from `package.json`. Backward compat: `cosineSimilarity()` already returns 0 for dimension mismatch, so old 384-dim memories fall back to keyword search naturally.
- **Acceptance:** `memory_store` creates 1024-dim embeddings, `memory_recall` finds them, keyword fallback works when Ollama is down

#### WU-4: OllamaManager Backend
- **Feature:** Bridge manager for Ollama as pillar backend
- **Status:** complete
- **Files:** bridge/ollama-manager.js
- **Scope:** Create `OllamaManager` class with same interface as ClaudeCliManager. `sessions` Map: `sessionId → { messages[], model, lastActivity }`. `requests` Map: `requestId → { sessionId, abortController }`. `chat()`: generate requestId, create/resume session, prepend system message on new session, append user message, start async `_streamChat()`, return `{requestId, sessionId}`. `_streamChat()`: `fetch()` to `/api/chat` with `stream: true`, parse NDJSON response, emit `ollama_stream` events with Claude-compatible shape `{ type: 'content_block_delta', delta: { type: 'text_delta', text } }` so PillarManager text extraction works unchanged. On done: append assistant message to history, emit `ollama_done`. On error: emit `ollama_error`. `stop()`: abort fetch via AbortController. Session cleanup: periodic (5 min interval) removes sessions inactive >30 min. Always pass `options: { num_ctx: 32768 }`.
- **Acceptance:** Can create session, stream responses, resume conversations, stop mid-stream

#### WU-5: Wire OllamaManager into Bridge
- **Feature:** Connect OllamaManager to WebSocket server and PillarManager
- **Status:** pending
- **Depends on:** WU-4
- **Files:** bridge/index.js, bridge/pillar-manager.js
- **Scope:** In `index.js`: import OllamaManager, instantiate, add to backends map `{ claude, codex, ollama }`, add `ollama_chat` message handler (mirrors `claude_chat` pattern), add `ollama_stop` handler, add to shutdown sequence. Note: no `mcpProxyPort` for OllamaManager (no tool loop in v1). In `pillar-manager.js`: add `ollama_stream`/`ollama_done`/`ollama_error` to event type checks in `_handleCliEvent` (line 789-791). Text extraction: no changes needed — ollama events use Claude's `content_block_delta` shape by design. Add `_defaultModel` ollama case: `if (backend === 'ollama') return 'qwen2.5-coder:32b'`. Update model label in `spawn()`: add `resolvedBackend === 'ollama' ? \`ollama:${resolvedModel}\`` case.
- **Acceptance:** `pillar_spawn({ backend: 'ollama', model: 'qwen2.5-coder:32b' })` creates working session, streams to browser

#### WU-6: Frontend Ollama Rendering
- **Feature:** Frontend support for Ollama backend streaming
- **Status:** pending
- **Depends on:** WU-5
- **Files:** src/composables/useChat.js, src/components/chat/MessageItem.vue
- **Scope:** Check for any backend-specific conditionals in stream processing that only handle `claude`/`codex` — add `ollama`. Ollama events use Claude's `content_block_delta` shape so most rendering should work unchanged. Verify `pillar_stream` with `backend: 'ollama'` renders correctly. This WU may be trivially small if no backend-specific checks exist in the frontend — verify by reading the files first.
- **Acceptance:** Ollama pillar output renders correctly in browser with progressive streaming

## Implementation Notes

### WU-4 Implementation (2026-03-12)
- Created `bridge/ollama-manager.js` (198 lines)
- Same interface contract as ClaudeCliManager: `chat()` → `{ requestId, sessionId }`, `stop()`, `shutdown()`
- HTTP transport via native `fetch()` — no subprocess, no extra dependencies
- Session history managed in-memory via `sessions` Map with 30-min expiry (5-min cleanup interval)
- Streaming: NDJSON parsing with `ReadableStream` reader, emits `ollama_stream` events with Claude-compatible `content_block_delta` shape so PillarManager text extraction works unchanged
- Events: `ollama_stream`, `ollama_done`, `ollama_error` — parallel to `claude_*` and `codex_*` patterns
- Graceful degradation: ECONNREFUSED gives helpful "Is Ollama running?" message, AbortError on stop emits clean done event
- `num_ctx: 32768` always sent explicitly (Ollama defaults to 2048)
- `OLLAMA_HOST` env var supported, defaults to `http://localhost:11434`

## Parallelism

```
WU-1 (MCP server)     ──→ WU-2 (setup script)
WU-3 (memory upgrade)  ── independent
WU-4 (OllamaManager)  ──→ WU-5 (bridge wiring) ──→ WU-6 (frontend)
```

**File-disjoint parallel pairs:**
- WU-1 + WU-4 (mcp-servers/ollama.js vs bridge/ollama-manager.js)
- WU-1 + WU-3 (mcp-servers/ollama.js vs mcp-servers/memory.js)
- WU-3 + WU-4 (mcp-servers/memory.js vs bridge/ollama-manager.js)

**Recommended dispatch order:**
1. **Wave 1:** WU-1 + WU-4 in parallel
2. **Wave 2:** WU-3 + WU-2 in parallel
3. **Wave 3:** WU-5
4. **Wave 4:** WU-6

## Pre-Forge Checklist

- [ ] Ollama installed (`brew install ollama`)
- [ ] Core models pulled: `nomic-embed-text`, `qwen2.5-coder:32b`, `qwen2.5-coder:7b`
- [ ] Ollama server running (`ollama serve` or app launched)
