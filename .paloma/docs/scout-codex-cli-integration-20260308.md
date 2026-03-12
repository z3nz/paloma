# Scout: OpenAI Codex CLI — Integration Research

> **Date:** 2026-03-08
> **Scope:** Deep research on Codex CLI capabilities, architecture, and Paloma integration feasibility
> **Status:** Complete

---

## 1. What Codex CLI Can Do

### Overview

**Codex CLI** (`@openai/codex` v0.111.0) is OpenAI's local coding agent — a Rust binary distributed via npm. It reads/writes files, executes shell commands in a sandbox, and drives multi-turn conversations with OpenAI models.

- **Binary location:** `/home/adam/.local/share/nvm/v21.6.1/bin/codex` (symlink to Rust binary via thin JS wrapper)
- **Login:** ChatGPT account login (OAuth). Also supports API key auth for more model options.
- **State:** SQLite database at `~/.codex/state_5.sqlite`
- **Config:** `~/.codex/config.toml` (not yet created on this system)

### Core Capabilities

| Capability | Details |
|---|---|
| **Code generation** | Reads files, generates/edits code, multi-file changes |
| **Shell execution** | Runs bash commands in a sandboxed environment (Landlock on Linux) |
| **File operations** | Reads, creates, modifies files via `apply_patch` tool |
| **Web search** | Built-in `web_search` tool (interactive mode only, `--search` flag) |
| **Code review** | `codex review` — non-interactive review against branches/commits |
| **Image input** | Accepts PNG/JPEG via `-i` flag |
| **Session management** | Resume, fork, archive sessions; SQLite-backed persistence |
| **Multi-agent** | Experimental `multi_agent` feature flag with agent roles and spawning |
| **Skills** | Plugin-like system in `~/.codex/skills/` |
| **Structured output** | `--output-schema` forces JSON response matching a schema |
| **MCP client** | Connects to MCP servers configured in `config.toml` |
| **MCP server** | Can BE an MCP server via `codex mcp-server` (stdio) |
| **App server** | JSON-RPC protocol over stdio or WebSocket (`ws://`) |

### Models

With **ChatGPT account login** (current setup):
- **Default:** `gpt-5.1-codex-max` (reports itself as "GPT-5")
- **Limited selection:** Only the GPT-5.1-Codex model family is supported
- Models like `o3`, `o4-mini`, `codex-mini` are **not available** with ChatGPT login

With **API key auth:**
- Full model selection: `o3`, `o4-mini`, `gpt-4o`, `gpt-5.2`, etc.
- Custom model providers via `model_providers` config
- OpenRouter-compatible providers possible via `base_url` config

### Sandbox Modes

| Mode | Description |
|---|---|
| `read-only` | Can read files, cannot write or execute dangerous commands |
| `workspace-write` | Can write within the workspace directory |
| `danger-full-access` | Full filesystem and network access (no sandbox) |

Linux sandboxing uses **Landlock + seccomp** (built into the Rust binary).

### Approval Policies

| Policy | Behavior |
|---|---|
| `untrusted` | Only trusted commands (ls, cat, sed) run without approval |
| `on-request` | Model decides when to ask (used with `--full-auto`) |
| `never` | Never asks — all commands auto-approved |

### Config System

- **User config:** `~/.codex/config.toml`
- **Project config:** `.codex/config.toml` (in repo, like `.claude/` for Claude)
- **Profiles:** Named config profiles for switching configurations
- **CLI overrides:** `-c key=value` for any config key
- **Instruction files:** AGENTS.md (hierarchical, nearest-ancestor wins)

Key config properties relevant to integration:
- `model` — model selection
- `instructions` — system instructions (injected as system message)
- `developer_instructions` — developer role message
- `mcp_servers` — MCP server connections (stdio or HTTP URL)
- `approval_policy` — command approval behavior
- `sandbox_mode` — sandbox level
- `model_provider` / `model_providers` — custom LLM provider endpoints
- `agents` — multi-agent settings (max_threads, max_depth, roles)
- `project_doc_fallback_filenames` — alternatives to AGENTS.md

---

## 2. How It Compares to Claude CLI

### What's the Same

| Feature | Claude CLI | Codex CLI |
|---|---|---|
| CLI coding agent | Yes | Yes |
| Reads/writes files | Yes | Yes |
| Runs shell commands | Yes | Yes (sandboxed) |
| Multi-turn conversations | Yes | Yes |
| Session resume | `--resume` with session ID | `codex resume` with thread ID |
| MCP support | Client (via `--mcp-config`) | Client (via `config.toml`) AND server |
| Streaming JSON output | `--output-format stream-json` | `codex exec --json` |
| Project instructions | CLAUDE.md | AGENTS.md |
| Non-interactive mode | `claude -p "prompt"` | `codex exec "prompt"` |

