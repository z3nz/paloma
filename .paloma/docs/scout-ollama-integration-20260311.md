# Scout: Ollama Local Model Integration
**Date:** 2026-03-11  
**Hardware target:** MacBook Pro M5, 128GB RAM, 8TB storage  
**Scope:** Full research for integrating Ollama as a local model backend for Paloma

---

## 1. Ollama on macOS with Apple Silicon

### Installation

```bash
# Option 1: Homebrew (recommended for dev workflows)
brew install ollama

# Option 2: Direct download from ollama.com
# .dmg installer, installs as macOS app with menu bar icon

# Start server
ollama serve  # or the app auto-starts on launch

# Pull and run a model
ollama pull qwen2.5-coder:32b
ollama run qwen2.5-coder:32b
```

Default port: `http://localhost:11434`

### Apple Silicon Integration

Ollama uses **llama.cpp under the hood** with **Metal GPU acceleration** automatically enabled on Apple Silicon. No configuration needed — Metal is detected and used by default.

**How it works with unified memory:**
- Apple Silicon's unified memory architecture means GPU and CPU share the same RAM pool
- Models load directly into this shared pool — no VRAM/RAM split like discrete GPU systems
- All GPU cores (the "neural engine" + GPU compute cores) can address the full 128GB
- This is why Apple Silicon punches above its weight vs. NVIDIA cards with limited VRAM

**M5 performance characteristics:**
- M5 Pro/Max has significantly improved memory bandwidth (~400+ GB/s on Max variant)
- Benchmark data from community: M5 MacBook Pro shows ~45% improvement in prompt processing (PP) and ~25% improvement in token generation (TG) vs M4
- Expected 70B Q4_K_M performance: **25–35 tokens/second** (TG)
- For comparison: M3 Max 128GB gets ~20–30 t/s on 70B Q4_K_M

**Note on MLX vs GGUF:** There are reports that LM Studio with MLX-format models runs 1–2x faster on Apple Silicon than Ollama's GGUF format. Ollama uses GGUF only. If peak performance matters for a specific use case, this is worth tracking — but for Paloma's pillar workflow, Ollama's ease of integration and API surface outweigh the performance gap.

### What fits in 128GB?

| Model | Quantization | Memory | Notes |
|-------|-------------|--------|-------|
| 7B | Q4_K_M | ~4.5GB | Very fast, good quality |
| 7B | Q8 | ~8GB | Near full quality |
| 14B | Q4_K_M | ~9GB | phi4, gemma2 range |
| 32B | Q4_K_M | ~20GB | qwen2.5-coder:32b |
| 32B | Q8 | ~35GB | Near lossless at 32B |
| 70B | Q4_K_M | ~40–45GB | llama3.3:70b, qwen3:72b |
| 70B | Q6_K | ~55GB | Better quality, still fits |
| 70B | Q8 | ~75GB | Near-lossless, fits with room |
| 235B (MoE) | Q4_K_M | ~130GB+ | qwen3:235b — tight but possible |

With 128GB, Adam can comfortably run **any 70B model at Q8** (the highest quality practical quantization) while still having memory for OS and other processes. A 70B Q4_K_M leaves ~85GB free — enough to run multiple models simultaneously or one large + one small.

**Context window memory note:** Context also consumes memory (KV cache). A 70B model at 32k context adds ~8–15GB on top of the model weights.

---

## 2. Ollama API Surface

Base URL: `http://localhost:11434`

### Core Endpoints

#### Chat (multi-turn, recommended for pillars)
```
POST /api/chat
```
```json
{
  "model": "qwen2.5-coder:32b",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Write a function that..."}
  ],
  "stream": true,
  "options": {
    "num_ctx": 32768,
    "temperature": 0.7
  }
}
```
**Streaming response:** NDJSON stream, each line is a JSON object:
```json
{"model":"qwen2.5-coder:32b","created_at":"...","message":{"role":"assistant","content":"Here "},"done":false}
{"model":"qwen2.5-coder:32b","created_at":"...","message":{"role":"assistant","content":""},"done":true,"eval_count":42,"eval_duration":1234567890}
```

#### Generate (single-turn, simpler)
```
POST /api/generate
```
```json
{
  "model": "llama3.2:3b",
  "prompt": "Why is the sky blue?",
  "stream": true,
  "options": {"num_ctx": 8192}
}
```

#### Embeddings
```
POST /api/embed
```
```json
{
  "model": "nomic-embed-text",
  "input": "The sky is blue because of Rayleigh scattering"
}
```
Returns: `{"embeddings": [[0.123, 0.456, ...]]}`  
Also accepts `input` as an array for batch embedding.

#### Model Management
```
POST /api/pull     {"model": "qwen2.5-coder:32b"}       # Download
DELETE /api/delete {"model": "old-model"}                # Remove
GET  /api/tags                                           # List installed models
POST /api/show     {"model": "qwen2.5-coder:32b"}        # Model details/metadata
POST /api/copy     {"source": "...", "destination": "..."} # Clone model
```

#### Running Models Check
```
GET /api/ps        # List currently loaded models in memory
```

### OpenAI-Compatible API

Ollama exposes a fully OpenAI-compatible layer at `/v1/`:

```
POST /v1/chat/completions   # Same as OpenAI's chat
POST /v1/embeddings         # Same as OpenAI's embeddings
GET  /v1/models             # List models (OpenAI format)
POST /v1/completions        # Legacy completions
```

Usage with OpenAI SDK (Node.js):
```javascript
import OpenAI from 'openai'
const client = new OpenAI({
  baseURL: 'http://localhost:11434/v1',
  apiKey: 'ollama'  // required but ignored
})
const response = await client.chat.completions.create({
  model: 'qwen2.5-coder:32b',
  messages: [{ role: 'user', content: 'Hello' }],
  stream: true
})
```

### ⚠️ Critical Gotcha: Context Window Default

**Ollama defaults to 2048 tokens context for ALL models**, regardless of what the model actually supports.

A qwen2.5-coder:32b supports 32k tokens but Ollama will silently truncate at 2k unless you set:
```json
{"options": {"num_ctx": 32768}}
```

For Paloma's pillar use (agents, coding tasks, long context): **always set `num_ctx` explicitly**. Recommended minimums:
- Fast/small models: `num_ctx: 8192`
- Coding/chat models: `num_ctx: 32768`
- Long context tasks: `num_ctx: 131072`

### Streaming Architecture

Ollama's streaming for `/api/chat`:
1. Send POST with `"stream": true` (default)
2. Response is an NDJSON stream — one JSON object per line
3. Each chunk has `message.content` delta (not the full text)
4. Final chunk has `"done": true` plus stats (`eval_count`, `eval_duration`, etc.)

For Node.js streaming, use `fetch` with response body as an async iterator:
```javascript
const response = await fetch('http://localhost:11434/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model, messages, stream: true, options: { num_ctx } })
})
const reader = response.body.getReader()
const decoder = new TextDecoder()
let buffer = ''
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  buffer += decoder.decode(value, { stream: true })
  const lines = buffer.split('\n')
  buffer = lines.pop()
  for (const line of lines) {
    if (!line.trim()) continue
    const chunk = JSON.parse(line)
    if (chunk.message?.content) {
      onChunk(chunk.message.content)  // emit delta
    }
    if (chunk.done) onDone(chunk)
  }
}
```

### Stateless API — Session Management

**Key difference from Claude/Codex CLIs:** Ollama is a **stateless HTTP API**. There are no persistent sessions or conversation IDs. Multi-turn conversations require maintaining the `messages` array yourself and sending the full history on each request.

This is actually simpler than Claude CLI's `--resume` pattern — you own the history, no session ID required.

---

## 3. Best Models for Paloma's Use Cases

All tested models run efficiently on M5/128GB. Memory estimates use Q4_K_M quantization.

### 🧑‍💻 Coding Assistance

| Model | Size | Memory | Speed | Notes |
|-------|------|---------|-------|-------|
| `qwen2.5-coder:32b` | 32B | ~20GB | ~35 t/s | **Top pick.** GPT-4o competitive on Aider benchmarks. Best overall coding quality. |
| `qwen2.5-coder:7b` | 7B | ~4.7GB | ~80 t/s | **Fast workhorse.** Great for quick edits, autocomplete. |
| `deepseek-coder-v2:16b` | 16B | ~10GB | ~55 t/s | Strong alternative, good at refactoring. |
| `qwen3:32b` | 32B | ~20GB | ~35 t/s | Strong reasoning + code, may edge out qwen2.5-coder on complex tasks. |