### What's Different

| Aspect | Claude CLI | Codex CLI |
|---|---|---|
| **Runtime** | Node.js process | Rust binary (via npm wrapper) |
| **Model backend** | Anthropic API (Claude models) | OpenAI API (GPT-5, o3, o4, etc.) |
| **Sandbox** | No built-in sandbox | Built-in Landlock/seccomp sandbox |
| **Approval model** | Tool-by-tool permission | Policy-based (trusted/on-request/never) |
| **Tool system** | MCP tools via proxy | Native tools (shell, apply_patch) + MCP |
| **Structured output** | Not built-in | `--output-schema` for JSON schema enforcement |
| **Multi-agent** | Not built-in (Paloma adds this) | Experimental `multi_agent` feature flag |
| **App server mode** | Not available | JSON-RPC over stdio/WebSocket |
| **MCP server mode** | Not available | `codex mcp-server` exposes tools |
| **Web search** | Via MCP tools | Built-in `web_search` tool |
| **Code review** | Not built-in | `codex review` command |
| **State persistence** | Session files | SQLite database |
| **Auth** | API key (env var) | ChatGPT login (OAuth) or API key |
| **Streaming format** | Claude API events (content_block_delta, etc.) | Simpler JSONL (thread.started, item.completed, turn.completed) |

### Where Each Excels