**Recommendation for Paloma:** `qwen2.5-coder:32b` for Forge/Polish (quality matters), `qwen2.5-coder:7b` as fast fallback for quick tasks.

### 🧠 General Reasoning

| Model | Size | Memory | Speed | Notes |
|-------|------|---------|-------|-------|
| `qwen3:72b` | 72B | ~45GB | ~28 t/s | **Top pick for 128GB.** Best open-source reasoning, 256K context support. |
| `llama3.3:70b` | 70B | ~45GB | ~28 t/s | Strong, versatile, excellent instruction following. |
| `deepseek-r1:32b` | 32B | ~20GB | ~35 t/s | Best reasoning for size. Chain-of-thought, thinking mode. |
| `phi4:14b` | 14B | ~9GB | ~55 t/s | Microsoft's surprisingly capable small model. Strong reasoning per GB. |
| `gemma3:27b` | 27B | ~17GB | ~38 t/s | Google's strong general model, clean instruction following. |

**Recommendation for Paloma:** `qwen3:72b` for complex reasoning tasks (Scout, Chart), `deepseek-r1:32b` for tasks needing explicit reasoning traces.

### 🔢 Embeddings (for Memory System Upgrade)

Current Paloma memory uses `Xenova/all-MiniLM-L6-v2`: 384 dimensions, 512 max tokens.

| Model | Dims | Context | Notes |
|-------|------|---------|-------|
| `nomic-embed-text` | 1024 | 8192 | **Best upgrade path.** 2.7x more dimensions, 16x more context. Strong MTEB scores. |
| `mxbai-embed-large` | 1024 | 512 | English-focused, BERT-large performance, strong on MTEB. |
| `snowflake-arctic-embed2` | 1024 | 8192 | Multilingual, competitive MTEB, large context window. |
| `qwen3-embedding` | 1024–2048 | 8192 | Latest from Alibaba, multiple size variants available. |

**Recommendation:** Upgrade to `nomic-embed-text`. 1024 dims + 8192 context is a massive improvement over the current 384/512 setup. The `memory.js` server would need ~20 lines changed to call Ollama's `/api/embed` instead of Xenova.

Backward compatibility note: Existing embeddings in `~/.paloma/memory/*.json` are 384-dim. Switching models invalidates stored embeddings — a full re-embed would be needed, or run both models during a transition period.

### 👁️ Vision / Multimodal

| Model | Size | Memory | Notes |
|-------|------|---------|-------|
| `qwen2.5-vl:72b` | 72B | ~45GB | **Best available.** Document OCR, layout analysis, visual reasoning. |
| `qwen2.5-vl:7b` | 7B | ~5GB | Good for quick visual tasks, much faster. |
| `llava:34b` | 34B | ~22GB | General visual understanding, chat about images. |
| `gemma3:27b` | 27B | ~17GB | Multimodal, handles multiple images. |
| `moondream` | 1.8B | ~1.5GB | Tiny, fast, CPU-capable, simple image Q&A. |

**Recommendation:** `qwen2.5-vl:7b` for most visual tasks (fast, capable). `qwen2.5-vl:72b` when accuracy is critical.

### ⚡ Fast Draft Models

| Model | Size | Memory | Speed | Use case |
|-------|------|---------|-------|---------|
| `llama3.2:3b` | 3B | ~2GB | ~120 t/s | Quick drafts, simple tasks |
| `qwen2.5:3b` | 3B | ~2GB | ~120 t/s | Better quality than llama at same size |
| `gemma3:4b` | 4B | ~3GB | ~100 t/s | Google's efficient small |
| `phi4-mini` | 4B | ~3GB | ~100 t/s | Strong reasoning per parameter count |

**Recommendation:** `qwen2.5:3b` as the "cheap and fast" default for tasks that don't need heavy reasoning.

---

## 4. Integration Architecture for Paloma

### Current Architecture Summary

After reading the source:

- **`bridge/claude-cli.js`** (`ClaudeCliManager`): spawns `claude` subprocess, reads stdout as NDJSON stream, emits `claude_stream` / `claude_done` / `claude_error` events via callback
- **`bridge/codex-cli.js`** (`CodexCliManager`): spawns `codex` subprocess, same callback pattern, emits `codex_stream` / `codex_done` / `codex_error`
- **`bridge/pillar-manager.js`** (`PillarManager`): accepts `backends = { claude, codex }`, dispatches sessions to the right backend, accumulates output, emits WebSocket events to browser (`pillar_stream`, `pillar_done`, etc.)
- **`bridge/index.js`**: WebSocket server, handles `claude_chat` and `codex_chat` messages, wires all the pieces together

**The key pattern:** Each backend has a `chat({ prompt, model, sessionId, systemPrompt, cwd }, onEvent)` method that returns `{ requestId, sessionId }` and fires events asynchronously.

### Integration Options Analysis

#### Option A: OllamaManager Backend (Native Integration)

Create `bridge/ollama-manager.js` following the same pattern as `ClaudeCliManager`.

```javascript
// bridge/ollama-manager.js
export class OllamaCliManager {
  constructor() {
    this.sessions = new Map()    // requestId → { messages, model, abortController }
    this.baseURL = process.env.OLLAMA_HOST || 'http://localhost:11434'
    this.defaultNumCtx = 32768
  }

  chat({ prompt, model, sessionId, systemPrompt, cwd }, onEvent) {
    const requestId = randomUUID()
    // sessionId maps to conversation history (since Ollama is stateless)
    const history = sessionId ? (this.sessions.get(sessionId)?.messages || []) : []
    if (!sessionId) sessionId = randomUUID()
    
    const messages = [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      ...history,
      { role: 'user', content: prompt }
    ]
    
    const controller = new AbortController()
    this.sessions.set(sessionId, { messages, model, abortController: controller })
    
    // Start async streaming
    this._streamChat(requestId, sessionId, model, messages, controller, onEvent)
    
    return { requestId, sessionId }
  }

  async _streamChat(requestId, sessionId, model, messages, controller, onEvent) {
    // fetch + NDJSON streaming + emit ollama_stream/ollama_done/ollama_error
    // Accumulate assistant message, add to session history on done
  }

  stop(requestId) { /* abort the fetch */ }
}
```

Then in `pillar-manager.js`:
```javascript
const backends = { claude: cliManager, codex: codexManager, ollama: ollamaManager }
```

And in `_handleCliEvent`:
```javascript
const isStream = event.type === 'claude_stream' || event.type === 'codex_stream' || event.type === 'ollama_stream'
```

**Pros:**
- Full Paloma integration — Ollama becomes a first-class backend alongside Claude and Codex
- Streaming to browser works through existing `pillar_stream` events
- Pillars can be spawned with `backend: 'ollama'` and `model: 'qwen2.5-coder:32b'`
- Pillar system lifecycle (notifications, idle, completion) fully works
- No new WebSocket message types needed (or minimal additions)

**Cons:**
- Most implementation work (~150–200 lines)
- Session management is inverted: OllamaManager must maintain message history (Ollama is stateless). PillarManager's `--resume sessionId` pattern maps to "load conversation history for this sessionId"
- No tool-use/function-calling awareness built in (unlike Claude CLI which handles tool approval flows natively). Ollama does support tool_calls in the chat API though.

**Verdict: This is the right approach for making Ollama a pillar backend.** The implementation work is reasonable and the architecture fit is clean.

#### Option B: Ollama MCP Server

Create `mcp-servers/ollama.js` exposing tools like `ollama_chat`, `ollama_generate`, `ollama_embed`, `ollama_list_models`, `ollama_pull_model`.

**Pros:**
- ~100 lines of implementation
- Reuses existing MCP tool infrastructure
- Works immediately with the permission system and ToolConfirmation.vue
- Claude/Codex pillars can call Ollama as a sub-task tool

**Cons:**
- Ollama becomes a tool, not a peer model — no streaming to browser, just tool results
- MCP tools are synchronous from the pillar's perspective — entire Ollama response comes back as a single tool result string
- Cannot replace a pillar session — only augments Claude/Codex sessions with Ollama capabilities
- Adds latency vs direct API call

**Verdict: Good for "use Ollama as a helper" use case (like asking a fast local model to check something), but NOT suitable as a standalone pillar backend. Worth building alongside Option A.**

#### Option C: OpenAI-Compatible Proxy (Browser-Side)

Since Ollama exposes `/v1/chat/completions`, it could plug into the existing browser-side OpenRouter path by setting `baseURL: 'http://localhost:11434/v1'`.