**Claude CLI excels at:**
- Deep reasoning (Claude Opus)
- Long-context tasks (200K token window)
- MCP tool integration (Paloma's entire tool ecosystem)
- System prompt injection (custom instructions via `--append-system-prompt`)
- Paloma's pillar system is built around it

**Codex CLI excels at:**
- Built-in sandboxing (security without external tooling)
- Structured output (JSON schema enforcement)
- Code review (dedicated non-interactive review mode)
- App server mode (WebSocket JSON-RPC for rich IDE integration)
- MCP server mode (can be used AS a tool by other agents)
- Web search (native, no MCP required)
- Multi-agent spawning (experimental but built-in)

---

## 3. Integration Surface

### Path A: `codex exec --json` — Subprocess (like Claude CLI)

The most direct integration path. Fork `claude-cli.js` → `codex-cli.js`.

**Invocation:**
```bash
echo "prompt" | codex exec --json \
  -s workspace-write \
  -C /path/to/project \
  --ephemeral \
  -
```

Or with prompt as argument:
```bash
codex exec --json -s workspace-write -C /path "prompt text"
```

**JSONL Output Format:**
```jsonl
{"type":"thread.started","thread_id":"019ccbf7-f5c6-..."}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Here's what I found..."}}
{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/usr/bin/bash -lc 'ls -la'","status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"...","aggregated_output":"...","exit_code":0,"status":"completed"}}
{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"Done."}}
{"type":"turn.completed","usage":{"input_tokens":16075,"cached_input_tokens":13184,"output_tokens":227}}
```

**Item Types:**
- `agent_message` — text output from the model
- `command_execution` — shell command with output and exit code
- `error` — error messages

**Key Flags for Subprocess Use:**
- `--json` — JSONL event output to stdout
- `--ephemeral` — no session persistence
- `-s workspace-write` — sandbox level
- `-C /path` — working directory
- `-m model` — model override
- `-o /path/to/file` — write last message to file
- `--output-schema /path/to/schema.json` — structured JSON output
- `--full-auto` — no approval prompts (sandboxed)

**stdin for prompts:** Use `-` as the prompt argument to read from stdin. Supports piping.

**Multi-turn in exec:** Use `codex exec resume --last` or `codex exec resume <session_id>` to continue a previous session in exec mode.

**No approval handling in exec mode:** The `--ask-for-approval` flag is NOT available in exec mode. Commands either run (based on sandbox policy) or are rejected by the sandbox. This simplifies subprocess integration — no interactive approval needed.

**What's Missing vs Claude CLI subprocess:**
- No `--append-system-prompt` equivalent (use `--config 'instructions="..."'` or `developer-instructions` instead)
- No `--session-id` for custom session IDs (uses auto-generated thread IDs)
- No `--allowedTools` equivalent (sandbox policy handles this)
- No streaming text deltas in exec JSONL — only complete items
- `--search` (web search) is NOT available in exec mode

### Path B: `codex app-server` — WebSocket JSON-RPC

A richer integration path for full session lifecycle management.

**Start the server:**
```bash
codex app-server --listen ws://127.0.0.1:19193
```

**Protocol:** JSON-RPC 2.0 with:
- **Client → Server requests:** `initialize`, `thread/start`, `thread/resume`, `thread/fork`, `turn/start`, `turn/cancel`, etc.
- **Server → Client requests:** `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/tool/requestUserInput`, `item/tool/call` (dynamic tool calls)
- **Server → Client notifications:** `thread/started`, `turn/started`, `item.completed`, `item.started`, `turn/completed`, `thread/tokenUsage/updated`, etc.

**Key Advantages:**
- Full thread lifecycle management (start, resume, fork, archive)
- Streaming events for real-time UI updates
- Command approval handling (server asks client for permission)
- Dynamic tool call support (server can call client-provided tools)
- Concurrent threads
- Token usage tracking

**Key Challenges:**
- Complex protocol — many event types and request/response patterns
- Need to handle command approval prompts (or configure policy)
- Experimental API surface — may change between versions

### Path C: `codex mcp-server` — Codex as MCP Tool

The simplest integration. Codex becomes an MCP server that Paloma's bridge can connect to.

**Setup:** Add to Paloma's MCP config:
```json
{
  "mcpServers": {
    "codex": {
      "command": "codex",
      "args": ["mcp-server"]
    }
  }
}
```

**Exposed Tools:**

1. **`codex`** — Start a new session
   - `prompt` (required) — initial user prompt
   - `approval-policy` — untrusted/on-failure/on-request/never
   - `base-instructions` — custom system instructions (replaces defaults)
   - `developer-instructions` — developer role message
   - `model` — model override
   - `sandbox` — read-only/workspace-write/danger-full-access
   - `cwd` — working directory
   - `config` — arbitrary config overrides (object)
   - `profile` — config profile name
   - Returns: `{ threadId: string, content: string }`

2. **`codex-reply`** — Continue a conversation
   - `threadId` (required) — from previous `codex` call
   - `prompt` (required) — next user message
   - Returns: `{ threadId: string, content: string }`

**Key Advantages:**
- Zero code changes — just MCP config
- Claude CLI can call Codex tools naturally through Paloma's MCP proxy
- Multi-turn via `threadId` chaining
- Full control over instructions, model, sandbox per call

**Key Limitations:**
- Synchronous — each tool call blocks until Codex completes
- No streaming — only final output returned
- No real-time progress visibility in browser
- Approval handling is internal to Codex (not routed to Paloma browser UI)

### Path D: Codex Connects to Paloma's MCP Servers

Configure Codex to use Paloma's existing MCP infrastructure.

```toml
# ~/.codex/config.toml
[mcp_servers.paloma-fs]
command = "node"
args = ["path/to/mcp-servers/filesystem-server.js"]

[mcp_servers.paloma-git]
command = "node"
args = ["path/to/mcp-servers/git-server.js"]
```

Or connect to Paloma's SSE proxy:
```toml
[mcp_servers.paloma]
url = "http://localhost:19192/sse"
```

**Key Advantage:** Codex gets all of Paloma's tools without duplication.
**Key Limitation:** Codex would run independently of the pillar system — no bridge integration, no browser UI streaming, no callback mechanism.

---

## 4. Architectural Fit in Paloma

### Option 1: Codex as a Pillar Backend (Deep Integration)

**Concept:** A pillar session could use Codex instead of Claude CLI as its "brain."

**Implementation:** Fork `claude-cli.js` → `codex-cli.js`:
- Spawn `codex exec --json --ephemeral -s workspace-write -C <projectRoot>`
- Parse JSONL events (simpler than Claude's stream-json format)
- Map `item.completed` → accumulated output for PillarManager
- Map `turn.completed` → session complete callback

**PillarManager changes:**
- `_defaultModel()` returns Codex model names when backend is codex
- `_startCliTurn()` selects Claude or Codex subprocess based on config
- System prompt injection via `--config 'instructions="..."'` or `--config 'developer_instructions="..."'`
- No MCP config injection needed if using `--full-auto` sandbox mode (Codex has its own file/shell tools)

**Pros:**
- Full streaming to browser UI
- Pillar lifecycle management (callbacks, timeouts, etc.)
- Could run Claude and Codex pillars concurrently
- Forge on Claude, Review on Codex — play to each model's strengths

**Cons:**
- New subprocess manager to maintain
- Different event format parsing
- System prompt injection is different (no `--append-system-prompt`)
- No MCP tool routing through Paloma's proxy (Codex uses its own native tools)
- Sandbox may conflict with Paloma's MCP filesystem tools

### Option 2: Codex as MCP Tool (Light Integration)

**Concept:** Add `codex mcp-server` to Paloma's MCP server list. Claude CLI sessions can call Codex as a tool.

**Implementation:** Add to bridge MCP config:
```javascript
// In bridge startup, add codex as an MCP server
mcpManager.addServer('codex', {
  command: 'codex',
  args: ['mcp-server']
})
```

**Usage from Claude pillar:**
```
Use the codex tool to review the code changes:
codex({ prompt: "Review the changes in the last commit", sandbox: "read-only", cwd: "/home/adam/paloma" })
```

**Pros:**
- Minimal code changes (just MCP config)
- Claude orchestrates, Codex executes specific tasks
- Natural tool-call pattern — fits existing architecture
- Can leverage Codex's strengths (code review, structured output)

**Cons:**
- Synchronous blocking calls
- No streaming in browser during Codex execution
- Double-agent overhead (Claude + Codex both reasoning)

### Option 3: Codex App Server (WebSocket Integration)

**Concept:** Run `codex app-server --listen ws://127.0.0.1:19193` and build a `codex-app-client.js` in the bridge.

**Pros:**
- Rich protocol with full lifecycle management
- Could support concurrent Codex threads
- Streaming events for real-time UI
- Dynamic tool calls (Codex can call back to Paloma)

**Cons:**
- Complex protocol to implement
- Experimental API surface
- Significant bridge development
- Highest effort of all options

### Recommended Approach

**Phase 1 (Quick Win): Option 2 — Codex as MCP Tool**
- Add `codex mcp-server` to Paloma's MCP config
- Claude pillars can call `codex` and `codex-reply` tools
- Use for code review (Polish pillar), web search tasks, structured data extraction
- Zero code changes — just config

**Phase 2 (Deep Integration): Option 1 — Codex as Pillar Backend**
- Build `codex-cli.js` subprocess manager
- Enable model selection per pillar: Claude for reasoning-heavy work, Codex for code-heavy work
- Support concurrent execution: Claude Forge + Codex Forge on file-disjoint work units
- This aligns with the Recursive Flow Architecture plan

**Phase 3 (Future): Option 3 — App Server**
- Only if we need rich thread management or dynamic tool calling
- Could replace the subprocess model entirely for Codex sessions

---

## 5. Practical Assessment

### Working on This System

- **Version:** 0.111.0
- **Auth:** ChatGPT account login (successful)
- **Default model:** GPT-5.1-Codex-Max (reports as "GPT-5")
- **Model restriction:** Only GPT-5.1-Codex family with ChatGPT login. o3/o4-mini require API key auth.
- **Exec mode:** Working perfectly with `--json` flag
- **MCP server mode:** Working, exposes `codex` and `codex-reply` tools
- **Config:** No `config.toml` yet — using defaults

### Observed Token Usage

| Task | Input Tokens | Cached | Output Tokens |
|---|---|---|---|
| Simple question ("What is 2+2?") | 7,587 | 6,528 | 20 |
| List directory | 16,075 | 13,184 | 227 |
| Model name query | 7,589 | 6,656 | 52 |
| Structured output ("What is 2+2?" with schema) | 7,605 | 2,432 | 27 |

Base system prompt consumes ~7,500 tokens. Aggressive caching reduces repeat costs.

### Gotchas and Limitations

1. **ChatGPT login restricts models.** Only GPT-5.1-Codex family. For model diversity, need API key auth.
2. **`--search` not available in exec mode.** Web search only works in interactive mode.
3. **No streaming deltas in exec JSONL.** Only complete items — no incremental text streaming for real-time UI.
4. **No `--append-system-prompt` equivalent.** Must use config overrides for custom instructions.
5. **Sandbox may interfere with MCP tools.** If Codex is sandboxed to `workspace-write`, it can't access files outside the workspace via its native tools. MCP tools bypass this (they run in the MCP server process, not the sandbox).
6. **Structured output requires strict schemas.** `additionalProperties: false` is mandatory at all levels.
7. **`--full-auto` combines approval policy + sandbox.** Equivalent to `-a on-request --sandbox workspace-write`. Convenient but doesn't expose individual control in exec mode.
8. **Multi-agent is experimental.** The `multi_agent` feature flag enables agent spawning but the API is not stable.

### Event Format Comparison

**Claude CLI stream-json:**
```json
{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
{"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}
```

**Codex exec --json:**
```json
{"type":"thread.started","thread_id":"..."}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"..."}}
{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"...","aggregated_output":"...","exit_code":0}}
{"type":"turn.completed","usage":{"input_tokens":...,"output_tokens":...}}
```

Codex's format is simpler — complete items rather than streaming deltas. Easier to parse but less suitable for real-time UI streaming.

---

## 6. Key Files for Integration

### Paloma's Current Architecture (Read in This Session)

| File | Relevance |
|---|---|
| `bridge/claude-cli.js` | **Template for `codex-cli.js`** — subprocess spawning, event parsing, session management. 89 lines. |
| `bridge/pillar-manager.js` | **Core integration point** — `spawn()`, `_startCliTurn()`, `_handleCliEvent()` need model-backend abstraction. 430 lines. |
| `bridge/mcp-proxy-server.js` | **MCP routing** — add `codex` MCP server config here for Option 2. 280 lines. |
| `src/prompts/base.js` | **System prompt** — needs Codex-specific adaptations if used as pillar backend |
| `src/prompts/phases.js` | **Phase prompts** — pillar instructions would need Codex-compatible versions |

### Codex's Architecture

| Component | Location | Description |
|---|---|---|
| Binary | `~/.local/share/nvm/v21.6.1/lib/node_modules/@openai/codex/bin/` | Rust binary via JS wrapper |
| Config | `~/.codex/config.toml` (not yet created) | TOML configuration |
| State DB | `~/.codex/state_5.sqlite` | Session persistence |
| Skills | `~/.codex/skills/` | Plugin system |
| App server schema | Generated to `/tmp/codex-schema/` | JSON Schema for JSON-RPC protocol |

---

## 7. Recommendations for Chart

### Immediate Actions (No Code)
1. **Create `~/.codex/config.toml`** with basic settings (model, sandbox defaults)
2. **Create `AGENTS.md`** in Paloma repo root — Codex's equivalent of CLAUDE.md
3. **Test `codex mcp-server`** as an MCP server in Paloma's existing config

### Short-Term (Option 2 — MCP Tool)
1. Add `codex mcp-server` to Paloma's MCP server list
2. Create a `codex-review` convenience tool or pillar flow
3. Use Codex for Polish-phase code reviews — `codex({ prompt: "Review...", sandbox: "read-only" })`

### Medium-Term (Option 1 — Pillar Backend)
1. Build `bridge/codex-cli.js` — subprocess manager mirroring `claude-cli.js`
2. Abstract `PillarManager._startCliTurn()` to support both backends
3. Add `backend` parameter to `pillar_spawn` tool: `{ backend: "claude" | "codex" }`
4. Enable per-pillar model backend selection in DNA (`phases.js`)

### Architectural Questions for Chart
1. **Should Codex share Paloma's MCP tools?** If yes, needs MCP config injection (like Claude CLI). If no, Codex uses its own native tools (simpler but less integrated).
2. **How to handle system prompts?** Codex's `instructions` config replaces the default prompt entirely. `developer_instructions` adds a developer role message. Neither is identical to Claude's `--append-system-prompt`.
3. **Approval routing:** Should Codex tool approvals route to Paloma's browser UI? If subprocess mode, no — sandbox policy handles it. If app-server mode, yes — but adds complexity.
4. **Cost model:** ChatGPT login uses plan credits. API key uses per-token billing. Which is better for Paloma's usage patterns?
5. **Concurrency:** Can a Claude pillar and a Codex pillar run simultaneously on file-disjoint work? This would be the ultimate Recursive Flow upgrade.

---

## Appendix: Command Reference Quick Sheet

```bash
# Basic exec (non-interactive, JSONL output)
codex exec --json -s workspace-write -C /path "prompt"

# Exec with stdin prompt
echo "prompt" | codex exec --json -s read-only --ephemeral -

# Structured output
codex exec --json --output-schema schema.json -s read-only "prompt"

# Save last message to file
codex exec --json -o /tmp/output.txt -s read-only "prompt"

# Full auto (sandboxed, minimal approval)
codex exec --json --full-auto -C /path "prompt"

# Code review
codex review --base main
codex review --uncommitted
codex review --commit abc123

# MCP server mode
codex mcp-server

# App server mode (WebSocket)
codex app-server --listen ws://127.0.0.1:19193

# Session resume
codex resume --last "follow-up prompt"

# MCP server management
codex mcp add my-server -- node server.js
codex mcp list

# Feature flags
codex features list
codex features enable multi_agent

# Config override
codex -c 'model="o3"' -c 'sandbox_mode="workspace-write"' "prompt"
```