**Pros:**
- Zero new bridge code — just configure an existing model selector
- Works immediately if Adam always uses Paloma locally

**Cons:**
- CORS issues: browser can't hit `localhost:11434` if Paloma is ever served from a different origin
- No pillar system integration — these are standalone chat sessions, not pillar sessions with lifecycle management
- System prompt handling differs from the pillar pattern
- The browser-side OpenRouter path doesn't have the same orchestration capabilities as bridge-managed sessions

**Verdict: Quick shortcut for testing, not a production integration path. Skip for now.**

#### Option D: Hybrid Approach (Recommended)

**Primary: Option A (OllamaManager backend)** for pillar integration.  
**Secondary: Simple MCP server** exposing just `ollama_embed` for the memory system upgrade.  
**Optional: OpenAI compat** documented but not built — Adam can use it ad-hoc from the browser model selector.

### Recommended Integration: OllamaManager

```
bridge/
  ollama-manager.js    ← new, ~150-200 lines
  index.js             ← add 'ollama' to backends, handle 'ollama_stop' message
  pillar-manager.js    ← add 'ollama_stream'/'ollama_done'/'ollama_error' to event handling

mcp-servers/
  ollama-embed.js      ← new, ~80 lines — exposes ollama_embed tool for memory system
```

**Session model for OllamaManager:**
- Session = conversation history (array of messages)
- `sessionId` = key into `sessions` Map
- On new session: empty history, add systemPrompt as first system message
- On resume: load history, append new user message, send all to API
- On completion: add assistant response to history
- Sessions expire after inactivity (same 30-min timeout pattern as pillar sessions)

**Event stream compatibility:**
- Ollama's streaming `message.content` delta → emit as `ollama_stream` with same `event.delta.type === 'text_delta'` shape, OR reuse `claude_stream` structure
- Recommended: emit `ollama_stream` but use the same `event` shape as Claude's `content_block_delta` so the frontend rendering code handles it uniformly with minimal changes

### Key Implementation Notes

1. **System prompt handling**: Unlike Claude CLI (`--append-system-prompt`), Ollama takes system as a message. On first turn, prepend `{ role: 'system', content: systemPrompt }`. On resume turns, system is already in history.

2. **Context window**: Always pass `options: { num_ctx: 32768 }` (or higher). Never rely on default 2048.

3. **Model health check**: On startup, check `GET /api/tags` to verify Ollama is running. If not, OllamaManager should fail gracefully, not crash the bridge.

4. **Tool calls**: Ollama supports `tools` in the chat API (for models that support function calling). If we want MCP tool loop for Ollama pillars, we'd need to implement the tool approval flow like Claude CLI gets via `--mcp-config`. This is advanced — start without tool calling, add it in a v2 if needed.

5. **Model availability**: Ollama requires models to be pulled before use. Consider adding `ollama_pull_model` as an MCP tool so Flow can manage models.

---

## 5. Ollama MCP Ecosystem

### Existing Projects

| Project | Description | Relevance |
|---------|-------------|-----------|
| `rawveg/ollama-mcp` | Full Ollama SDK as MCP tools — chat, manage models, embeddings | High — could adapt |
| `Jadael/OllamaClaude` | Lets Claude Code delegate tasks to local Ollama | Medium — different use case |
| `jonigl/mcp-client-for-ollama` | TUI MCP client that uses Ollama as the AI | Low |

**Key finding:** There are working MCP servers for Ollama. `rawveg/ollama-mcp` exposes the complete Ollama SDK as tools. We could use it directly or adapt it as `mcp-servers/ollama.js`.

### Custom Ollama MCP Server for Paloma

A minimal Paloma-specific Ollama MCP server (`mcp-servers/ollama.js`) would expose:

```
ollama_chat        — Single-turn chat with any Ollama model
ollama_generate    — Raw completion (no message format)  
ollama_embed       — Generate embeddings (for memory upgrade)
ollama_list_models — List available models
ollama_pull_model  — Download a model
```

This enables Claude/Codex pillars to use Ollama for sub-tasks without Ollama needing to be a full backend.

---

## 6. Local Embeddings Upgrade

### Current State
- File: `mcp-servers/memory.js`
- Model: `Xenova/all-MiniLM-L6-v2` via `@xenova/transformers`
- Dimensions: 384
- Max tokens: 512
- Loads ~200MB model into Node.js process memory
- Has keyword fallback while model loads (first startup is slow)

### Ollama Embedding Option

**Recommended model:** `nomic-embed-text`
- Pull: `ollama pull nomic-embed-text`
- Dimensions: **1024** (2.7x better than current)
- Max context: **8192 tokens** (16x better than current)
- API: `POST http://localhost:11434/api/embed`
- Performance: Very fast (embedding is cheap compute)

**Changes to `mcp-servers/memory.js`:**
```javascript
// Replace the embed() function:
async function embed(text) {
  try {
    const response = await fetch('http://localhost:11434/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'nomic-embed-text', input: text })
    })
    const data = await response.json()
    return data.embeddings[0]
  } catch (err) {
    console.error('[memory] Ollama embed failed, falling back to keyword:', err.message)
    return null
  }
}
// Update EMBEDDING_DIM = 1024
// Remove @xenova/transformers dependency
```

**Tradeoffs:**
- **Pro:** Significantly better semantic search quality, larger context window for rich memories
- **Pro:** Removes heavy `@xenova/transformers` NPM dependency (~2GB node_modules)
- **Pro:** No startup delay — Ollama is always running
- **Con:** Requires Ollama to be running (adds a dependency)
- **Con:** Existing embeddings are incompatible — need full re-embed of stored memories
- **Con:** Keyword fallback remains essential when Ollama is unavailable

**Migration strategy:**
1. Keep `EMBEDDING_DIM` configurable (env var or auto-detect from Ollama model)
2. Store embedding model name with each memory entry
3. On recall, if stored dims don't match current model, use keyword fallback for those entries
4. Or: one-time migration script to re-embed all memories

### Alternative: Keep Both

Keep Xenova as the local fallback, use Ollama as primary when available:
```javascript
const embedder = ollamaAvailable ? ollamaEmbed : xenovaEmbed
```

This is more robust but more complex. Given that Adam has Ollama as a dedicated tool, just switching fully to Ollama embeddings is cleaner.

---

## Architectural Recommendations Summary

### Short-term (high value, lower effort)
1. **Ollama MCP server** (`mcp-servers/ollama.js`) — lets any pillar call Ollama as a tool. ~80 lines. Useful immediately.
2. **Embeddings upgrade** — swap `memory.js` to use `nomic-embed-text` via Ollama. ~20 lines changed. Significant quality improvement.

### Medium-term (proper integration)
3. **OllamaManager backend** (`bridge/ollama-manager.js`) — makes Ollama a first-class pillar backend. ~150–200 lines. Enables `pillar_spawn({ backend: 'ollama', model: 'qwen2.5-coder:32b' })`.

### Not needed now
- OpenAI-compatible browser-side path — too limited for pillar workflow
- Full tool-calling loop for Ollama pillars — complex, tackle in v2

### Model Setup for Adam's Machine

Pull these models to get started:

```bash
# Coding (primary workhorse)
ollama pull qwen2.5-coder:32b

# Fast coding (quick tasks)
ollama pull qwen2.5-coder:7b

# Reasoning (for Scout/Chart work)
ollama pull qwen3:72b

# Embeddings (for memory system)
ollama pull nomic-embed-text

# Vision (optional but powerful)
ollama pull qwen2.5-vl:7b

# Fast general (cheap tokens)
ollama pull qwen2.5:3b
```

Approximate disk usage: ~100GB for all of the above. With 8TB storage, not a concern.

---

## Open Questions for Chart

1. **Tool calling for Ollama pillars?** Ollama supports function calling in its chat API. Should OllamaManager implement the MCP tool approval loop, or is Ollama-as-pillar useful without tool access?

2. **Backend selection UI?** How should Adam select `backend: 'ollama'` when spawning a pillar? Through a model selector in the browser, or through Flow's prompt?

3. **Always-on vs on-demand?** Should the bridge check Ollama availability at startup and expose it conditionally? Or always include it and let calls fail gracefully?

4. **Memory migration?** When upgrading embeddings, should we write a one-time migration script or accept that old memories get keyword-fallback treatment until re-queried?

5. **Naming convention?** The bridge currently handles `claude_chat` and `codex_chat` messages. Should Ollama be `ollama_chat` or should we refactor to a generic `local_chat` for all HTTP-based backends?

---

*Scout findings complete. Ready for Chart phase.*
